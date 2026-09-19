/**
 * Avenora — 24-Hour Cloud Stream
 * cloud-stream.js
 *
 * Handles:
 *   - Creator dashboard: start / manage / stop a 24-hour cloud broadcast
 *   - Listener player: real-time synchronized playback from the Avenora backend
 *   - Real-time Now Playing sync via Firestore studioCloudStreamMusic
 *   - Duplicate stream prevention
 *   - Test mode (5-minute broadcasts, founder-only)
 *
 * Architecture:
 *   Creator configures → Avenora backend Cloud Stream service starts
 *   Backend writes Now Playing → studioCloudStreamMusic/{streamId}
 *   Listeners subscribe to that Firestore doc and seek to synchronized position
 *   Audio files served directly from the configured CDN
 *
 * Collections used:
 *   cloudStreams/{streamId}             — broadcast record
 *   studioCloudStreamMusic/{streamId}   — live Now Playing (backend-owned)
 *   studioPlaylists/{uid}/playlists/{plId} — creator's playlists
 *   cloudStreamTracks/{uid}/tracks/{trackId} — creator's track library
 */

'use strict';

import { initializeApp, getApps, getApp }
  from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, browserLocalPersistence, setPersistence
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
  collection, query, orderBy, limit, where, onSnapshot,
  serverTimestamp, documentId
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

/* ── Firebase config — Avenora (avenora-6e147) ─────────────────────── */
const _CFG = {
  apiKey:            'AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI',
  authDomain:        'avenora-6e147.firebaseapp.com',
  databaseURL:       'https://avenora-6e147-default-rtdb.firebaseio.com',
  projectId:         'avenora-6e147',
  storageBucket:     'avenora-6e147.firebasestorage.app',
  messagingSenderId: '389692647062',
  appId:             '1:389692647062:web:6a2dd06ade8bc92d3e84b7',
  measurementId:     'G-7ESV78Q6J3',
};

const _app  = getApps().length ? getApp() : initializeApp(_CFG);
const _auth = getAuth(_app);
const _db   = getFirestore(_app);

setPersistence(_auth, browserLocalPersistence).catch(() => {});

/* ── Avenora Backend URL ─────────────────────────────────────────────── */
// Resolved from runtime config.
// Priority: window.LU_CONFIG (set by the SPA's index.html) → postMessage AVN_CONFIG
// from the parent SPA frame → null (degraded / local mode).
// NOTE: When this page runs inside an <iframe> the parent's window.LU_CONFIG is
// NOT accessible (iframes have isolated windows). The parent sends it via
// postMessage { type: 'AVN_CONFIG', apiUrl } on load.
let _API_BASE = (() => {
  const raw = (typeof window !== 'undefined' && window.LU_CONFIG && window.LU_CONFIG.apiUrl)
    ? window.LU_CONFIG.apiUrl.replace(/\/api\/?$/, '') + '/api'
    : null;
  return raw;
})();

/**
 * Wait up to `maxMs` for _API_BASE to be populated (by the AVN_CONFIG postMessage).
 * This handles the race where the parent sends AVN_CONFIG slightly after the iframe
 * has already called _startApp but before csrStartBroadcast is invoked.
 */
async function _waitForApiBase(maxMs = 3000) {
  if (_API_BASE) return _API_BASE;
  const step = 100;
  let waited = 0;
  while (!_API_BASE && waited < maxMs) {
    await _sleep(step);
    waited += step;
  }
  return _API_BASE;
}

/**
 * Make an authenticated request to the AVENORA backend.
 * Attaches the Firebase ID token from the current user.
 */
async function _apiRequest(method, path, body) {
  if (!_API_BASE) throw new Error('Backend URL not configured. The Avenora backend engine is not reachable from this context.');
  const token = _user ? await _user.getIdToken().catch(() => null) : null;
  if (!token) throw new Error('Authentication required — Firebase ID token unavailable');
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(_API_BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
let _user         = null;
let _userData     = null;
let _streamId     = null;   // active stream ID (creator's own)
let _streamData   = null;   // cloudStreams Firestore doc data
let _artworkDataUrl = null; // base64 cover artwork
// Set to true after POST /api/cloud-radio/start succeeds so the client-side
// auto-advance queue writer knows the server engine is managing the queue.
let _engineRunning = false;

// Set to true when the parent SPA sends AVN_AUTH_TOKEN confirming sign-in.
// Even a uid-only message (token=null) counts as parent confirmation —
// it means the parent SPA verified the user is logged in.
let _parentConfirmedAuth = false;
// Set to true once we have called _startApp (prevents double-init).
let _appInitialised = false;

// Tracks whether we are currently polling for auth after parent confirmation.
let _waitForAuthInterval = null;

/* Listener player state */
let _player = {
  audio:       null,      // HTMLAudioElement
  playing:     false,
  trackId:     null,
  trackUrl:    null,
  trackDur:    0,
  trackStartedAt: 0,      // server timestamp when track started
  volume:      0.8,
  progressRaf: null,
  unsub:       null,      // Firestore Now Playing snapshot unsubscribe
  syncInterval: null,
  listenerCount: 0,
  broadcastTitle: '',
  hostName:    '',
};

/* Creator state */
let _creator = {
  playlists:    [],
  selectedPl:   null,
  queue:        [],
  activeUnsub:  null,
  healthInterval: null,
  expiryInterval: null,
};

/* Confirmation dialog callback */
let _confirmCallback = null;

/* ═══════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════ */

async function _startApp(user) {
  if (_appInitialised) return;
  _appInitialised = true;

  _show('csrLoading', false);
  _show('csrAuthGate', false);
  _user = user;
  try {
    const snap = await getDoc(doc(_db, 'users', user.uid));
    if (snap.exists()) _userData = snap.data();
  } catch(_) {}

  _setAuthBadge(_userData ? (_userData.displayName || _userData.username || 'You') : 'You');

  // When embedded inside the SPA iframe, update the back button to use the
  // parent's navigateTo() instead of a hard-coded URL.
  const isEmbedded = window.parent && window.parent !== window;
  if (isEmbedded) {
    const backBtn = _el('csrBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          if (typeof window.parent.navigateTo === 'function') {
            window.parent.navigateTo('hub');
          } else {
            window.parent.location.hash = '#cloudstream';
          }
        } catch(_) {
          // cross-origin fallback (shouldn't happen — same origin)
          window.location.href = '../index.html#cloudstream';
        }
      });
    }
    const authGateBackBtn = _el('csrAuthGateBackBtn');
    if (authGateBackBtn) {
      authGateBackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          if (typeof window.parent.navigateTo === 'function') {
            window.parent.navigateTo('hub');
          } else {
            window.parent.location.hash = '#hub';
          }
        } catch(_) {
          window.location.href = '../index.html#hub';
        }
      });
    }
  }

  const params = new URLSearchParams(window.location.search);
  const watchId = params.get('id') || params.get('watch') || params.get('stream');

  if (watchId) {
    _show('csrApp', true);
    _show('csrListenerPanel', true);
    await _initListenerMode(watchId);
  } else {
    _show('csrApp', true);
    await _initCreatorMode();
  }
}

let _authGateTimer = null;

// Parent SPA → iframe postMessage bridge.
// The iframe's own Firebase SDK (v12.18.0) restores the session from
// localStorage independently.  The postMessage bridge is a belt-and-
// suspenders signal that:
//   a) cancels the gate timer early (avoids brief "Sign In Required" flash),
//   b) starts an auth poll if the iframe's own onAuthStateChanged hasn't fired yet.
window.addEventListener('message', async (event) => {
  try {
    if (!event.data) return;

    // ── AVN_CONFIG: backend API URL (not needed in Firebase-only mode) ──────
    if (event.data.type === 'AVN_CONFIG') {
      const apiUrl = event.data.apiUrl || '';
      if (apiUrl && !_API_BASE) {
        _API_BASE = apiUrl.replace(/\/api\/?$/, '') + '/api';
      }
      return;
    }

    // ── AVN_AUTH_TOKEN: parent confirmed auth state ──────────────────────────
    if (event.data.type === 'AVN_AUTH_TOKEN') {
      // Mark parent as having confirmed auth.  Even a null uid counts —
      // it means the parent ran its own onAuthStateChanged and is telling us
      // the result.  We NEVER show the auth gate when the parent has sent this.
      _parentConfirmedAuth = true;

      // Cancel any pending gate timer immediately.
      if (_authGateTimer) { clearTimeout(_authGateTimer); _authGateTimer = null; }

      // If the app is already running, nothing more to do.
      if (_appInitialised) return;

      // Keep the loading spinner visible — do NOT show the auth gate.
      _show('csrLoading', true);
      _show('csrAuthGate', false);

      // If the iframe's own Firebase already has the user, start immediately.
      if (_auth.currentUser) {
        await _startApp(_auth.currentUser);
        return;
      }

      // If the parent says the user IS signed in (uid present) but the iframe's
      // Firebase hasn't resolved yet, poll until it does.
      // Max wait: 20 s (40 × 500 ms).  In practice it resolves in < 2 s.
      if (event.data.uid && !_waitForAuthInterval) {
        let _waitAttempts = 0;
        _waitForAuthInterval = setInterval(async () => {
          _waitAttempts++;
          if (_auth.currentUser) {
            clearInterval(_waitForAuthInterval);
            _waitForAuthInterval = null;
            if (!_appInitialised) await _startApp(_auth.currentUser);
          } else if (_waitAttempts >= 40) {
            clearInterval(_waitForAuthInterval);
            _waitForAuthInterval = null;
            // 20 s elapsed and still no user — Firebase may have failed to
            // restore the session.  Show the auth gate so the user can tap
            // "Back to Avenora" and re-enter normally.
            if (!_appInitialised) {
              _show('csrLoading', false);
              _show('csrAuthGate', true);
            }
          }
        }, 500);
      }
      // If parent sent null uid it means the user is genuinely not signed in —
      // onAuthStateChanged will handle showing the gate via the timer below.
    }
  } catch (_) {}
});

// ── Firebase own auth state change ──────────────────────────────────────────
// This fires from localStorage restoration — typically within 1-2 s of page load.
// It is the PRIMARY auth signal; postMessage above is secondary / belt-and-suspenders.
onAuthStateChanged(_auth, async user => {
  // Cancel any pending gate timer — auth has resolved one way or another.
  if (_authGateTimer) { clearTimeout(_authGateTimer); _authGateTimer = null; }

  // Cancel any parent-triggered auth poll — no longer needed.
  if (_waitForAuthInterval) { clearInterval(_waitForAuthInterval); _waitForAuthInterval = null; }

  if (user) {
    // Signed-in user found — start the app.
    await _startApp(user);
  } else if (!_appInitialised) {
    // No user yet.  Firebase has definitively returned null from localStorage.
    //
    // Two cases:
    //   A) Parent has already sent AVN_AUTH_TOKEN → parent is still working;
    //      NEVER show the gate — let the parent poll drive the next attempt.
    //      Set a very long safety timer that only fires if everything stalls.
    //   B) No parent message yet (standalone open or parent slow to send) →
    //      give 15 s for the parent to arrive before showing the gate.
    //
    // In both cases the timer is cancelled the moment a signed-in user arrives
    // (either via a second onAuthStateChanged or via the poll in the message handler).
    if (_parentConfirmedAuth) {
      // Parent already confirmed — do not show gate.  Just keep the spinner.
      // No timer needed — the parent's poll will call _startApp when Firebase resolves.
      return;
    }
    // No parent confirmation yet — start a grace period.
    const gateDelay = 15000;
    _authGateTimer = setTimeout(() => {
      _authGateTimer = null;
      // Final check: if parent has since confirmed auth, do NOT show the gate.
      if (!_appInitialised && !_parentConfirmedAuth) {
        _show('csrLoading', false);
        _show('csrAuthGate', true);
        _show('csrApp', false);
        _setAuthBadge('Sign In');
      }
    }, gateDelay);
  }
});

/* ═══════════════════════════════════════════════════════
   CREATOR MODE
═══════════════════════════════════════════════════════ */
async function _initCreatorMode() {
  // Check for an already-active stream belonging to this user
  try {
    const snap = await getDocs(query(
      collection(_db, 'cloudStreams'),
      where('uid', '==', _user.uid),
      where('status', 'in', ['active', 'starting', 'recovering']),
      limit(1)
    ));
    if (snap.docs.length) {
      const d = snap.docs[0];
      _streamId   = d.id;
      _streamData = d.data();
      _showActiveStream();
    } else {
      _showCreateForm();
    }
  } catch (e) {
    console.error('[CSR] initCreatorMode error:', e);
    _showCreateForm();
  }

  // Load playlists for the create form (background)
  _loadPlaylists();

  // Load broadcast history
  _loadHistory();
}

function _showActiveStream() {
  _show('csrStatusPanel', true);
  _show('csrActiveBanner', true);
  _show('csrCreatePanel', false);
  _renderStatusPanel();
  _startHealthMonitor();
  _startExpiryCountdown();
  _subscribeNowPlaying(_streamId);

  // Also show listener player below so creator can monitor the broadcast
  _show('csrListenerPanel', true);
  _initListenerForStream(_streamId, _streamData);
}

function _showCreateForm() {
  _show('csrStatusPanel', false);
  _show('csrActiveBanner', false);
  _show('csrCreatePanel', true);
  _renderCreateForm();
  _show('csrHistoryPanel', true);
}

/* ═══════════════════════════════════════════════════════
   STATUS PANEL RENDER
═══════════════════════════════════════════════════════ */
function _renderStatusPanel() {
  if (!_streamData) return;
  const d = _streamData;

  _setStatusBadge(d.status || 'unknown');

  _el('csrStreamId').textContent   = 'ID: ' + (_streamId || '—');
  _el('csrInfoTitle').textContent  = d.streamName     || '—';
  _el('csrInfoHost').textContent   = d.displayName    || (_userData && (_userData.displayName || _userData.username)) || '—';
  _el('csrInfoCategory').textContent = d.category     || '—';
  _el('csrInfoStarted').textContent  = d.startedAt ? _fmtTime(d.startedAt.toMillis ? d.startedAt.toMillis() : d.startedAt) : '—';
  _el('csrInfoExpires').textContent  = d.expiresAt ? new Date(d.expiresAt).toLocaleString() : '—';
  _el('csrInfoListeners').textContent = d.viewerCount || '0';
  // Worker status is derived from studioCloudStreamMusic, not the broadcast doc.
  // _checkHealth updates this element via Firestore; seed it as 'starting' on first render.
  const workerEl = _el('csrInfoWorker');
  if (workerEl && workerEl.textContent === '—') workerEl.textContent = 'starting';
}

function _setStatusBadge(status) {
  const el = _el('csrStatusBadge');
  if (!el) return;
  const map = {
    active:    ['csr-status-live',    '&#128308; LIVE'],
    starting:  ['csr-status-starting','&#9203; STARTING'],
    recovering:['csr-status-warn',    '&#9888; RECOVERING'],
    stopping:  ['csr-status-warn',    '&#9209; STOPPING'],
    stopped:   ['csr-status-offline', '&#9209; ENDED'],
    ended:     ['csr-status-offline', '&#9209; ENDED'],
    failed:    ['csr-status-error',   '&#10060; ERROR'],
    offline:   ['csr-status-offline', '&#9898; OFFLINE'],
    unknown:   ['csr-status-offline', '&#9898; OFFLINE'],
  };
  const [cls, label] = map[status] || map.unknown;
  el.className = 'csr-status-badge ' + cls;
  el.innerHTML = label;
}

/* ═══════════════════════════════════════════════════════
   HEALTH MONITOR (creator)
═══════════════════════════════════════════════════════ */
function _startHealthMonitor() {
  _stopHealthMonitor();
  _creator.healthInterval = setInterval(_checkHealth, 30000);
  _checkHealth(); // immediate
}
function _stopHealthMonitor() {
  if (_creator.healthInterval) { clearInterval(_creator.healthInterval); _creator.healthInterval = null; }
}

async function _checkHealth() {
  if (!_streamId) return;
  try {
    let backendAnswered = false;

    // Primary: ask the backend engine for real server-side status.
    if (_API_BASE) {
      try {
        const data = await _apiRequest('GET', `/cloud-radio/status/${_streamId}`);
        backendAnswered = true;
        if (data.success && data.status) {
          const s = data.status;
          if (s.status === 'running') _engineRunning = true;
          _el('csrInfoWorker').textContent = s.status || 'running';
          if (s.currentTrack) {
            _el('csrNpTitle').textContent  = s.currentTrack.title  || '—';
            _el('csrNpArtist').textContent = s.currentTrack.artist || '';
            _el('csrNpNext').textContent   = s.nextTrack ? 'Next: ' + s.nextTrack.title : '';
          }
        } else if (data.success && !data.running) {
          _engineRunning = false;
          _el('csrInfoWorker').textContent = 'offline';
        }
      } catch (_apiErr) {
        backendAnswered = false;
      }
    }

    // Firestore: read cloudStreams for status + listener count.
    const cloudSnap = await getDoc(doc(_db, 'cloudStreams', _streamId));
    if (cloudSnap.exists()) {
      const cs = cloudSnap.data();
      if (_streamData) {
        _streamData.status      = cs.status;
        _streamData.viewerCount = cs.viewerCount || 0;
      }
      _setStatusBadge(cs.status);
      _el('csrInfoListeners').textContent = cs.viewerCount || '0';
      if (!backendAnswered) {
        const wStatus = cs.workerStatus || 'pending';
        _el('csrInfoWorker').textContent = wStatus;
        if (wStatus === 'running') _engineRunning = true;
      }
    }

    // Check expiry
    if (_streamData && _streamData.expiresAt) {
      const remain = _streamData.expiresAt - Date.now();
      if (remain <= 0) {
        _streamExpired();
      }
    }
  } catch(_) {
    // Temporarily unreachable — non-fatal
  }
}

/* ═══════════════════════════════════════════════════════
   EXPIRY COUNTDOWN
═══════════════════════════════════════════════════════ */
function _startExpiryCountdown() {
  if (_creator.expiryInterval) clearInterval(_creator.expiryInterval);
  _creator.expiryInterval = setInterval(_tickExpiry, 1000);
  _tickExpiry();
}
function _tickExpiry() {
  if (!_streamData || !_streamData.expiresAt) return;
  const remain = _streamData.expiresAt - Date.now();
  const el = _el('csrInfoRemaining');
  if (remain <= 0) {
    if (el) el.textContent = 'EXPIRED';
    _streamExpired();
    return;
  }
  if (el) el.textContent = _fmtDuration(Math.floor(remain / 1000));
}
function _streamExpired() {
  if (_creator.expiryInterval) { clearInterval(_creator.expiryInterval); _creator.expiryInterval = null; }
  _setStatusBadge('ended');
  _toast('Your 24-hour cloud broadcast has ended.', 'info');
}

/* ═══════════════════════════════════════════════════════
   NOW PLAYING SYNC (Firestore real-time)
═══════════════════════════════════════════════════════ */
function _subscribeNowPlaying(streamId) {
  if (_player.unsub) { try { _player.unsub(); } catch(_) {} }
  _player.unsub = onSnapshot(
    doc(_db, 'studioCloudStreamMusic', streamId),
    snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      // Update creator status panel
      _el('csrNpTitle').textContent  = d.currentTitle  || '—';
      _el('csrNpArtist').textContent = d.currentArtist || '';
      _el('csrNpNext').textContent   = d.nextTitle ? 'Next: ' + d.nextTitle : '';
      // Update listener player if same track is playing
      _syncListenerToNowPlaying(d);
    },
    err => console.warn('[CSR] NowPlaying snapshot error:', err.message)
  );
}

/* ═══════════════════════════════════════════════════════
   CREATE BROADCAST FORM
═══════════════════════════════════════════════════════ */
function _renderCreateForm() {
  // Reveal test mode option only for founders
  const isFounder = _userData && _userData.role === 'founder';
  const dur = _el('csrFormDuration');
  if (dur) {
    // Show 5-min test option only to founders
    const testOpt = dur.querySelector('option[value="5"]');
    if (testOpt) testOpt.style.display = isFounder ? '' : 'none';
  }
  const hint = _el('csrTestModeHint');
  if (hint && dur) {
    dur.addEventListener('change', () => {
      hint.style.display = (dur.value === '5' && isFounder) ? '' : 'none';
    });
  }
}

async function _loadPlaylists() {
  const el = _el('csrPlaylistSelector');
  if (!el) return;
  try {
    const snap = await getDocs(query(
      collection(_db, 'studioPlaylists', _user.uid, 'playlists'),
      orderBy('createdAt', 'desc'),
      limit(50)
    ));
    _creator.playlists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderPlaylistSelector();
  } catch (e) {
    el.innerHTML = '<div class="csr-hint">Could not load playlists. Try uploading music in 24-Hour Studio first.</div>';
  }
}

function _renderPlaylistSelector() {
  const el = _el('csrPlaylistSelector');
  if (!el) return;
  if (!_creator.playlists.length) {
    el.innerHTML = '<div class="csr-hint">No playlists found. <a class="csr-link" href="/frontend/index.html#dj">Go to 24-Hour Studio</a> to create a playlist and upload tracks.</div>';
    return;
  }
  el.innerHTML = _creator.playlists.map(pl => {
    const sel = _creator.selectedPl && _creator.selectedPl.id === pl.id;
    return `<button class="csr-pl-btn${sel ? ' selected' : ''}" onclick="csrSelectPlaylist('${_esc(pl.id)}')">
      <span class="csr-pl-name">${_esc(pl.name)}</span>
      <span class="csr-pl-count">${(pl.trackIds || []).length} tracks</span>
    </button>`;
  }).join('');
}

window.csrSelectPlaylist = async function(plId) {
  const pl = _creator.playlists.find(p => p.id === plId);
  if (!pl) return;
  _creator.selectedPl = pl;
  _renderPlaylistSelector();
  // Load track objects
  _creator.queue = [];
  const el = _el('csrQueuePreview');
  if (el) { el.style.display = ''; el.innerHTML = '<div class="csr-hint">Loading tracks…</div>'; }
  try {
    const ids = pl.trackIds || [];
    if (!ids.length) {
      if (el) el.innerHTML = '<div class="csr-hint">This playlist has no tracks yet.</div>';
      return;
    }
    // Batch-fetch in chunks of 30 (Firestore 'in' query limit)
    const chunks = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const results = [];
    for (const chunk of chunks) {
      const snap = await getDocs(query(
        collection(_db, 'cloudStreamTracks', _user.uid, 'tracks'),
        where(documentId(), 'in', chunk)
      ));
      snap.docs.forEach(d => results.push({ id: d.id, ...d.data() }));
    }
    // Order by original trackIds order
    _creator.queue = ids.map(id => results.find(r => r.id === id)).filter(Boolean);
    _renderQueuePreview();
  } catch (e) {
    if (el) el.innerHTML = '<div class="csr-hint">Could not load tracks: ' + _esc(e.message) + '</div>';
  }
};

function _renderQueuePreview() {
  const el = _el('csrQueuePreview');
  if (!el) return;
  const q = _creator.queue;
  if (!q.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  const totalSecs = q.reduce((a, t) => a + (t.duration || 0), 0);
  el.innerHTML =
    `<div class="csr-queue-header">${q.length} tracks · ${_fmtDuration(totalSecs)} total</div>` +
    `<div class="csr-queue-list">` +
    q.slice(0, 10).map((t, i) =>
      `<div class="csr-queue-item">
        <span class="csr-queue-num">${i + 1}</span>
        <div class="csr-queue-info">
          <div class="csr-queue-title">${_esc(t.title || 'Untitled')}</div>
          <div class="csr-queue-artist">${_esc(t.artist || '')}</div>
        </div>
        <span class="csr-queue-dur">${_fmtDuration(t.duration || 0)}</span>
      </div>`
    ).join('') +
    (q.length > 10 ? `<div class="csr-queue-more">+ ${q.length - 10} more tracks</div>` : '') +
    `</div>`;
}

/* ═══════════════════════════════════════════════════════
   START BROADCAST
═══════════════════════════════════════════════════════ */
window.csrStartBroadcast = async function() {
  const btn = _el('csrStartBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Starting…'; }

  try {
    // 1. Auth check
    if (!_user) throw new Error('Authentication required. Please sign in.');

    // 2. Validate playlist
    if (!_creator.selectedPl) throw new Error('No audio tracks selected. Please select a playlist first.');
    // Accept any track that has a playable URL regardless of status field —
    // different upload paths (Studio upload vs profile music) may not set status:'ready'.
    const validTracks = _creator.queue.filter(t => t.url || t.downloadURL || t.musicUrl);
    if (!validTracks.length) throw new Error('No playable audio tracks found in the selected playlist. Make sure uploaded tracks have a valid audio URL.');

    // 3. Duration limit
    const durEl = _el('csrFormDuration');
    let durationMinutes = parseInt(durEl ? durEl.value : '1440', 10);
    const maxDuration = 1440; // 24 hours — backend enforces this too
    const isFounder = _userData && _userData.role === 'founder';
    if (durationMinutes === 5 && !isFounder) {
      throw new Error('Test mode is only available to founders.');
    }
    if (durationMinutes > maxDuration) {
      durationMinutes = maxDuration;
    }

    // 4. Duplicate stream check
    const dupSnap = await getDocs(query(
      collection(_db, 'cloudStreams'),
      where('uid', '==', _user.uid),
      where('status', 'in', ['active', 'starting', 'recovering']),
      limit(1)
    ));
    if (dupSnap.docs.length) {
      _show('csrDuplicateWarn', true);
      _streamId   = dupSnap.docs[0].id;
      _streamData = dupSnap.docs[0].data();
      throw new Error('Broadcast already active — opening your existing broadcast.');
    }

    // 5. Build stream ID and config
    const streamId = _user.uid + '_' + Date.now();
    _streamId = streamId;
    const title   = (_el('csrFormTitle')    || {}).value?.trim() || 'CloudStream by ' + (_userData?.displayName || _user.uid);
    const desc    = (_el('csrFormDesc')     || {}).value?.trim() || '';
    const cat     = (_el('csrFormCategory') || {}).value || 'Music';
    const shuffle = (_el('csrFormShuffle')  || {}).checked || false;
    const repeat  = (_el('csrFormRepeat')   || {}).checked !== false;

    _show('csrStartingProgress', true);
    _show('csrValidationError', false);
    _renderHandoffStep(0, 'Preparing broadcast…');

    // 6. Create Firestore record
    await setDoc(doc(_db, 'cloudStreams', streamId), {
      uid:            _user.uid,
      displayName:    _userData?.displayName || _userData?.username || '',
      streamName:     title,
      description:    desc,
      category:       cat,
      theme:          'avenora',
      durationMinutes,
      status:         'starting',
      viewerCount:    0,
      coverArt:       _artworkDataUrl || '',
      createdAt:      serverTimestamp(),
      startedAt:      null,
      expiresAt:      null,
      workerStatus:   'pending',
      lastHeartbeat:  null,
      musicPlaylistId: _creator.selectedPl.id
    });
    _streamData = { uid: _user.uid, streamName: title, status: 'starting', durationMinutes };
    _renderHandoffStep(1, 'Saving broadcast configuration…');
    await _sleep(400);

    // 7. Build music queue — no longer calls Cloudflare Worker
    _renderHandoffStep(2, 'Configuring broadcast…');
    const musicQueue = validTracks.map(t => ({
      id:       t.id,
      title:       t.title    || t.name   || 'Untitled',
      artist:      t.artist   || t.artist_name || '',
      url:         t.url      || t.downloadURL || t.musicUrl || '',
      storagePath: t.storagePath || '',
      duration:    t.duration || t.durationSecs || 0
    }));

    // 8. Start the real server-side cloud radio engine via the AVENORA backend.
    //    This call is MANDATORY — if it fails the broadcast is aborted and the
    //    user sees a real error.  We never report LIVE without a running engine.
    _renderHandoffStep(2, 'Starting cloud radio engine…');

    // Wait briefly for _API_BASE in case the AVN_CONFIG postMessage hasn't arrived yet.
    const apiBase = await _waitForApiBase(3000);
    if (!apiBase) {
      // Clean up the Firestore record we already wrote
      updateDoc(doc(_db, 'cloudStreams', streamId), { status: 'failed', workerStatus: 'unavailable' }).catch(() => {});
      throw new Error('Cannot reach the Avenora backend. Make sure you are signed in and have a network connection, then try again.');
    }

    console.info('[CSR] Sending /cloud-radio/start — streamId=' + streamId + ' tracks=' + musicQueue.length + ' apiBase=' + apiBase);

    let engineResponse;
    try {
      engineResponse = await _apiRequest('POST', '/cloud-radio/start', {
        streamId,
        uid:             _user.uid,
        queue:           musicQueue,
        shuffle,
        repeat,
        durationMinutes,
      });
    } catch (apiErr) {
      console.error('[CSR] Backend engine start failed:', apiErr.message);
      // Clean up — mark the stream record as failed so it doesn't show as LIVE
      updateDoc(doc(_db, 'cloudStreams', streamId), { status: 'failed', workerStatus: 'error', engineError: apiErr.message }).catch(() => {});
      throw new Error('Cloud Radio engine failed to start: ' + apiErr.message);
    }

    _engineRunning = true;
    _renderHandoffStep(3, 'Engine running…');
    console.info('[CSR] Engine started — response:', engineResponse.message, 'status:', engineResponse.status?.status, 'track:', engineResponse.status?.currentTrack?.title);

    // 9. Use the server's authoritative timestamps.
    //    The backend already wrote status:'active', startedAt, and workerStatus:'running'
    //    to Firestore after engine.startSession() succeeded.
    //    We only need to publish to liveRooms (discovery feed) and update our local state.
    const serverStartedAt = engineResponse.startedAt || Date.now();
    const expiresAt       = engineResponse.expiresAt  || (serverStartedAt + durationMinutes * 60 * 1000);

    // Publish to liveRooms so the discovery feed picks it up
    await setDoc(doc(_db, 'liveRooms', _user.uid), {
      creatorId:     _user.uid,
      creatorSource: 'avenora',
      roomId:        _user.uid,
      hostId:        _user.uid,
      hostName:      _userData?.displayName || _userData?.username || '',
      hostUsername:  _userData?.username    || '',
      hostAvatar:    _userData?.avatar || _userData?.profilePicture || _user.photoURL || '',
      title,
      description:   desc,
      category:      cat,
      coverArt:      _artworkDataUrl || '',
      status:        'live',
      isLive:        true,
      type:          '24hour_cloudstream',
      cloudStreamId: streamId,
      startedAt:     serverTimestamp(),
      expiresAt:     new Date(expiresAt).toISOString(),
      viewers:       0,
      likes:         0,
      createdAt:     serverTimestamp(),
      updatedAt:     serverTimestamp()
    });

    _streamData = {
      uid: _user.uid, streamName: title, status: 'active', durationMinutes,
      startedAt: serverStartedAt, expiresAt, category: cat,
      displayName: _userData?.displayName || ''
    };

    _renderHandoffStep(4, 'Broadcast is LIVE! Engine running 24/7.');
    await _sleep(800);

    _show('csrStartingProgress', false);
    _show('csrCreatePanel', false);
    _showActiveStream();

    _toast('&#9925; Cloud Radio is LIVE! The server will keep playing even when you close this tab.', 'success');

  } catch (e) {
    console.error('[CSR] startBroadcast error:', e);
    _show('csrStartingProgress', false);
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128308; GO LIVE FOR 24 HOURS'; }
    if (_streamId && e.message && e.message.includes('already active')) {
      _showActiveStream();
    } else {
      _showError('csrValidationError', e.message || 'Could not start broadcast.');
      if (_streamId) {
        // Mark failed
        updateDoc(doc(_db, 'cloudStreams', _streamId), { status: 'failed' }).catch(() => {});
      }
    }
    _streamId = null;
  }
};

function _renderHandoffStep(step, label) {
  const el = _el('csrHandoffSteps');
  if (!el) return;
  const steps = [
    'Preparing broadcast…',
    'Saving broadcast configuration…',
    'Configuring broadcast…',
    'Broadcast configured…',
    'Broadcast is LIVE!',
  ];
  el.innerHTML = steps.map((s, i) => {
    const done   = i < step;
    const active = i === step;
    const icon   = done ? '&#10003;' : active ? '&#9203;' : '&#9675;';
    return `<div class="csr-handoff-step${done ? ' done' : active ? ' active' : ''}">
      <span class="csr-handoff-icon">${icon}</span>
      <span>${_esc(i === step ? label : s)}</span>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   STOP BROADCAST
═══════════════════════════════════════════════════════ */
window.csrConfirmStop = function() {
  _showConfirm(
    'End Cloud Broadcast?',
    'This will stop the broadcast for all listeners. The cloud worker will be shut down. This cannot be undone.',
    _stopBroadcast
  );
};

async function _stopBroadcast() {
  const btn = _el('csrStopBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Stopping…'; }
  _stopHealthMonitor();
  _engineRunning = false;

  const sid = _streamId;

  // 1. Stop the server-side engine
  if (_API_BASE && sid) {
    try {
      await _apiRequest('POST', '/cloud-radio/stop', { streamId: sid });
    } catch (_) {}
  }

  // 2. Update Firestore records
  try {
    if (sid) {
      await updateDoc(doc(_db, 'cloudStreams', sid), {
        status: 'stopped', stoppedAt: serverTimestamp(), stoppedBy: 'creator', workerStatus: 'stopped'
      }).catch(() => {});
      await updateDoc(doc(_db, 'studioCloudStreamMusic', sid), {
        status: 'stopped', stoppedAt: serverTimestamp()
      }).catch(() => {});
    }
    await updateDoc(doc(_db, 'liveRooms', _user.uid), {
      isLive: false, status: 'ended', updatedAt: serverTimestamp()
    }).catch(() => {});
  } catch(_) {}

  if (_player.unsub) { try { _player.unsub(); } catch(_) {} _player.unsub = null; }
  _stopPlayerAudio();
  _streamId   = null;
  _streamData = null;
  _show('csrStatusPanel', false);
  _show('csrActiveBanner', false);
  _show('csrListenerPanel', false);
  _show('csrCreatePanel', true);
  _renderCreateForm();
  _toast('Cloud broadcast ended.', 'info');
}

/* ═══════════════════════════════════════════════════════
   SKIP TRACK
═══════════════════════════════════════════════════════ */
window.csrSkipTrack = async function() {
  if (!_streamId || !_user) return;
  try {
    // First try the server-side engine
    if (_API_BASE) {
      await _apiRequest('POST', '/cloud-radio/skip', { streamId: _streamId });
      _toast('Skipping to next track…', 'info');
      return;
    }
    // Fallback: advance Firestore directly for client-side playback
    const musicSnap = await getDoc(doc(_db, 'studioCloudStreamMusic', _streamId));
    if (!musicSnap.exists()) { _toast('No active music state found.', 'error'); return; }
    const ms = musicSnap.data();
    const queue = ms.queue || [];
    if (!queue.length) { _toast('Queue is empty.', 'info'); return; }
    const nextIndex = ((ms.queueIndex || 0) + 1) % queue.length;
    const nextTrack = queue[nextIndex] || {};
    const _afterSkip = queue[(nextIndex + 1) % queue.length] || {};
    await updateDoc(doc(_db, 'studioCloudStreamMusic', _streamId), {
      queueIndex:      nextIndex,
      currentTrackId:  nextTrack.id        || '',
      currentTitle:    nextTrack.title     || '',
      currentArtist:   nextTrack.artist    || '',
      currentTrackUrl: nextTrack.url       || nextTrack.downloadURL || '',
      currentDuration: nextTrack.duration  || 0,
      trackStartedAt:  Date.now(),
      currentElapsed:  0,
      nextTrackId:     _afterSkip.id       || '',
      nextTitle:       _afterSkip.title    || '',
      nextArtist:      _afterSkip.artist   || '',
      status:          'playing',
      updatedAt:       serverTimestamp()
    });
    _toast('Skipping to next track…', 'info');
  } catch (e) {
    _toast('Could not skip: ' + e.message, 'error');
  }
};

/* ═══════════════════════════════════════════════════════
   SCROLL HELPERS
═══════════════════════════════════════════════════════ */
window.csrScrollToStream = function() {
  const el = _el('csrStatusPanel');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
};
window.csrScrollToPlaylist = function() {
  // Navigate to Creator Studio where playlists are managed.
  // Use the SPA's navigateTo() if available (embedded mode), otherwise use hash navigation.
  if (window.parent && window.parent !== window && typeof window.parent.navigateTo === 'function') {
    try { window.parent.navigateTo('cloudstudio'); return; } catch(_) {}
  }
  window.location.href = '../index.html#cloudstudio';
};
window.csrOpenExistingStream = function() {
  _show('csrDuplicateWarn', false);
  _showActiveStream();
};

/* ═══════════════════════════════════════════════════════
   LISTENER MODE (URL ?id=STREAMID)
   Reads stream state from Firestore directly.
   No Cloudflare Worker dependency.
═══════════════════════════════════════════════════════ */
async function _initListenerMode(streamId) {
  try {
    // Load stream record from Firestore (cloudStreams collection)
    const streamSnap = await getDoc(doc(_db, 'cloudStreams', streamId));

    if (!streamSnap.exists()) {
      _showPlayerOffline('Broadcast not found.');
      return;
    }

    const data = streamSnap.data();

    if (data.status !== 'active' && data.status !== 'recovering' && data.status !== 'starting') {
      _showPlayerOffline('This broadcast has ended.');
      return;
    }

    const streamData = {
      streamName:  data.streamName  || 'Avenora Cloud Radio',
      displayName: data.displayName || '',
      category:    data.category    || '',
      viewerCount: data.viewerCount || 0,
      startedAt:   data.startedAt?.toMillis?.() || Date.now(),
      expiresAt:   data.expiresAt   || 0,
      status:      data.status
    };

    _player.trackStartedAt = Date.now();
    _show('csrListenerPanel', true);
    await _initListenerForStream(streamId, streamData);

  } catch (e) {
    console.warn('[CSR] Firestore stream load failed:', e.message);
    _show('csrListenerPanel', true);
    await _initListenerForStream(streamId, { streamName: 'Avenora Cloud Radio', displayName: '' });
  }
}

async function _initListenerForStream(streamId, streamData) {
  _player.broadcastTitle = streamData?.streamName || 'Avenora Cloud Radio';
  _player.hostName       = streamData?.displayName || streamData?.hostName || '';

  // Update player UI header
  _setText('csrPlayerBroadcastTitle', _player.broadcastTitle);
  _setText('csrPlayerHost', _player.hostName ? 'by ' + _player.hostName : '');

  // Handle cover artwork
  if (streamData?.coverArt) {
    const art = _el('csrPlayerArtwork');
    if (art) art.innerHTML = `<img src="${_esc(streamData.coverArt)}" alt="Cover" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
  }

  // Subscribe to Now Playing from Firestore with automatic reconnect on error.
  // We re-subscribe up to 5 times with exponential back-off before giving up.
  let _snapshotRetries = 0;
  const _maxSnapshotRetries = 5;

  const _subscribeNowPlayingForListener = () => {
    if (_player.unsub) { try { _player.unsub(); } catch(_) {} _player.unsub = null; }
    _player.unsub = onSnapshot(
      doc(_db, 'studioCloudStreamMusic', streamId),
      snap => {
        // Successful snapshot — reset retry counter.
        _snapshotRetries = 0;
        if (!snap.exists()) { _showPlayerOffline('Broadcast ended.'); return; }
        const d = snap.data();
        if (d.status === 'stopped' || d.status === 'ended') {
          _showPlayerOffline('Broadcast ended.');
          return;
        }
        _syncListenerToNowPlaying(d);
      },
      err => {
        console.warn('[CSR] listener nowPlaying error:', err.message);
        _snapshotRetries++;
        if (_snapshotRetries <= _maxSnapshotRetries) {
          const delay = Math.min(2000 * Math.pow(2, _snapshotRetries - 1), 30000);
          console.info('[CSR] Retrying Firestore snapshot in', delay, 'ms (attempt', _snapshotRetries, ')');
          // Show a transient reconnecting notice (not the offline screen).
          const offlineEl = _el('csrPlayerOffline');
          const msgEl = offlineEl && offlineEl.querySelector('.csr-player-offline-msg');
          if (msgEl && _player.audio) {
            // Audio is still playing — just show a reconnecting message.
            msgEl.textContent = 'Connection temporarily unavailable. Reconnecting…';
            _show('csrPlayerOffline', true);
          }
          setTimeout(() => {
            // If audio is still playing, hide the reconnecting notice.
            if (_player.audio && _player.playing) _show('csrPlayerOffline', false);
            _subscribeNowPlayingForListener();
          }, delay);
        } else {
          // All retries exhausted — show offline state but do NOT redirect to login.
          _showPlayerOffline('Connection temporarily unavailable. Refresh the page to retry.');
        }
      }
    );
  };
  _subscribeNowPlayingForListener();

  // Note: listener count is maintained by the cloud worker via health heartbeats.
  // Clients do not write to cloudStreams directly (permission denied for non-owners).

  // Try to load current Now Playing right away
  try {
    const np = await getDoc(doc(_db, 'studioCloudStreamMusic', streamId));
    if (np.exists()) _syncListenerToNowPlaying(np.data());
  } catch(_) {}
}

function _syncListenerToNowPlaying(d) {
  if (!d) return;
  const url    = d.currentTrackUrl  || d.currentUrl || '';
  const title  = d.currentTitle     || '—';
  const artist = d.currentArtist    || '';
  const dur    = d.currentDuration  || 0;
  const next   = d.nextTitle || '';

  _setText('csrPlayerTrackTitle',  title);
  _setText('csrPlayerTrackArtist', artist);
  _setText('csrPlayerTotalTime',   _fmtDuration(dur));

  const nextEl = _el('csrPlayerNextRow');
  if (nextEl) nextEl.textContent = next ? '▶ Next: ' + next : '';

  // If the track changed, load the new audio
  if (url && url !== _player.trackUrl) {
    _player.trackUrl  = url;
    _player.trackId   = d.currentTrackId || '';
    _player.trackDur  = dur;
    // Use engine's trackStartedAt (epoch ms) for accurate clock-sync.
    _player.trackStartedAt =
      (typeof d.trackStartedAt === 'number' && d.trackStartedAt > 0)
        ? d.trackStartedAt
        : (d.updatedAt?.toMillis ? d.updatedAt.toMillis() : Date.now());
    _loadAndPlayTrack(url, dur);
  }
}

function _loadAndPlayTrack(url, dur) {
  _stopPlayerAudio();
  const audio = new Audio(url);
  audio.volume      = _player.volume;
  audio.crossOrigin = 'anonymous';
  audio.preload     = 'auto';
  _player.audio     = audio;
  _player.trackDur  = dur;
  // Mark as playing so the play button and auto-advance work correctly.
  // The browser may block autoplay — we handle that below and show the play button.
  _player.playing   = true;

  // Seek to synchronized position based on server-side clock
  // The worker sets updatedAt when the track starts; we skip ahead to match
  const elapsed = Math.max(0, (Date.now() - _player.trackStartedAt) / 1000);
  if (elapsed > 2 && dur > 0 && elapsed < dur - 2) {
    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        // Clamp seek to valid range
        const seekTo = Math.min(elapsed, audio.duration - 1);
        try { audio.currentTime = seekTo; } catch(_) {}
      }
    }, { once: true });
  }

  audio.addEventListener('timeupdate', _updatePlayerProgress);
  audio.addEventListener('ended', _onTrackEnded);
  audio.addEventListener('error', (e) => {
    const code = e.target?.error?.code;
    const msg  = e.target?.error?.message || 'unknown';
    console.warn('[CSR] audio error for track (code=' + code + '):', url, msg);
    // Skip to next track after a brief delay.
    // Using _onTrackEnded() triggers the same flow as a natural track end,
    // so the Firestore queue is advanced and all listeners get the next track.
    setTimeout(() => {
      if (_player.audio === audio) {
        _stopProgressRaf();
        _setPlayBtn(false);
        _autoAdvanceQueue();
      }
    }, 1500);
  });

  // Always attempt autoplay — if blocked, show the play button so the user can start manually
  audio.play().then(() => {
    _setPlayBtn(true);
  }).catch(() => {
    // Autoplay blocked by browser policy — show play button so user can tap to start
    _player.playing = false;
    _setPlayBtn(false);
  });
  _startProgressRaf();
  _show('csrPlayerOffline', false);
}

function _onTrackEnded() {
  // Track has finished playing. Auto-advance:
  // If this client is the creator (owns _streamId), advance the queue in Firestore
  // so all listeners get the next track. Non-creator listeners just wait for the
  // Firestore snapshot to update (driven by the creator's client or the backend).
  _stopProgressRaf();
  _setPlayBtn(false);
  _autoAdvanceQueue();
}

/**
 * Advance the Now Playing queue by one track.
 *
 * Architecture:
 *   - When the server engine IS running (_engineRunning=true): the engine manages
 *     all queue advancement server-side. Clients must not interfere.
 *   - When the server engine is NOT running (Firebase-only / local mode):
 *     The stream OWNER's client advances the Firestore queue when a track ends.
 *     All other listeners receive the update via the Firestore onSnapshot and
 *     start the next track automatically — they do NOT call this function.
 *
 *   Repeat logic:
 *     - repeat=true (default): loops back to track 0 after the last track.
 *     - repeat=false: stops the broadcast when the last track finishes.
 *
 *   Skip-on-error: if a track URL is missing/broken, it is skipped and the
 *   next valid track is used.  If ALL tracks are broken the broadcast stops.
 */
async function _autoAdvanceQueue() {
  // _streamId is only set for the stream OWNER (creator mode).
  // Non-owner listeners have _streamId=null and should NOT write to Firestore.
  if (!_streamId || !_user) return;

  // If the server engine is running it manages the queue — do not write from client.
  if (_engineRunning) return;

  // Only the stream owner advances the queue.
  // This prevents multiple browser tabs from racing.
  if (_streamData && _streamData.uid && _streamData.uid !== _user.uid) return;

  try {
    const musicRef = doc(_db, 'studioCloudStreamMusic', _streamId);
    const musicSnap = await getDoc(musicRef);
    if (!musicSnap.exists()) return;

    const ms = musicSnap.data();
    if (ms.status === 'stopped' || ms.status === 'ended') return;

    const queue = ms.queue || [];
    if (!queue.length) return;

    const currentIndex = typeof ms.queueIndex === 'number' ? ms.queueIndex : 0;
    // repeat: stored in the stream doc; default to true so the broadcast loops.
    const repeat = ms.repeat !== false;
    const isLastTrack = currentIndex >= queue.length - 1;

    // If repeat is off and we are on the last track, end the broadcast.
    if (!repeat && isLastTrack) {
      console.info('[CSR] auto-advance: end of playlist, repeat=false — stopping broadcast');
      await updateDoc(musicRef, { status: 'ended', updatedAt: serverTimestamp() }).catch(() => {});
      await updateDoc(doc(_db, 'cloudStreams', _streamId), { status: 'stopped', stoppedAt: serverTimestamp() }).catch(() => {});
      _stopPlayerAudio();
      _setStatusBadge('ended');
      _toast('Broadcast ended — all tracks played.', 'info');
      return;
    }

    // Find the next VALID track (has a playable URL). Skip broken entries.
    let nextIndex = currentIndex;
    let tries = 0;
    do {
      nextIndex = (nextIndex + 1) % queue.length;
      tries++;
    } while (tries < queue.length && !(queue[nextIndex]?.url || queue[nextIndex]?.downloadURL));

    const nextTrack = queue[nextIndex] || {};
    // Skip if still no valid URL found (all tracks in queue are broken)
    if (!nextTrack.url && !nextTrack.downloadURL) {
      console.warn('[CSR] auto-advance: no valid tracks in queue — stopping broadcast');
      await updateDoc(musicRef, { status: 'ended', updatedAt: serverTimestamp() }).catch(() => {});
      _showPlayerOffline('All tracks in the queue are unavailable.');
      return;
    }

    const afterNext  = queue[(nextIndex + 1) % queue.length] || {};
    const trackUrl   = nextTrack.url || nextTrack.downloadURL || '';

    await updateDoc(musicRef, {
      queueIndex:       nextIndex,
      currentTrackId:   nextTrack.id        || '',
      currentTitle:     nextTrack.title     || '',
      currentArtist:    nextTrack.artist    || '',
      currentTrackUrl:  trackUrl,
      currentDuration:  nextTrack.duration  || 0,
      trackStartedAt:   Date.now(),
      currentElapsed:   0,
      nextTrackId:      afterNext.id        || '',
      nextTitle:        afterNext.title     || '',
      nextArtist:       afterNext.artist    || '',
      status:           'playing',
      updatedAt:        serverTimestamp(),
    });
  } catch (e) {
    console.warn('[CSR] auto-advance failed:', e.message);
    // Retry once after 3 s if we get a transient Firestore error.
    setTimeout(() => {
      if (_streamId && !_engineRunning) _autoAdvanceQueue().catch(() => {});
    }, 3000);
  }
}

function _updatePlayerProgress() {
  const audio = _player.audio;
  if (!audio) return;
  const pos = audio.currentTime;
  const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : _player.trackDur;
  const pct = dur > 0 ? (pos / dur) * 100 : 0;
  const fill = _el('csrPlayerProgressFill');
  if (fill) fill.style.width = pct.toFixed(2) + '%';
  _setText('csrPlayerCurrentTime', _fmtDuration(Math.floor(pos)));
}

function _startProgressRaf() {
  _stopProgressRaf();
  function tick() {
    _updatePlayerProgress();
    _player.progressRaf = requestAnimationFrame(tick);
  }
  _player.progressRaf = requestAnimationFrame(tick);
}

function _stopProgressRaf() {
  if (_player.progressRaf) {
    cancelAnimationFrame(_player.progressRaf);
    _player.progressRaf = null;
  }
}

function _stopPlayerAudio() {
  _stopProgressRaf();
  if (_player.audio) {
    _player.audio.removeEventListener('timeupdate', _updatePlayerProgress);
    _player.audio.removeEventListener('ended', _onTrackEnded);
    _player.audio.pause();
    _player.audio.src = '';
    _player.audio = null;
  }
  _player.playing = false;
}

function _showPlayerOffline(msg) {
  _show('csrPlayerOffline', true);
  const el = _el('csrPlayerOffline');
  if (el) {
    const msgEl = el.querySelector('.csr-player-offline-msg');
    if (msgEl) msgEl.textContent = msg || 'Broadcast ended.';
  }
  _stopPlayerAudio();
}

/* ── Play/Pause controls ── */
window.csrTogglePlay = function() {
  if (!_player.audio) {
    // If no audio loaded yet, try reloading current track
    if (_player.trackUrl) {
      _player.playing = true;
      _loadAndPlayTrack(_player.trackUrl, _player.trackDur);
    }
    return;
  }
  if (_player.playing) {
    _player.audio.pause();
    _player.playing = false;
    _stopProgressRaf();
  } else {
    _player.audio.play().catch(() => {});
    _player.playing = true;
    _startProgressRaf();
  }
  _setPlayBtn(_player.playing);
};

function _setPlayBtn(playing) {
  const btn = _el('csrPlayerPlayBtn');
  if (btn) btn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
}

window.csrSetVolume = function(val) {
  _player.volume = parseInt(val, 10) / 100;
  if (_player.audio) _player.audio.volume = _player.volume;
};

/* ═══════════════════════════════════════════════════════
   BROADCAST HISTORY
═══════════════════════════════════════════════════════ */
async function _loadHistory() {
  const el = _el('csrHistoryList');
  if (!el || !_user) return;
  try {
    const snap = await getDocs(query(
      collection(_db, 'cloudStreams'),
      where('uid', '==', _user.uid),
      orderBy('createdAt', 'desc'),
      limit(10)
    ));
    if (!snap.docs.length) {
      el.innerHTML = '<div class="csr-hint">No broadcast history yet.</div>';
      _show('csrHistoryPanel', false);
      return;
    }
    _show('csrHistoryPanel', true);
    el.innerHTML = snap.docs.map(d => {
      const data = d.data();
      const started = data.startedAt?.toMillis ? data.startedAt.toMillis() : null;
      const stopped = data.stoppedAt?.toMillis ? data.stoppedAt.toMillis() : null;
      const duration = (started && stopped) ? _fmtDuration(Math.floor((stopped - started) / 1000)) : '—';
      const statusColors = { active: '#39ff14', stopped: '#5a80a8', failed: '#ff3355', ended: '#5a80a8' };
      const color = statusColors[data.status] || '#5a80a8';
      return `<div class="csr-history-item">
        <div class="csr-history-name">${_esc(data.streamName || 'Untitled')}</div>
        <div class="csr-history-meta">
          <span style="color:${color}">${_esc((data.status || '').toUpperCase())}</span>
          <span>·</span>
          <span>${started ? _fmtDate(started) : '—'}</span>
          <span>·</span>
          <span>${duration}</span>
        </div>
      </div>`;
    }).join('');
  } catch(_) {
    el.innerHTML = '<div class="csr-hint">Could not load history.</div>';
  }
}

/* ═══════════════════════════════════════════════════════
   ARTWORK
═══════════════════════════════════════════════════════ */
window.csrLoadArtwork = function(evt) {
  const file = evt.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _artworkDataUrl = e.target.result;
    const img = _el('csrArtworkImg');
    if (img) img.src = _artworkDataUrl;
    _show('csrArtworkPreview', true);
    _el('csrArtworkBtn').textContent = '&#128444; Change Image';
  };
  reader.readAsDataURL(file);
};
window.csrRemoveArtwork = function() {
  _artworkDataUrl = null;
  _show('csrArtworkPreview', false);
  _el('csrArtworkBtn').textContent = '&#128444; Choose Image';
};

/* ═══════════════════════════════════════════════════════
   CONFIRMATION DIALOG
═══════════════════════════════════════════════════════ */
function _showConfirm(title, body, cb) {
  _confirmCallback = cb;
  _setText('csrConfirmTitle', title);
  _setText('csrConfirmBody', body);
  _show('csrConfirmOverlay', true);
}
window.csrConfirmCancel  = function() { _show('csrConfirmOverlay', false); _confirmCallback = null; };
window.csrConfirmProceed = function() { _show('csrConfirmOverlay', false); if (_confirmCallback) _confirmCallback(); _confirmCallback = null; };

/* ═══════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════ */
function _el(id)      { return document.getElementById(id); }
function _show(id, v) { const e = _el(id); if (e) e.style.display = v ? '' : 'none'; }
function _setText(id, t) { const e = _el(id); if (e) e.textContent = t || ''; }
function _sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }
function _esc(s)      { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function _fmtDuration(secs) {
  if (!secs || secs <= 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${_pad(m)}:${_pad(s)}` : `${m}:${_pad(s)}`;
}
function _pad(n) { return n < 10 ? '0' + n : '' + n; }

function _fmtTime(ms) {
  return new Date(ms).toLocaleString();
}
function _fmtDate(ms) {
  return new Date(ms).toLocaleDateString();
}

function _setAuthBadge(name) {
  const el = _el('csrAuthBadge');
  if (el) el.textContent = name;
}

function _showError(id, msg) {
  const el = _el(id);
  if (!el) return;
  el.style.display = msg ? '' : 'none';
  el.textContent = msg || '';
}

let _toastTimeout = null;
function _toast(msg, type) {
  const el = _el('csrToast');
  if (!el) return;
  el.innerHTML = msg;
  el.className = 'csr-toast csr-toast-show' + (type === 'success' ? ' csr-toast-success' : type === 'error' ? ' csr-toast-error' : '');
  el.style.display = '';
  if (_toastTimeout) clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => {
    el.classList.remove('csr-toast-show');
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, 4000);
}
