/**
 * AVENORA — 24-Hour Always-On Channel (SPA page)
 *
 * The viewer page for the AVENORA 24-hour channel.
 * Subscribes to channelNowPlaying/avenora via Firestore and renders the
 * appropriate player based on the current program type:
 *   MUSIC / AUDIO    → audio player with waveform visualization
 *   VIDEO            → video player
 *   IMAGE            → image display
 *   SLIDESHOW        → auto-advancing image slideshow
 *   LIVE_CAMERA      → HLS player via MediaMTX
 *   PRE_RECORDED_SHOW → video player
 *
 * This page does NOT expose skip/next controls to viewers.
 * The server engine controls all programming.
 *
 * Authentication: reuses the existing AVENORA Firebase session.
 * No separate login required.
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
            <div id="ch-state-offline" class="ch-state-view">
              <div class="ch-state-icon">📡</div>
              <div class="ch-state-title">CHANNEL OFFLINE</div>
              <div class="ch-state-desc">The AVENORA 24-Hour Channel is currently offline. Check back soon.</div>
              <button class="ch-btn ch-btn-outline" onclick="chRefresh()">↻ Refresh</button>
            </div>

            <!-- LOADING state -->
            <div id="ch-state-loading" class="ch-state-view">
              <div class="ch-spinner"></div>
              <div class="ch-state-desc">Connecting to channel…</div>
            </div>

            <!-- LIVE CAMERA player -->
            <div id="ch-state-live" class="ch-state-view" style="display:none">
              <div class="ch-live-badge">
                <span class="ch-live-dot"></span> LIVE
              </div>
              <div class="ch-video-wrap">
                <video id="ch-video-live" class="ch-video" autoplay playsinline controls></video>
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
                <video id="ch-video-vod" class="ch-video" autoplay playsinline controls></video>
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

  // Current channel state
  status:       null,
  programType:  null,
  mediaUrl:     null,
  images:       [],
  slideIdx:     0,
  slideTimer:   null,

  // Audio
  audio:        null,
  audioPlaying: false,
  volume:       0.8,

  // Video
  hls:          null,  // Hls.js instance for live camera

  // Progress RAF
  progressRaf:  null,
  itemStartedAt: 0,
  itemDuration:  0,

  // API base
  apiBase:      null,
};

// ── Init ──────────────────────────────────────────────────────────────────
async function _chInit() {
  // Resolve Firebase Firestore + module functions from the parent SPA's Firebase instance
  try {
    _ch.db       = await window.AvenoraFirebase.getFirestore();
    _ch.fsModule = await window.AvenoraFirebase._loadModuleFirestore();
  } catch (e) {
    console.warn('[Channel] Firestore unavailable, using REST fallback', e.message);
  }

  // Resolve API base
  _ch.apiBase = (window.LU_CONFIG && window.LU_CONFIG.apiUrl) || null;

  _chShowState('loading');
  _chSubscribeNowPlaying();

  // Return cleanup function
  return () => {
    if (typeof _ch.unsub === 'function') { try { _ch.unsub(); } catch (_) {} }
    _chStopAudio();
    _chStopSlideshow();
    cancelAnimationFrame(_ch.progressRaf);
    if (_ch.hls) { try { _ch.hls.destroy(); } catch (_) {} }
  };
}

// ── Firestore subscription ────────────────────────────────────────────────
function _chSubscribeNowPlaying() {
  if (!_ch.db || !_ch.fsModule) {
    // Fallback: poll the REST API every 10s
    _chPollNowPlaying();
    return;
  }

  try {
    const { doc, onSnapshot } = _ch.fsModule;
    if (!doc || !onSnapshot) throw new Error('Firestore doc/onSnapshot not available');

    _ch.unsub = onSnapshot(
      doc(_ch.db, 'channelNowPlaying', 'avenora'),
      snap => {
        if (!snap.exists()) {
          _chRenderState({ status: 'OFFLINE' });
          return;
        }
        _chRenderState(snap.data());
      },
      err => {
        console.warn('[Channel] Firestore snapshot error:', err.message);
        // Fall back to polling
        setTimeout(_chPollNowPlaying, 5000);
      }
    );
  } catch (e) {
    console.warn('[Channel] Firestore subscribe failed:', e.message);
    _chPollNowPlaying();
  }
}

async function _chPollNowPlaying() {
  try {
    const base = _ch.apiBase || '/api';
    const res  = await fetch(base + '/channel/now-playing');
    const data = await res.json();
    if (data.success && data.channel) {
      _chRenderState(data.channel);
    } else {
      _chRenderState({ status: 'OFFLINE' });
    }
  } catch (e) {
    _chRenderState({ status: 'OFFLINE' });
  }
  // Poll again in 10s
  setTimeout(_chPollNowPlaying, 10_000);
}

// ── Render state ──────────────────────────────────────────────────────────
function _chRenderState(ch) {
  if (!ch) return;

  const status = (ch.status || 'OFFLINE').toUpperCase();
  const type   = (ch.programType || '').toUpperCase();
  // Cache for tap-to-play handler which runs outside this function
  _ch.programType = type;

  // Update on-air badge
  const onairEl = document.getElementById('ch-onair-badge');
  const onairLabelEl = document.getElementById('ch-onair-label');
  if (onairEl) {
    const isOnAir = status !== 'OFFLINE' && ch.running;
    onairEl.classList.toggle('hidden', !isOnAir);
    if (onairLabelEl) {
      onairLabelEl.textContent = type === 'LIVE_CAMERA' ? 'LIVE' : 'ON AIR';
    }
  }

  // Update info panel
  _chSetText('ch-np-title',  ch.programTitle || '—');
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

  if (status === 'OFFLINE' || !ch.running) {
    _chShowState('offline');
    _chStopAudio();
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
      _chShowState('offline');
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

  const hlsUrl = ch.mediaUrl; // HLS URL from the now-playing doc

  if (!hlsUrl) {
    if (videoEl) videoEl.style.display = 'none';
    if (unavailEl) unavailEl.style.display = '';
    return;
  }

  if (unavailEl) unavailEl.style.display = 'none';
  videoEl.style.display = '';

  // If url hasn't changed, don't reload
  if (_ch._liveHlsUrl === hlsUrl) return;
  _ch._liveHlsUrl = hlsUrl;

  // Destroy any previous HLS instance
  if (_ch.hls) { try { _ch.hls.destroy(); } catch (_) {} _ch.hls = null; }

  if (window.Hls && window.Hls.isSupported()) {
    _ch.hls = new window.Hls({ lowLatencyMode: true });
    _ch.hls.loadSource(hlsUrl);
    _ch.hls.attachMedia(videoEl);
    _ch.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().catch(() => { _chShowTapToPlay(); });
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

  if (videoEl.src !== ch.mediaUrl) {
    const seekTo = ch.elapsed > 5 && ch.duration > 0 && ch.elapsed < ch.duration - 5
      ? ch.elapsed : 0;
    videoEl.src  = ch.mediaUrl;
    videoEl.load();
    if (seekTo > 0) {
      videoEl.addEventListener('loadedmetadata', () => {
        if (isFinite(videoEl.duration)) videoEl.currentTime = Math.min(seekTo, videoEl.duration - 2);
      }, { once: true });
    }
    videoEl.play().catch(() => { _chShowTapToPlay(); });
  }
  videoEl.addEventListener('ended', () => { /* engine will advance */ }, { once: true });
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

  const audioEl = document.getElementById('ch-audio-el');
  if (!audioEl) return;

  if (!ch.mediaUrl) return;

  if (_ch._audioUrl !== ch.mediaUrl) {
    _ch._audioUrl = ch.mediaUrl;
    audioEl.src   = ch.mediaUrl;
    audioEl.volume = _ch.volume;
    audioEl.load();

    // Seek to synchronized position
    if (ch.elapsed > 2 && ch.duration > 0 && ch.elapsed < ch.duration - 2) {
      audioEl.addEventListener('loadedmetadata', () => {
        if (isFinite(audioEl.duration)) {
          audioEl.currentTime = Math.min(ch.elapsed, audioEl.duration - 1);
        }
      }, { once: true });
    }

    audioEl.play().then(() => {
      _ch.audioPlaying = true;
      _chSetPlayIcon(true);
      _chStartWaveform();
    }).catch(() => {
      _ch.audioPlaying = false;
      _chSetPlayIcon(false);
      _chStopWaveform();
      _chShowTapToPlay();
    });

    audioEl.addEventListener('ended', _chOnAudioEnded, { once: true });
    audioEl.addEventListener('timeupdate', _chUpdateAudioProgress);
  }
}

function _chOnAudioEnded() {
  // The server engine will publish the next track within seconds via Firestore.
  // We just stop local playback and wait.
  _chSetPlayIcon(false);
  _chStopWaveform();
  _ch.audioPlaying = false;
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
  document.getElementById('ch-tap-to-play').style.display = 'none';
  const audioEl = document.getElementById('ch-audio-el');
  const videoLive = document.getElementById('ch-video-live');
  const videoVod = document.getElementById('ch-video-vod');
  const t = (_ch.programType || '').toUpperCase();
  if (audioEl && (t === 'AUDIO' || t === 'MUSIC')) {
    audioEl.play().then(() => { _ch.audioPlaying = true; _chSetPlayIcon(true); _chStartWaveform(); }).catch(() => {});
  }
  if (videoLive) videoLive.play().catch(() => {});
  if (videoVod)  videoVod.play().catch(() => {});
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

  // Calculate which slide should be showing based on server elapsed time
  const elapsed = ch.elapsed || 0;
  const slideIdx = Math.min(Math.floor(elapsed / perSecs), totalImages - 1);

  // Show slide counter
  const counter = document.getElementById('ch-slide-counter');
  const prog    = document.getElementById('ch-slide-progress');
  if (counter) counter.style.display = '';
  if (prog)    prog.style.display = '';

  // Only restart if the image set changed
  const imgKey = images.map(i => i.url).join('|');
  if (_ch._slideshowKey === imgKey && _ch.slideIdx === slideIdx) return;

  _chStopSlideshow();
  _ch._slideshowKey = imgKey;
  _ch.slideIdx      = slideIdx;
  _ch.images        = images;

  function showSlide(idx) {
    const img  = images[idx];
    const imgEl = document.getElementById('ch-image-el');
    if (imgEl && img) imgEl.src = img.url;
    _chSetText('ch-slide-num', String(idx + 1));
    _chSetText('ch-slide-total', String(totalImages));
    // Progress bar
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

  // Calculate remaining time in current slide
  const slideElapsed = elapsed % perSecs;
  const firstDelay   = Math.max(0, (perSecs - slideElapsed) * 1000);

  _ch.slideTimer = setTimeout(function advance() {
    _ch.slideIdx++;
    if (_ch.slideIdx >= totalImages) {
      // Slideshow done — engine will advance the channel
      _chStopSlideshow();
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
  }
  _ch.audioPlaying = false;
  _ch._audioUrl = null;
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
  _chSetText('ch-np-elapsed', _chFmtTime(elapsed));
  _chSetText('ch-np-duration', duration > 0 ? _chFmtTime(duration) : '—');
  const fill = document.getElementById('ch-np-fill');
  if (fill && duration > 0) {
    fill.style.width = Math.min(100, (elapsed / duration) * 100) + '%';
  }
  const pw = document.getElementById('ch-np-progress-wrap');
  if (pw) pw.style.display = duration > 0 ? '' : 'none';
}

// ── UI state routing ──────────────────────────────────────────────────────
const CH_STATES = ['offline', 'loading', 'live', 'video', 'audio', 'image'];

function _chShowState(state) {
  CH_STATES.forEach(s => {
    const el = document.getElementById('ch-state-' + s);
    if (el) el.style.display = s === state ? '' : 'none';
  });
  document.getElementById('ch-tap-to-play').style.display = 'none';
}

function _chShowTapToPlay() {
  const el = document.getElementById('ch-tap-to-play');
  if (el) el.style.display = '';
}

// ── Misc helpers ─────────────────────────────────────────────────────────
window.chRefresh = function() {
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
