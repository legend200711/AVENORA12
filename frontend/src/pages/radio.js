/**
 * AVENORA RADIO — Listener Page (frontend/src/pages/radio.js)
 *
 * Architecture — TRUE SYNCHRONIZED BROADCAST
 * ══════════════════════════════════════════
 * ONE master station timeline lives in Firestore.
 * ALL listeners read that timeline and seek to the correct playback position.
 *
 * CRITICAL INVARIANTS:
 *   • Joining the radio NEVER restarts the current song.
 *   • Leaving/re-opening the radio NEVER resets the station timeline.
 *   • The listener's `audio.ended` event NEVER independently advances the
 *     global station — it only re-syncs against the master timeline.
 *   • Track advancement is guarded by a Firestore transaction that checks
 *     `queueRevision` so only ONE client wins the race to advance the station.
 *   • A dedicated `_masterTicker` interval (not the audio `ended` event) is
 *     responsible for triggering advancement checks.
 *
 * Playback offset formula:
 *   seekPosition = (clientNow - serverClockOffset) - trackStartedAt   [in seconds]
 */

registerPage('radio', {
  async render(container) {
    container.innerHTML = _radioShell();
    const cleanup = await _initRadioPlayer();
    return cleanup;
  }
});

// ─── Shell HTML ───────────────────────────────────────────
function _radioShell() {
  return `
    <div class="radio-page">
      <div class="radio-stars" id="radio-stars-bg"></div>
      <div class="radio-atmosphere"></div>
      <div class="radio-content">

        <!-- Header -->
        <div class="radio-header">
          <div class="radio-station-badge">
            <span class="radio-on-air-dot" id="radio-onair-dot"></span>
            <span id="radio-onair-label">CONNECTING…</span>
          </div>
          <h1 class="radio-station-name" id="radio-station-name">AVENORA RADIO</h1>
          <div class="radio-station-tagline" id="radio-station-tagline">24 HOURS • 7 DAYS • ALWAYS PLAYING</div>
          <div class="radio-station-id-banner" id="radio-station-id">YOU ARE LISTENING TO AVENORA RADIO</div>
        </div>

        <!-- Reconnecting notice -->
        <div class="radio-reconnecting hidden" id="radio-reconnecting">
          <span>↻</span>
          <span>RECONNECTING…</span>
        </div>

        <!-- Error notice -->
        <div class="radio-error-msg hidden" id="radio-error-msg"></div>

        <!-- Now Playing card -->
        <div class="radio-now-playing" id="radio-np-card">
          <div class="radio-np-label">NOW PLAYING</div>
          <div class="radio-np-inner">
            <div class="radio-np-art" id="radio-np-art">🎵</div>
            <div class="radio-np-info">
              <div class="radio-np-title" id="radio-np-title">Loading…</div>
              <div class="radio-np-artist" id="radio-np-artist"></div>
              <div class="radio-np-album" id="radio-np-album"></div>
              <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
                <span class="radio-live-badge" id="radio-live-badge">
                  <span class="radio-on-air-dot" style="width:6px;height:6px"></span>
                  LIVE
                </span>
                <span class="radio-listeners" id="radio-listener-count">
                  👥 <span id="radio-listener-num">–</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Progress -->
          <div class="radio-progress-wrap">
            <div class="radio-progress-times">
              <span id="radio-elapsed">0:00</span>
              <span id="radio-duration">–:––</span>
            </div>
            <div class="radio-progress-bar">
              <div class="radio-progress-fill" id="radio-progress-fill" style="width:0%"></div>
            </div>
          </div>

          <!-- Visualizer canvas -->
          <canvas class="radio-visualizer" id="radio-viz" width="600" height="48"></canvas>

          <!-- Controls -->
          <div class="radio-controls">
            <div class="radio-volume-wrap">
              <span>🔊</span>
              <input type="range" min="0" max="100" value="100" class="radio-volume-slider"
                     id="radio-vol" oninput="radioSetVolume(this.value)" aria-label="Volume">
            </div>
            <button class="radio-play-btn" id="radio-play-btn" onclick="radioTogglePlay()" aria-label="Play/Pause" title="Play / Pause">
              ▶
            </button>
            <button class="radio-icon-btn" id="radio-fav-btn" onclick="radioToggleFavorite()" aria-label="Favourite" title="Favourite">
              ♡
            </button>
          </div>
        </div>

        <!-- Action bar -->
        <div class="radio-action-bar">
          <button class="radio-action-btn" onclick="radioShare()" title="Share Avenora Radio">
            🔗 Share
          </button>
          <button class="radio-action-btn" onclick="navigateTo('music')" title="Go to Music Hub">
            🎵 Music Hub
          </button>
        </div>

        <!-- Upcoming -->
        <div class="radio-section" id="radio-upcoming-section" style="display:none">
          <div class="radio-section-title">
            <span>NEXT UP</span>
            <span id="radio-playlist-count" style="color:var(--text-muted);font-size:0.62rem"></span>
          </div>
          <div id="radio-upcoming-list"></div>
        </div>

        <!-- Recently Played -->
        <div class="radio-section" id="radio-recent-section" style="display:none">
          <div class="radio-section-title">RECENTLY PLAYED</div>
          <div id="radio-recent-list"></div>
        </div>

        <!-- Admin link (shown for admins) -->
        <div id="radio-admin-link-wrap" style="display:none;text-align:center;margin-top:var(--space-xl)">
          <button class="radio-action-btn" onclick="navigateTo('radioadmin')">
            ⚙️ Station Admin
          </button>
        </div>

        <!-- Empty state -->
        <div class="radio-status-msg hidden" id="radio-empty-state">
          <div style="font-size:2rem;margin-bottom:12px">📻</div>
          <div style="font-family:var(--font-display);letter-spacing:0.2em;color:rgba(0,160,255,0.55);margin-bottom:8px">AVENORA RADIO</div>
          <div style="color:var(--text-muted);font-size:0.8rem">Station is waiting for music.</div>
        </div>

        <!-- Autoplay unlock overlay — shown when browser blocks autoplay -->
        <div class="radio-status-msg hidden" id="radio-autoplay-unlock"
             style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
          <div style="font-size:2.5rem">📻</div>
          <div style="font-family:var(--font-display);letter-spacing:0.18em;color:#00ccff;font-size:1.1rem">AVENORA RADIO</div>
          <div style="color:rgba(255,255,255,0.7);font-size:0.9rem;text-align:center;max-width:300px">Tap below to start listening</div>
          <button onclick="radioUnlockAutoplay()"
                  style="background:linear-gradient(135deg,#0080ff,#00ccff);color:#fff;border:none;border-radius:40px;padding:14px 36px;font-size:1.1rem;font-family:var(--font-display);letter-spacing:0.12em;cursor:pointer;margin-top:8px">
            ▶ START LISTENING
          </button>
        </div>
      </div>
    </div>

    <!-- Hidden audio -->
    <audio id="radio-audio" preload="auto" crossorigin="anonymous" style="display:none"></audio>
  `;
}

// ─── Player state ─────────────────────────────────────────
// Module-level so it survives tab switches, but is RESET on each fresh render
// via _resetRadioState() to avoid stale currentTrackId/currentUrl from a previous
// session preventing a new audio element from loading.
let _radioState = {
  unsubscribe:       null,
  pingInterval:      null,
  progressTimer:     null,
  masterTicker:      null,
  vizAnimFrame:      null,
  vizCtx:            null,
  vizAnalyser:       null,
  vizSource:         null,
  audioCtx:          null,
  listenerId:        null,
  currentUrl:        null,
  currentTrackId:    null,
  serverClockOffset: 0,
  clockSamples:      [],
  isUserPaused:      false,
  stationDoc:        null,
  favoriteTrackIds:  new Set(),
};

/**
 * Reset the mutable playback fields so that on re-open, the new audio element
 * is always loaded fresh (fixes the "re-open → no audio" bug).
 * Preserves listenerId (stable per session) and favoriteTrackIds (persisted from last open).
 */
function _resetRadioState() {
  // Cancel any stale visualizer animation frame before tearing down AudioContext
  if (_radioState.vizAnimFrame) {
    try { cancelAnimationFrame(_radioState.vizAnimFrame); } catch (_) {}
    _radioState.vizAnimFrame = null;
  }
  // Disconnect visualizer nodes before closing AudioContext
  if (_radioState.vizSource) {
    try { _radioState.vizSource.disconnect(); } catch (_) {}
    _radioState.vizSource = null;
  }
  if (_radioState.vizAnalyser) {
    try { _radioState.vizAnalyser.disconnect(); } catch (_) {}
    _radioState.vizAnalyser = null;
  }
  // Close old AudioContext to release hardware resources
  if (_radioState.audioCtx) {
    try { _radioState.audioCtx.close(); } catch (_) {}
    _radioState.audioCtx = null;
  }
  // Preserve persistent fields
  const favs    = _radioState.favoriteTrackIds;
  const lisId   = _radioState.listenerId;
  _radioState = {
    unsubscribe:       null,
    pingInterval:      null,
    progressTimer:     null,
    masterTicker:      null,
    vizAnimFrame:      null,
    vizCtx:            null,
    vizAnalyser:       null,
    vizSource:         null,
    audioCtx:          null,
    listenerId:        lisId,
    currentUrl:        null,   // CRITICAL: reset so _onStationUpdate always loads audio
    currentTrackId:    null,   // CRITICAL: reset so trackChanged === true on first update
    serverClockOffset: 0,
    clockSamples:      [],
    isUserPaused:      false,
    stationDoc:        null,
    favoriteTrackIds:  favs,
  };
}

// ─── Init ─────────────────────────────────────────────────
async function _initRadioPlayer() {
  // CRITICAL: reset all playback fields on every fresh render so stale
  // currentTrackId / currentUrl from a previous session don't prevent
  // _onStationUpdate from loading the audio element.
  _resetRadioState();
  _radioState.listenerId = 'avn-' + Math.random().toString(36).slice(2) + Date.now();

  _buildStars();

  // Restore saved volume preference
  const savedVol  = localStorage.getItem('lu_mp_volume');
  const initVol   = savedVol !== null ? Math.max(0, Math.min(1, Number(savedVol) || 1)) : 1.0;
  const volSlider = document.getElementById('radio-vol');
  if (volSlider) volSlider.value = Math.round(initVol * 100);
  const radioAudio = document.getElementById('radio-audio');
  if (radioAudio) { radioAudio.volume = initVol; radioAudio.muted = false; }

  // Subscribe to Firestore now-playing doc (source of truth for master timeline)
  await _subscribeFirestore();

  // Presence heartbeat
  _startPresence();

  // Show admin link for admin/founder users
  _checkAdminLink();

  // Drift correction ticker — every 12 s re-check listener position vs master timeline.
  // Does NOT advance the station — only the backend radioEngine does that.
  _radioState.masterTicker = setInterval(_driftCheck, 12000);

  return function _radioCleanup() {
    if (_radioState.unsubscribe)   { try { _radioState.unsubscribe(); } catch {} }
    if (_radioState.pingInterval)   clearInterval(_radioState.pingInterval);
    if (_radioState.progressTimer)  clearInterval(_radioState.progressTimer);
    if (_radioState.masterTicker)   clearInterval(_radioState.masterTicker);
    if (_pollInterval)              { clearInterval(_pollInterval); _pollInterval = null; }
    if (_radioState.vizAnimFrame)   cancelAnimationFrame(_radioState.vizAnimFrame);
    const audio = document.getElementById('radio-audio');
    if (audio) { audio.pause(); audio.src = ''; }
    _leavePresence();
    // Null out the timer handles so _resetRadioState() on next open starts clean.
    _radioState.unsubscribe   = null;
    _radioState.pingInterval  = null;
    _radioState.progressTimer = null;
    _radioState.masterTicker  = null;
    _radioState.vizAnimFrame  = null;
  };
}

// ─── Firestore subscription ───────────────────────────────
async function _subscribeFirestore() {
  try {
    const { getFirestore } = window.AvenoraFirebase || {};
    if (!getFirestore) { _fallbackToApiPoll(); return; }
    const db = await getFirestore();

    const { doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const docRef = doc(db, 'stationNowPlaying', 'avenoraRadio');

    _radioState.unsubscribe = onSnapshot(docRef, (snap) => {
      if (!snap.exists()) {
        _showEmptyState();
        return;
      }
      _onStationUpdate(snap.data());
    }, (err) => {
      console.warn('[Radio] Firestore error:', err);
      _showReconnecting(true);
      _fallbackToApiPoll();
    });

    _showReconnecting(false);
  } catch (err) {
    console.warn('[Radio] Firestore subscribe failed:', err);
    _fallbackToApiPoll();
  }
}

// Fallback: poll /api/radio/status when Firestore is unavailable
let _pollInterval = null;
function _fallbackToApiPoll() {
  // Guard: only start once per page session (reset in _radioCleanup)
  if (_pollInterval) return;
  _showReconnecting(true);
  _pollInterval = setInterval(async () => {
    try {
      const data = await LegendAPI.request('GET', '/radio/status');
      if (data && data.status) {
        _showReconnecting(false);
        _onStationUpdate(_apiStatusToDoc(data));
      }
    } catch {}
  }, 8000);
}

function _apiStatusToDoc(s) {
  if (!s || !s.currentTrack) return null;
  const t = s.currentTrack;
  return {
    status:          s.status || 'playing',
    stationName:     s.stationName || 'AVENORA RADIO',
    currentTitle:    t.title || '',
    currentArtist:   t.artist || '',
    currentAlbum:    t.album || '',
    currentCoverUrl: t.coverUrl || null,
    currentUrl:      t.url || '',
    currentDuration: t.duration || 0,
    currentElapsed:  t.elapsed || 0,
    trackStartedAt:  s.trackStartedAt || (Date.now() - (t.elapsed || 0) * 1000),
    currentIndex:    s.currentIndex || 0,
    currentTrackId:  t.id || '',
    queueRevision:   s.queueRevision || 0,
    upcoming:        s.upcoming || [],
    recentlyPlayed:  [],
    serverTime:      Date.now(),
    playlistLength:  s.playlistLength || 0,
  };
}

// ─── Server clock calibration ────────────────────────────
/**
 * Update the rolling server-clock-offset estimate.
 * serverClockOffset = (localNow - serverTime)
 * A positive value means our local clock is ahead of the server.
 * We use the median of the last 5 samples to smooth outliers.
 */
function _updateClockOffset(serverTime) {
  if (!serverTime || typeof serverTime !== 'number') return;
  const sample = Date.now() - serverTime;
  const samples = _radioState.clockSamples;
  samples.push(sample);
  if (samples.length > 5) samples.shift();
  // Median of samples
  const sorted = [...samples].sort((a, b) => a - b);
  _radioState.serverClockOffset = sorted[Math.floor(sorted.length / 2)];
}

/**
 * Returns the current server time in milliseconds,
 * corrected by our clock-offset estimate.
 */
function _serverNow() {
  return Date.now() - _radioState.serverClockOffset;
}

// ─── Station update handler ───────────────────────────────
/**
 * Called every time the Firestore NowPlaying doc changes.
 * Responsibilities:
 *   1. Calibrate server clock offset.
 *   2. If the track changed → load the new URL seeked to the correct position.
 *   3. If the same track is playing → only correct drift if > 3 seconds.
 *   4. NEVER advance the station — only the backend radioEngine does that.
 */
function _onStationUpdate(doc) {
  if (!doc) { _showEmptyState(); return; }
  _radioState.stationDoc = doc;

  // Calibrate server clock
  if (doc.serverTime) _updateClockOffset(doc.serverTime);

  const status = doc.status || 'stopped';

  // Update station name
  const nameEl = document.getElementById('radio-station-name');
  if (nameEl && doc.stationName) nameEl.textContent = doc.stationName;

  if (status === 'stopped' || status === 'paused') {
    _showOnAir(false, status === 'paused' ? 'PAUSED' : 'OFF AIR');
    _updateNowPlaying(doc);
    _updateQueues(doc);
    return;
  }

  // Resolve audio URL
  let resolvedUrl = doc.currentUrl || '';
  if (!resolvedUrl && doc.currentStoragePath && window.AvenoraStorage?.getPublicUrl) {
    resolvedUrl = window.AvenoraStorage.getPublicUrl('music', doc.currentStoragePath);
  }
  if (!resolvedUrl && doc.currentStoragePath) {
    const SUPABASE_STORAGE = 'https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public';
    const encoded = doc.currentStoragePath.split('/').map(encodeURIComponent).join('/');
    resolvedUrl = `${SUPABASE_STORAGE}/music/${encoded}`;
  }

  if (status === 'error' || !resolvedUrl) {
    if (status === 'playing' && !resolvedUrl) {
      console.error('[Radio] MEDIA_RECORD_MISSING', {
        status,
        currentTrackId:     doc.currentTrackId     || '(none)',
        currentTitle:       doc.currentTitle        || '(none)',
        currentUrl:         doc.currentUrl          || '(empty)',
        currentStoragePath: doc.currentStoragePath  || '(none)',
        hint: 'Open Radio Admin → click 🔧 Repair to fix broken tracks.',
      });
      // Try refreshing from the API
      try {
        const apiUrl = window.LU_CONFIG?.apiUrl;
        if (apiUrl) {
          fetch(`${apiUrl}/radio/status`).then(r => r.json()).then(data => {
            if (data?.currentTrack?.url) _onStationUpdate(_apiStatusToDoc(data));
          }).catch(() => {});
        }
      } catch (_) {}
    }
    _showEmptyState();
    return;
  }

  _showOnAir(true, 'ON AIR');
  _showEmptyState(false);
  _hideError();

  // ── Calculate correct playback position ──
  // trackStartedAt is a Unix ms timestamp set by whoever advanced the station.
  // We correct for measured clock skew between local and server clocks.
  const trackStartedAt = doc.trackStartedAt || 0;
  const elapsedSec     = trackStartedAt > 0
    ? Math.max(0, (_serverNow() - trackStartedAt) / 1000)
    : (doc.currentElapsed || 0);
  const duration = doc.currentDuration || 0;

  _updateNowPlaying(doc);
  _updateQueues(doc);

  const trackChanged = resolvedUrl !== _radioState.currentUrl ||
                       doc.currentTrackId !== _radioState.currentTrackId;

  if (trackChanged) {
    // New track — load and seek to the correct server-synchronized position
    _loadAudio(resolvedUrl, elapsedSec, doc.currentTrackId);
  } else {
    // Same track is already loaded — only correct drift if > 3 seconds out
    const audio = document.getElementById('radio-audio');
    if (audio && audio.readyState >= 2 && !_radioState.isUserPaused) {
      const drift = Math.abs(audio.currentTime - elapsedSec);
      if (drift > 3) {
        console.info('[Radio] Drift correction:', drift.toFixed(1), 's — seeking to', elapsedSec.toFixed(1));
        audio.currentTime = Math.min(elapsedSec, (audio.duration || Infinity) - 0.5);
      }
    }
  }

  // Restart progress timer with current trackStartedAt
  _startProgressTimer(trackStartedAt, duration);
}

// ─── Audio loading ────────────────────────────────────────
/**
 * Load a new audio URL and seek to `seekTo` seconds.
 * Only called when the track ACTUALLY changes (URL or trackId differs).
 * DOES NOT call _tryAdvanceRadio.
 */
function _loadAudio(url, seekTo, trackId) {
  const audio = document.getElementById('radio-audio');
  if (!audio) return;

  _radioState.currentUrl     = url;
  _radioState.currentTrackId = trackId;

  // Pause Music Hub player if it is running so they don't play simultaneously.
  // This only affects the local listener — it never touches the global station.
  try {
    const mpAudio = document.getElementById('mp-audio');
    if (mpAudio && !mpAudio.paused) {
      mpAudio.pause();
      if (typeof MP !== 'undefined') { MP.isPlaying = false; }
      const mpBtn = document.getElementById('mp-btn-play');
      if (mpBtn) mpBtn.textContent = '▶';
    }
  } catch (_) {}

  // Pause Cloud Stream iframe if it is playing — local coordination only.
  try {
    const csrFrame = document.getElementById('csr-frame');
    if (csrFrame && csrFrame.contentWindow) {
      csrFrame.contentWindow.postMessage({ type: 'AVN_PAUSE' }, location.origin);
    }
  } catch (_) {}

  audio.pause();
  audio.src = url;
  audio.load();

  // Restore volume — never muted, never zero
  audio.muted = false;
  const savedVol  = localStorage.getItem('lu_mp_volume');
  const vol       = savedVol !== null ? Math.max(0, Math.min(1, Number(savedVol) || 1)) : 1.0;
  audio.volume    = vol > 0 ? vol : 1.0;
  const volSlider = document.getElementById('radio-vol');
  if (volSlider) volSlider.value = Math.round(audio.volume * 100);

  /**
   * SEEK-THEN-PLAY: always wait for loadedmetadata before seeking.
   * Assigning currentTime before the browser knows the media duration is
   * unreliable — the assignment is silently ignored on some browsers.
   *
   * Two-phase sequence:
   *   1. loadedmetadata fires → duration is known → seek to master position
   *   2. canplay fires         → playback is ready → call audio.play()
   *
   * If the audio is already in the right readyState (re-use after seek),
   * both events may have already fired, so we check readyState first.
   */
  let _metadataReady = false;
  let _seekApplied   = false;
  let _playAttempted = false;

  const _applySeek = () => {
    if (_seekApplied) return;
    _seekApplied = true;
    const targetTime = Math.max(0, seekTo);
    if (targetTime > 0.5 && isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(targetTime, audio.duration - 0.5);
      console.info('[Radio] Seeked to', audio.currentTime.toFixed(1), 's (target:', targetTime.toFixed(1), 's, duration:', audio.duration.toFixed(1), 's)');
    }
  };

  const _tryPlay = () => {
    if (_playAttempted) return;
    _playAttempted = true;
    if (_radioState.isUserPaused) return;

    if (_radioState.audioCtx?.state === 'suspended') {
      _radioState.audioCtx.resume().catch(() => {});
    }

    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        _setPlayBtn(true);
        _radioState.isUserPaused = false;
        _hideAutoplayOverlay();
      }).catch((err) => {
        console.info('[Radio] Autoplay blocked:', err.message, '— showing unlock overlay');
        _setPlayBtn(false);
        _radioState.isUserPaused = true;
        _showAutoplayOverlay();
      });
    }
  };

  const onLoadedMetadata = () => {
    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    _metadataReady = true;
    _applySeek();
  };

  const onCanPlay = () => {
    audio.removeEventListener('canplay', onCanPlay);
    _tryPlay();
  };

  if (audio.readyState >= 1) {
    // HAVE_METADATA or better — duration may already be known
    _metadataReady = true;
    _applySeek();
  } else {
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
  }

  if (audio.readyState >= 3) {
    // HAVE_FUTURE_DATA — can play immediately
    _tryPlay();
  } else {
    audio.addEventListener('canplay', onCanPlay);
  }

  // Handle audio errors — log and attempt re-sync from master timeline
  audio.addEventListener('error', () => {
    const errCode  = audio.error?.code;
    const errMsg   = audio.error?.message || '(no message)';
    console.error('[Radio] Audio error', {
      errorCode:    errCode,
      errorMessage: errMsg,
      networkState: audio.networkState,
      readyState:   audio.readyState,
      src:          audio.src?.slice(0, 200) || '(no src)',
      trackId:      _radioState.currentTrackId || '(none)',
      hint: errCode === 4 ? 'MEDIA_ERR_SRC_NOT_SUPPORTED — MIME type or CORS issue' :
            errCode === 3 ? 'MEDIA_ERR_DECODE — file may be corrupt' :
            errCode === 2 ? 'MEDIA_ERR_NETWORK — network problem' :
            'Check Supabase bucket policies and file URL',
    });
    // Don't advance the station — re-sync will happen via masterTicker or Firestore update
    _showError('⚠ Audio failed — will retry…');
    setTimeout(() => {
      _hideError();
      // Force a re-sync by re-evaluating the current station doc
      if (_radioState.stationDoc) _onStationUpdate(_radioState.stationDoc);
    }, 4000);
  }, { once: true });

  /**
   * CRITICAL: When the listener's audio ends, do NOT advance the global station.
   *
   * The server-side radioEngine is the SOLE authority for song changes.
   * On local audio end, simply wait for the Firestore onSnapshot to deliver
   * the next track. The _driftCheck will also resync us.
   *
   * If the Firestore doc has already moved to a new track, _resyncFromMaster
   * will detect that and load the new URL. It will NEVER write to Firestore.
   */
  audio.addEventListener('ended', () => {
    if (_radioState.isUserPaused) return;
    console.info('[Radio] Local audio ended — re-syncing from master (read-only)');
    _resyncFromMaster();
  }, { once: true });

  // Init visualizer once
  if (!_radioState.vizCtx) _initVisualizer(audio);
}

// ─── Re-sync from master (READ-ONLY) ─────────────────────
/**
 * Called when local audio ends or from _driftCheck.
 * Re-reads the latest Firestore state and applies it locally:
 *   - If the master has advanced to a new track → load the new audio at the
 *     correct server-synchronized position.
 *   - If the master is still on the same track → seek to the current position.
 *
 * CRITICAL: This function NEVER writes to Firestore or calls the backend.
 * Only the server-side radioEngine advances the station.
 */
async function _resyncFromMaster() {
  try {
    const cachedDoc = _radioState.stationDoc;
    if (cachedDoc) {
      // Use cached doc — the Firestore onSnapshot keeps it fresh
      const now         = _serverNow();
      const startedAt   = cachedDoc.trackStartedAt || 0;
      const elapsedSec  = Math.max(0, (now - startedAt) / 1000);
      const duration    = cachedDoc.currentDuration || 0;

      // Resolve URL from cached doc
      let resolvedUrl = cachedDoc.currentUrl || '';
      if (!resolvedUrl && cachedDoc.currentStoragePath) {
        const SUPABASE_STORAGE = 'https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public';
        const encoded = cachedDoc.currentStoragePath.split('/').map(encodeURIComponent).join('/');
        resolvedUrl = `${SUPABASE_STORAGE}/music/${encoded}`;
      }
      if (!resolvedUrl) return; // nothing to play yet

      const audio = document.getElementById('radio-audio');
      if (!audio || _radioState.isUserPaused) return;

      if (cachedDoc.currentTrackId && cachedDoc.currentTrackId !== _radioState.currentTrackId) {
        // Track has already changed in Firestore — load the new one
        console.info('[Radio] _resyncFromMaster — master moved to', cachedDoc.currentTrackId, '— loading');
        _loadAudio(resolvedUrl, elapsedSec, cachedDoc.currentTrackId);
      } else if (duration > 0 && elapsedSec < duration) {
        // Same track, master still playing — reload at current position (audio had ended locally)
        console.info('[Radio] _resyncFromMaster — master still on same track at', elapsedSec.toFixed(1), 's — reloading');
        _loadAudio(resolvedUrl, elapsedSec, cachedDoc.currentTrackId);
      } else {
        // Master duration exhausted but no Firestore update yet — backend will advance shortly.
        // Poll Firestore once to see if doc has been updated since our cached copy.
        console.info('[Radio] _resyncFromMaster — master track duration exceeded, waiting for server...');
        try {
          const { getFirestore } = window.AvenoraFirebase || {};
          if (!getFirestore) return;
          const db = await getFirestore();
          const { doc: fsDoc, getDoc } =
            await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
          const snap = await getDoc(fsDoc(db, 'stationNowPlaying', 'avenoraRadio'));
          if (snap.exists()) {
            const fresh = snap.data();
            if (fresh.currentTrackId && fresh.currentTrackId !== _radioState.currentTrackId) {
              _onStationUpdate(fresh);
            }
            // else: server hasn't advanced yet — wait for onSnapshot to fire
          }
        } catch (_) {}
      }
      return;
    }

    // No cached doc at all — do a one-time fetch from Firestore
    const { getFirestore } = window.AvenoraFirebase || {};
    if (!getFirestore) return;
    const db = await getFirestore();
    const { doc: fsDoc, getDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(fsDoc(db, 'stationNowPlaying', 'avenoraRadio'));
    if (snap.exists()) _onStationUpdate(snap.data());
  } catch (e) {
    console.warn('[Radio] _resyncFromMaster failed:', e.message);
  }
}

// ─── Drift correction ticker ──────────────────────────────
/**
 * Runs every 12 seconds. Compares the listener's current playback position
 * against the master station timeline. If drift exceeds 2-3 s, seeks to the
 * correct position. Does NOT advance the station or write to Firestore.
 *
 * The backend radioEngine is the SOLE authority for all track changes.
 */
function _driftCheck() {
  const doc = _radioState.stationDoc;
  if (!doc || doc.status !== 'playing') return;

  const startedAt  = doc.trackStartedAt || 0;
  const duration   = doc.currentDuration || 0;
  if (!startedAt || !duration) return;

  const now        = _serverNow();
  const masterPos  = Math.max(0, (now - startedAt) / 1000);

  // If master says we're past the end, wait for the server to publish new track
  if (masterPos >= duration) return;

  const audio = document.getElementById('radio-audio');
  if (!audio || !audio.duration || _radioState.isUserPaused) return;

  const drift = Math.abs(audio.currentTime - masterPos);
  if (drift > 3) {
    console.info('[Radio] _driftCheck: correcting', drift.toFixed(1), 's drift → seeking to', masterPos.toFixed(1));
    audio.currentTime = Math.min(masterPos, audio.duration - 0.5);
  }
}

// ─── Progress timer ───────────────────────────────────────
function _startProgressTimer(trackStartedAt, durationSec) {
  if (_radioState.progressTimer) clearInterval(_radioState.progressTimer);
  _radioState.progressTimer = setInterval(() => {
    const elapsed  = Math.max(0, (_serverNow() - trackStartedAt) / 1000);
    const duration = durationSec || 0;
    const pct      = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

    const fillEl = document.getElementById('radio-progress-fill');
    const elEl   = document.getElementById('radio-elapsed');
    const durEl  = document.getElementById('radio-duration');

    if (fillEl) fillEl.style.width = pct + '%';
    if (elEl)   elEl.textContent   = _fmtTime(elapsed);
    if (durEl)  durEl.textContent  = duration > 0 ? _fmtTime(duration) : '–:––';
  }, 1000);
}

// ─── UI helpers ───────────────────────────────────────────
function _updateNowPlaying(doc) {
  const art    = document.getElementById('radio-np-art');
  const title  = document.getElementById('radio-np-title');
  const artist = document.getElementById('radio-np-artist');
  const album  = document.getElementById('radio-np-album');

  if (title)  title.textContent  = doc.currentTitle  || 'Unknown Track';
  if (artist) artist.textContent = doc.currentArtist || '';
  if (album)  album.textContent  = doc.currentAlbum  || '';

  if (art) {
    if (doc.currentCoverUrl) {
      art.innerHTML = `<img src="${escapeHtml(doc.currentCoverUrl)}" alt="Cover art" onerror="this.parentElement.innerHTML='🎵'">`;
    } else {
      art.innerHTML = '🎵';
    }
  }

  const countEl = document.getElementById('radio-playlist-count');
  if (countEl && doc.playlistLength) {
    countEl.textContent = `${doc.playlistLength} TRACKS`;
  }

  if (_radioState.currentTrackId) {
    const favBtn = document.getElementById('radio-fav-btn');
    if (favBtn) {
      const isFav = _radioState.favoriteTrackIds.has(_radioState.currentTrackId);
      favBtn.textContent = isFav ? '♥' : '♡';
      favBtn.title       = isFav ? 'Unfavourite' : 'Favourite';
      favBtn.style.color = isFav ? 'rgba(255,80,100,0.90)' : '';
    }
  }
}

function _updateQueues(doc) {
  const upcomingSection = document.getElementById('radio-upcoming-section');
  const upcomingList    = document.getElementById('radio-upcoming-list');
  const upcoming        = doc.upcoming || [];

  if (upcomingSection) upcomingSection.style.display = upcoming.length ? '' : 'none';
  if (upcomingList && upcoming.length) {
    upcomingList.innerHTML = upcoming.slice(0, 8).map((t, i) => `
      <div class="radio-track-row">
        <span class="radio-track-num">${i + 1}</span>
        <div class="radio-track-art-sm">
          ${t.coverUrl ? `<img src="${escapeHtml(t.coverUrl)}" alt="" onerror="this.parentElement.innerHTML='🎵'">` : '🎵'}
        </div>
        <div class="radio-track-info">
          <div class="radio-track-title">${escapeHtml(t.title || 'Untitled')}</div>
          <div class="radio-track-artist">${escapeHtml(t.artist || '')}</div>
        </div>
        <span class="radio-track-duration">${t.duration ? _fmtTime(t.duration) : ''}</span>
      </div>`).join('');
  }

  const recentSection = document.getElementById('radio-recent-section');
  const recentList    = document.getElementById('radio-recent-list');
  const recent        = doc.recentlyPlayed || [];

  if (recentSection) recentSection.style.display = recent.length ? '' : 'none';
  if (recentList && recent.length) {
    recentList.innerHTML = recent.slice(0, 6).map((t) => `
      <div class="radio-track-row" style="opacity:0.65">
        <div class="radio-track-art-sm">
          ${t.coverUrl ? `<img src="${escapeHtml(t.coverUrl)}" alt="" onerror="this.parentElement.innerHTML='🎵'">` : '🎵'}
        </div>
        <div class="radio-track-info">
          <div class="radio-track-title">${escapeHtml(t.title || 'Untitled')}</div>
          <div class="radio-track-artist">${escapeHtml(t.artist || '')}</div>
        </div>
      </div>`).join('');
  }
}

function _showOnAir(onAir, label = 'ON AIR') {
  const dot   = document.getElementById('radio-onair-dot');
  const lbl   = document.getElementById('radio-onair-label');
  const badge = document.getElementById('radio-live-badge');

  if (lbl)   lbl.textContent        = label;
  if (dot)   dot.style.background   = onAir ? '#ff3344' : '#666';
  if (dot)   dot.style.boxShadow    = onAir ? '0 0 8px #ff3344' : 'none';
  if (badge) badge.style.display    = onAir ? 'inline-flex' : 'none';

  const playBtn = document.getElementById('radio-play-btn');
  if (playBtn) playBtn.disabled = false;
}

function _showEmptyState(show = true) {
  const empty = document.getElementById('radio-empty-state');
  const np    = document.getElementById('radio-np-card');
  if (empty) empty.classList.toggle('hidden', !show);
  if (np)    np.style.opacity = show ? '0.3' : '1';
}

function _showAutoplayOverlay() {
  const el = document.getElementById('radio-autoplay-unlock');
  if (el) {
    el.classList.remove('hidden');
    el.style.display = 'flex';
  }
}

function _hideAutoplayOverlay() {
  const el = document.getElementById('radio-autoplay-unlock');
  if (el) {
    el.classList.add('hidden');
    el.style.display = 'none';
  }
}

window.radioUnlockAutoplay = function () {
  _hideAutoplayOverlay();
  const audio = document.getElementById('radio-audio');
  if (!audio) return;
  if (_radioState.audioCtx?.state === 'suspended') {
    _radioState.audioCtx.resume().catch(() => {});
  }
  _radioState.isUserPaused = false;
  const stDoc = _radioState.stationDoc;
  if (stDoc) {
    // Resolve URL same way as _onStationUpdate — supports storagePath fallback
    let resolvedUrl = stDoc.currentUrl || '';
    if (!resolvedUrl && stDoc.currentStoragePath) {
      if (window.AvenoraStorage?.getPublicUrl) {
        resolvedUrl = window.AvenoraStorage.getPublicUrl('music', stDoc.currentStoragePath);
      }
      if (!resolvedUrl) {
        const SUPABASE_STORAGE = 'https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public';
        const encoded = stDoc.currentStoragePath.split('/').map(encodeURIComponent).join('/');
        resolvedUrl = `${SUPABASE_STORAGE}/music/${encoded}`;
      }
    }
    if (resolvedUrl) {
      const elapsedSec = stDoc.trackStartedAt
        ? Math.max(0, (_serverNow() - stDoc.trackStartedAt) / 1000)
        : 0;
      _loadAudio(resolvedUrl, elapsedSec, stDoc.currentTrackId);
      return;
    }
  }
  // Already loaded audio — just resume
  if (audio.src) {
    audio.play().then(() => { _setPlayBtn(true); }).catch(() => {});
  }
};

function _showReconnecting(show) {
  const el = document.getElementById('radio-reconnecting');
  if (el) el.classList.toggle('hidden', !show);
}

function _showError(msg) {
  const el = document.getElementById('radio-error-msg');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function _hideError() {
  const el = document.getElementById('radio-error-msg');
  if (el) el.classList.add('hidden');
}

function _setPlayBtn(playing) {
  const btn = document.getElementById('radio-play-btn');
  if (btn) btn.textContent = playing ? '⏸' : '▶';
}

// ─── Listener presence ────────────────────────────────────
function _startPresence() {
  _pingPresence();
  _radioState.pingInterval = setInterval(_pingPresence, 30_000);
}

async function _pingPresence() {
  try {
    const apiUrl = window.LU_CONFIG?.apiUrl;
    if (!apiUrl) return;
    const res = await fetch(`${apiUrl}/radio/listener/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listenerId: _radioState.listenerId }),
    });
    if (res.ok) {
      const data = await res.json();
      const el = document.getElementById('radio-listener-num');
      if (el) el.textContent = data.count ?? '–';
    }
  } catch {}
}

async function _leavePresence() {
  try {
    const apiUrl = window.LU_CONFIG?.apiUrl;
    if (!apiUrl) return;
    await fetch(`${apiUrl}/radio/listener/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listenerId: _radioState.listenerId }),
    });
  } catch {}
}

// ─── Admin link visibility ────────────────────────────────
function _checkAdminLink() {
  try {
    const user = window.LegendState?.get?.('user');
    if (user && (user.role === 'admin' || user.role === 'founder')) {
      const el = document.getElementById('radio-admin-link-wrap');
      if (el) el.style.display = '';
    }
  } catch {}
}

// ─── Visualizer ───────────────────────────────────────────
function _initVisualizer(audioEl) {
  try {
    if (!window.AudioContext && !window.webkitAudioContext) return;

    // Reuse the existing AudioContext if it is still open — creating a new one
    // per track wastes resources and can leave suspended orphan contexts.
    if (!_radioState.audioCtx || _radioState.audioCtx.state === 'closed') {
      _radioState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_radioState.audioCtx.state === 'suspended') {
      _radioState.audioCtx.resume().catch(() => {});
    }

    // Guard against calling createMediaElementSource on the same element twice —
    // that throws "already connected".  Tear down first if the source exists.
    if (_radioState.vizSource) {
      try { _radioState.vizSource.disconnect(); } catch (_) {}
      _radioState.vizSource = null;
    }
    if (_radioState.vizAnalyser) {
      try { _radioState.vizAnalyser.disconnect(); } catch (_) {}
      _radioState.vizAnalyser = null;
    }

    _radioState.vizSource   = _radioState.audioCtx.createMediaElementSource(audioEl);
    _radioState.vizAnalyser = _radioState.audioCtx.createAnalyser();
    _radioState.vizAnalyser.fftSize = 128;

    // ─── Audio graph ──────────────────────────────────────────────────────────
    // source ──→ destination          (guarantees audible output — always wired)
    // source ──→ analyser ──→ destination  (parallel branch for visualizer only)
    _radioState.vizSource.connect(_radioState.audioCtx.destination);
    _radioState.vizSource.connect(_radioState.vizAnalyser);
    _radioState.vizAnalyser.connect(_radioState.audioCtx.destination);

    const canvas = document.getElementById('radio-viz');
    if (!canvas) return;
    _radioState.vizCtx = canvas.getContext('2d');
    _drawViz();
  } catch (vizErr) {
    console.warn('[AVN RADIO VIZ] _initVisualizer failed (visualizer disabled, audio unaffected):', vizErr?.message || vizErr);
    // Clear partial state so the next call can retry cleanly
    if (_radioState.vizSource)   { try { _radioState.vizSource.disconnect(); }   catch (_) {} _radioState.vizSource   = null; }
    if (_radioState.vizAnalyser) { try { _radioState.vizAnalyser.disconnect(); } catch (_) {} _radioState.vizAnalyser = null; }
  }
}

function _drawViz() {
  const analyser = _radioState.vizAnalyser;
  const ctx      = _radioState.vizCtx;
  const canvas   = document.getElementById('radio-viz');
  if (!analyser || !ctx || !canvas) return;

  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);

  function draw() {
    _radioState.vizAnimFrame = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const barW = (W / bufLen) * 2;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const bH  = (data[i] / 255) * H;
      const hue = 200 + (i / bufLen) * 40;
      ctx.fillStyle = `hsla(${hue},80%,60%,0.65)`;
      ctx.fillRect(x, H - bH, barW - 1, bH);
      x += barW;
    }
  }
  draw();
}

// ─── Stars ────────────────────────────────────────────────
function _buildStars() {
  const bg = document.getElementById('radio-stars-bg');
  if (!bg) return;
  const noAnim = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count  = noAnim ? 30 : 80;
  const frag   = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'radio-star';
    const size = Math.random() * 2 + 1;
    s.style.cssText = [
      `width:${size}px`,
      `height:${size}px`,
      `left:${Math.random() * 100}%`,
      `top:${Math.random() * 100}%`,
      `--dur:${(Math.random() * 4 + 2).toFixed(1)}s`,
      `--delay:${(Math.random() * 5).toFixed(1)}s`,
      `--op:${(Math.random() * 0.5 + 0.2).toFixed(2)}`,
    ].join(';');
    frag.appendChild(s);
  }
  bg.appendChild(frag);
}

// ─── Global controls ─────────────────────────────────────
window.radioTogglePlay = function () {
  const audio = document.getElementById('radio-audio');
  if (!audio) return;

  _hideAutoplayOverlay();

  if (_radioState.audioCtx?.state === 'suspended') {
    _radioState.audioCtx.resume().catch(() => {});
  }

  if (audio.paused) {
    _radioState.isUserPaused = false;
    const stDoc = _radioState.stationDoc;
    if (stDoc && stDoc.currentUrl && stDoc.trackStartedAt) {
      const elapsedSec = Math.max(0, (_serverNow() - stDoc.trackStartedAt) / 1000);
      // Reload to resync if drift > 5 s
      if (Math.abs(audio.currentTime - elapsedSec) > 5) {
        _loadAudio(stDoc.currentUrl, elapsedSec, stDoc.currentTrackId);
        return;
      }
    }
    audio.play().then(() => { _setPlayBtn(true); }).catch(() => {});
  } else {
    audio.pause();
    _radioState.isUserPaused = true;
    _setPlayBtn(false);
  }
};

window.radioSetVolume = function (val) {
  const audio = document.getElementById('radio-audio');
  if (!audio) return;
  const normalized = Math.max(0, Math.min(1, parseInt(val, 10) / 100));
  audio.volume = normalized;
  audio.muted  = false;
  try { localStorage.setItem('lu_mp_volume', String(normalized)); } catch (_) {}
};

window.radioToggleFavorite = async function () {
  const user = window.LegendState?.get?.('user');
  if (!user) {
    if (typeof Toast !== 'undefined') Toast.show('Sign in to favourite tracks', 'info');
    return;
  }
  const trackId = _radioState.currentTrackId;
  if (!trackId) return;

  const isFav  = _radioState.favoriteTrackIds.has(trackId);
  const action = isFav ? 'remove' : 'add';

  try {
    const token  = await _getAuthToken();
    const apiUrl = window.LU_CONFIG?.apiUrl || '';
    const res = await fetch(`${apiUrl}/radio/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ trackId, action }),
    });
    if (res.ok) {
      if (isFav) _radioState.favoriteTrackIds.delete(trackId);
      else       _radioState.favoriteTrackIds.add(trackId);

      const favBtn = document.getElementById('radio-fav-btn');
      if (favBtn) {
        favBtn.textContent = _radioState.favoriteTrackIds.has(trackId) ? '♥' : '♡';
        favBtn.style.color = _radioState.favoriteTrackIds.has(trackId) ? 'rgba(255,80,100,0.90)' : '';
      }
    }
  } catch {}
};

window.radioShare = function () {
  const url = location.origin + location.pathname + '#radio';
  if (navigator.share) {
    navigator.share({ title: 'Avenora Radio', text: '🎵 Listen to Avenora Radio — 24 hours, 7 days!', url })
      .catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => {
      if (typeof Toast !== 'undefined') Toast.show('Link copied!', 'success');
    }).catch(() => {
      if (typeof Toast !== 'undefined') Toast.show(url, 'info');
    });
  }
};

// ─── Helpers ─────────────────────────────────────────────
function _fmtTime(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

async function _getAuthToken() {
  try {
    const { getFirebaseAuth } = window.AvenoraFirebase || {};
    if (!getFirebaseAuth) return null;
    const auth = await getFirebaseAuth();
    return auth.currentUser ? await auth.currentUser.getIdToken() : null;
  } catch { return null; }
}
