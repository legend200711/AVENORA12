/**
 * AVENORA RADIO — Listener Page (frontend/src/pages/radio.js)
 *
 * Architecture:
 *   - Subscribes to Firestore `stationNowPlaying/avenoraRadio` for real-time
 *     track state (current track, trackStartedAt, queue, etc.)
 *   - Calculates elapsed offset from server's trackStartedAt + serverTime clock skew.
 *   - Plays audio via HTML5 <audio> element, seeked to the correct offset.
 *   - When the server advances to a new track the onSnapshot fires and the
 *     client loads the new URL automatically.
 *   - Listener presence is maintained via /api/radio/listener/ping every 30 s.
 *   - Reconnects automatically on network loss.
 *
 * The listener's browser is ONLY a listener — the server controls the station.
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
let _radioState = {
  unsubscribe:      null,    // Firestore listener
  pingInterval:     null,    // presence heartbeat
  progressTimer:    null,    // progress UI update
  vizAnimFrame:     null,    // visualizer RAF
  vizCtx:           null,
  vizAnalyser:      null,
  vizSource:        null,
  audioCtx:         null,
  listenerId:       null,
  currentUrl:       null,    // currently loaded audio URL
  currentTrackId:   null,
  serverClockOffset: 0,      // local - server ms offset
  isUserPaused:     false,
  stationDoc:       null,    // latest Firestore doc
  favoriteTrackIds: new Set(),
};

async function _initRadioPlayer() {
  _radioState.listenerId = 'avn-' + Math.random().toString(36).slice(2) + Date.now();

  _buildStars();

  // Restore saved volume preference
  const savedVol = localStorage.getItem('lu_mp_volume');
  const initVol  = savedVol !== null ? Math.max(0, Math.min(1, Number(savedVol) || 1)) : 1.0;
  const volSlider = document.getElementById('radio-vol');
  if (volSlider) volSlider.value = Math.round(initVol * 100);
  const radioAudio = document.getElementById('radio-audio');
  if (radioAudio) { radioAudio.volume = initVol; radioAudio.muted = false; }

  // Subscribe to Firestore now-playing doc
  await _subscribeFirestore();

  // Start presence heartbeat
  _startPresence();

  // Show admin link for admin/founder users
  _checkAdminLink();

  return function _radioCleanup() {
    if (_radioState.unsubscribe) { try { _radioState.unsubscribe(); } catch {} }
    if (_radioState.pingInterval)  clearInterval(_radioState.pingInterval);
    if (_radioState.progressTimer) clearInterval(_radioState.progressTimer);
    if (_radioState.vizAnimFrame)  cancelAnimationFrame(_radioState.vizAnimFrame);
    const audio = document.getElementById('radio-audio');
    if (audio) { audio.pause(); audio.src = ''; }
    _leavePresence();
    _radioState.unsubscribe = null;
    _radioState.pingInterval = null;
    _radioState.progressTimer = null;
    _radioState.vizAnimFrame = null;
  };
}

// ─── Firestore subscription ───────────────────────────────
async function _subscribeFirestore() {
  try {
    const { getFirestore } = window.AvenoraFirebase || {};
    if (!getFirestore) { _fallbackToApiPoll(); return; }
    const db = await getFirestore();

    // Use modular SDK API (the project uses Firebase ESM v10)
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
  if (_pollInterval) return;
  _showReconnecting(true);
  _pollInterval = setInterval(async () => {
    try {
      // LegendAPI.request expects (method, path, opts) — no leading /api
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
    upcoming:        s.upcoming || [],
    recentlyPlayed:  [],
    serverTime:      Date.now(),
    playlistLength:  s.playlistLength || 0,
  };
}

// ─── Station update handler ───────────────────────────────
function _onStationUpdate(doc) {
  if (!doc) { _showEmptyState(); return; }
  _radioState.stationDoc = doc;

  // Update clock skew estimate
  if (doc.serverTime) {
    _radioState.serverClockOffset = Date.now() - doc.serverTime;
  }

  const status = doc.status || 'stopped';

  // Update station name / tagline
  const nameEl = document.getElementById('radio-station-name');
  if (nameEl && doc.stationName) nameEl.textContent = doc.stationName;

  if (status === 'stopped' || status === 'paused') {
    _showOnAir(false, status === 'paused' ? 'PAUSED' : 'OFF AIR');
    _updateNowPlaying(doc);
    _updateQueues(doc);
    return;
  }

  // Resolve audio URL — try doc.currentUrl first, then fall back to storagePath
  let resolvedUrl = doc.currentUrl || '';
  if (!resolvedUrl && doc.currentStoragePath && window.AvenoraStorage?.getPublicUrl) {
    resolvedUrl = window.AvenoraStorage.getPublicUrl('music', doc.currentStoragePath);
    if (resolvedUrl) {
      console.info('[Radio] Resolved currentUrl from currentStoragePath:', doc.currentStoragePath, resolvedUrl);
    }
  }
  if (!resolvedUrl && doc.currentStoragePath) {
    // Construct Supabase public URL directly
    const SUPABASE_STORAGE = 'https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public';
    const encoded = doc.currentStoragePath.split('/').map(encodeURIComponent).join('/');
    resolvedUrl = `${SUPABASE_STORAGE}/music/${encoded}`;
    console.info('[Radio] Constructed Supabase URL from currentStoragePath:', resolvedUrl);
  }

  if (status === 'error' || !resolvedUrl) {
    if (status === 'playing' && !resolvedUrl) {
      // Station claims to be playing but has no URL — log full MEDIA_RECORD_MISSING diagnostic
      console.error('[Radio] MEDIA_RECORD_MISSING', {
        status,
        currentTrackId:     doc.currentTrackId     || '(none)',
        currentTitle:       doc.currentTitle        || '(none)',
        currentUrl:         doc.currentUrl          || '(empty)',
        currentStoragePath: doc.currentStoragePath  || '(none)',
        stationDocKeys:     Object.keys(doc).join(', '),
        collectionsChecked: ['stationNowPlaying/avenoraRadio'],
        hint:               'The station NowPlaying doc has no audio URL. ' +
                            'Open Radio Admin → click 🔧 Repair to fix broken tracks.',
      });
      // Try to refresh from the API poll (gives the server a chance to populate the URL)
      try {
        const apiUrl = window.LU_CONFIG?.apiUrl;
        if (apiUrl) {
          fetch(`${apiUrl}/radio/status`).then(r => r.json()).then(data => {
            if (data?.currentTrack?.url) {
              _onStationUpdate(_apiStatusToDoc(data));
            }
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

  // Compute correct playback offset
  const adjustedNow       = Date.now() - _radioState.serverClockOffset;
  const trackStartedAt    = doc.trackStartedAt || (adjustedNow - (doc.currentElapsed || 0) * 1000);
  const elapsedSec        = Math.max(0, (adjustedNow - trackStartedAt) / 1000);
  const duration          = doc.currentDuration || 0;

  _updateNowPlaying(doc);
  _updateQueues(doc);

  // Load audio if track changed (compare resolved URL to avoid reloading same track)
  if (resolvedUrl && resolvedUrl !== _radioState.currentUrl) {
    _loadAudio(resolvedUrl, elapsedSec, doc.currentTrackId);
  }

  // Start progress timer
  _startProgressTimer(trackStartedAt, duration);
}

// ─── Audio loading ────────────────────────────────────────
function _loadAudio(url, seekTo, trackId) {
  const audio = document.getElementById('radio-audio');
  if (!audio) return;

  _radioState.currentUrl     = url;
  _radioState.currentTrackId = trackId;

  audio.pause();
  audio.src = url;
  audio.load();

  // Ensure correct volume — prefer saved preference, fall back to 1.0
  audio.muted = false;
  const savedVol = localStorage.getItem('lu_mp_volume');
  const vol = savedVol !== null ? Math.max(0, Math.min(1, Number(savedVol) || 1)) : 1.0;
  audio.volume = vol;
  // Sync the slider
  const volSlider = document.getElementById('radio-vol');
  if (volSlider) volSlider.value = Math.round(vol * 100);

  const attemptPlay = () => {
    if (seekTo > 1) {
      audio.currentTime = Math.min(seekTo, (audio.duration || Infinity) - 0.5);
    }
    // Resume AudioContext if suspended (mobile requirement)
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
        // Autoplay blocked — show the ▶ Start Listening overlay
        console.info('[Radio] Autoplay blocked:', err.message);
        _setPlayBtn(false);
        _radioState.isUserPaused = true;
        _showAutoplayOverlay();
      });
    }
  };

  // canplaythrough is most reliable for seeking before play
  const onReady = () => {
    audio.removeEventListener('canplaythrough', onReady);
    if (!_radioState.isUserPaused) attemptPlay();
  };

  // If the audio is already ready enough, don't wait for canplaythrough
  if (audio.readyState >= 3) {
    if (!_radioState.isUserPaused) attemptPlay();
  } else {
    audio.addEventListener('canplaythrough', onReady);
  }

  audio.addEventListener('error', (e) => {
    const ae = document.getElementById('radio-audio');
    const errCode  = ae?.error?.code;
    const errMsg   = ae?.error?.message || '(no message)';
    const netState = ae?.networkState;
    const rdyState = ae?.readyState;
    console.error('[Radio] Audio error', {
      errorCode:    errCode,
      errorMessage: errMsg,
      networkState: netState,
      readyState:   rdyState,
      src:          ae?.src?.slice(0, 200) || '(no src)',
      trackId:      _radioState.currentTrackId || '(none)',
      hint:         errCode === 4 ? 'MEDIA_ERR_SRC_NOT_SUPPORTED — wrong MIME type or CORS issue on Supabase storage' :
                    errCode === 3 ? 'MEDIA_ERR_DECODE — file may be corrupt' :
                    errCode === 2 ? 'MEDIA_ERR_NETWORK — network problem fetching audio' :
                    'Check Supabase bucket policies and file URL',
    });
    // Auto-advance on error so one broken track doesn't stop the station
    _showError('⚠ Audio failed — skipping to next track…');
    setTimeout(() => { _hideError(); _tryAdvanceRadio(); }, 3000);
  }, { once: true });

  // When a track ends naturally, advance to the next track.
  // The Firestore onSnapshot fires when the backend advances, but this
  // is a client-side safety net.
  audio.addEventListener('ended', () => {
    if (_radioState.isUserPaused) return;
    _tryAdvanceRadio();
  }, { once: true });

  // Init visualizer once
  if (!_radioState.vizCtx) _initVisualizer(audio);
}

/**
 * Called when the audio element fires 'ended'.
 * Attempts to advance the station to the next track.
 *
 * Strategy:
 *   1. If a backend is configured — call POST /radio/station/skip to let the engine advance.
 *   2. In production (no backend) — advance directly in Firestore so the Firestore
 *      onSnapshot fires for all listeners (cross-device sync).
 */
async function _tryAdvanceRadio(skipDepth) {
  // skipDepth prevents infinite recursion when multiple consecutive tracks have no URL.
  const depth = (skipDepth || 0);
  if (depth > 50) {
    console.warn('[Radio] _tryAdvanceRadio — too many consecutive skips, stopping');
    return;
  }
  try {
    const apiUrl = window.LU_CONFIG?.apiUrl;
    if (apiUrl) {
      // Backend path: let the engine handle advancement
      const res = await fetch(`${apiUrl}/radio/station/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null);
      if (res?.ok) {
        console.info('[Radio] Track ended — requested station advance via backend');
      }
      return;
    }

    // Firestore-only path (production): advance the current track index
    if (!window.AvenoraFirebase?.getFirestore) return;
    const db = await window.AvenoraFirebase.getFirestore();
    const { doc, getDoc, setDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    const stationRef = doc(db, 'radioStations', 'avenoraRadio');
    const stationSnap = await getDoc(stationRef);
    if (!stationSnap.exists()) return;

    const stationData = stationSnap.data();
    const playlist = Array.isArray(stationData.playlist) ? stationData.playlist : [];
    if (!playlist.length) return;

    // Always loop: radio station plays forever
    const currentIdx  = typeof stationData.currentIndex === 'number' ? stationData.currentIndex : 0;
    const nextIdx     = (currentIdx + 1) % playlist.length;

    const nextTrack = playlist[nextIdx];
    if (!nextTrack) {
      // Corrupt playlist entry — skip again
      await _tryAdvanceRadio(depth + 1);
      return;
    }

    // Resolve the next track's URL
    let nextUrl = nextTrack.url || nextTrack.audioUrl || nextTrack.fileUrl || '';
    if (!nextUrl && nextTrack.storagePath) {
      if (window.AvenoraStorage?.getPublicUrl) {
        nextUrl = window.AvenoraStorage.getPublicUrl('music', nextTrack.storagePath) || '';
      }
      if (!nextUrl) {
        // Construct Supabase public URL directly as fallback
        const SUPABASE_STORAGE = 'https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public';
        const encoded = nextTrack.storagePath.split('/').map(encodeURIComponent).join('/');
        nextUrl = `${SUPABASE_STORAGE}/music/${encoded}`;
      }
    }

    if (!nextUrl) {
      // This track has no playable URL — skip it and try the one after
      console.warn('[Radio] _tryAdvanceRadio — track has no URL, auto-skipping:', nextTrack.id, nextTrack.title);
      // Temporarily advance currentIndex in Firestore so we don't get stuck
      await setDoc(stationRef, { currentIndex: nextIdx, updatedAt: Date.now() }, { merge: true });
      await _tryAdvanceRadio(depth + 1);
      return;
    }

    const now = Date.now();
    const upcoming = [];
    for (let i = 1; i <= 5; i++) {
      const t = playlist[(nextIdx + i) % playlist.length];
      if (t) upcoming.push({ id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl || null, duration: t.duration || 0 });
    }

    // Write updated state to both Firestore documents
    await setDoc(stationRef, {
      currentIndex:   nextIdx,
      trackStartedAt: now,
      status:         'playing',
      active:         true,
      updatedAt:      now,
    }, { merge: true });

    await setDoc(doc(db, 'stationNowPlaying', 'avenoraRadio'), {
      status:           'playing',
      currentTrackId:   nextTrack.id   || '',
      currentTitle:     nextTrack.title  || '',
      currentArtist:    nextTrack.artist || '',
      currentAlbum:     nextTrack.album  || '',
      currentCoverUrl:  nextTrack.coverUrl || null,
      currentUrl:       nextUrl,
      currentDuration:  nextTrack.duration || 0,
      currentElapsed:   0,
      trackStartedAt:   now,
      currentIndex:     nextIdx,
      playlistLength:   playlist.length,
      upcoming,
      recentlyPlayed:   [],
      serverTime:       now,
      updatedAt:        now,
    }, { merge: true });

    console.info('[Radio] _tryAdvanceRadio — Firestore advanced to track', nextIdx, nextTrack.title);
  } catch (e) {
    console.warn('[Radio] _tryAdvanceRadio failed (non-fatal):', e.message);
  }
}

// ─── Progress timer ───────────────────────────────────────
function _startProgressTimer(trackStartedAt, durationSec) {
  if (_radioState.progressTimer) clearInterval(_radioState.progressTimer);
  _radioState.progressTimer = setInterval(() => {
    const elapsed  = Math.max(0, (Date.now() - _radioState.serverClockOffset - trackStartedAt) / 1000);
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

  // Playlist count
  const countEl = document.getElementById('radio-playlist-count');
  if (countEl && doc.playlistLength) {
    countEl.textContent = `${doc.playlistLength} TRACKS`;
  }

  // Favorite state
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
  // Upcoming
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

  // Recently played
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

  if (lbl)   lbl.textContent  = label;
  if (dot)   dot.style.background  = onAir ? '#ff3344' : '#666';
  if (dot)   dot.style.boxShadow   = onAir ? '0 0 8px #ff3344' : 'none';
  if (badge) badge.style.display   = onAir ? 'inline-flex' : 'none';

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
  // Resume AudioContext (required by Web Audio API after user gesture)
  if (_radioState.audioCtx?.state === 'suspended') {
    _radioState.audioCtx.resume().catch(() => {});
  }
  _radioState.isUserPaused = false;
  // If we have a valid station doc, reload to the correct position
  const stDoc = _radioState.stationDoc;
  if (stDoc && stDoc.currentUrl) {
    const adjustedNow = Date.now() - _radioState.serverClockOffset;
    const elapsedSec  = stDoc.trackStartedAt
      ? Math.max(0, (adjustedNow - stDoc.trackStartedAt) / 1000)
      : 0;
    _loadAudio(stDoc.currentUrl, elapsedSec, stDoc.currentTrackId);
  } else if (audio.src) {
    audio.play().then(() => {
      _setPlayBtn(true);
    }).catch(() => {});
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
  // Join immediately
  _pingPresence();
  // Ping every 30 s
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
    _radioState.audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
    _radioState.vizAnalyser = _radioState.audioCtx.createAnalyser();
    _radioState.vizAnalyser.fftSize = 128;
    _radioState.vizSource   = _radioState.audioCtx.createMediaElementSource(audioEl);

    // Connect source DIRECTLY to destination so audio is always audible.
    // The analyser is wired in parallel (source→analyser→destination),
    // NOT in series — a broken analyser can never silence playback.
    _radioState.vizSource.connect(_radioState.audioCtx.destination);
    _radioState.vizSource.connect(_radioState.vizAnalyser);
    _radioState.vizAnalyser.connect(_radioState.audioCtx.destination);

    const canvas = document.getElementById('radio-viz');
    if (!canvas) return;
    _radioState.vizCtx = canvas.getContext('2d');
    _drawViz();
  } catch {}
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
      const bH = (data[i] / 255) * H;
      const hue = 200 + (i / bufLen) * 40; // blue-cyan range
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
  // Only create stars if reduced-motion not requested
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

  // Always dismiss the autoplay overlay on any play interaction
  _hideAutoplayOverlay();

  if (_radioState.audioCtx?.state === 'suspended') {
    _radioState.audioCtx.resume().catch(() => {});
  }

  if (audio.paused) {
    _radioState.isUserPaused = false;
    // If we have a valid station doc, reconnect to the current server position
    const stDoc = _radioState.stationDoc;
    if (stDoc && stDoc.currentUrl && stDoc.trackStartedAt) {
      const adjustedNow  = Date.now() - _radioState.serverClockOffset;
      const elapsedSec   = Math.max(0, (adjustedNow - stDoc.trackStartedAt) / 1000);
      // If more than 5 s of drift, reload to resync
      if (Math.abs(audio.currentTime - elapsedSec) > 5) {
        _loadAudio(stDoc.currentUrl, elapsedSec, stDoc.currentTrackId);
        return;
      }
    }
    audio.play().then(() => {
      _setPlayBtn(true);
    }).catch(() => {});
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
  // Share the same volume key with the Music Hub player so both stay in sync
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

  const isFav = _radioState.favoriteTrackIds.has(trackId);
  const action = isFav ? 'remove' : 'add';

  try {
    const token = await _getAuthToken();
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
