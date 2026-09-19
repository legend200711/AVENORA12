/**
 * AVENORA — Channel Studio (Cinematic Broadcast Control Center)
 *
 * Provides the channel admin/founder with:
 *   - Real-time channel status (current program, next, elapsed, viewers)
 *   - Programming queue management (add / remove / reorder)
 *   - Fallback queue management
 *   - Live camera control (redirects to AVENORA Live)
 *   - Broadcast history (last 20 items)
 *   - Channel start/stop/skip
 *   - Connection status system with exponential backoff retry
 *
 * Authentication: reuses existing AVENORA Firebase session.
 * Access: founder/admin role only (checked server-side on all mutations).
 */

registerPage('channelstudio', {
  async render(container) {
    container.innerHTML = `
      <div class="chs-page">

        <!-- ── Cinematic Hero Header ─────────────────────────── -->
        <div class="chs-hero">
          <div class="chs-hero-bg-grid" aria-hidden="true"></div>
          <div class="chs-hero-orbit chs-hero-orbit-1" aria-hidden="true"></div>
          <div class="chs-hero-orbit chs-hero-orbit-2" aria-hidden="true"></div>
          <div class="chs-hero-inner">
            <div class="chs-hero-badge">
              <span class="chs-hero-badge-dot"></span>
              <span>24/7 BROADCAST CONTROL</span>
            </div>
            <div class="chs-hero-logo">
              <span class="chs-hero-logo-avenora">AVENORA</span>
              <span class="chs-hero-logo-studio">CHANNEL STUDIO</span>
            </div>
            <p class="chs-hero-tagline">24-HOUR ALWAYS-ON CHANNEL CONTROL CENTER</p>
            <div id="chs-hero-status" class="chs-hero-status">
              <span class="chs-hero-status-dot chs-dot-offline"></span>
              <span id="chs-hero-status-text">CHANNEL OFFLINE</span>
            </div>
          </div>
        </div>

        <!-- ── Connection Status Banner ──────────────────────── -->
        <div id="chs-conn-banner" class="chs-conn-banner chs-conn-connecting" style="display:none">
          <div class="chs-conn-banner-inner">
            <span class="chs-conn-banner-dot"></span>
            <span id="chs-conn-banner-text">CONNECTING TO CHANNEL SYSTEM…</span>
            <button id="chs-conn-retry-btn" class="chs-conn-retry-btn" onclick="chsManualRetry()" style="display:none">RECONNECT</button>
          </div>
        </div>

        <!-- ── Auth gate ──────────────────────────────────────── -->
        <div id="chs-auth-gate" style="display:none">
          <div class="chs-gate-card">
            <div class="chs-gate-icon">🔒</div>
            <h3 class="chs-gate-title">SIGN IN REQUIRED</h3>
            <p class="chs-gate-desc">Channel Studio is restricted to channel admins and founders.</p>
            <button class="chs-btn chs-btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
          </div>
        </div>

        <!-- ── Not admin gate ─────────────────────────────────── -->
        <div id="chs-noaccess" style="display:none">
          <div class="chs-gate-card">
            <div class="chs-gate-icon">🛡</div>
            <h3 class="chs-gate-title">ACCESS RESTRICTED</h3>
            <p class="chs-gate-desc">Channel Studio is for channel admins and founders only.</p>
          </div>
        </div>

        <!-- ── Loading ──────────────────────────────────────────── -->
        <div id="chs-loading" class="chs-loading-screen">
          <div class="chs-spinner"></div>
          <span class="chs-loading-text">Initialising Channel Studio…</span>
        </div>

        <!-- ── Main app ─────────────────────────────────────────── -->
        <div id="chs-app" style="display:none">

          <!-- ═══ CHANNEL STATUS CARD ═══════════════════════════ -->
          <div class="chs-status-card card" id="chs-status-bar">
            <div class="chs-status-card-hdr">
              <div class="chs-status-card-dot-row">
                <span class="chs-status-card-blink" aria-hidden="true"></span>
                <span class="chs-status-card-hdr-label">CHANNEL STATUS</span>
              </div>
              <div class="chs-status-controls">
                <button id="chs-btn-start-ch" class="chs-btn chs-btn-green chs-btn-sm" onclick="chsStartChannel()" style="display:none">▶ START</button>
                <button id="chs-btn-stop-ch" class="chs-btn chs-btn-danger chs-btn-sm" onclick="chsStopChannel()" style="display:none">⏹ STOP</button>
                <button class="chs-btn chs-btn-outline chs-btn-sm" onclick="chsSkip()" title="Skip to next program">⏭</button>
                <button class="chs-btn chs-btn-outline chs-btn-sm" onclick="chsRefreshStatus()">↻ Refresh</button>
                <a class="chs-btn chs-btn-outline chs-btn-sm" href="#channel" onclick="navigateTo('channel');return false;">📺 View Channel</a>
              </div>
            </div>

            <!-- Status indicator row -->
            <div class="chs-status-indicator-row">
              <span id="chs-status-dot" class="chs-dot chs-dot-offline"></span>
              <span id="chs-status-text" class="chs-status-text-large">OFFLINE</span>
            </div>

            <!-- NOW / NEXT block -->
            <div class="chs-now-next-grid">
              <div class="chs-now-block">
                <div class="chs-now-next-label">NOW</div>
                <div class="chs-now-next-type" id="chs-now-type">—</div>
                <div class="chs-now-next-title" id="chs-now-title">—</div>
                <div class="chs-progress-wrap" id="chs-progress-wrap">
                  <div class="chs-progress-bar"><div class="chs-progress-fill" id="chs-progress-fill" style="width:0%"></div></div>
                  <div class="chs-progress-pct" id="chs-progress-pct">0%</div>
                </div>
                <div class="chs-time-row">
                  <span class="chs-time-label">ELAPSED</span>
                  <span class="chs-time-val" id="chs-elapsed">—</span>
                  <span class="chs-time-sep">·</span>
                  <span class="chs-time-label">REMAINING</span>
                  <span class="chs-time-val" id="chs-remaining">—</span>
                </div>
              </div>
              <div class="chs-next-block">
                <div class="chs-now-next-label">NEXT</div>
                <div class="chs-now-next-type" id="chs-next-type">—</div>
                <div class="chs-now-next-title" id="chs-next-title">—</div>
                <div class="chs-queue-info" id="chs-queue-info"></div>
              </div>
            </div>
          </div>

          <!-- ═══ LIVE CAMERA ════════════════════════════════════ -->
          <div class="chs-section card" id="chs-live-section">
            <div class="chs-section-hdr">
              <div class="chs-section-hdr-left">
                <span class="chs-section-icon">📡</span>
                <h2 class="chs-section-title">LIVE CAMERA</h2>
              </div>
              <div id="chs-live-status-badge" class="chs-live-badge" style="display:none">
                <span class="chs-live-badge-dot"></span>OFFLINE
              </div>
            </div>
            <p class="chs-section-desc">
              Broadcast directly to the AVENORA 24-Hour Channel. Your live feed instantly replaces
              the scheduled program for all viewers. When you stop, the channel seamlessly continues
              with the next scheduled item.
            </p>
            <div class="chs-live-camera-area">
              <div class="chs-live-camera-icon" aria-hidden="true">🎥</div>
              <div class="chs-live-camera-actions">
                <button class="chs-btn chs-btn-live" onclick="chsGoLive()">🎥 GO LIVE NOW</button>
                <button class="chs-btn chs-btn-outline chs-btn-sm" onclick="chsStopLive()" id="chs-stop-live-btn" style="display:none">⏹ Stop Live</button>
              </div>
              <div id="chs-live-session-status" class="chs-live-session-status chs-live-session-ready">
                LIVE SESSION READY
              </div>
            </div>
            <div id="chs-live-info" class="chs-live-now-box" style="display:none">
              <div class="chs-live-now-hdr">
                <span class="chs-live-now-dot"></span>
                <strong>ON AIR — LIVE NOW</strong>
              </div>
              <div id="chs-live-detail" class="chs-live-now-detail">—</div>
            </div>
          </div>

          <!-- ═══ CHANNEL PROGRAMMING ═══════════════════════════ -->
          <div class="chs-section card">
            <div class="chs-section-hdr">
              <div class="chs-section-hdr-left">
                <span class="chs-section-icon">📋</span>
                <h2 class="chs-section-title">CHANNEL PROGRAMMING</h2>
              </div>
              <button class="chs-btn chs-btn-primary chs-btn-sm" onclick="chsOpenAddProgram()">+ Add Program</button>
            </div>
            <p class="chs-section-desc">
              Programs broadcast in order. When all have aired, the channel loops back to the beginning.
            </p>
            <div id="chs-program-list" class="chs-program-list">
              <div class="chs-list-loading"><div class="chs-spinner chs-spinner-sm"></div><span>Loading schedule…</span></div>
            </div>
          </div>

          <!-- ═══ FALLBACK BROADCAST ════════════════════════════ -->
          <div class="chs-section card">
            <div class="chs-section-hdr">
              <div class="chs-section-hdr-left">
                <span class="chs-section-icon">🔄</span>
                <h2 class="chs-section-title">FALLBACK BROADCAST</h2>
              </div>
              <button class="chs-btn chs-btn-outline chs-btn-sm" onclick="chsOpenAddFallback()">+ Add Fallback</button>
            </div>
            <p class="chs-section-desc">
              Fallback programming keeps the AVENORA channel alive when no scheduled program is available.
              This content loops continuously to prevent dead air.
            </p>
            <div id="chs-fallback-status-row" class="chs-fallback-status-row" style="display:none"></div>
            <div id="chs-fallback-list" class="chs-program-list">
              <div class="chs-list-loading"><div class="chs-spinner chs-spinner-sm"></div><span>Loading fallback…</span></div>
            </div>
          </div>

          <!-- ═══ BROADCAST HISTORY ══════════════════════════════ -->
          <div class="chs-section card">
            <div class="chs-section-hdr">
              <div class="chs-section-hdr-left">
                <span class="chs-section-icon">📜</span>
                <h2 class="chs-section-title">BROADCAST HISTORY</h2>
              </div>
              <button class="chs-btn chs-btn-ghost chs-btn-sm" onclick="chsLoadHistory()">↻ Refresh</button>
            </div>
            <p class="chs-section-desc">Recently played programs on this channel.</p>
            <div id="chs-history-list" class="chs-program-list">
              <div class="chs-list-loading"><div class="chs-spinner chs-spinner-sm"></div><span>Loading history…</span></div>
            </div>
          </div>

          <!-- ═══ CHANNEL SETTINGS ══════════════════════════════ -->
          <div class="chs-section card">
            <div class="chs-section-hdr">
              <div class="chs-section-hdr-left">
                <span class="chs-section-icon">⚙️</span>
                <h2 class="chs-section-title">CHANNEL SETTINGS</h2>
              </div>
            </div>
            <div class="chs-settings-grid">
              <div class="chs-setting-card">
                <div class="chs-setting-label">CHANNEL IDENTITY</div>
                <div class="chs-setting-value">AVENORA 24-HOUR CHANNEL</div>
                <div class="chs-setting-hint">Managed by founder/admin</div>
              </div>
              <div class="chs-setting-card">
                <div class="chs-setting-label">LIVE HEARTBEAT</div>
                <div class="chs-setting-value">30 SECONDS</div>
                <div class="chs-setting-hint">Auto-transitions after 30s of heartbeat silence</div>
              </div>
              <div class="chs-setting-card">
                <div class="chs-setting-label">PROGRAMMING</div>
                <div class="chs-setting-value">LOOP ALL CONTENT</div>
                <div class="chs-setting-hint">Channel loops back to start when queue ends</div>
              </div>
              <div class="chs-setting-card" id="chs-backend-card">
                <div class="chs-setting-label">BACKEND STATUS</div>
                <div id="chs-backend-status" class="chs-setting-value">Checking…</div>
                <div class="chs-setting-hint" id="chs-backend-hint">Verifying connection to channel engine</div>
                <button id="chs-backend-reconnect" class="chs-btn chs-btn-outline chs-btn-sm" style="display:none;margin-top:8px" onclick="chsManualRetry()">RECONNECT</button>
              </div>
            </div>
          </div>

        </div><!-- /#chs-app -->

        <!-- ── ADD PROGRAM / FALLBACK PANEL ───────────────────── -->
        <div id="chs-add-panel" class="chs-add-panel card" style="display:none">
          <div class="chs-section-hdr">
            <div class="chs-section-hdr-left">
              <h2 class="chs-section-title" id="chs-add-panel-title">Add Program</h2>
            </div>
            <button class="chs-btn chs-btn-ghost chs-btn-sm" onclick="chsCloseAddPanel()">✕ Close</button>
          </div>
          <div class="chs-form">
            <div class="chs-field">
              <label class="chs-label">Program Type</label>
              <select class="form-input" id="chs-add-type" onchange="chsOnTypeChange()">
                <option value="MUSIC">🎵 Music / Audio Track</option>
                <option value="AUDIO">🎙 Audio Program</option>
                <option value="VIDEO">🎬 Video</option>
                <option value="PRE_RECORDED_SHOW">📺 Pre-recorded Show</option>
                <option value="IMAGE">🖼 Image Display</option>
                <option value="SLIDESHOW">🖼 Slideshow</option>
              </select>
            </div>
            <div class="chs-field">
              <label class="chs-label">Title</label>
              <input class="form-input" id="chs-add-title" placeholder="Program title" maxlength="200">
            </div>
            <div class="chs-field">
              <label class="chs-label">Artist / Host <span class="chs-opt">optional</span></label>
              <input class="form-input" id="chs-add-artist" placeholder="Artist or host name" maxlength="200">
            </div>
            <div class="chs-field" id="chs-media-url-field">
              <label class="chs-label">Media URL</label>
              <input class="form-input" id="chs-add-url" placeholder="https://… (direct file or YouTube URL)" maxlength="2000" oninput="chsOnUrlInput()">
              <div class="chs-hint" id="chs-url-hint">Direct link to audio/video file, or a YouTube URL (https://youtu.be/… or https://www.youtube.com/watch?v=…)</div>
              <div id="chs-url-type-badge" style="display:none;margin-top:6px;font-size:0.8rem;font-weight:600;color:var(--neon-red)"></div>
            </div>
            <div class="chs-field">
              <label class="chs-label">Duration <span class="chs-opt">seconds — leave 0 to auto-detect</span></label>
              <input class="form-input" type="number" id="chs-add-duration" placeholder="e.g. 180 for 3 minutes" min="0" max="86400" value="0">
            </div>
            <div class="chs-field" id="chs-artwork-field">
              <label class="chs-label">Cover Art URL <span class="chs-opt">optional</span></label>
              <input class="form-input" id="chs-add-art" placeholder="https://…" maxlength="500">
            </div>
            <!-- Slideshow fields -->
            <div id="chs-slideshow-fields" style="display:none;flex-direction:column;gap:16px">
              <div class="chs-field">
                <label class="chs-label">Seconds Per Image</label>
                <select class="form-input" id="chs-add-per-image">
                  <option value="5">5 seconds</option>
                  <option value="10" selected>10 seconds</option>
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">60 seconds</option>
                </select>
              </div>
              <div class="chs-field">
                <label class="chs-label">Image URLs <span class="chs-opt">one per line</span></label>
                <textarea class="form-input" id="chs-add-images" rows="6"
                  placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"></textarea>
              </div>
            </div>
            <div id="chs-add-error" class="chs-error" style="display:none"></div>
            <div class="chs-form-actions">
              <button class="chs-btn chs-btn-primary" onclick="chsSubmitAdd()">Add to Queue</button>
              <button class="chs-btn chs-btn-ghost" onclick="chsCloseAddPanel()">Cancel</button>
            </div>
          </div>
        </div>

      </div><!-- /.chs-page -->
    `;

    // ── Bootstrap ────────────────────────────────────────────────────────
    document.getElementById('chs-loading').style.display = 'flex';
    document.getElementById('chs-app').style.display    = 'none';

    let user = window.AvenoraFirebase?.Auth?.getUser?.() || null;
    if (!user && window.AvenoraFirebase?.Auth?.listenAuthState) {
      await new Promise(resolve => {
        if (LegendState && LegendState.get('authLoading') === false) {
          user = window.AvenoraFirebase.Auth.getUser();
          return resolve();
        }
        const unsub = LegendState?.subscribe?.('user', (u) => {
          user = u;
          if (typeof unsub === 'function') unsub();
          resolve();
        });
        setTimeout(() => {
          if (typeof unsub === 'function') unsub();
          user = window.AvenoraFirebase?.Auth?.getUser?.() || null;
          resolve();
        }, 5000);
      });
    }

    document.getElementById('chs-loading').style.display = 'none';

    if (!user) {
      document.getElementById('chs-auth-gate').style.display = '';
      const authUnsub = LegendState?.subscribe?.('user', async (u) => {
        if (u) {
          if (typeof authUnsub === 'function') authUnsub();
          document.getElementById('chs-auth-gate').style.display = 'none';
          await _chsInit(u);
        }
      });
      return () => { if (typeof authUnsub === 'function') authUnsub(); };
    }

    await _chsInit(user);
    return () => { _chsClearAll(); };
  }
});

// ── Module state ──────────────────────────────────────────────────────────
const _chsState = {
  user:               null,
  apiBase:            null,
  programming:        [],
  fallback:           [],
  addingTo:           'program',  // 'program' | 'fallback'
  pollTimer:          null,
  liveStreamId:       null,
  liveHeartbeatTimer: null,
  // Connection / retry state
  retryTimer:         null,
  retryCount:         0,
  maxRetries:         8,
  retryDelays:        [2000, 5000, 10000, 20000, 30000, 30000, 60000, 60000],
  connState:          'idle', // idle | connecting | connected | offline
};

// ── Init ──────────────────────────────────────────────────────────────────
async function _chsInit(user) {
  _chsState.user    = user;
  _chsState.apiBase = (window.LU_CONFIG && window.LU_CONFIG.apiUrl) || '/api';

  // Check role — server will also enforce, but give a nice early gate
  const role = user.role || (await _chsGetRole(user));
  if (role !== 'founder' && role !== 'admin') {
    document.getElementById('chs-noaccess').style.display = '';
    return;
  }

  document.getElementById('chs-app').style.display = '';

  _chsSetConnState('connecting');
  await _chsInitialLoad();

  // Auto-refresh status every 10s
  _chsState.pollTimer = setInterval(chsLoadStatus, 10_000);
}

// ── Initial data load with connection management ──────────────────────────
async function _chsInitialLoad() {
  _chsState.retryCount = 0;
  await _chsTryLoad();
}

async function _chsTryLoad() {
  _chsSetConnState('connecting');
  try {
    await Promise.all([
      chsLoadStatus(),
      chsLoadProgramming(),
      chsLoadFallback(),
      chsLoadHistory(),
    ]);
    _chsCheckBackend();
    _chsSetConnState('connected');
    _chsState.retryCount = 0;
  } catch (e) {
    console.warn('[ChannelStudio] Load failed:', e.message);
    _chsHandleConnFailure();
  }
}

function _chsHandleConnFailure() {
  _chsState.retryCount++;
  if (_chsState.retryCount > _chsState.maxRetries) {
    _chsSetConnState('offline');
    return;
  }
  const delay = _chsState.retryDelays[Math.min(_chsState.retryCount - 1, _chsState.retryDelays.length - 1)];
  _chsSetConnState('reconnecting', delay);
  clearTimeout(_chsState.retryTimer);
  _chsState.retryTimer = setTimeout(_chsTryLoad, delay);
}

function _chsSetConnState(state, retryIn) {
  _chsState.connState = state;
  const banner    = document.getElementById('chs-conn-banner');
  const bannerTxt = document.getElementById('chs-conn-banner-text');
  const retryBtn  = document.getElementById('chs-conn-retry-btn');
  const backendEl = document.getElementById('chs-backend-status');
  const reconnBtn = document.getElementById('chs-backend-reconnect');

  if (!banner) return;

  banner.className = 'chs-conn-banner';
  if (retryBtn) retryBtn.style.display = 'none';

  if (state === 'connected') {
    banner.style.display = 'none';
    if (backendEl) backendEl.innerHTML = '<span class="chs-conn-ok">● CONNECTED</span>';
    if (reconnBtn) reconnBtn.style.display = 'none';
  } else if (state === 'connecting') {
    banner.style.display = '';
    banner.classList.add('chs-conn-connecting');
    if (bannerTxt) bannerTxt.textContent = 'CONNECTING TO CHANNEL SYSTEM…';
    if (backendEl) backendEl.innerHTML = '<span class="chs-conn-connecting-text">● CONNECTING…</span>';
  } else if (state === 'reconnecting') {
    banner.style.display = '';
    banner.classList.add('chs-conn-reconnecting');
    const sec = retryIn ? Math.round(retryIn / 1000) : '…';
    if (bannerTxt) bannerTxt.textContent = `CONNECTION LOST — Retrying in ${sec}s…`;
    if (retryBtn) retryBtn.style.display = '';
    if (backendEl) backendEl.innerHTML = '<span class="chs-conn-lost">● CONNECTION LOST</span>';
    if (reconnBtn) reconnBtn.style.display = '';
  } else if (state === 'offline') {
    banner.style.display = '';
    banner.classList.add('chs-conn-offline');
    if (bannerTxt) bannerTxt.textContent = 'CHANNEL SYSTEM OFFLINE — Check backend configuration';
    if (retryBtn) retryBtn.style.display = '';
    if (backendEl) backendEl.innerHTML = '<span class="chs-conn-lost">● OFFLINE</span>';
    if (reconnBtn) reconnBtn.style.display = '';
  }
}

window.chsManualRetry = function() {
  clearTimeout(_chsState.retryTimer);
  _chsState.retryCount = 0;
  _chsTryLoad();
};

async function _chsGetRole(user) {
  try {
    const fs  = await window.AvenoraFirebase.getFirestore();
    const fsM = await window.AvenoraFirebase._loadModuleFirestore();
    const { doc, getDoc } = fsM || {};
    if (doc && getDoc) {
      const snap = await getDoc(doc(fs, 'users', user.uid));
      if (snap.exists()) return snap.data().role || 'user';
    }
  } catch (_) {}
  return user.role || 'user';
}

function _chsClearAll() {
  clearInterval(_chsState.pollTimer);
  _chsState.pollTimer = null;
  clearInterval(_chsState.liveHeartbeatTimer);
  _chsState.liveHeartbeatTimer = null;
  clearTimeout(_chsState.retryTimer);
  _chsState.retryTimer = null;
}

// ── API helper ────────────────────────────────────────────────────────────
async function _chsApi(method, path, body) {
  const base = _chsState.apiBase || '/api';
  let token = null;
  try {
    const auth = await window.AvenoraFirebase.getFirebaseAuth();
    if (auth.currentUser) token = await auth.currentUser.getIdToken(false);
  } catch (_) {}
  if (!token) throw new Error('Not authenticated');

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(base + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// ── Backend health check ──────────────────────────────────────────────────
async function _chsCheckBackend() {
  const el   = document.getElementById('chs-backend-status');
  const hint = document.getElementById('chs-backend-hint');
  if (!el) return;
  try {
    const base = _chsState.apiBase || '/api';
    const res  = await fetch(base + '/health');
    const d    = await res.json();
    if (d.ok) {
      const extra = d.config?.mediaMTXConfigured === false
        ? '<br><span style="color:#c9a84c;font-size:0.75rem">MediaMTX not configured — live camera unavailable</span>'
        : '';
      el.innerHTML = '<span class="chs-conn-ok">● CONNECTED</span>' + extra;
      if (hint) hint.textContent = 'Channel engine is online and responding';
      const reconnBtn = document.getElementById('chs-backend-reconnect');
      if (reconnBtn) reconnBtn.style.display = 'none';
    } else {
      el.innerHTML = '<span class="chs-conn-warn">⚠ BACKEND ERROR</span>';
      if (hint) hint.textContent = 'Backend returned an error — check server logs';
    }
  } catch {
    el.innerHTML = '<span class="chs-conn-lost">● OFFLINE</span>';
    if (hint) hint.textContent = 'Cannot reach backend server';
    const reconnBtn = document.getElementById('chs-backend-reconnect');
    if (reconnBtn) reconnBtn.style.display = '';
  }
}

// ── Channel status ────────────────────────────────────────────────────────
window.chsLoadStatus = async function() {
  try {
    const data = await _chsApi('GET', '/channel/status');
    if (data.success) {
      _chsRenderStatus(data.status);
      if (_chsState.connState !== 'connected') _chsSetConnState('connected');
    }
  } catch (e) {
    console.warn('[ChannelStudio] Status load failed:', e.message);
    if (_chsState.connState === 'connected') _chsHandleConnFailure();
  }
};

window.chsRefreshStatus = chsLoadStatus;

function _chsFmtTime(secs) {
  if (!secs || secs <= 0) return '—';
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function _chsRenderStatus(st) {
  if (!st) return;

  const running  = st.running && st.status !== 'OFFLINE';
  const dot      = document.getElementById('chs-status-dot');
  const txt      = document.getElementById('chs-status-text');
  const heroDot  = document.querySelector('#chs-hero-status .chs-hero-status-dot');
  const heroTxt  = document.getElementById('chs-hero-status-text');
  const startBtn = document.getElementById('chs-btn-start-ch');
  const stopBtn  = document.getElementById('chs-btn-stop-ch');

  if (dot) {
    dot.className = 'chs-dot ' + (
      st.status === 'LIVE'      ? 'chs-dot-live'    :
      st.status === 'PLAYING'   ? 'chs-dot-online'  :
      st.status === 'FALLBACK'  ? 'chs-dot-fallback':
      st.status === 'ONLINE'    ? 'chs-dot-online'  :
      'chs-dot-offline'
    );
  }
  if (txt) txt.textContent = st.status || 'OFFLINE';
  if (heroDot) {
    heroDot.className = 'chs-hero-status-dot ' + (
      st.status === 'LIVE' || st.status === 'PLAYING' ? 'chs-hero-dot-live' : 'chs-hero-dot-offline'
    );
  }
  if (heroTxt) {
    heroTxt.textContent = (st.status === 'LIVE' || st.status === 'PLAYING') ? '● CHANNEL ONLINE' : '● CHANNEL OFFLINE';
  }

  if (startBtn) startBtn.style.display = !running ? '' : 'none';
  if (stopBtn)  stopBtn.style.display  = running  ? '' : 'none';

  const nowType   = document.getElementById('chs-now-type');
  const nowTitle  = document.getElementById('chs-now-title');
  const nxtType   = document.getElementById('chs-next-type');
  const nxtTitle  = document.getElementById('chs-next-title');
  const elapsed   = document.getElementById('chs-elapsed');
  const remaining = document.getElementById('chs-remaining');
  const queueInfo = document.getElementById('chs-queue-info');
  const progFill  = document.getElementById('chs-progress-fill');
  const progPct   = document.getElementById('chs-progress-pct');

  if (nowType)  nowType.textContent  = st.currentItem
    ? (_chsTypeLabel(st.currentItem.type) + (st.currentItem.sourceType === 'youtube' ? ' ▶YT' : ''))
    : '—';
  if (nowTitle) nowTitle.textContent = st.currentItem?.title || '—';
  if (nxtType)  nxtType.textContent  = st.nextItem
    ? (_chsTypeLabel(st.nextItem.type) + (st.nextItem.sourceType === 'youtube' ? ' ▶YT' : ''))
    : '—';
  if (nxtTitle) nxtTitle.textContent = st.nextItem?.title || '—';
  if (elapsed)  elapsed.textContent  = st.currentItem?.elapsed != null ? _chsFmtTime(st.currentItem.elapsed) : '—';
  if (remaining) remaining.textContent = st.currentItem?.remaining != null && st.currentItem.remaining > 0
    ? _chsFmtTime(st.currentItem.remaining) : '—';
  if (queueInfo) queueInfo.textContent = `Queue: ${st.queueLength || 0} · Fallback: ${st.fallbackLength || 0}`;

  // Progress bar
  if (st.currentItem?.elapsed != null && st.currentItem?.duration) {
    const pct = Math.min(100, Math.round((st.currentItem.elapsed / st.currentItem.duration) * 100));
    if (progFill) progFill.style.width = pct + '%';
    if (progPct)  progPct.textContent  = pct + '%';
  }

  // Live badge
  const liveBadge      = document.getElementById('chs-live-status-badge');
  const liveInfo       = document.getElementById('chs-live-info');
  const liveDetail     = document.getElementById('chs-live-detail');
  const stopLiveBtn    = document.getElementById('chs-stop-live-btn');
  const liveSessionSt  = document.getElementById('chs-live-session-status');

  if (st.status === 'LIVE' && st.liveSession?.active) {
    if (liveBadge)  { liveBadge.style.display = ''; liveBadge.innerHTML = '<span class="chs-live-badge-dot"></span>🔴 LIVE'; }
    if (liveInfo)   liveInfo.style.display = '';
    if (liveDetail && st.currentItem) {
      liveDetail.textContent = `"${st.currentItem.title || 'Live Camera'}" — started: ${
        st.liveSession.startedAt ? new Date(st.liveSession.startedAt).toLocaleTimeString() : '—'
      }`;
    }
    if (stopLiveBtn) stopLiveBtn.style.display = '';
    if (liveSessionSt) { liveSessionSt.className = 'chs-live-session-status chs-live-session-active'; liveSessionSt.textContent = '🔴 LIVE SESSION ACTIVE'; }
  } else {
    if (liveBadge)  liveBadge.style.display = 'none';
    if (liveInfo)   liveInfo.style.display = 'none';
    if (stopLiveBtn) stopLiveBtn.style.display = 'none';
    if (liveSessionSt) { liveSessionSt.className = 'chs-live-session-status chs-live-session-ready'; liveSessionSt.textContent = 'LIVE SESSION READY'; }
  }
}

// ── Channel start/stop ─────────────────────────────────────────────────
window.chsStartChannel = async function() {
  try {
    const data = await _chsApi('POST', '/channel/start');
    if (data.success) { _chsToast('Channel started ✅'); _chsRenderStatus(data.status); }
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

window.chsStopChannel = async function() {
  if (!confirm('Stop the channel? It will go offline for viewers.')) return;
  try {
    const data = await _chsApi('POST', '/channel/stop');
    if (data.success) { _chsToast('Channel stopped'); chsLoadStatus(); }
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

window.chsSkip = async function() {
  try {
    await _chsApi('POST', '/channel/skip');
    _chsToast('Skipped to next program');
    setTimeout(chsLoadStatus, 1000);
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

// ── Live camera ────────────────────────────────────────────────────────
window.chsGoLive = async function() {
  navigateTo('live');
};

window.chsStopLive = async function() {
  if (!_chsState.liveStreamId) {
    try {
      const data = await _chsApi('GET', '/channel/status');
      if (data.status?.liveSession?.streamId) {
        _chsState.liveStreamId = data.status.liveSession.streamId;
      }
    } catch (_) {}
  }
  if (!_chsState.liveStreamId) {
    _chsToast('No active live session found', 'error');
    return;
  }
  try {
    await _chsApi('POST', '/channel/live/stop', { streamId: _chsState.liveStreamId });
    _chsToast('Live stopped — transitioning to next program');
    clearInterval(_chsState.liveHeartbeatTimer);
    _chsState.liveStreamId = null;
    setTimeout(chsLoadStatus, 1500);
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

// ── Programming ────────────────────────────────────────────────────────
window.chsLoadProgramming = async function() {
  const el = document.getElementById('chs-program-list');
  try {
    const data = await _chsApi('GET', '/channel/programming/full');
    if (data.success) {
      _chsState.programming = data.programming || [];
      _chsRenderProgramming();
    }
  } catch (e) {
    if (el) el.innerHTML = _chsUnavailableBlock('PROGRAMMING TEMPORARILY UNAVAILABLE', e.message, 'chsLoadProgramming()');
  }
};

function _chsRenderProgramming() {
  const el = document.getElementById('chs-program-list');
  if (!el) return;
  const items = _chsState.programming;
  if (!items.length) {
    el.innerHTML = `<div class="chs-empty-state">
      <div class="chs-empty-icon">📋</div>
      <div class="chs-empty-title">No programming scheduled</div>
      <div class="chs-empty-desc">Add programs to get started. The channel will use fallback content until programs are scheduled.</div>
    </div>`;
    return;
  }
  el.innerHTML = `
    <div class="chs-timeline">
      ${items.map((item, i) => `
        <div class="chs-timeline-item" id="chs-prog-${_esc(item.id)}">
          <div class="chs-timeline-dot"></div>
          <div class="chs-timeline-line" ${i === items.length - 1 ? 'style="opacity:0"' : ''}></div>
          <div class="chs-timeline-content">
            <div class="chs-prog-header">
              <span class="chs-prog-num">${String(i + 1).padStart(2, '0')}</span>
              <span class="chs-prog-type-badge">${_chsTypeLabel(item.type)}</span>
              ${item.sourceType === 'youtube' ? '<span class="chs-prog-dur" style="color:var(--neon-red)">▶ YouTube</span>' : ''}
              ${item.duration ? `<span class="chs-prog-dur">${_chsFmtDuration(item.duration)}</span>` : ''}
            </div>
            <div class="chs-prog-title">${_esc(item.title)}</div>
            ${item.artist ? `<div class="chs-prog-artist">${_esc(item.artist)}</div>` : ''}
            ${item.sourceType === 'youtube' && item.youtubeId
              ? `<div class="chs-prog-url" title="YouTube video ID: ${_esc(item.youtubeId)}">▶ YouTube — ID: ${_esc(item.youtubeId)}</div>`
              : item.mediaUrl ? `<div class="chs-prog-url" title="${_esc(item.mediaUrl)}">${_esc(item.mediaUrl)}</div>` : ''
            }
            <div class="chs-prog-actions">
              ${i > 0 ? `<button class="chs-btn chs-btn-ghost chs-btn-xs" title="Move up" onclick="chsMoveProgram('${_esc(item.id)}','up')">↑ Up</button>` : ''}
              ${i < items.length - 1 ? `<button class="chs-btn chs-btn-ghost chs-btn-xs" title="Move down" onclick="chsMoveProgram('${_esc(item.id)}','down')">↓ Down</button>` : ''}
              <button class="chs-btn chs-btn-danger chs-btn-xs" title="Remove" onclick="chsRemoveProgram('${_esc(item.id)}')">✕ Remove</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>`;
}

window.chsMoveProgram = async function(id, direction) {
  try {
    await _chsApi('PATCH', '/channel/programming/' + id + '/move', { direction });
    await chsLoadProgramming();
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

window.chsRemoveProgram = async function(id) {
  if (!confirm('Remove this program from the schedule?')) return;
  try {
    await _chsApi('DELETE', '/channel/programming/' + id);
    _chsToast('Program removed');
    await chsLoadProgramming();
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

// ── Fallback ───────────────────────────────────────────────────────────
window.chsLoadFallback = async function() {
  const el = document.getElementById('chs-fallback-list');
  try {
    const data = await _chsApi('GET', '/channel/fallback');
    if (data.success) {
      _chsState.fallback = data.fallback || [];
      _chsRenderFallback();
    }
  } catch (e) {
    if (el) el.innerHTML = _chsUnavailableBlock('FALLBACK DATA TEMPORARILY UNAVAILABLE', e.message, 'chsLoadFallback()');
  }
};

function _chsRenderFallback() {
  const el        = document.getElementById('chs-fallback-list');
  const statusRow = document.getElementById('chs-fallback-status-row');
  if (!el) return;
  const items = _chsState.fallback;

  if (statusRow) {
    statusRow.style.display = '';
    statusRow.innerHTML = items.length > 0
      ? `<span class="chs-fallback-ready">✅ FALLBACK READY — ${items.length} item${items.length !== 1 ? 's' : ''} configured</span>`
      : `<span class="chs-fallback-warn">⚠ NO FALLBACK CONTENT — Channel may go dark without fallback</span>`;
  }

  if (!items.length) {
    el.innerHTML = `<div class="chs-empty-state">
      <div class="chs-empty-icon">🔄</div>
      <div class="chs-empty-title">No fallback content configured</div>
      <div class="chs-empty-desc">Add at least one fallback item to keep the channel alive during scheduling gaps.</div>
    </div>`;
    return;
  }
  el.innerHTML = items.map((item, i) => `
    <div class="chs-prog-item">
      <div class="chs-prog-item-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="chs-prog-item-icon">${_chsTypeEmoji(item.type)}</div>
      <div class="chs-prog-item-info">
        <div class="chs-prog-title">${_esc(item.title)}</div>
        <div class="chs-prog-meta">
          ${_chsTypeLabel(item.type)}
          ${item.sourceType === 'youtube' ? ' · <span style="color:var(--neon-red)">▶ YouTube</span>' : ''}
          ${item.artist ? ' · ' + _esc(item.artist) : ''}
          ${item.duration ? ' · ' + _chsFmtDuration(item.duration) : ''}
        </div>
      </div>
      <button class="chs-btn chs-btn-danger chs-btn-xs" onclick="chsRemoveFallback('${_esc(item.id)}')">✕</button>
    </div>
  `).join('');
}

window.chsRemoveFallback = async function(id) {
  if (!confirm('Remove this fallback item?')) return;
  try {
    const remaining = _chsState.fallback.filter(i => i.id !== id);
    await _chsApi('POST', '/channel/fallback', { items: remaining });
    _chsToast('Fallback item removed');
    await chsLoadFallback();
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

// ── Broadcast history ─────────────────────────────────────────────────
window.chsLoadHistory = async function() {
  const el = document.getElementById('chs-history-list');
  if (!el) return;
  try {
    const data = await _chsApi('GET', '/channel/history');
    const history = data.history || [];
    if (!history.length) {
      el.innerHTML = `<div class="chs-empty-state">
        <div class="chs-empty-icon">📜</div>
        <div class="chs-empty-title">No broadcast history yet</div>
        <div class="chs-empty-desc">History will appear here once the channel starts broadcasting.</div>
      </div>`;
      return;
    }
    el.innerHTML = `
      <div class="chs-history-timeline">
        ${history.slice().reverse().map((item, i) => `
          <div class="chs-history-item">
            <div class="chs-history-dot ${i === 0 ? 'chs-history-dot-latest' : ''}"></div>
            <div class="chs-history-time">${item.playedAt ? new Date(item.playedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—'}</div>
            <div class="chs-history-info">
              <div class="chs-history-title">${_esc(item.title || '—')}</div>
              <div class="chs-history-meta">${_chsTypeLabel(item.type)}${item.artist ? ' · ' + _esc(item.artist) : ''}${item.duration ? ' · ' + _chsFmtDuration(item.duration) : ''}</div>
            </div>
            <div class="chs-history-badge">Completed</div>
          </div>
        `).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = _chsUnavailableBlock('BROADCAST HISTORY TEMPORARILY UNAVAILABLE', e.message, 'chsLoadHistory()');
  }
};

// ── Add program panel ──────────────────────────────────────────────────
window.chsOpenAddProgram = function() {
  _chsState.addingTo = 'program';
  _chsEl('chs-add-panel-title').textContent = 'Add Program to Schedule';
  _chsEl('chs-add-panel').style.display = '';
  _chsEl('chs-add-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  chsOnTypeChange();
};

window.chsOpenAddFallback = function() {
  _chsState.addingTo = 'fallback';
  _chsEl('chs-add-panel-title').textContent = 'Add Fallback Item';
  _chsEl('chs-add-panel').style.display = '';
  _chsEl('chs-add-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  chsOnTypeChange();
};

window.chsCloseAddPanel = function() {
  _chsEl('chs-add-panel').style.display = 'none';
};

// ── YouTube URL detection ─────────────────────────────────────────────────
function _chsExtractYouTubeId(url) {
  if (!url) return null;
  // youtu.be/VIDEO_ID
  const short = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];
  // youtube.com/watch?v=VIDEO_ID
  const long = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (long) return long[1];
  // youtube.com/embed/VIDEO_ID
  const embed = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (embed) return embed[1];
  return null;
}

function _chsIsDirectMedia(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    return /\.(mp3|mp4|m4a|m4v|webm|ogg|oga|wav|aac|flac|opus|mov|avi|mkv)$/.test(path);
  } catch { return false; }
}

window.chsOnUrlInput = function() {
  const url   = (_chsEl('chs-add-url')?.value || '').trim();
  const badge = _chsEl('chs-url-type-badge');
  const hint  = _chsEl('chs-url-hint');
  if (!badge) return;

  const ytId = _chsExtractYouTubeId(url);
  if (ytId) {
    badge.style.display = '';
    badge.textContent   = '▶ YouTube detected — will use embedded player (ID: ' + ytId + ')';
    badge.style.color   = '#ff3333';
    if (hint) hint.textContent = 'YouTube URLs are stored as embedded sources and played via the YouTube player.';
  } else if (url && _chsIsDirectMedia(url)) {
    badge.style.display = '';
    badge.textContent   = '✓ Direct media file detected';
    badge.style.color   = '#00e676';
    if (hint) hint.textContent = 'Direct link to audio/video file (Supabase, Firebase Storage, S3, CDN, etc.)';
  } else if (url) {
    badge.style.display = '';
    badge.textContent   = '⚠ URL type unknown — ensure this is a direct media URL';
    badge.style.color   = '#ffab00';
    if (hint) hint.textContent = 'Direct link to audio/video file, or a YouTube URL (https://youtu.be/… or https://www.youtube.com/watch?v=…)';
  } else {
    badge.style.display = 'none';
    if (hint) hint.textContent = 'Direct link to audio/video file, or a YouTube URL (https://youtu.be/… or https://www.youtube.com/watch?v=…)';
  }
};

window.chsOnTypeChange = function() {
  const type = (_chsEl('chs-add-type')?.value || '').toUpperCase();
  const ssFields = _chsEl('chs-slideshow-fields');
  if (ssFields) ssFields.style.display = (type === 'SLIDESHOW' || type === 'IMAGE') ? 'flex' : 'none';
  const urlField = _chsEl('chs-media-url-field');
  if (urlField) urlField.style.display = (type === 'SLIDESHOW') ? 'none' : '';
  const artField = _chsEl('chs-artwork-field');
  if (artField) artField.style.display = (type === 'VIDEO' || type === 'PRE_RECORDED_SHOW') ? 'none' : '';
};

window.chsSubmitAdd = async function() {
  const type     = (_chsEl('chs-add-type')?.value || '').toUpperCase();
  const title    = (_chsEl('chs-add-title')?.value || '').trim();
  const artist   = (_chsEl('chs-add-artist')?.value || '').trim();
  const mediaUrl = (_chsEl('chs-add-url')?.value || '').trim();
  const duration = parseInt(_chsEl('chs-add-duration')?.value || '0', 10) || 0;
  const coverArt = (_chsEl('chs-add-art')?.value || '').trim();
  const perImage = parseInt(_chsEl('chs-add-per-image')?.value || '10', 10);
  const errEl    = _chsEl('chs-add-error');

  if (errEl) errEl.style.display = 'none';
  if (!title) { _chsShowError('Title is required'); return; }

  const item = { type, title, artist: artist || null, coverArt: coverArt || null, duration };

  if (type === 'SLIDESHOW' || type === 'IMAGE') {
    const rawUrls = (_chsEl('chs-add-images')?.value || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (!rawUrls.length) { _chsShowError('Add at least one image URL'); return; }
    item.images       = rawUrls.map(url => ({ url, caption: '' }));
    item.perImageSecs = perImage;
    item.duration     = rawUrls.length * perImage;
    delete item.mediaUrl;
  } else {
    if (!mediaUrl) { _chsShowError('Media URL is required for this program type'); return; }

    // ── Detect source type from URL ──────────────────────────────────────
    const youtubeId = _chsExtractYouTubeId(mediaUrl);
    if (youtubeId) {
      // YouTube URL — store as YouTube source.
      // Do NOT call fetch() against the YouTube URL.
      // The channel engine and player will use YouTube embed/IFrame API.
      item.sourceType = 'youtube';
      item.youtubeId  = youtubeId;
      item.sourceUrl  = mediaUrl;
      // mediaUrl is set to null so the channel engine doesn't try to play it
      // as a direct audio/video src. The player checks sourceType instead.
      item.mediaUrl   = null;
    } else {
      // Direct media file or CDN/storage URL
      item.sourceType = 'direct';
      item.sourceUrl  = mediaUrl;
      item.mediaUrl   = mediaUrl;
    }
  }

  try {
    if (_chsState.addingTo === 'fallback') {
      await _chsApi('POST', '/channel/fallback/add', item);
      _chsToast('Fallback item added ✅');
      await chsLoadFallback();
    } else {
      await _chsApi('POST', '/channel/programming/add', item);
      _chsToast('Program added ✅');
      await chsLoadProgramming();
    }
    chsCloseAddPanel();
    ['chs-add-title','chs-add-artist','chs-add-url','chs-add-duration','chs-add-art','chs-add-images'].forEach(id => {
      const el = _chsEl(id); if (el) el.value = '';
    });
    const dur = _chsEl('chs-add-duration');
    if (dur) dur.value = '0';
    // Reset URL type badge
    const badge = _chsEl('chs-url-type-badge');
    if (badge) badge.style.display = 'none';
  } catch (e) {
    _chsShowError(e.message);
  }
};

// ── Unavailable block helper ───────────────────────────────────────────
function _chsUnavailableBlock(title, technicalMsg, retryFn) {
  console.warn('[ChannelStudio]', title, '|', technicalMsg);
  return `<div class="chs-unavail-block">
    <div class="chs-unavail-icon">⚠</div>
    <div class="chs-unavail-title">${_esc(title)}</div>
    <div class="chs-unavail-desc">The channel system is reconnecting. Please wait or retry.</div>
    <button class="chs-btn chs-btn-outline chs-btn-sm" onclick="${retryFn}">↻ Retry</button>
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────
function _chsShowError(msg) {
  const el = _chsEl('chs-add-error');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

function _chsEl(id) { return document.getElementById(id); }

function _chsTypeEmoji(type) {
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

function _chsTypeLabel(type) {
  const MAP = {
    LIVE_CAMERA:       '🔴 LIVE',
    MUSIC:             '🎵 MUSIC',
    AUDIO:             '🎙 AUDIO',
    VIDEO:             '🎬 VIDEO',
    IMAGE:             '🖼 IMAGE',
    SLIDESHOW:         '🖼 SLIDESHOW',
    PRE_RECORDED_SHOW: '📺 SHOW',
  };
  return MAP[type] || (type || '—');
}

function _chsFmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s > 0 ? s + 's' : ''}` : `${s}s`;
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

let _chsToastTimer = null;
function _chsToast(msg, type = 'success') {
  clearTimeout(_chsToastTimer);
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  _chsToastTimer = setTimeout(() => { el.remove(); }, 3500);
}
