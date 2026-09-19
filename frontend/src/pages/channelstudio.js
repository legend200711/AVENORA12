/**
 * AVENORA — Channel Studio (Admin Control Center)
 *
 * Provides the channel admin/founder with:
 *   - Real-time channel status (current program, next, elapsed, viewers)
 *   - Programming queue management (add / remove / reorder)
 *   - Fallback queue management
 *   - Live camera control (redirects to AVENORA Live)
 *   - Broadcast history (last 20 items)
 *   - Channel start/stop/skip
 *
 * Authentication: reuses existing AVENORA Firebase session.
 * Access: founder/admin role only (checked server-side on all mutations).
 */

registerPage('channelstudio', {
  async render(container) {
    container.innerHTML = `
      <div class="chs-page">

        <!-- ── Page header ─────────────────────────────────── -->
        <div class="chs-header">
          <h1 class="chs-title">
            <span style="color:var(--neon-blue,#00ccff)">AVENORA</span> CHANNEL STUDIO
          </h1>
          <p class="chs-tagline">24-HOUR ALWAYS-ON CHANNEL CONTROL CENTER</p>
        </div>

        <!-- ── Auth gate ──────────────────────────────────── -->
        <div id="chs-auth-gate" style="display:none">
          <div class="card" style="text-align:center;padding:var(--space-2xl)">
            <p style="font-size:2rem;margin-bottom:var(--space-md)">🔒</p>
            <h3 style="font-family:var(--font-display);margin-bottom:var(--space-sm)">SIGN IN REQUIRED</h3>
            <p style="color:var(--text-secondary);margin-bottom:var(--space-lg)">
              Channel Studio is restricted to channel admins and founders.
            </p>
            <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
          </div>
        </div>

        <!-- ── Not admin gate ─────────────────────────────── -->
        <div id="chs-noaccess" style="display:none">
          <div class="card" style="text-align:center;padding:var(--space-2xl)">
            <p style="font-size:2rem;margin-bottom:var(--space-md)">🛡</p>
            <h3 style="font-family:var(--font-display);margin-bottom:var(--space-sm)">ACCESS RESTRICTED</h3>
            <p style="color:var(--text-secondary)">Channel Studio is for channel admins only.</p>
          </div>
        </div>

        <!-- ── Loading ─────────────────────────────────────── -->
        <div id="chs-loading" style="display:flex;flex-direction:column;align-items:center;padding:var(--space-3xl);gap:var(--space-md)">
          <div class="spinner spinner-lg"></div>
          <span style="color:var(--text-muted)">Loading Channel Studio…</span>
        </div>

        <!-- ── Main app ────────────────────────────────────── -->
        <div id="chs-app" style="display:none">

          <!-- ── CHANNEL STATUS BAR ─────────────────────── -->
          <div class="chs-status-bar card" id="chs-status-bar">
            <div class="chs-status-left">
              <span id="chs-status-dot" class="chs-dot chs-dot-offline"></span>
              <span id="chs-status-text" class="chs-status-text">OFFLINE</span>
            </div>
            <div class="chs-status-mid">
              <div class="chs-status-item">
                <span class="chs-status-label">NOW</span>
                <span id="chs-now-type" class="chs-status-val">—</span>
                <span id="chs-now-title" class="chs-status-title">—</span>
              </div>
              <div class="chs-status-item">
                <span class="chs-status-label">NEXT</span>
                <span id="chs-next-type" class="chs-status-val">—</span>
                <span id="chs-next-title" class="chs-status-title">—</span>
              </div>
              <div class="chs-status-item">
                <span class="chs-status-label">ELAPSED</span>
                <span id="chs-elapsed" class="chs-status-val">—</span>
              </div>
              <div class="chs-status-item">
                <span class="chs-status-label">REMAINING</span>
                <span id="chs-remaining" class="chs-status-val">—</span>
              </div>
            </div>
            <div class="chs-status-right">
              <button id="chs-btn-start-ch" class="btn btn-green btn-sm" onclick="chsStartChannel()" style="display:none">▶ START CHANNEL</button>
              <button id="chs-btn-stop-ch" class="btn btn-danger btn-sm" onclick="chsStopChannel()" style="display:none">⏹ STOP CHANNEL</button>
              <button class="btn btn-outline btn-sm" onclick="chsRefreshStatus()">↻ Refresh</button>
              <button class="btn btn-outline btn-sm" onclick="navigateTo('channel')">📺 View Channel</button>
            </div>
          </div>

          <!-- ── CHANNEL CONTROLS ────────────────────────── -->
          <div class="chs-controls card">
            <button class="btn btn-outline btn-sm" onclick="chsSkip()" title="Skip current program">⏭ Skip Program</button>
            <button class="btn btn-outline btn-sm" onclick="chsLoadStatus()">↻ Refresh Status</button>
            <span id="chs-queue-info" style="font-size:0.78rem;color:var(--text-muted);align-self:center;padding:0 8px"></span>
          </div>

          <!-- ── LIVE CAMERA ─────────────────────────────── -->
          <div class="card chs-section" id="chs-live-section">
            <div class="chs-section-hdr">
              <h2 class="section-title">🔴 LIVE CAMERA</h2>
              <div id="chs-live-status-badge" class="chs-badge" style="display:none">OFFLINE</div>
            </div>
            <p class="chs-section-desc">
              Go live directly on the AVENORA 24-Hour Channel. While your camera connection is active,
              the channel switches to your live feed. When you stop (or the connection drops),
              the channel automatically transitions to the next scheduled program.
            </p>
            <div class="chs-live-controls" style="flex-wrap:wrap;gap:12px">
              <button class="btn btn-danger" onclick="chsGoLive()">🎥 GO LIVE NOW</button>
              <button class="btn btn-outline btn-sm" onclick="chsStopLive()" id="chs-stop-live-btn" style="display:none">⏹ Stop Live</button>
              <span class="chs-hint" style="align-self:center">Live camera requires an active AVENORA Live session. Your stream will be broadcast to all channel viewers.</span>
            </div>
            <div id="chs-live-info" style="display:none;margin-top:var(--space-md);padding:var(--space-md);background:rgba(255,92,110,0.06);border:1px solid rgba(255,92,110,0.25);border-radius:8px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <span style="width:9px;height:9px;border-radius:50%;background:#ff5c6e;animation:chPulse 1s infinite;display:inline-block"></span>
                <strong>LIVE NOW</strong>
              </div>
              <div id="chs-live-detail" style="font-size:0.82rem;color:var(--text-secondary)">—</div>
            </div>
          </div>

          <!-- ── PROGRAMMING QUEUE ───────────────────────── -->
          <div class="card chs-section">
            <div class="chs-section-hdr">
              <h2 class="section-title">📋 CHANNEL PROGRAMMING</h2>
              <button class="btn btn-primary btn-sm" onclick="chsOpenAddProgram()">+ Add Program</button>
            </div>
            <p class="chs-section-desc">Programs play in order. When all have played, the channel loops from the beginning.</p>
            <div id="chs-program-list" class="chs-program-list">
              <div style="color:var(--text-muted);padding:var(--space-lg);text-align:center">Loading…</div>
            </div>
          </div>

          <!-- ── FALLBACK QUEUE ──────────────────────────── -->
          <div class="card chs-section">
            <div class="chs-section-hdr">
              <h2 class="section-title">🔄 FALLBACK PROGRAMMING</h2>
              <button class="btn btn-outline btn-sm" onclick="chsOpenAddFallback()">+ Add Fallback</button>
            </div>
            <p class="chs-section-desc">
              Fallback plays when no scheduled program is available — loops continuously to keep the channel alive.
              Add at least one fallback item to prevent the channel going dark.
            </p>
            <div id="chs-fallback-list" class="chs-program-list">
              <div style="color:var(--text-muted);padding:var(--space-lg);text-align:center">Loading…</div>
            </div>
          </div>

          <!-- ── BROADCAST HISTORY ────────────────────────── -->
          <div class="card chs-section">
            <div class="chs-section-hdr">
              <h2 class="section-title">📜 BROADCAST HISTORY</h2>
              <button class="btn btn-ghost btn-sm" onclick="chsLoadHistory()">↻ Refresh</button>
            </div>
            <p class="chs-section-desc">Recently played programs on this channel.</p>
            <div id="chs-history-list" class="chs-program-list">
              <div style="color:var(--text-muted);padding:var(--space-lg);text-align:center">Loading…</div>
            </div>
          </div>

          <!-- ── CHANNEL SETTINGS ─────────────────────────── -->
          <div class="card chs-section">
            <div class="chs-section-hdr">
              <h2 class="section-title">⚙️ CHANNEL SETTINGS</h2>
            </div>
            <div class="chs-settings-grid">
              <div class="chs-field">
                <label class="chs-label">Channel Name</label>
                <div style="font-size:0.88rem;color:var(--text-primary)">AVENORA 24-HOUR CHANNEL</div>
                <div class="chs-hint">Managed by founder/admin</div>
              </div>
              <div class="chs-field">
                <label class="chs-label">Live Heartbeat Timeout</label>
                <div style="font-size:0.88rem;color:var(--text-primary)">30 seconds</div>
                <div class="chs-hint">If the live camera connection is lost for 30s, the channel automatically transitions to the next program</div>
              </div>
              <div class="chs-field">
                <label class="chs-label">Programming Mode</label>
                <div style="font-size:0.88rem;color:var(--text-primary)">Loop (all items repeat)</div>
                <div class="chs-hint">When all scheduled programs have played, the channel loops back to the beginning</div>
              </div>
              <div class="chs-field">
                <label class="chs-label">Streaming Backend</label>
                <div id="chs-backend-status" style="font-size:0.88rem;color:var(--text-primary)">Checking…</div>
              </div>
            </div>
          </div>

        </div><!-- /#chs-app -->

        <!-- ── ADD PROGRAM PANEL ───────────────────────────── -->
        <div id="chs-add-panel" class="chs-add-panel card" style="display:none">
          <div class="chs-section-hdr">
            <h2 class="section-title" id="chs-add-panel-title">Add Program</h2>
            <button class="btn btn-ghost btn-sm" onclick="chsCloseAddPanel()">✕</button>
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
              <input class="form-input" id="chs-add-url" placeholder="https://…" maxlength="2000">
              <div class="chs-hint">Direct link to the audio or video file (Supabase, Firebase Storage, S3, CDN, etc.)</div>
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
            <div id="chs-slideshow-fields" style="display:none">
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
              <button class="btn btn-primary" onclick="chsSubmitAdd()">Add to Queue</button>
              <button class="btn btn-ghost" onclick="chsCloseAddPanel()">Cancel</button>
            </div>
          </div>
        </div><!-- /#chs-add-panel -->

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
    return () => { _chsClearPoll(); };
  }
});

// ── Module state ──────────────────────────────────────────────────────────
const _chsState = {
  user:        null,
  apiBase:     null,
  programming: [],
  fallback:    [],
  addingTo:    'program',   // 'program' | 'fallback'
  pollTimer:   null,
  liveStreamId: null,       // current live stream ID (if live via channel)
  liveHeartbeatTimer: null,
};

// ── Init ──────────────────────────────────────────────────────────────────
async function _chsInit(user) {
  _chsState.user    = user;
  _chsState.apiBase = (window.LU_CONFIG && window.LU_CONFIG.apiUrl) || '/api';

  // Check role — server will also enforce, but we can give a nice early gate
  const role = user.role || (await _chsGetRole(user));
  if (role !== 'founder' && role !== 'admin') {
    document.getElementById('chs-noaccess').style.display = '';
    return;
  }

  document.getElementById('chs-app').style.display = '';

  await Promise.all([
    chsLoadStatus(),
    chsLoadProgramming(),
    chsLoadFallback(),
    chsLoadHistory(),
  ]);

  // Check backend streaming config
  _chsCheckBackend();

  // Auto-refresh status every 10s
  _chsState.pollTimer = setInterval(chsLoadStatus, 10_000);
}

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

function _chsClearPoll() {
  clearInterval(_chsState.pollTimer);
  _chsState.pollTimer = null;
  clearInterval(_chsState.liveHeartbeatTimer);
  _chsState.liveHeartbeatTimer = null;
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
  const el = document.getElementById('chs-backend-status');
  if (!el) return;
  try {
    const base = _chsState.apiBase || '/api';
    const res = await fetch(base + '/health');
    const d   = await res.json();
    if (d.ok) {
      const mediamtx = d.config?.mediaMTXConfigured === false
        ? ' · <span style="color:#c9a84c">MediaMTX not configured (live camera unavailable)</span>'
        : ' · MediaMTX configured';
      el.innerHTML = '<span style="color:#4a9e72">✅ Backend online</span>' + (mediamtx || '');
    } else {
      el.innerHTML = '<span style="color:#c0394a">⚠ Backend returned error</span>';
    }
  } catch {
    el.innerHTML = '<span style="color:#c0394a">⚠ Cannot reach backend</span>';
  }
}

// ── Channel status ────────────────────────────────────────────────────────
window.chsLoadStatus = async function() {
  try {
    const data = await _chsApi('GET', '/channel/status');
    if (data.success) _chsRenderStatus(data.status);
  } catch (e) {
    console.warn('[ChannelStudio] Status load failed:', e.message);
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

  const running = st.running && st.status !== 'OFFLINE';
  const dot     = document.getElementById('chs-status-dot');
  const txt     = document.getElementById('chs-status-text');
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

  if (startBtn) startBtn.style.display = !running ? '' : 'none';
  if (stopBtn)  stopBtn.style.display  = running ? '' : 'none';

  // Now / Next / elapsed / remaining
  const nowType  = document.getElementById('chs-now-type');
  const nowTitle = document.getElementById('chs-now-title');
  const nxtType  = document.getElementById('chs-next-type');
  const nxtTitle = document.getElementById('chs-next-title');
  const elapsed  = document.getElementById('chs-elapsed');
  const remaining = document.getElementById('chs-remaining');
  const queueInfo = document.getElementById('chs-queue-info');

  if (nowType)  nowType.textContent  = st.currentItem ? _chsTypeEmoji(st.currentItem.type) : '—';
  if (nowTitle) nowTitle.textContent = st.currentItem?.title || '—';
  if (nxtType)  nxtType.textContent  = st.nextItem ? _chsTypeEmoji(st.nextItem.type) : '—';
  if (nxtTitle) nxtTitle.textContent = st.nextItem?.title || '—';
  if (elapsed)  elapsed.textContent  = st.currentItem?.elapsed != null ? _chsFmtTime(st.currentItem.elapsed) : '—';
  if (remaining) remaining.textContent = st.currentItem?.remaining != null && st.currentItem.remaining > 0
    ? _chsFmtTime(st.currentItem.remaining) : '—';
  if (queueInfo) queueInfo.textContent = `Queue: ${st.queueLength || 0} | Fallback: ${st.fallbackLength || 0}`;

  // Live badge update
  const liveBadge = document.getElementById('chs-live-status-badge');
  const liveInfo  = document.getElementById('chs-live-info');
  const liveDetail = document.getElementById('chs-live-detail');
  const stopLiveBtn = document.getElementById('chs-stop-live-btn');
  if (st.status === 'LIVE' && st.liveSession?.active) {
    if (liveBadge) { liveBadge.style.display = ''; liveBadge.textContent = '🔴 LIVE'; liveBadge.style.color = '#ff5c6e'; }
    if (liveInfo)  liveInfo.style.display = '';
    if (liveDetail && st.currentItem) {
      liveDetail.textContent = `Title: ${st.currentItem.title || 'Live Camera'} — started: ${
        st.liveSession.startedAt ? new Date(st.liveSession.startedAt).toLocaleTimeString() : '—'
      }`;
    }
    if (stopLiveBtn) stopLiveBtn.style.display = '';
  } else {
    if (liveBadge) { liveBadge.style.display = 'none'; }
    if (liveInfo)  liveInfo.style.display = 'none';
    if (stopLiveBtn) stopLiveBtn.style.display = 'none';
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
  // Navigate to the AVENORA Live page so the creator can set up their camera
  // and get a proper WHIP session. The Live page will trigger /api/live/:id/start-publishing
  // and then call /api/channel/live/start with the streamId and hlsUrl.
  navigateTo('live');
};

window.chsStopLive = async function() {
  if (!_chsState.liveStreamId) {
    // Try to find active live session from status
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

// ── Programming load/render ────────────────────────────────────────────
window.chsLoadProgramming = async function() {
  try {
    const data = await _chsApi('GET', '/channel/programming/full');
    if (data.success) {
      _chsState.programming = data.programming || [];
      _chsRenderProgramming();
    }
  } catch (e) {
    const el = document.getElementById('chs-program-list');
    if (el) el.innerHTML = `<div style="color:var(--text-muted);padding:var(--space-md)">Could not load programming: ${_esc(e.message)}</div>`;
  }
};

function _chsRenderProgramming() {
  const el = document.getElementById('chs-program-list');
  if (!el) return;
  const items = _chsState.programming;
  if (!items.length) {
    el.innerHTML = `<div style="color:var(--text-muted);padding:var(--space-lg);text-align:center">
      No programming scheduled. Add programs to get started.
    </div>`;
    return;
  }
  el.innerHTML = items.map((item, i) => `
    <div class="chs-prog-item" id="chs-prog-${_esc(item.id)}">
      <div class="chs-prog-icon">${_chsTypeEmoji(item.type)}</div>
      <div class="chs-prog-info">
        <div class="chs-prog-title">${_esc(item.title)}</div>
        <div class="chs-prog-meta">${_esc(item.type)}${item.artist ? ' · ' + _esc(item.artist) : ''}${item.duration ? ' · ' + _chsFmtDuration(item.duration) : ''}</div>
        ${item.mediaUrl ? `<div class="chs-prog-meta" style="color:var(--text-muted);font-size:0.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px" title="${_esc(item.mediaUrl)}">${_esc(item.mediaUrl)}</div>` : ''}
      </div>
      <div class="chs-prog-actions" style="display:flex;gap:4px;flex-shrink:0">
        ${i > 0 ? `<button class="btn btn-ghost btn-xs" title="Move up" onclick="chsMoveProgram('${_esc(item.id)}','up')">↑</button>` : '<div style="width:28px"></div>'}
        ${i < items.length - 1 ? `<button class="btn btn-ghost btn-xs" title="Move down" onclick="chsMoveProgram('${_esc(item.id)}','down')">↓</button>` : '<div style="width:28px"></div>'}
        <button class="btn btn-danger btn-xs" title="Remove" onclick="chsRemoveProgram('${_esc(item.id)}')">✕</button>
      </div>
    </div>
  `).join('');
}

window.chsMoveProgram = async function(id, direction) {
  try {
    await _chsApi('PATCH', '/channel/programming/' + id + '/move', { direction });
    await chsLoadProgramming();
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

window.chsRemoveProgram = async function(id) {
  if (!confirm('Remove this program?')) return;
  try {
    await _chsApi('DELETE', '/channel/programming/' + id);
    _chsToast('Program removed');
    await chsLoadProgramming();
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

// ── Fallback load/render ────────────────────────────────────────────────
window.chsLoadFallback = async function() {
  try {
    const data = await _chsApi('GET', '/channel/fallback');
    if (data.success) {
      _chsState.fallback = data.fallback || [];
      _chsRenderFallback();
    }
  } catch (e) {
    const el = document.getElementById('chs-fallback-list');
    if (el) el.innerHTML = `<div style="color:var(--text-muted);padding:var(--space-md)">Could not load fallback: ${_esc(e.message)}</div>`;
  }
};

function _chsRenderFallback() {
  const el = document.getElementById('chs-fallback-list');
  if (!el) return;
  const items = _chsState.fallback;
  if (!items.length) {
    el.innerHTML = `<div style="color:var(--text-muted);padding:var(--space-lg);text-align:center">
      No fallback configured. Add fallback content to prevent the channel going dark.
    </div>`;
    return;
  }
  el.innerHTML = items.map((item, i) => `
    <div class="chs-prog-item">
      <div class="chs-prog-icon">${_chsTypeEmoji(item.type)}</div>
      <div class="chs-prog-info">
        <div class="chs-prog-title">${_esc(item.title)}</div>
        <div class="chs-prog-meta">${_esc(item.type)}${item.artist ? ' · ' + _esc(item.artist) : ''}${item.duration ? ' · ' + _chsFmtDuration(item.duration) : ''}</div>
      </div>
      <div class="chs-prog-actions">
        <button class="btn btn-danger btn-xs" onclick="chsRemoveFallback('${_esc(item.id)}')">✕</button>
      </div>
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
      el.innerHTML = `<div style="color:var(--text-muted);padding:var(--space-lg);text-align:center">No broadcast history yet.</div>`;
      return;
    }
    el.innerHTML = history.slice().reverse().map(item => `
      <div class="chs-prog-item">
        <div class="chs-prog-icon">${_chsTypeEmoji(item.type)}</div>
        <div class="chs-prog-info">
          <div class="chs-prog-title">${_esc(item.title || '—')}</div>
          <div class="chs-prog-meta">${_esc(item.type || '')}${item.artist ? ' · ' + _esc(item.artist) : ''}${item.duration ? ' · ' + _chsFmtDuration(item.duration) : ''}${item.playedAt ? ' · ' + new Date(item.playedAt).toLocaleTimeString() : ''}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div style="color:var(--text-muted);padding:var(--space-md)">Could not load history: ${_esc(e.message)}</div>`;
  }
};

// ── Add program panel ──────────────────────────────────────────────────
window.chsOpenAddProgram = function() {
  _chsState.addingTo = 'program';
  _chsEl('chs-add-panel-title').textContent = 'Add Program';
  _chsEl('chs-add-panel').style.display = '';
  _chsEl('chs-add-panel').scrollIntoView({ behavior: 'smooth' });
  chsOnTypeChange();
};

window.chsOpenAddFallback = function() {
  _chsState.addingTo = 'fallback';
  _chsEl('chs-add-panel-title').textContent = 'Add Fallback Item';
  _chsEl('chs-add-panel').style.display = '';
  _chsEl('chs-add-panel').scrollIntoView({ behavior: 'smooth' });
  chsOnTypeChange();
};

window.chsCloseAddPanel = function() {
  _chsEl('chs-add-panel').style.display = 'none';
};

window.chsOnTypeChange = function() {
  const type = (_chsEl('chs-add-type')?.value || '').toUpperCase();
  _chsEl('chs-slideshow-fields').style.display = (type === 'SLIDESHOW' || type === 'IMAGE') ? '' : 'none';
  _chsEl('chs-media-url-field').style.display  = (type === 'SLIDESHOW') ? 'none' : '';
  _chsEl('chs-artwork-field').style.display    = (type === 'VIDEO' || type === 'PRE_RECORDED_SHOW') ? 'none' : '';
};

window.chsSubmitAdd = async function() {
  const type      = (_chsEl('chs-add-type')?.value || '').toUpperCase();
  const title     = (_chsEl('chs-add-title')?.value || '').trim();
  const artist    = (_chsEl('chs-add-artist')?.value || '').trim();
  const mediaUrl  = (_chsEl('chs-add-url')?.value || '').trim();
  const duration  = parseInt(_chsEl('chs-add-duration')?.value || '0', 10) || 0;
  const coverArt  = (_chsEl('chs-add-art')?.value || '').trim();
  const perImage  = parseInt(_chsEl('chs-add-per-image')?.value || '10', 10);
  const errEl     = _chsEl('chs-add-error');

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
    item.mediaUrl = mediaUrl;
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
    // Clear form
    ['chs-add-title','chs-add-artist','chs-add-url','chs-add-duration','chs-add-art','chs-add-images'].forEach(id => {
      const el = _chsEl(id);
      if (el) el.value = '';
    });
    const dur = _chsEl('chs-add-duration');
    if (dur) dur.value = '0';
  } catch (e) {
    _chsShowError(e.message);
  }
};

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
  return (MAP[type] || '▶') + ' ' + (type || '');
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
