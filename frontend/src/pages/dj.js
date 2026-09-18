/**
 * AVENORA DJ SYSTEM
 * Real browser-based DJ with dual decks, crossfader, EQ, BPM, visualizer
 * Uses Web Audio API for actual audio processing
 *
 * BROADCAST MODE — fully browser-side:
 *   Deck A audio  ─┐
 *                  ├─→ bass/mid/treble EQ ─→ Deck Gain ─→ DJ.masterGain
 *   Deck B audio  ─┘
 *
 *   DJ.masterGain ─→ DJ.analyser ─→ AudioContext.destination  (speakers)
 *                 └→ DJ.streamDest (MediaStreamAudioDestinationNode)
 *                         ↓
 *                   MediaRecorder  (browser recording / broadcast capture)
 *
 * No backend server is required for browser recording.
 * RTMP delivery to platforms (Twitch/YouTube) requires a relay because
 * browsers cannot speak RTMP natively — this is documented honestly below.
 */

registerPage('dj', {
  async render(container) {
    container.innerHTML = `
      <!-- Cosmic deep-space background layer -->
      <div id="dj-cosmic-bg" aria-hidden="true"></div>

      <div id="dj-app">

        <!-- ═══ HEADER ══════════════════════════════════════════ -->
        <div class="dj-cosmic-header">
          <div class="dj-brand-wrap">
            <span class="dj-brand-title">AVENORA</span>
            <span class="dj-brand-system">DJ SYSTEM</span>
            <span class="dj-brand-subtitle">MUSIC BEYOND TIME</span>
          </div>
        </div>

        <!-- ═══ MODE SELECTOR ════════════════════════════════════ -->
        <div class="dj-mode-bar">
          <button class="dj-mode-btn mode-listen" id="mode-listen" onclick="setDJMode('listen')" aria-label="Listen mode">
            LISTEN
          </button>
          <button class="dj-mode-btn mode-dj active" id="mode-dj" onclick="setDJMode('dj')" aria-label="DJ mode">
            DJ
          </button>
          <button class="dj-mode-btn mode-broadcast" id="mode-broadcast" onclick="setDJMode('broadcast')" aria-label="Broadcast mode">
            <span class="dj-bc-dot" aria-hidden="true"></span>BROADCAST
          </button>
        </div>

        <!-- ═══ BROADCAST PANEL (hidden by default) ═════════════ -->
        <div id="dj-broadcast-panel" style="display:none">
          <div class="dj-panel dj-broadcast-panel">
            <h4 class="dj-bc-title">📡 BROADCAST MODE</h4>

            <!-- Status row -->
            <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md)">
              <span id="bc-status-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#555;flex-shrink:0"></span>
              <span id="bc-status-text" style="font-size:0.85rem;color:var(--text-muted)">Idle — ready to record</span>
            </div>

            <!-- Recording duration -->
            <div id="bc-timer" class="dj-bc-timer" style="display:none">00:00:00</div>

            <!-- Controls -->
            <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;margin-bottom:var(--space-md)">
              <button class="btn btn-primary" id="bc-start-btn" onclick="djBroadcastStart()">⏺ START RECORDING</button>
              <button class="btn btn-outline" id="bc-stop-btn" onclick="djBroadcastStop()" disabled style="opacity:0.4">⏹ STOP</button>
            </div>

            <!-- Protocol info -->
            <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.6;border-top:1px solid rgba(255,100,40,0.15);padding-top:var(--space-sm)">
              <strong style="color:var(--text-primary)">What BROADCAST captures:</strong><br>
              ✅ Full mixed master output (Deck A + Deck B, EQ, crossfader)<br>
              ✅ Browser-local recording via <code>MediaRecorder</code> (download when stopped)<br>
              ⚠️ RTMP streaming (Twitch, YouTube) requires a relay service — browsers
              cannot speak RTMP natively. A WebRTC/WHIP relay or OBS can ingest your
              local recording and forward it to RTMP platforms.
            </div>

            <!-- Download link appears after stop -->
            <div id="bc-download-wrap" style="display:none;margin-top:var(--space-md)">
              <a id="bc-download-link" href="#" download="avenora-dj-mix.webm"
                 class="btn btn-green" style="text-decoration:none">
                ⬇ DOWNLOAD MIX
              </a>
              <span style="font-size:0.78rem;color:var(--text-muted);margin-left:var(--space-sm)" id="bc-download-size"></span>
            </div>
          </div>
        </div>

        <!-- ═══ MAIN DJ INTERFACE ════════════════════════════════ -->
        <div id="dj-interface" style="max-width:1200px;margin:0 auto">

          <!-- Decks + Mixer grid -->
          <div id="dj-decks-grid">

            <!-- DECK A — AURORA -->
            ${renderDeckHTML('A')}

            <!-- MIXER -->
            <div class="dj-panel dj-mixer-panel" id="dj-mixer-col"
                 style="display:flex;flex-direction:column;align-items:center;gap:var(--space-sm)">
              <p class="dj-mixer-title">MIXER</p>

              <div style="display:flex;flex-direction:column;gap:2px;width:100%">
                ${renderEQKnob('Master', 'master')}
                ${renderEQKnob('Bass A', 'bass-a')}
                ${renderEQKnob('Mid A', 'mid-a')}
                ${renderEQKnob('Treble A', 'treble-a')}
                <div class="dj-mixer-divider"></div>
                ${renderEQKnob('Bass B', 'bass-b')}
                ${renderEQKnob('Mid B', 'mid-b')}
                ${renderEQKnob('Treble B', 'treble-b')}
              </div>

              <!-- Crossfader -->
              <div class="dj-crossfader-wrap">
                <p class="dj-crossfader-label">CROSSFADER</p>
                <div class="dj-crossfader-track">
                  <span class="dj-cf-a">A</span>
                  <input type="range" id="crossfader" min="0" max="100" value="50"
                         class="dj-slider-crossfader"
                         oninput="djCrossfade(this.value)" aria-label="Crossfader">
                  <span class="dj-cf-b">B</span>
                </div>
              </div>
            </div>

            <!-- DECK B — NOVA -->
            ${renderDeckHTML('B')}
          </div>

          <!-- Visualizer -->
          <div class="dj-panel dj-viz-panel" style="margin-bottom:var(--space-lg)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-sm)">
              <span class="dj-viz-title">VISUALIZER</span>
              <div style="display:flex;gap:4px">
                <button class="dj-ctrl-btn" onclick="djSetViz('bars')">BARS</button>
                <button class="dj-ctrl-btn" onclick="djSetViz('wave')">WAVE</button>
                <button class="dj-ctrl-btn" onclick="djSetViz('circle')">CIRCLE</button>
              </div>
            </div>
            <canvas id="dj-visualizer" style="width:100%;height:120px;border-radius:var(--radius-md);background:rgba(4,2,12,0.60)"></canvas>
          </div>

          <!-- Library grid -->
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-md)">

            <!-- Music library + import -->
            <div class="dj-panel dj-library-panel">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md)">
                <span class="dj-library-title">MUSIC LIBRARY</span>
                <button class="btn btn-primary btn-sm" onclick="djImport()">📂 IMPORT</button>
              </div>
              <div class="search-bar" style="margin-bottom:var(--space-md)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" placeholder="Search tracks…" id="dj-search" oninput="djSearchTracks(this.value)">
              </div>
              <div id="dj-library" style="max-height:240px;overflow-y:auto">
                <p style="text-align:center;color:var(--text-muted);padding:var(--space-lg);font-size:0.85rem">
                  Loading library…
                </p>
              </div>
            </div>

            <!-- Playlists -->
            <div class="dj-panel dj-playlist-panel">
              <p class="dj-playlist-title" style="margin-bottom:var(--space-md)">PLAYLISTS</p>
              <div style="display:flex;flex-direction:column;gap:var(--space-sm)">
                ${['AVENORA HITS','AVENORA ESSENTIALS','AVENORA CHILL','AVENORA ROCK','24/7 AVENORA RADIO'].map(p => `
                  <div class="track-row" onclick="loadDJPlaylist('${p}')">
                    <span style="font-size:1.1rem">🎵</span>
                    <span style="flex:1;font-weight:600;font-size:0.83rem">${p}</span>
                    <span style="font-size:0.75rem;color:var(--text-muted)">→</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

        </div><!-- /dj-interface -->
      </div><!-- /dj-app -->
    `;

    initDJSystem();
    return () => cleanupDJSystem();
  }
});

function renderDeckHTML(deck) {
  const d = deck.toLowerCase();
  const isA = deck === 'A';
  const deckClass = isA ? 'dj-deck-a' : 'dj-deck-b';
  const titleClass = isA ? 'dj-deck-title-a' : 'dj-deck-title-b';
  const subtitle   = isA ? 'AURORA' : 'NOVA';
  const sliderClass = isA ? 'dj-slider dj-slider-gold' : 'dj-slider dj-slider-cyan';
  const progClass  = isA ? 'dj-progress-fill-a' : 'dj-progress-fill-b';
  const outerClass = isA ? 'dj-play-outer-a' : 'dj-play-outer-b';

  return `
    <div class="dj-panel ${deckClass}" id="deck-${d}">
      <!-- Deck header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-md)">
        <div>
          <span class="dj-deck-title ${titleClass}">DECK ${deck}</span>
          <span class="dj-deck-subtitle">${subtitle}</span>
        </div>
        <button class="dj-queue-btn" onclick="djLoadToQueue('${deck}')" aria-label="Add to Deck ${deck} queue">QUEUE</button>
      </div>

      <!-- Track info -->
      <div class="dj-track-info">
        <p id="deck-${d}-title" class="dj-track-title">No track loaded</p>
        <p id="deck-${d}-bpm" class="dj-track-bpm">BPM: —</p>
      </div>

      <!-- Progress / waveform -->
      <div class="dj-progress-wrap" onclick="djSeek('${deck}', event, this)" aria-label="Seek">
        <div class="dj-progress-bar">
          <div class="${progClass}" id="deck-${d}-prog" style="width:0%"></div>
        </div>
      </div>
      <div class="dj-time-row">
        <span id="deck-${d}-time">0:00</span>
        <span id="deck-${d}-dur">0:00</span>
      </div>

      <!-- Transport controls -->
      <div class="dj-play-btn-wrap">
        <button class="dj-ctrl-btn" onclick="djPrev('${deck}')" aria-label="Previous">⏮</button>
        <button class="dj-ctrl-btn dj-ctrl-cue" id="deck-${d}-cue" onclick="djCue('${deck}')" aria-label="Cue">CUE</button>
        <div class="${outerClass}" id="deck-${d}-play-wrap">
          <button class="dj-play-btn"
                  id="deck-${d}-play" onclick="djTogglePlay('${deck}')" aria-label="Play/Pause Deck ${deck}">▶</button>
        </div>
        <button class="dj-ctrl-btn" onclick="djNext('${deck}')" aria-label="Next">⏭</button>
        <button class="dj-ctrl-btn dj-ctrl-sync" onclick="djSync('${deck}')" title="Sync BPM" aria-label="Sync BPM">SYNC</button>
      </div>

      <!-- Volume -->
      <div class="dj-vol-row">
        <span class="dj-vol-label">VOL</span>
        <input type="range" min="0" max="100" value="80" id="deck-${d}-vol"
               class="${sliderClass}"
               oninput="djSetVolume('${deck}', this.value)" aria-label="Deck ${deck} volume">
        <span id="deck-${d}-vol-label" class="dj-vol-pct">80%</span>
      </div>

      <!-- Load track -->
      <button class="dj-load-btn" onclick="djLoadToDecks('${deck}')" aria-label="Load track to Deck ${deck}">
        📂 LOAD TRACK
      </button>
    </div>
  `;
}

function renderEQKnob(label, id) {
  // Choose slider colour based on channel
  const isB = id.endsWith('-b');
  const isMaster = id === 'master';
  const sliderClass = isMaster ? 'dj-slider dj-slider-neutral'
                    : isB      ? 'dj-slider dj-slider-cyan'
                               : 'dj-slider dj-slider-gold';
  return `
    <div class="dj-eq-row">
      <span class="dj-eq-label">${label}</span>
      <input type="range" min="-20" max="20" value="0" id="eq-${id}"
             class="${sliderClass}"
             oninput="djEQ('${id}', this.value)" aria-label="${label} EQ">
      <span id="eq-${id}-val" class="dj-eq-val">0dB</span>
    </div>
  `;
}

// ─── DJ Audio Engine ──────────────────────────────────────
const DJ = {
  audioCtx:    null,
  analyser:    null,
  visualizer:  null,
  // MediaStreamAudioDestinationNode — taps the master mix for recording
  streamDest:  null,
  decks: {
    A: { audio: null, gainNode: null, bassFilter: null, midFilter: null, trebleFilter: null, isPlaying: false, cuePoint: 0, queue: [], queueIndex: -1 },
    B: { audio: null, gainNode: null, bassFilter: null, midFilter: null, trebleFilter: null, isPlaying: false, cuePoint: 0, queue: [], queueIndex: -1 },
  },
  masterGain:      null,
  crossfadeValue:  50,
  library:         [],
  mode:            'dj',
  // Broadcast state
  broadcast: {
    recorder:   null,   // MediaRecorder instance
    chunks:     [],     // recorded Blob chunks
    timerStart: null,   // Date when recording started
    timerRaf:   null,   // requestAnimationFrame handle
  },
};

function initDJSystem() {
  try {
    DJ.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    DJ.masterGain = DJ.audioCtx.createGain();
    DJ.masterGain.gain.value = 0.8;

    DJ.analyser = DJ.audioCtx.createAnalyser();
    DJ.analyser.fftSize = 512;

    // ── Audio graph ────────────────────────────────────────
    // masterGain → analyser → speakers (existing path)
    DJ.masterGain.connect(DJ.analyser);
    DJ.analyser.connect(DJ.audioCtx.destination);

    // masterGain → streamDest  (broadcast/recording tap)
    // MediaStreamAudioDestinationNode is supported in all modern browsers.
    if (typeof DJ.audioCtx.createMediaStreamDestination === 'function') {
      DJ.streamDest = DJ.audioCtx.createMediaStreamDestination();
      DJ.masterGain.connect(DJ.streamDest);
    }

    // Init both decks
    ['A', 'B'].forEach(deck => {
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous'; // required for Web Audio API to process CORS audio
      document.body.appendChild(audio);
      DJ.decks[deck].audio = audio;

      const src = DJ.audioCtx.createMediaElementSource(audio);
      const gain = DJ.audioCtx.createGain();
      gain.gain.value = 0.8;

      // EQ filters
      const bass = DJ.audioCtx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 200;
      const mid  = DJ.audioCtx.createBiquadFilter(); mid.type  = 'peaking';  mid.frequency.value  = 1000; mid.Q.value = 1;
      const treble = DJ.audioCtx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 3000;

      src.connect(bass); bass.connect(mid); mid.connect(treble); treble.connect(gain); gain.connect(DJ.masterGain);

      DJ.decks[deck].gainNode    = gain;
      DJ.decks[deck].bassFilter  = bass;
      DJ.decks[deck].midFilter   = mid;
      DJ.decks[deck].trebleFilter = treble;

      audio.addEventListener('timeupdate', () => djUpdateProgress(deck));
      // Queue auto-advance: when a track ends, load and play the next in the deck queue
      audio.addEventListener('ended', () => {
        DJ.decks[deck].isPlaying = false;
        djUpdatePlayBtn(deck);
        djAutoAdvance(deck);
      });
      audio.addEventListener('loadedmetadata', () => {
        const dur = document.getElementById(`deck-${deck.toLowerCase()}-dur`);
        if (dur) dur.textContent = formatDuration(audio.duration);
      });
    });

    // Visualizer
    const canvas = document.getElementById('dj-visualizer');
    if (canvas && typeof LegendVisual !== 'undefined' && LegendVisual) {
      try {
        DJ.visualizer = new LegendVisual.MusicVisualizer(canvas, DJ.analyser, { mode: 'bars', color: '#00aaff' });
        DJ.visualizer.start();
      } catch {}
    }

    // Progress update loop
    DJ.progressInterval = setInterval(() => {
      ['A', 'B'].forEach(deck => djUpdateProgress(deck));
    }, 100);

    // Load the cloud library so tracks appear immediately
    djLoadCloudLibrary();

  } catch (err) {
    Toast.error('Web Audio API not available: ' + err.message);
  }
}

function cleanupDJSystem() {
  clearInterval(DJ.progressInterval);
  // Stop any active broadcast recording
  if (DJ.broadcast.recorder && DJ.broadcast.recorder.state !== 'inactive') {
    DJ.broadcast.recorder.stop();
  }
  if (DJ.broadcast.timerRaf) cancelAnimationFrame(DJ.broadcast.timerRaf);
  ['A', 'B'].forEach(deck => {
    const audio = DJ.decks[deck]?.audio;
    if (audio) { audio.pause(); audio.src = ''; audio.remove(); }
  });
  if (DJ.visualizer) DJ.visualizer.stop();
  if (DJ.audioCtx) DJ.audioCtx.close();
}

// ─── Mode switcher ────────────────────────────────────────
window.setDJMode = function (mode) {
  DJ.mode = mode;
  ['listen', 'dj', 'broadcast'].forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (!btn) return;
    btn.className = `dj-mode-btn mode-${m}${m === mode ? ' active' : ''}`;
  });

  const panel = document.getElementById('dj-broadcast-panel');
  if (panel) panel.style.display = (mode === 'broadcast') ? 'block' : 'none';

  if (mode === 'broadcast') {
    _djBroadcastCheckSupport();
  }
};

/**
 * Check browser support for broadcast features and update the panel accordingly.
 * Called when the user switches to Broadcast mode.
 */
function _djBroadcastCheckSupport() {
  const hasDest     = !!DJ.streamDest;
  const hasRecorder = typeof window.MediaRecorder !== 'undefined';

  if (!hasDest) {
    _djBroadcastSetStatus('unsupported',
      'MediaStreamAudioDestinationNode not supported in this browser. ' +
      'Try Chrome/Firefox on desktop.');
    const startBtn = document.getElementById('bc-start-btn');
    if (startBtn) startBtn.disabled = true;
    return;
  }
  if (!hasRecorder) {
    _djBroadcastSetStatus('unsupported',
      'MediaRecorder not supported in this browser. ' +
      'Chrome, Firefox, and Edge on Android/desktop all support it.');
    const startBtn = document.getElementById('bc-start-btn');
    if (startBtn) startBtn.disabled = true;
    return;
  }

  _djBroadcastSetStatus('idle', 'Ready — mixed master output will be recorded');
}

function _djBroadcastSetStatus(state, message) {
  const dot  = document.getElementById('bc-status-dot');
  const text = document.getElementById('bc-status-text');
  const colorMap = { idle: '#888', recording: '#ff4444', unsupported: '#555', stopped: '#22cc88' };
  if (dot)  dot.style.background = colorMap[state] || '#888';
  if (text) text.textContent = message;
}

// ─── Broadcast: Start ─────────────────────────────────────
window.djBroadcastStart = function () {
  if (!DJ.streamDest || typeof window.MediaRecorder === 'undefined') {
    Toast.error('Broadcast recording not supported in this browser.');
    return;
  }

  // Prevent duplicate recorders
  if (DJ.broadcast.recorder && DJ.broadcast.recorder.state !== 'inactive') {
    Toast.info('Recording is already active.');
    return;
  }

  // Resume AudioContext if suspended (browser autoplay policy)
  if (DJ.audioCtx?.state === 'suspended') {
    DJ.audioCtx.resume().catch(() => {});
  }

  // Choose the best supported MIME type
  const preferredTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    '',   // browser default
  ];
  const mimeType = preferredTypes.find(t => !t || MediaRecorder.isTypeSupported(t)) || '';
  const recorderOpts = mimeType ? { mimeType } : {};

  let recorder;
  try {
    recorder = new MediaRecorder(DJ.streamDest.stream, recorderOpts);
  } catch (err) {
    Toast.error('Could not start MediaRecorder: ' + err.message);
    return;
  }

  DJ.broadcast.chunks  = [];
  DJ.broadcast.recorder = recorder;

  recorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) DJ.broadcast.chunks.push(e.data);
  };

  recorder.onstop = () => {
    _djBroadcastOnStop(mimeType);
  };

  recorder.onerror = e => {
    Toast.error('Recording error: ' + (e.error?.message || 'unknown'));
    _djBroadcastSetStatus('idle', 'Recording failed — ready to retry');
  };

  recorder.start(1000); // collect data every 1 s

  // UI feedback
  DJ.broadcast.timerStart = Date.now();
  _djBroadcastTickTimer();

  _djBroadcastSetStatus('recording', 'Recording mixed master output…');
  const startBtn = document.getElementById('bc-start-btn');
  const stopBtn  = document.getElementById('bc-stop-btn');
  const timer    = document.getElementById('bc-timer');
  const dlWrap   = document.getElementById('bc-download-wrap');
  if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '0.4'; }
  if (stopBtn)  { stopBtn.disabled  = false; stopBtn.style.opacity  = '1'; }
  if (timer)    timer.style.display = 'block';
  if (dlWrap)   dlWrap.style.display = 'none';

  Toast.success('Broadcast recording started — capturing full DJ mix');
};

// ─── Broadcast: Stop ─────────────────────────────────────
window.djBroadcastStop = function () {
  const rec = DJ.broadcast.recorder;
  if (!rec || rec.state === 'inactive') {
    Toast.info('No active recording.');
    return;
  }
  rec.stop(); // triggers onstop → _djBroadcastOnStop
};

function _djBroadcastOnStop(mimeType) {
  if (DJ.broadcast.timerRaf) {
    cancelAnimationFrame(DJ.broadcast.timerRaf);
    DJ.broadcast.timerRaf = null;
  }

  const startBtn = document.getElementById('bc-start-btn');
  const stopBtn  = document.getElementById('bc-stop-btn');
  const timer    = document.getElementById('bc-timer');
  if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = '1'; }
  if (stopBtn)  { stopBtn.disabled  = true;  stopBtn.style.opacity  = '0.4'; }
  if (timer)    timer.style.display = 'none';

  const chunks = DJ.broadcast.chunks;
  if (!chunks.length) {
    _djBroadcastSetStatus('idle', 'Recording stopped — no audio captured (play a track first)');
    return;
  }

  const ext = mimeType && mimeType.includes('ogg') ? 'ogg'
            : mimeType && mimeType.includes('mp4') ? 'mp4'
            : 'webm';
  const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
  const url  = URL.createObjectURL(blob);

  const dlLink = document.getElementById('bc-download-link');
  const dlSize = document.getElementById('bc-download-size');
  const dlWrap = document.getElementById('bc-download-wrap');
  if (dlLink) {
    dlLink.href     = url;
    dlLink.download = `avenora-dj-mix.${ext}`;
    dlLink.textContent = `⬇ DOWNLOAD MIX (.${ext.toUpperCase()})`;
  }
  if (dlSize) {
    const mb = (blob.size / (1024 * 1024)).toFixed(1);
    dlSize.textContent = `${mb} MB`;
  }
  if (dlWrap) dlWrap.style.display = 'block';

  _djBroadcastSetStatus('stopped', 'Recording saved — download your mix below');
  Toast.success('Broadcast stopped. Your mix is ready to download.');

  // Release stream tracks so browser reports mic/audio capture as off
  DJ.streamDest?.stream?.getTracks().forEach(t => t.stop());
  // Re-connect streamDest for next session
  if (DJ.streamDest && DJ.masterGain) {
    // Re-connect only if the destination is still alive
    try { DJ.masterGain.connect(DJ.streamDest); } catch {}
  }

  DJ.broadcast.chunks   = [];
  DJ.broadcast.recorder = null;
}

function _djBroadcastTickTimer() {
  const timer = document.getElementById('bc-timer');
  if (!timer || !DJ.broadcast.recorder || DJ.broadcast.recorder.state !== 'recording') return;

  const elapsed = Math.floor((Date.now() - DJ.broadcast.timerStart) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  timer.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  DJ.broadcast.timerRaf = requestAnimationFrame(_djBroadcastTickTimer);
}

// ─── Visualizer mode ─────────────────────────────────────
window.djSetViz = function (mode) {
  if (DJ.visualizer) {
    DJ.visualizer.stop();
    DJ.visualizer.opts.mode = mode;
    DJ.visualizer.start();
  }
};

// ─── Local file import ────────────────────────────────────
window.djImport = function () {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.multiple = true;
  if ('webkitdirectory' in input && confirm('Import entire folder?')) input.webkitdirectory = true;

  input.onchange = (e) => {
    const files = Array.from(e.target.files);
    const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];
    const valid = files.filter(f => audioExts.some(ext => f.name.toLowerCase().endsWith(ext)));

    const newTracks = valid.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name.replace(/\.[^.]+$/, ''),
      url: URL.createObjectURL(f),
      file: f,
      _local: true,
    }));

    DJ.library.push(...newTracks);
    djRenderLibrary(DJ.library);
    Toast.success(`${newTracks.length} tracks imported to DJ library!`);
  };
  input.click();
};

// ─── Cloud library loader (Firebase → Firestore cloudStreamTracks) ──
async function djLoadCloudLibrary() {
  const libraryEl = document.getElementById('dj-library');

  // 1. Show any already-loaded local tracks immediately
  if (DJ.library.length) { djRenderLibrary(DJ.library); return; }

  // 2. Try to load from Firestore (user's own uploads)
  const firebaseUser = window.AvenoraFirebase?.Auth?.getUser?.();
  if (!firebaseUser || !window.AvenoraFirebase?.getFirestore) {
    if (libraryEl) libraryEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:var(--space-md);font-size:0.85rem">Sign in to load your cloud library, or use 📂 IMPORT to add local files</p>';
    return;
  }

  try {
    const uid   = firebaseUser.uid || firebaseUser.id;
    const fsDb  = await window.AvenoraFirebase.getFirestore();
    const { collection, query, orderBy, limit, getDocs } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    const snap = await getDocs(query(
      collection(fsDb, 'cloudStreamTracks', uid, 'tracks'),
      orderBy('createdAt', 'desc'),
      limit(200)
    ));

    const cloudTracks = snap.docs.map(d => {
      const data = d.data();
      return {
        id:   d.id,
        name: data.title || data.fileName?.replace(/\.[^.]+$/, '') || 'Untitled',
        url:  data.url   || data.downloadURL || data.fileUrl || '',
        artist: data.artist || '',
        _cloud: true,
      };
    }).filter(t => t.url);

    DJ.library = [...DJ.library, ...cloudTracks];
    djRenderLibrary(DJ.library);

    if (!cloudTracks.length && libraryEl && !DJ.library.length) {
      libraryEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:var(--space-md);font-size:0.85rem">No tracks in your cloud library yet — upload tracks in Cloud Studio or use 📂 IMPORT</p>';
    }
  } catch (err) {
    console.warn('[DJSystem] Could not load cloud library:', err.message);
    if (libraryEl && !DJ.library.length) {
      libraryEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:var(--space-md);font-size:0.85rem">Could not load cloud library. Use 📂 IMPORT to add local files.</p>';
    }
  }
}

window.djSearchTracks = debounce(function (query) {
  const filtered = query.trim()
    ? DJ.library.filter(t => t.name.toLowerCase().includes(query.toLowerCase()))
    : DJ.library;
  djRenderLibrary(filtered);
}, 200);

function djRenderLibrary(tracks) {
  const el = document.getElementById('dj-library');
  if (!el) return;
  if (!tracks.length) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:var(--space-md);font-size:0.85rem">No tracks found</p>';
    return;
  }
  el.innerHTML = tracks.map(t => `
    <div class="track-row">
      <div class="track-info">
        <div class="track-title truncate" style="font-size:0.85rem">${escapeHtml(t.name)}</div>
        ${t.artist ? `<div style="font-size:0.73rem;color:var(--text-muted)">${escapeHtml(t.artist)}</div>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="djLoadTrackToDeck('A', '${t.id}')" style="color:var(--neon-blue);font-size:0.75rem">→A</button>
      <button class="btn btn-ghost btn-sm" onclick="djLoadTrackToDeck('B', '${t.id}')" style="color:var(--neon-green);font-size:0.75rem">→B</button>
    </div>
  `).join('');
}

window.djLoadTrackToDeck = function (deck, trackId) {
  const track = DJ.library.find(t => t.id === trackId);
  if (!track) return;

  const d = DJ.decks[deck];
  const audio = d.audio;
  if (!audio) return;

  audio.src = track.url;
  audio.load();

  const title = document.getElementById(`deck-${deck.toLowerCase()}-title`);
  const bpm   = document.getElementById(`deck-${deck.toLowerCase()}-bpm`);
  if (title) title.textContent = track.name + (track.artist ? ` — ${track.artist}` : '');
  if (bpm)   bpm.textContent   = 'BPM: detecting...';

  // Set this track into the deck queue at position 0, retaining subsequent tracks
  if (!d.queue.find(qt => qt.id === trackId)) {
    d.queue.unshift(track);
    d.queueIndex = 0;
  } else {
    d.queueIndex = d.queue.findIndex(qt => qt.id === trackId);
  }

  Toast.info(`"${track.name}" loaded to Deck ${deck}`);
};

window.djLoadToDecks = function (deck) { djImportToSpecificDeck(deck); };
window.djLoadToQueue = function (deck) {
  // Allow user to pick files to append to this deck's queue
  djEnqueueToDeck(deck);
};

function djEnqueueToDeck(deck) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.multiple = true;
  input.onchange = (e) => {
    const files = Array.from(e.target.files);
    const newTracks = files.map(f => ({
      id:    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name:  f.name.replace(/\.[^.]+$/, ''),
      url:   URL.createObjectURL(f),
      _local: true,
    }));
    DJ.library.push(...newTracks);
    DJ.decks[deck].queue.push(...newTracks);
    djRenderLibrary(DJ.library);
    Toast.success(`${newTracks.length} tracks added to Deck ${deck} queue`);
  };
  input.click();
}

function djImportToSpecificDeck(deck) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const track = {
      id:    Date.now().toString(),
      name:  file.name.replace(/\.[^.]+$/, ''),
      url:   URL.createObjectURL(file),
      _local: true,
    };
    DJ.library.push(track);
    djLoadTrackToDeck(deck, track.id);
    djRenderLibrary(DJ.library);
  };
  input.click();
}

// ─── Queue auto-advance ───────────────────────────────────
/**
 * Called when a deck's current track ends.
 * Advances to the next track in that deck's queue.
 * If the queue is exhausted it stops cleanly — does NOT restart track 1.
 */
function djAutoAdvance(deck) {
  const d = DJ.decks[deck];
  const nextIndex = d.queueIndex + 1;

  if (nextIndex < d.queue.length) {
    d.queueIndex = nextIndex;
    const nextTrack = d.queue[nextIndex];

    const audio = d.audio;
    if (!audio) return;
    audio.src = nextTrack.url;
    audio.load();

    const title = document.getElementById(`deck-${deck.toLowerCase()}-title`);
    if (title) title.textContent = nextTrack.name + (nextTrack.artist ? ` — ${nextTrack.artist}` : '');

    // Auto-play the next track
    audio.play()
      .then(() => { d.isPlaying = true; djUpdatePlayBtn(deck); })
      .catch(() => {
        // Autoplay blocked — user must press play
        djUpdatePlayBtn(deck);
      });

    Toast.info(`Deck ${deck}: now playing "${nextTrack.name}"`);
  }
  // If no more tracks, deck simply stays idle (no restart)
}

window.djTogglePlay = function (deck) {
  if (DJ.audioCtx?.state === 'suspended') DJ.audioCtx.resume();
  const d = DJ.decks[deck];
  const audio = d.audio;
  if (!audio) return;
  if (d.isPlaying) {
    audio.pause();
    d.isPlaying = false;
  } else {
    audio.play().then(() => { d.isPlaying = true; }).catch(err => Toast.error(`Deck ${deck}: ${err.message}`));
  }
  djUpdatePlayBtn(deck);
};

function djUpdatePlayBtn(deck) {
  const d = deck.toLowerCase();
  const btn  = document.getElementById(`deck-${d}-play`);
  const wrap = document.getElementById(`deck-${d}-play-wrap`);
  const playing = DJ.decks[deck].isPlaying;
  if (btn)  btn.textContent = playing ? '⏸' : '▶';
  if (wrap) {
    wrap.classList.toggle('playing', playing);
  }
}

// djPrev / djNext now navigate the deck queue instead of seeking by 10 s
window.djPrev = function (deck) {
  const d = DJ.decks[deck];
  if (d.queue.length && d.queueIndex > 0) {
    d.queueIndex -= 1;
    const t = d.queue[d.queueIndex];
    d.audio.src = t.url;
    d.audio.load();
    const title = document.getElementById(`deck-${deck.toLowerCase()}-title`);
    if (title) title.textContent = t.name + (t.artist ? ` — ${t.artist}` : '');
    if (d.isPlaying) d.audio.play().catch(() => {});
  } else {
    const audio = d.audio;
    if (audio) audio.currentTime = Math.max(0, audio.currentTime - 10);
  }
};
window.djNext = function (deck) {
  const d = DJ.decks[deck];
  if (d.queue.length && d.queueIndex < d.queue.length - 1) {
    d.queueIndex += 1;
    const t = d.queue[d.queueIndex];
    d.audio.src = t.url;
    d.audio.load();
    const title = document.getElementById(`deck-${deck.toLowerCase()}-title`);
    if (title) title.textContent = t.name + (t.artist ? ` — ${t.artist}` : '');
    if (d.isPlaying) d.audio.play().catch(() => {});
  } else {
    const audio = d.audio;
    if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
  }
};

window.djCue = function (deck) {
  const d = DJ.decks[deck];
  if (!d.audio) return;
  if (d.isPlaying) {
    d.cuePoint = d.audio.currentTime;
    Toast.info(`Cue point set at ${formatDuration(d.cuePoint)}`);
  } else {
    d.audio.currentTime = d.cuePoint;
  }
};

window.djSync = function (deck) {
  Toast.info('BPM sync: detecting BPM requires audio analysis — feature available with Essentia.js integration.');
};

window.djCrossfade = function (val) {
  DJ.crossfadeValue = parseInt(val);
  const aGain = (100 - val) / 100;
  const bGain = val / 100;
  if (DJ.decks.A.gainNode) DJ.decks.A.gainNode.gain.value = aGain;
  if (DJ.decks.B.gainNode) DJ.decks.B.gainNode.gain.value = bGain;
};

window.djSetVolume = function (deck, val) {
  const d = DJ.decks[deck];
  if (d.gainNode) d.gainNode.gain.value = val / 100;
  const label = document.getElementById(`deck-${deck.toLowerCase()}-vol-label`);
  if (label) label.textContent = `${val}%`;
};

window.djEQ = function (id, val) {
  const valEl = document.getElementById(`eq-${id}-val`);
  if (valEl) valEl.textContent = `${val >= 0 ? '+' : ''}${val}dB`;

  const gainDb = parseFloat(val);
  const [type, deckLetter] = id.split('-');

  if (deckLetter === 'a' || deckLetter === 'b') {
    const deck = deckLetter.toUpperCase();
    const d = DJ.decks[deck];
    const filterMap = { bass: d.bassFilter, mid: d.midFilter, treble: d.trebleFilter };
    const filter = filterMap[type];
    if (filter) filter.gain.value = gainDb;
  } else if (id === 'master') {
    if (DJ.masterGain) DJ.masterGain.gain.value = (parseInt(val) + 20) / 40;
  }
};

window.djSeek = function (deck, e, bar) {
  const audio = DJ.decks[deck]?.audio;
  if (!audio || !audio.duration) return;
  const rect = bar.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  audio.currentTime = ((touch.clientX - rect.left) / rect.width) * audio.duration;
};

function djUpdateProgress(deck) {
  const audio = DJ.decks[deck]?.audio;
  if (!audio) return;
  const d   = deck.toLowerCase();
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  const prog = document.getElementById(`deck-${d}-prog`);
  if (prog) prog.style.width = `${pct}%`;
  const time = document.getElementById(`deck-${d}-time`);
  if (time) time.textContent = formatDuration(audio.currentTime);
}

/**
 * loadDJPlaylist — loads all user's cloud tracks that match the playlist name
 * (preset playlists use Firestore genres; "24/7 AVENORA RADIO" loads all tracks).
 */
window.loadDJPlaylist = function (name) {
  const genreMap = {
    'AVENORA HITS':       null,         // all tracks
    'AVENORA ESSENTIALS': null,
    'AVENORA CHILL':      'Chill',
    'AVENORA ROCK':       'Rock',
    '24/7 AVENORA RADIO': null,
  };
  const genre = genreMap[name];

  // Filter current library
  const filtered = genre
    ? DJ.library.filter(t => (t.genre || '').toLowerCase() === genre.toLowerCase())
    : DJ.library;

  if (!filtered.length) {
    Toast.info(`Playlist "${name}" — no tracks loaded yet. Import files or upload tracks to Cloud Studio.`);
    return;
  }

  // Load into Deck A queue
  DJ.decks.A.queue = [...filtered];
  DJ.decks.A.queueIndex = 0;
  djLoadTrackToDeck('A', filtered[0].id);
  Toast.success(`Loaded ${filtered.length} tracks from "${name}" into Deck A`);
};
