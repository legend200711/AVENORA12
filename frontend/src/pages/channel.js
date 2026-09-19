/**
 * AVENORA — 24-Hour Always-On Channel (SPA page)
 *
 * The viewer page for the AVENORA 24-hour channel.
 *
 * How it works:
 *   1. Primary: Subscribes to channelNowPlaying/avenora via Firestore (real-time).
 *   2. Fallback: Polls GET /api/channel/now-playing every 10s if Firestore fails.
 *   3. Self-contained playback: the client maintains its own track queue for
 *      MUSIC items so audio advances automatically without waiting for the server.
 *
 * Key design decisions vs. the old version:
 *   - Initialises Firestore directly using the same CDN SDK (v10.12.2) as the
 *     rest of the app — does NOT depend on window.AvenoraFirebase._loadModuleFirestore()
 *     which had a race-condition where it could resolve before the firebase.js IIFE ran.
 *   - The channel status ONLINE (running=true, no current item) is shown as
 *     "LOADING" not "OFFLINE". Only explicit status=OFFLINE shows the offline card.
 *   - When a MUSIC item contains a tracks[] array, the client plays them one by
 *     one with automatic advancement — the server duration is only a hint.
 *   - Failed media items are automatically retried once then skipped.
 *   - Audio starts muted on mobile and shows a TAP TO PLAY prompt.
 */

registerPage('channel', {
  async render(container) {
    container.innerHTML = `
      <div class="ch-page">
        <!-- ── Channel Header ─────────────────────────────── -->
        <div class="ch-header">
          <div class="ch-header-inner">
            <div class="ch-logo">
              <span class="ch-logo-text">AVENORA</span>
              <span class="ch-logo-tag">24-HOUR CHANNEL</span>
            </div>
            <div id="ch-onair-badge" class="ch-onair hidden">
              <span class="ch-onair-dot"></span>
              <span id="ch-onair-label">ON AIR</span>
            </div>
            <div id="ch-viewer-count" class="ch-viewer-count hidden">
              <span>👁</span> <span id="ch-viewers-num">0</span>
            </div>
          </div>
        </div>

        <!-- ── Main Player Area ───────────────────────────── -->
        <div class="ch-main">

          <!-- Player panel -->
          <div class="ch-player-panel" id="ch-player-panel">

            <!-- OFFLINE state -->
            <div id="ch-state-offline" class="ch-state-view" style="display:none">
              <div class="ch-state-icon">📡</div>
              <div class="ch-state-title">CHANNEL OFFLINE</div>
              <div class="ch-state-desc">The AVENORA 24-Hour Channel is currently offline. Check back soon.</div>
              <button class="ch-btn ch-btn-outline" onclick="chRefresh()">↻ Refresh</button>
            </div>

            <!-- LOADING state (default on start) -->
            <div id="ch-state-loading" class="ch-state-view">
              <div class="ch-spinner"></div>
              <div class="ch-state-desc">Connecting to channel…</div>
            </div>

            <!-- STANDBY state — channel is online but no content scheduled yet -->
            <div id="ch-state-standby" class="ch-state-view" style="display:none">
              <div class="ch-state-icon">📻</div>
              <div class="ch-state-title">CHANNEL ONLINE</div>
              <div class="ch-state-desc">AVENORA 24-Hour Channel is live — programming starting soon.</div>
              <button class="ch-btn ch-btn-outline" onclick="chRefresh()">↻ Refresh</button>
            </div>

            <!-- LIVE CAMERA player -->
            <div id="ch-state-live" class="ch-state-view" style="display:none">
              <div class="ch-live-badge">
                <span class="ch-live-dot"></span> LIVE
              </div>
              <div class="ch-video-wrap">
                <video id="ch-video-live" class="ch-video" autoplay playsinline controls muted></video>
                <div id="ch-live-no-mediamtx" class="ch-live-unavail" style="display:none">
                  <div class="ch-live-unavail-icon">🎥</div>
                  <div>Live camera active</div>
                  <div class="ch-live-unavail-sub">Live video delivery requires MediaMTX configuration.</div>
                </div>
              </div>
            </div>

            <!-- VIDEO player -->
            <div id="ch-state-video" class="ch-state-view" style="display:none">
              <div class="ch-video-wrap">
                <video id="ch-video-vod" class="ch-video" autoplay playsinline controls muted></video>
              </div>
            </div>

            <!-- YOUTUBE player -->
            <div id="ch-state-youtube" class="ch-state-view" style="display:none">
              <div class="ch-video-wrap" style="position:relative;width:100%;padding-top:56.25%">
                <iframe
                  id="ch-youtube-frame"
                  style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowfullscreen
                  title="AVENORA YouTube Program"
                ></iframe>
              </div>
              <div class="ch-audio-info" style="margin-top:12px">
                <div class="ch-audio-title" id="ch-yt-title">—</div>
                <div class="ch-audio-artist" id="ch-yt-artist"></div>
              </div>
            </div>

            <!-- AUDIO / MUSIC player -->
            <div id="ch-state-audio" class="ch-state-view" style="display:none">
              <div class="ch-audio-artwork" id="ch-audio-artwork">
                <div class="ch-audio-artwork-placeholder">♪</div>
              </div>
              <div class="ch-audio-info">
                <div class="ch-audio-title" id="ch-audio-title">—</div>
                <div class="ch-audio-artist" id="ch-audio-artist"></div>
              </div>
              <div class="ch-waveform" id="ch-waveform" aria-hidden="true">
                ${Array.from({ length: 20 }, (_, i) => `<div class="ch-waveform-bar" style="animation-delay:${i * 0.1}s"></div>`).join('')}
              </div>
              <div class="ch-audio-controls">
                <button class="ch-play-btn" id="ch-audio-play" onclick="chToggleAudio()" aria-label="Play/Pause">▶</button>
                <div class="ch-vol-row">
                  <span>🔈</span>
                  <input type="range" class="ch-vol-slider" id="ch-vol" min="0" max="100" value="80" oninput="chSetVolume(this.value)">
                  <span>🔊</span>
                </div>
              </div>
              <audio id="ch-audio-el" preload="auto"></audio>
            </div>

            <!-- IMAGE / SLIDESHOW player -->
            <div id="ch-state-image" class="ch-state-view" style="display:none">
              <div class="ch-image-wrap">
                <img id="ch-image-el" class="ch-image" src="" alt="">
              </div>
              <div id="ch-slide-progress" class="ch-slide-progress" style="display:none">
                <div id="ch-slide-fill" class="ch-slide-fill"></div>
              </div>
              <div id="ch-slide-counter" class="ch-slide-counter" style="display:none">
                <span id="ch-slide-num">1</span> / <span id="ch-slide-total">1</span>
              </div>
            </div>

            <!-- Autoplay blocked -->
            <div id="ch-tap-to-play" class="ch-tap-to-play" style="display:none">
              <button class="ch-tap-btn" onclick="chTapToPlay()">▶ TAP TO PLAY</button>
            </div>
          </div>

          <!-- ── Now Playing / Info Panel ────────────────── -->
          <div class="ch-info-panel">
            <div class="ch-np-section">
              <div class="ch-np-label">NOW PLAYING</div>
              <div class="ch-np-type-badge" id="ch-np-type">—</div>
              <div class="ch-np-title" id="ch-np-title">Loading…</div>
              <div class="ch-np-artist" id="ch-np-artist"></div>
              <div class="ch-np-progress-wrap" id="ch-np-progress-wrap">
                <div class="ch-np-time" id="ch-np-elapsed">0:00</div>
                <div class="ch-np-bar">
                  <div class="ch-np-fill" id="ch-np-fill"></div>
                </div>
                <div class="ch-np-time" id="ch-np-duration">—</div>
              </div>
            </div>

            <div class="ch-next-section" id="ch-next-section" style="display:none">
              <div class="ch-next-label">NEXT</div>
              <div class="ch-next-type" id="ch-next-type"></div>
              <div class="ch-next-title" id="ch-next-title"></div>
            </div>

            <div class="ch-history-section" id="ch-history-section" style="display:none">
              <div class="ch-history-label">RECENTLY PLAYED</div>
              <div id="ch-history-list" class="ch-history-list"></div>
            </div>

            <div class="ch-actions">
              <button class="ch-btn ch-btn-outline ch-btn-sm" onclick="navigateTo('cloudstudio')">🎛 Studio</button>
              <button class="ch-btn ch-btn-outline ch-btn-sm" onclick="navigateTo('music')">🎧 Music Hub</button>
            </div>

            <div class="ch-channel-desc">
              <div class="ch-channel-name">AVENORA 24-HOUR CHANNEL</div>
              <div class="ch-channel-sub">Always on. Never silent.</div>
            </div>
          </div>

        </div><!-- /.ch-main -->
      </div><!-- /.ch-page -->
    `;

    // ── Bootstrap ──────────────────────────────────────────────────────────
    return _chInit();
  }
});

// ── Module state ──────────────────────────────────────────────────────────
const _ch = {
  // Firebase/Firestore
  db:           null,
  unsub:        null,   // Firestore snapshot unsubscriber

  // Current channel state (from server)
  status:       null,
  programType:  null,
  mediaUrl:     null,
  images:       [],
  slideIdx:     0,
  slideTimer:   null,

  // Client-side track queue (for MUSIC items with tracks array)
  trackQueue:   [],     // array of { id, title, artist, url, duration, coverArt }
  trackIdx:     0,      // current track in client queue
  trackRetries: 0,      // retry counter for current track
  _trackItemId: null,   // programItem id the queue was built from

  // Audio
  audio:        null,
  audioPlaying: false,
  volume:       0.8,
  _audioUrl:    null,

  // Video
  hls:          null,  // Hls.js instance for live camera
  _liveHlsUrl:  null,
  _vodUrl:      null,

  // Slideshow
  _slideshowKey: null,

  // YouTube
  _ytEmbedUrl:  null,

  // Progress RAF
  progressRaf:  null,
  itemStartedAt: 0,
  itemDuration:  0,

  // Polling fallback
  pollTimer:    null,
  _pollMode:    false,

  // API base
  apiBase:      null,

  // Reconnect state
  _retryTimer:  null,
  _retryCount:  0,
};

// ── Firebase config (same project as the rest of the app) ─────────────────
const _CH_FIREBASE_CFG = {
  apiKey:            'AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI',
  authDomain:        'avenora-6e147.firebaseapp.com',
  projectId:         'avenora-6e147',
  storageBucket:     'avenora-6e147.firebasestorage.app',
  messagingSenderId: '389692647062',
  appId:             '1:389692647062:web:6a2dd06ade8bc92d3e84b7',
};

const _CH_SDK_VER = '10.12.2';

// ── Init ──────────────────────────────────────────────────────────────────
async function _chInit() {
  // Resolve API base
  _ch.apiBase = (window.LU_CONFIG && window.LU_CONFIG.apiUrl) || null;

  _chShowState('loading');

  // Try to get Firestore — first attempt: use the parent's already-initialized
  // instance to avoid creating a duplicate Firebase App.
  let dbReady = false;
  try {
    if (window.AvenoraFirebase) {
      _ch.db       = await window.AvenoraFirebase.getFirestore();
      _ch.fsModule = await window.AvenoraFirebase._loadModuleFirestore();
      if (_ch.db && _ch.fsModule && typeof _ch.fsModule.onSnapshot === 'function') {
        dbReady = true;
      }
    }
  } catch (e) {
    console.warn('[Channel] AvenoraFirebase Firestore unavailable:', e.message);
  }

  // Second attempt: initialize directly from CDN (no dependency on AvenoraFirebase).
  // This is the reliable path that works even if AvenoraFirebase hasn't finished
  // its async setup when this page loads.
  if (!dbReady) {
    try {
      const appMod = await import(
        `https://www.gstatic.com/firebasejs/${_CH_SDK_VER}/firebase-app.js`
      );
      const fsMod = await import(
        `https://www.gstatic.com/firebasejs/${_CH_SDK_VER}/firebase-firestore.js`
      );
      _ch.fsModule = fsMod;

      // Reuse the default app if already initialized (prevents "duplicate app" error).
      // Try the default app first; only create a named app if no apps exist at all.
      let app;
      const existingApps = appMod.getApps();
      if (existingApps.length > 0) {
        // Prefer the default (unnamed) app — same as the rest of the SPA
        app = appMod.getApp();
      } else {
        app = appMod.initializeApp(_CH_FIREBASE_CFG);
      }
      _ch.db = fsMod.getFirestore(app);
      dbReady = true;
      console.info('[Channel] Firestore initialized directly from CDN');
    } catch (e2) {
      console.warn('[Channel] Direct Firestore init failed, using REST fallback:', e2.message);
    }
  }

  if (dbReady) {
    _chSubscribeNowPlaying();
  } else {
    // Last resort: REST polling
    _chPollNowPlaying();
  }

  // Return cleanup function
  return () => {
    if (typeof _ch.unsub === 'function') { try { _ch.unsub(); } catch (_) {} _ch.unsub = null; }
    _chStopAudio();
    _chStopSlideshow();
    cancelAnimationFrame(_ch.progressRaf);
    if (_ch.hls) { try { _ch.hls.destroy(); } catch (_) {} _ch.hls = null; }
    clearTimeout(_ch.pollTimer);
    clearTimeout(_ch._retryTimer);
    // Stop any YouTube embed
    const ytFrame = document.getElementById('ch-youtube-frame');
    if (ytFrame) { ytFrame.src = 'about:blank'; }
    _ch._ytEmbedUrl = null;
  };
}

// ── Firestore subscription ────────────────────────────────────────────────
function _chSubscribeNowPlaying() {
  if (!_ch.db || !_ch.fsModule) {
    _chPollNowPlaying();
    return;
  }

  try {
    const { doc, onSnapshot } = _ch.fsModule;
    if (typeof doc !== 'function' || typeof onSnapshot !== 'function') {
      throw new Error('Firestore doc/onSnapshot not available');
    }

    _ch.unsub = onSnapshot(
      doc(_ch.db, 'channelNowPlaying', 'avenora'),
      snap => {
        // Reset retry counter on successful snapshot
        _ch._retryCount = 0;
        clearTimeout(_ch._retryTimer);

        if (!snap.exists()) {
          // Document doesn't exist yet — channel may be starting up.
          // Show loading instead of offline; poll the API for authoritative status.
          _chShowState('loading');
          _chSetText('ch-np-title', 'Connecting…');
          // Fall back to polling in case document never appears
          if (!_ch._pollMode) {
            _ch._pollMode = true;
            setTimeout(_chPollNowPlaying, 5_000);
          }
          return;
        }
        _ch._pollMode = false;
        _chRenderState(snap.data());
      },
      err => {
        console.warn('[Channel] Firestore snapshot error:', err.message);
        // Exponential backoff retry (capped at 60s)
        _ch._retryCount++;
        const delay = Math.min(5_000 * Math.pow(2, _ch._retryCount - 1), 60_000);
        _ch._retryTimer = setTimeout(() => {
          // Re-subscribe
          if (typeof _ch.unsub === 'function') { try { _ch.unsub(); } catch (_) {} }
          _chSubscribeNowPlaying();
        }, delay);
        // Meanwhile poll the REST API
        _chPollNowPlaying();
      }
    );
  } catch (e) {
    console.warn('[Channel] Firestore subscribe failed:', e.message);
    _chPollNowPlaying();
  }
}

async function _chPollNowPlaying() {
  // Clear any existing poll timer to avoid duplicate polling
  clearTimeout(_ch.pollTimer);

  try {
    const base = _ch.apiBase || '/api';
    const res  = await fetch(base + '/channel/now-playing', {
      cache: 'no-store',
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.channel) {
        _chRenderState(data.channel);
        // If channel is ONLINE/PLAYING via REST, switch back to Firestore subscription
        // only if we don't already have one running.
        if (!_ch.unsub && _ch.db && _ch.fsModule) {
          _chSubscribeNowPlaying();
        }
      } else {
        // API returned success:false or no channel — might just be starting up
        _chRenderState({ status: 'ONLINE', running: false });
      }
    } else {
      // HTTP error — keep current state, show reconnecting
      _chShowReconnecting();
    }
  } catch (e) {
    _chShowReconnecting();
  }

  // Poll again in 10s
  _ch.pollTimer = setTimeout(_chPollNowPlaying, 10_000);
}

// ── Reconnecting state ────────────────────────────────────────────────────
function _chShowReconnecting() {
  // Only switch to loading if we're already in loading/standby (not mid-playback)
  const current = _ch.status;
  if (!current || current === 'OFFLINE' || current === 'LOADING') {
    _chShowState('loading');
    _chSetText('ch-np-title', 'Reconnecting…');
  }
}

// ── Render state ──────────────────────────────────────────────────────────
function _chRenderState(ch) {
  if (!ch) return;

  const status = (ch.status || '').toUpperCase();
  const type   = (ch.programType || '').toUpperCase();

  // Cache for tap-to-play handler which runs outside this function
  _ch.status      = status;
  _ch.programType = type;

  // Update on-air badge
  const onairEl = document.getElementById('ch-onair-badge');
  const onairLabelEl = document.getElementById('ch-onair-label');
  if (onairEl) {
    const isOnAir = status !== 'OFFLINE' && ch.running && status !== 'ONLINE';
    onairEl.classList.toggle('hidden', !isOnAir);
    if (onairLabelEl) {
      onairLabelEl.textContent = type === 'LIVE_CAMERA' ? 'LIVE' : 'ON AIR';
    }
  }

  // Update info panel
  _chSetText('ch-np-title',  ch.programTitle || (ch.running ? 'Loading…' : '—'));
  _chSetText('ch-np-artist', ch.artist || '');
  _chSetText('ch-np-type',   _chTypeBadge(type));

  if (ch.nextTitle) {
    const ns = document.getElementById('ch-next-section');
    if (ns) ns.style.display = '';
    _chSetText('ch-next-type',  _chTypeBadge((ch.nextType || '').toUpperCase()));
    _chSetText('ch-next-title', ch.nextTitle);
  } else {
    const ns = document.getElementById('ch-next-section');
    if (ns) ns.style.display = 'none';
  }

  // Recently played
  if (Array.isArray(ch.recentlyPlayed) && ch.recentlyPlayed.length > 0) {
    const hs = document.getElementById('ch-history-section');
    const hl = document.getElementById('ch-history-list');
    if (hs) hs.style.display = '';
    if (hl) {
      hl.innerHTML = ch.recentlyPlayed.slice().reverse().map(i => `
        <div class="ch-history-item">
          <span class="ch-history-type">${_chTypeIcon((i.type || '').toUpperCase())}</span>
          <span class="ch-history-title">${_esc(i.title || '—')}</span>
          ${i.artist ? `<span class="ch-history-artist">${_esc(i.artist)}</span>` : ''}
        </div>
      `).join('');
    }
  }

  // Track progress
  _ch.itemStartedAt = ch.startedAt || 0;
  _ch.itemDuration  = ch.duration  || 0;
  _chUpdateInfoProgress(ch.elapsed || 0, ch.duration || 0);

  // ── Route to correct player ───────────────────────────────────────────

  if (status === 'OFFLINE') {
    _chShowState('offline');
    _chStopAudio();
    return;
  }

  // Channel is running but no current item scheduled yet
  if (!ch.running || (!type && !ch.programTitle)) {
    _chShowState('standby');
    _chStopAudio();
    return;
  }

  // Channel has content — route to player.
  // YouTube items (sourceType === 'youtube') override the normal type routing
  // regardless of whether the program type is VIDEO, MUSIC, AUDIO, etc.
  const sourceType = (ch.sourceType || 'direct').toLowerCase();
  if (sourceType === 'youtube' && ch.youtubeId) {
    _chShowYouTube(ch);
    return;
  }

  switch (type) {
    case 'LIVE_CAMERA':
      _chShowLive(ch);
      break;
    case 'VIDEO':
    case 'PRE_RECORDED_SHOW':
      _chShowVideo(ch);
      break;
    case 'MUSIC':
    case 'AUDIO':
      _chShowAudio(ch);
      break;
    case 'IMAGE':
      _chShowImage(ch);
      break;
    case 'SLIDESHOW':
      _chShowSlideshow(ch);
      break;
    default:
      // Unknown type but channel is running — show standby, not offline
      _chShowState('standby');
      break;
  }
}

// ── Player: Live Camera ───────────────────────────────────────────────────
function _chShowLive(ch) {
  _chShowState('live');
  _chStopAudio();
  _chStopSlideshow();

  const videoEl = document.getElementById('ch-video-live');
  const unavailEl = document.getElementById('ch-live-no-mediamtx');
  if (!videoEl) return;

  const hlsUrl = ch.mediaUrl;

  if (!hlsUrl) {
    if (videoEl) videoEl.style.display = 'none';
    if (unavailEl) unavailEl.style.display = '';
    return;
  }

  if (unavailEl) unavailEl.style.display = 'none';
  videoEl.style.display = '';

  if (_ch._liveHlsUrl === hlsUrl) return;
  _ch._liveHlsUrl = hlsUrl;

  if (_ch.hls) { try { _ch.hls.destroy(); } catch (_) {} _ch.hls = null; }

  if (window.Hls && window.Hls.isSupported()) {
    _ch.hls = new window.Hls({ lowLatencyMode: true });
    _ch.hls.loadSource(hlsUrl);
    _ch.hls.attachMedia(videoEl);
    _ch.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().catch(() => { _chShowTapToPlay(); });
    });
    _ch.hls.on(window.Hls.Events.ERROR, (ev, data) => {
      if (data.fatal) {
        console.warn('[Channel] HLS fatal error:', data.type, data.details);
        _chShowTapToPlay();
      }
    });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = hlsUrl;
    videoEl.play().catch(() => { _chShowTapToPlay(); });
  }
}

// ── Player: Video ─────────────────────────────────────────────────────────
function _chShowVideo(ch) {
  _chShowState('video');
  _chStopAudio();
  _chStopSlideshow();

  const videoEl = document.getElementById('ch-video-vod');
  if (!videoEl || !ch.mediaUrl) return;

  // Don't reload the same URL
  if (_ch._vodUrl === ch.mediaUrl) return;
  _ch._vodUrl = ch.mediaUrl;

  const seekTo = ch.elapsed > 5 && ch.duration > 0 && ch.elapsed < ch.duration - 5
    ? ch.elapsed : 0;
  videoEl.src  = ch.mediaUrl;
  videoEl.load();

  videoEl.onerror = () => {
    const errCode = videoEl.error?.code;
    const msg = errCode === 4 ? 'This media URL is not a supported direct video file.' :
                errCode === 2 ? 'A network error occurred while loading this video URL.' :
                               'Unable to load this video source.';
    console.warn('[Channel] Video load error:', { url: ch.mediaUrl, code: errCode, message: msg });
    // Don't show offline — show standby and wait for next state update
    _ch._vodUrl = null;
    _chShowState('standby');
    _chSetText('ch-np-title', msg);
  };

  if (seekTo > 0) {
    videoEl.addEventListener('loadedmetadata', () => {
      if (isFinite(videoEl.duration)) videoEl.currentTime = Math.min(seekTo, videoEl.duration - 2);
    }, { once: true });
  }
  videoEl.play().catch(() => { _chShowTapToPlay(); });
  // When video ends, go to standby and wait for server to advance
  videoEl.addEventListener('ended', () => {
    _ch._vodUrl = null;
    _chShowState('standby');
    _chSetText('ch-np-title', 'Loading next…');
  }, { once: true });
}

// ── Player: Audio / Music ─────────────────────────────────────────────────
function _chShowAudio(ch) {
  _chShowState('audio');
  _chStopSlideshow();

  // Update audio UI
  _chSetText('ch-audio-title',  ch.programTitle || '—');
  _chSetText('ch-audio-artist', ch.artist || '');

  const artEl = document.getElementById('ch-audio-artwork');
  if (artEl && ch.coverArt) {
    artEl.innerHTML = `<img src="${_esc(ch.coverArt)}" alt="${_esc(ch.programTitle || '')}" class="ch-audio-artwork-img">`;
  } else if (artEl) {
    artEl.innerHTML = '<div class="ch-audio-artwork-placeholder">♪</div>';
  }

  // ── Client-side track queue for MUSIC items with tracks[] array ────────
  // When the server sends a MUSIC item with a tracks[] array, build a local
  // queue and advance through it automatically — don't wait for the server
  // to publish a new now-playing for each individual track.
  const itemId = ch.mediaId || ch.programTitle;
  if (ch.tracks && ch.tracks.length > 0 && _ch._trackItemId !== itemId) {
    // New track set — build client queue
    _ch._trackItemId = itemId;
    _ch.trackQueue   = ch.tracks.filter(t => t.url);
    _ch.trackIdx     = 0;
    _ch.trackRetries = 0;

    // If server sends elapsed, seek into the queue to find the correct track
    if (ch.elapsed > 0 && ch.elapsed < (ch.duration || 0)) {
      let acc = 0;
      for (let i = 0; i < _ch.trackQueue.length; i++) {
        const dur = _ch.trackQueue[i].duration || 180;
        if (acc + dur > ch.elapsed) {
          _ch.trackIdx = i;
          break;
        }
        acc += dur;
      }
    }

    _chPlayQueuedTrack(_ch.trackQueue[_ch.trackIdx], ch.elapsed);
    return;
  }

  // Single-track mode: a single mediaUrl without a tracks[] array
  const audioEl = document.getElementById('ch-audio-el');
  if (!audioEl || !ch.mediaUrl) return;

  if (_ch._audioUrl !== ch.mediaUrl) {
    _chPlaySingleAudio(ch.mediaUrl, ch.elapsed, ch.duration);
  }
}

/** Play an individual track from the client-side track queue. */
function _chPlayQueuedTrack(track, serverElapsed) {
  if (!track || !track.url) {
    // Skip to next
    _chAdvanceTrackQueue();
    return;
  }

  const audioEl = document.getElementById('ch-audio-el');
  if (!audioEl) return;

  // Update now-playing UI for this track
  _chSetText('ch-audio-title',  track.title  || '—');
  _chSetText('ch-audio-artist', track.artist || '');
  _chSetText('ch-np-title',     track.title  || '—');
  _chSetText('ch-np-artist',    track.artist || '');
  _chSetText('ch-np-type',      '🎵 MUSIC');

  const artEl = document.getElementById('ch-audio-artwork');
  if (artEl && track.coverArt) {
    artEl.innerHTML = `<img src="${_esc(track.coverArt)}" alt="${_esc(track.title || '')}" class="ch-audio-artwork-img">`;
  } else if (artEl) {
    artEl.innerHTML = '<div class="ch-audio-artwork-placeholder">♪</div>';
  }

  _ch._audioUrl = track.url;
  audioEl.src   = track.url;
  audioEl.volume = _ch.volume;
  audioEl.load();

  // Seek if this is the first track and we have server elapsed context
  const seekTo = (_ch.trackIdx === 0 && serverElapsed > 2) ? serverElapsed : 0;
  if (seekTo > 0) {
    audioEl.addEventListener('loadedmetadata', () => {
      if (isFinite(audioEl.duration)) {
        audioEl.currentTime = Math.min(seekTo, audioEl.duration - 1);
      }
    }, { once: true });
  }

  audioEl.onerror = () => {
    console.warn('[Channel] Audio load error (queued):', track.url);
    _ch.trackRetries++;
    if (_ch.trackRetries >= 2) {
      _ch.trackRetries = 0;
      _chAdvanceTrackQueue();
    } else {
      // Retry after 2s
      setTimeout(() => _chPlayQueuedTrack(track, 0), 2_000);
    }
  };

  audioEl.play().then(() => {
    _ch.audioPlaying = true;
    _ch.trackRetries = 0;
    _chSetPlayIcon(true);
    _chStartWaveform();
  }).catch((err) => {
    _ch.audioPlaying = false;
    _chSetPlayIcon(false);
    _chStopWaveform();
    if (err && err.name === 'NotAllowedError') {
      // Browser blocked autoplay — user must tap to play
      console.info('[Channel] Autoplay blocked by browser policy — showing tap-to-play prompt');
      _chShowTapToPlay();
    } else {
      console.warn('[Channel] Audio play() rejected:', err?.message || err);
    }
  });

  // When this track ends, advance to the next
  audioEl.addEventListener('ended', _chOnQueuedTrackEnded, { once: true });
  audioEl.addEventListener('timeupdate', _chUpdateAudioProgress);
}

function _chOnQueuedTrackEnded() {
  _ch.trackRetries = 0;
  _ch._audioUrl = null;
  _chAdvanceTrackQueue();
}

function _chAdvanceTrackQueue() {
  const audioEl = document.getElementById('ch-audio-el');
  if (audioEl) {
    audioEl.pause();
    audioEl.removeEventListener('timeupdate', _chUpdateAudioProgress);
  }
  _ch.audioPlaying = false;
  _chSetPlayIcon(false);
  _chStopWaveform();

  _ch.trackIdx++;

  if (_ch.trackIdx >= _ch.trackQueue.length) {
    // All tracks played — start from the beginning of the same queue
    // and keep playing. This prevents a permanent standby when the server
    // hasn't advanced to a new item yet (same music block still active).
    _ch.trackIdx = 0;
    _ch._audioUrl = null;
    // Poll the server immediately to see if a new item has been queued.
    // If the server still has the same item, we replay the queue from the top.
    // If a new item arrived, _chPollNowPlaying / Firestore will push it.
    clearTimeout(_ch.pollTimer);
    _ch.pollTimer = setTimeout(_chPollNowPlaying, 500);
    // Meanwhile, restart the queue from the beginning without entering standby
    const first = _ch.trackQueue[0];
    if (first) {
      _chPlayQueuedTrack(first, 0);
    } else {
      _chShowState('standby');
      _chSetText('ch-np-title', 'Loading next program…');
    }
    return;
  }

  const next = _ch.trackQueue[_ch.trackIdx];
  _chPlayQueuedTrack(next, 0);
}

/** Play a single mediaUrl (no tracks[] array). */
function _chPlaySingleAudio(url, elapsed, duration) {
  const audioEl = document.getElementById('ch-audio-el');
  if (!audioEl || !url) return;

  _ch._audioUrl = url;
  audioEl.src   = url;
  audioEl.volume = _ch.volume;
  audioEl.load();

  audioEl.onerror = (e) => {
    const errCode = audioEl.error?.code;
    const msg = errCode === 4 ? 'This media URL is not a supported direct audio/video file.' :
                errCode === 3 ? 'Unable to decode media. The file may be corrupt or unsupported.' :
                errCode === 2 ? 'A network error occurred while loading this media URL.' :
                errCode === 1 ? 'Your browser blocked playback until the user interacts with the player.' :
                               'Unable to load this media source.';
    console.warn('[Channel] Single audio load error:', { url, code: errCode, message: msg });
    _ch._audioUrl = null;
    // Don't show offline — wait for server update
    _chShowState('standby');
    _chSetText('ch-np-title', msg);
  };

  if (elapsed > 2 && duration > 0 && elapsed < duration - 2) {
    audioEl.addEventListener('loadedmetadata', () => {
      if (isFinite(audioEl.duration)) {
        audioEl.currentTime = Math.min(elapsed, audioEl.duration - 1);
      }
    }, { once: true });
  }

  audioEl.play().then(() => {
    _ch.audioPlaying = true;
    _chSetPlayIcon(true);
    _chStartWaveform();
  }).catch((err) => {
    _ch.audioPlaying = false;
    _chSetPlayIcon(false);
    _chStopWaveform();
    if (err && err.name === 'NotAllowedError') {
      _chShowTapToPlay();
    }
  });

  audioEl.addEventListener('ended', _chOnSingleAudioEnded, { once: true });
  audioEl.addEventListener('timeupdate', _chUpdateAudioProgress);
}

function _chOnSingleAudioEnded() {
  // Single-track item finished — show standby and wait for server to publish next item.
  _chSetPlayIcon(false);
  _chStopWaveform();
  _ch.audioPlaying = false;
  _ch._audioUrl    = null;
  _chShowState('standby');
  _chSetText('ch-np-title', 'Loading next program…');
}

window.chToggleAudio = function() {
  const audioEl = document.getElementById('ch-audio-el');
  if (!audioEl) return;
  if (_ch.audioPlaying) {
    audioEl.pause();
    _ch.audioPlaying = false;
    _chSetPlayIcon(false);
    _chStopWaveform();
  } else {
    audioEl.play().then(() => {
      _ch.audioPlaying = true;
      _chSetPlayIcon(true);
      _chStartWaveform();
    }).catch(() => {});
  }
};

window.chSetVolume = function(val) {
  _ch.volume = val / 100;
  const audioEl = document.getElementById('ch-audio-el');
  if (audioEl) audioEl.volume = _ch.volume;
};

window.chTapToPlay = function() {
  const tapEl = document.getElementById('ch-tap-to-play');
  if (tapEl) tapEl.style.display = 'none';
  const audioEl   = document.getElementById('ch-audio-el');
  const videoLive = document.getElementById('ch-video-live');
  const videoVod  = document.getElementById('ch-video-vod');
  const t = (_ch.programType || '').toUpperCase();
  const st = (_ch.status || '').toLowerCase();
  // YouTube: user interaction has happened — try to reload with autoplay enabled
  if (st === 'youtube' || _ch._ytEmbedUrl) {
    const frame = document.getElementById('ch-youtube-frame');
    if (frame && _ch._ytEmbedUrl) {
      frame.src = _ch._ytEmbedUrl;
    }
    return;
  }
  if (audioEl && (t === 'AUDIO' || t === 'MUSIC')) {
    audioEl.muted = false;
    audioEl.play().then(() => {
      _ch.audioPlaying = true;
      _chSetPlayIcon(true);
      _chStartWaveform();
    }).catch(() => {});
  }
  if (videoLive) { videoLive.muted = false; videoLive.play().catch(() => {}); }
  if (videoVod)  { videoVod.muted  = false; videoVod.play().catch(() => {}); }
};

function _chUpdateAudioProgress() {
  const audioEl = document.getElementById('ch-audio-el');
  if (!audioEl) return;
  const elapsed  = audioEl.currentTime;
  const duration = audioEl.duration || _ch.itemDuration;
  _chUpdateInfoProgress(elapsed, duration);
}

// ── Player: Image ─────────────────────────────────────────────────────────
function _chShowImage(ch) {
  _chShowState('image');
  _chStopAudio();
  _chStopSlideshow();

  const imgEl = document.getElementById('ch-image-el');
  if (!imgEl) return;

  const url = ch.mediaUrl || (ch.images && ch.images[0]?.url);
  if (url) imgEl.src = url;
}

// ── Player: Slideshow ─────────────────────────────────────────────────────
function _chShowSlideshow(ch) {
  _chShowState('image');
  _chStopAudio();

  if (!ch.images || !ch.images.length) return;

  const images      = ch.images;
  const perSecs     = ch.perImageSecs || 10;
  const totalImages = images.length;

  const elapsed  = ch.elapsed || 0;
  const slideIdx = Math.min(Math.floor(elapsed / perSecs), totalImages - 1);

  const counter = document.getElementById('ch-slide-counter');
  const prog    = document.getElementById('ch-slide-progress');
  if (counter) counter.style.display = '';
  if (prog)    prog.style.display = '';

  const imgKey = images.map(i => i.url).join('|');
  if (_ch._slideshowKey === imgKey && _ch.slideIdx === slideIdx) return;

  _chStopSlideshow();
  _ch._slideshowKey = imgKey;
  _ch.slideIdx      = slideIdx;
  _ch.images        = images;

  function showSlide(idx) {
    const img   = images[idx];
    const imgEl = document.getElementById('ch-image-el');
    if (imgEl && img) imgEl.src = img.url;
    _chSetText('ch-slide-num',   String(idx + 1));
    _chSetText('ch-slide-total', String(totalImages));
    const fill = document.getElementById('ch-slide-fill');
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '0%';
      requestAnimationFrame(() => {
        fill.style.transition = `width ${perSecs}s linear`;
        fill.style.width = '100%';
      });
    }
  }

  showSlide(_ch.slideIdx);

  const slideElapsed = elapsed % perSecs;
  const firstDelay   = Math.max(0, (perSecs - slideElapsed) * 1000);

  _ch.slideTimer = setTimeout(function advance() {
    _ch.slideIdx++;
    if (_ch.slideIdx >= totalImages) {
      _chStopSlideshow();
      // Show standby and wait for server to advance the program
      _chShowState('standby');
      _chSetText('ch-np-title', 'Loading next program…');
      return;
    }
    showSlide(_ch.slideIdx);
    _ch.slideTimer = setTimeout(advance, perSecs * 1000);
  }, firstDelay);
}

function _chStopSlideshow() {
  clearTimeout(_ch.slideTimer);
  _ch.slideTimer = null;
}

// ── Audio helpers ─────────────────────────────────────────────────────────
function _chStopAudio() {
  const audioEl = document.getElementById('ch-audio-el');
  if (audioEl) {
    audioEl.pause();
    audioEl.removeEventListener('timeupdate', _chUpdateAudioProgress);
    audioEl.removeEventListener('ended', _chOnSingleAudioEnded);
    audioEl.removeEventListener('ended', _chOnQueuedTrackEnded);
  }
  _ch.audioPlaying = false;
  _ch._audioUrl    = null;
  _chStopWaveform();
}

function _chStartWaveform() {
  const bars = document.querySelectorAll('.ch-waveform-bar');
  bars.forEach(b => b.classList.add('active'));
}

function _chStopWaveform() {
  const bars = document.querySelectorAll('.ch-waveform-bar');
  bars.forEach(b => b.classList.remove('active'));
}

function _chSetPlayIcon(playing) {
  const btn = document.getElementById('ch-audio-play');
  if (btn) btn.textContent = playing ? '⏸' : '▶';
}

// ── Progress helpers ──────────────────────────────────────────────────────
function _chUpdateInfoProgress(elapsed, duration) {
  _chSetText('ch-np-elapsed',  _chFmtTime(elapsed));
  _chSetText('ch-np-duration', duration > 0 ? _chFmtTime(duration) : '—');
  const fill = document.getElementById('ch-np-fill');
  if (fill && duration > 0) {
    fill.style.width = Math.min(100, (elapsed / duration) * 100) + '%';
  }
  const pw = document.getElementById('ch-np-progress-wrap');
  if (pw) pw.style.display = duration > 0 ? '' : 'none';
}

// ── Player: YouTube ───────────────────────────────────────────────────────
// YouTube content is displayed via the YouTube IFrame embed.
// We do NOT call fetch() on the YouTube URL.
// We do NOT use <video src="youtubeUrl"> or <audio src="youtubeUrl">.
function _chShowYouTube(ch) {
  _chShowState('youtube');
  _chStopAudio();
  _chStopSlideshow();

  const frame  = document.getElementById('ch-youtube-frame');
  const titleEl  = document.getElementById('ch-yt-title');
  const artistEl = document.getElementById('ch-yt-artist');

  if (titleEl)  titleEl.textContent  = ch.programTitle || '—';
  if (artistEl) artistEl.textContent = ch.artist       || '';

  if (!frame || !ch.youtubeId) {
    console.warn('[Channel] YouTube player: missing youtubeId or frame element', ch);
    _chShowState('standby');
    _chSetText('ch-np-title', 'YouTube source unavailable');
    return;
  }

  // Avoid reloading the same video
  const embedUrl = `https://www.youtube.com/embed/${ch.youtubeId}?autoplay=1&rel=0&modestbranding=1`;
  if (_ch._ytEmbedUrl === embedUrl) return;
  _ch._ytEmbedUrl = embedUrl;

  frame.src = embedUrl;

  console.info('[Channel] YouTube embed loaded:', ch.youtubeId, ch.programTitle);
}

// ── UI state routing ──────────────────────────────────────────────────────
const CH_STATES = ['offline', 'loading', 'standby', 'live', 'video', 'audio', 'image', 'youtube'];

function _chShowState(state) {
  CH_STATES.forEach(s => {
    const el = document.getElementById('ch-state-' + s);
    if (el) el.style.display = s === state ? '' : 'none';
  });
  const tapEl = document.getElementById('ch-tap-to-play');
  if (tapEl) tapEl.style.display = 'none';
  // Clear YouTube embed src when leaving YouTube state to stop playback
  if (state !== 'youtube') {
    const frame = document.getElementById('ch-youtube-frame');
    if (frame && _ch._ytEmbedUrl) {
      frame.src = 'about:blank';
      _ch._ytEmbedUrl = null;
    }
  }
}

function _chShowTapToPlay() {
  const el = document.getElementById('ch-tap-to-play');
  if (el) el.style.display = '';
}

// ── Misc helpers ─────────────────────────────────────────────────────────
window.chRefresh = function() {
  _ch._pollMode = false;
  _chShowState('loading');
  _chPollNowPlaying();
};

function _chTypeBadge(type) {
  const MAP = {
    LIVE_CAMERA:       '🔴 LIVE CAMERA',
    MUSIC:             '🎵 MUSIC',
    AUDIO:             '🎙 AUDIO',
    VIDEO:             '🎬 VIDEO',
    IMAGE:             '🖼 IMAGE',
    SLIDESHOW:         '🖼 SLIDESHOW',
    PRE_RECORDED_SHOW: '📺 SHOW',
  };
  return MAP[type] || type || '—';
}

function _chTypeIcon(type) {
  const MAP = {
    LIVE_CAMERA:       '🔴',
    MUSIC:             '🎵',
    AUDIO:             '🎙',
    VIDEO:             '🎬',
    IMAGE:             '🖼',
    SLIDESHOW:         '🖼',
    PRE_RECORDED_SHOW: '📺',
  };
  return MAP[type] || '▶';
}

function _chSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _chFmtTime(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
