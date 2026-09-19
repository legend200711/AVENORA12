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

          <!-- ═══ UPLOAD YOUR MEDIA ════════════════════════════ -->
          <div class="chs-section chs-upload-section card" id="chs-upload-section">
            <div class="chs-section-hdr">
              <div class="chs-section-hdr-left">
                <span class="chs-section-icon">📤</span>
                <h2 class="chs-section-title">UPLOAD YOUR MEDIA</h2>
              </div>
              <button class="chs-btn chs-btn-ghost chs-btn-sm" id="chs-upload-toggle-btn" onclick="chsToggleUpload()">▼ Expand</button>
            </div>
            <p class="chs-section-desc">Upload music, videos, or photos directly from your phone. Add to your 24-hour channel.</p>

            <div id="chs-upload-body" style="display:none">
              <!-- Upload type buttons -->
              <div class="chs-upload-type-row">
                <button class="chs-upload-type-btn" onclick="chsUploadTrigger('audio')">
                  <span class="chs-upload-type-icon">🎵</span>
                  <span class="chs-upload-type-label">MUSIC</span>
                  <span class="chs-upload-type-hint">MP3 · M4A · WAV · AAC</span>
                </button>
                <button class="chs-upload-type-btn" onclick="chsUploadTrigger('video')">
                  <span class="chs-upload-type-icon">🎬</span>
                  <span class="chs-upload-type-label">VIDEO</span>
                  <span class="chs-upload-type-hint">MP4 · WebM · MOV</span>
                </button>
                <button class="chs-upload-type-btn" onclick="chsShowSlideshowBuilder()">
                  <span class="chs-upload-type-icon">🖼️</span>
                  <span class="chs-upload-type-label">PHOTOS + MUSIC</span>
                  <span class="chs-upload-type-hint">Slideshow with audio</span>
                </button>
              </div>

              <!-- Hidden file inputs — works on Android Chrome -->
              <input type="file" id="chs-audio-input" accept="audio/mpeg,audio/mp4,audio/m4a,audio/aac,audio/wav,audio/x-m4a,.mp3,.m4a,.aac,.wav" style="display:none" onchange="chsHandleAudioFile(this)">
              <input type="file" id="chs-video-input" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,.mp4,.webm,.mov,.avi" style="display:none" onchange="chsHandleVideoFile(this)">
              <input type="file" id="chs-image-input" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple style="display:none" onchange="chsHandleSlideImages(this)">
              <input type="file" id="chs-slide-audio-input" accept="audio/mpeg,audio/mp4,audio/m4a,audio/aac,.mp3,.m4a,.aac" style="display:none" onchange="chsHandleSlideAudio(this)">

              <!-- Active upload progress cards -->
              <div id="chs-upload-progress-area"></div>

              <!-- Slideshow Builder (hidden by default) -->
              <div id="chs-slideshow-builder" class="chs-slideshow-builder" style="display:none">
                <div class="chs-slideshow-builder-hdr">
                  <span class="chs-section-icon">🖼️</span>
                  <h3 class="chs-slideshow-title">PHOTO + MUSIC SLIDESHOW BUILDER</h3>
                  <button class="chs-btn chs-btn-ghost chs-btn-xs" onclick="chsCloseSlideshowBuilder()">✕</button>
                </div>

                <!-- Step 1: Photos -->
                <div class="chs-slideshow-step">
                  <div class="chs-slideshow-step-num">1</div>
                  <div class="chs-slideshow-step-body">
                    <div class="chs-slideshow-step-title">SELECT PHOTOS</div>
                    <button class="chs-btn chs-btn-primary chs-btn-sm" onclick="document.getElementById('chs-image-input').click()">📷 Choose Photos from Phone</button>
                    <div id="chs-slide-images-preview" class="chs-slide-images-preview"></div>
                  </div>
                </div>

                <!-- Step 2: Duration per image -->
                <div class="chs-slideshow-step">
                  <div class="chs-slideshow-step-num">2</div>
                  <div class="chs-slideshow-step-body">
                    <div class="chs-slideshow-step-title">SECONDS PER PHOTO</div>
                    <div class="chs-slideshow-duration-row">
                      <button class="chs-duration-btn" onclick="chsSetPerImage(5)" id="chs-dur-5">5s</button>
                      <button class="chs-duration-btn chs-duration-active" onclick="chsSetPerImage(10)" id="chs-dur-10">10s</button>
                      <button class="chs-duration-btn" onclick="chsSetPerImage(15)" id="chs-dur-15">15s</button>
                      <button class="chs-duration-btn" onclick="chsSetPerImage(30)" id="chs-dur-30">30s</button>
                      <button class="chs-duration-btn" onclick="chsSetPerImage(60)" id="chs-dur-60">60s</button>
                    </div>
                    <div id="chs-slideshow-duration-hint" class="chs-hint"></div>
                  </div>
                </div>

                <!-- Step 3: Music -->
                <div class="chs-slideshow-step">
                  <div class="chs-slideshow-step-num">3</div>
                  <div class="chs-slideshow-step-body">
                    <div class="chs-slideshow-step-title">ADD MUSIC <span class="chs-opt">optional</span></div>
                    <div class="chs-slideshow-audio-row">
                      <button class="chs-btn chs-btn-outline chs-btn-sm" onclick="document.getElementById('chs-slide-audio-input').click()">🎵 Upload Music</button>
                      <button class="chs-btn chs-btn-ghost chs-btn-sm" onclick="chsPickMediaForSlide()">📁 From My Media</button>
                    </div>
                    <div id="chs-slide-audio-info" class="chs-slide-audio-info"></div>
                  </div>
                </div>

                <!-- Step 4: Title -->
                <div class="chs-slideshow-step">
                  <div class="chs-slideshow-step-num">4</div>
                  <div class="chs-slideshow-step-body">
                    <div class="chs-slideshow-step-title">SLIDESHOW TITLE</div>
                    <input class="form-input" id="chs-slideshow-name" placeholder="My Photo Slideshow" maxlength="200" style="max-width:360px">
                  </div>
                </div>

                <div id="chs-slideshow-error" class="chs-error" style="display:none"></div>
                <div class="chs-slideshow-actions">
                  <button class="chs-btn chs-btn-primary" onclick="chsSaveSlideshow()" id="chs-slideshow-save-btn">💾 Save &amp; Add to Library</button>
                  <button class="chs-btn chs-btn-ghost" onclick="chsCloseSlideshowBuilder()">Cancel</button>
                </div>
              </div>

              <!-- MY MEDIA library header -->
              <div class="chs-my-media-hdr">
                <span class="chs-my-media-hdr-text">MY MEDIA</span>
                <button class="chs-btn chs-btn-ghost chs-btn-xs" onclick="chsLoadMyMedia()">↻ Refresh</button>
              </div>

              <!-- Filter tabs -->
              <div class="chs-media-tabs" id="chs-media-tabs">
                <button class="chs-media-tab chs-media-tab-active" onclick="chsFilterMedia('all')" data-tab="all">All</button>
                <button class="chs-media-tab" onclick="chsFilterMedia('audio')" data-tab="audio">🎵 Music</button>
                <button class="chs-media-tab" onclick="chsFilterMedia('video')" data-tab="video">🎬 Videos</button>
                <button class="chs-media-tab" onclick="chsFilterMedia('image')" data-tab="image">🖼️ Photos</button>
                <button class="chs-media-tab" onclick="chsFilterMedia('slideshow')" data-tab="slideshow">🎞️ Slideshows</button>
              </div>

              <div id="chs-media-library" class="chs-media-library">
                <div class="chs-list-loading"><div class="chs-spinner chs-spinner-sm"></div><span>Loading your media…</span></div>
              </div>
            </div><!-- /#chs-upload-body -->
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
  maxRetries:         10,
  retryDelays:        [3000, 6000, 12000, 20000, 30000, 45000, 60000, 60000, 60000, 60000],
  connState:          'idle', // idle | connecting | connected | reconnecting | offline
  // Last-known-good cache keys
  _cacheKeyProg:      'avn_chs_prog_cache',
  _cacheKeyFallback:  'avn_chs_fallback_cache',
  // Media upload state
  myMedia:            [],   // full list from /api/media/library
  mediaFilter:        'all',
  slideshow: {
    images:       [],   // { file, url, blobUrl, storagePath, caption }
    perImageSecs: 10,
    audioTrack:   null, // { file, url, storagePath, title, duration }
    uploadExpanded: false,
  },
  uploadExpanded: false,
};

// ── localStorage cache helpers ────────────────────────────────────────────
function _chsSaveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
}
function _chsLoadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Cache is valid for 24 hours
    if (Date.now() - parsed.ts < 86400000) return parsed.data;
  } catch (_) {}
  return null;
}

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

  // Show last-known-good data immediately while connecting
  _chsRestoreFromCache();

  // Proactively wake the Render backend by pinging /health first
  // (Render free tier can be asleep — this starts the warm-up before the real requests fire)
  _chsWakeBackend();

  _chsSetConnState('connecting');
  await _chsInitialLoad();

  // Auto-refresh status every 15s (avoids hammering a waking Render instance)
  _chsState.pollTimer = setInterval(chsLoadStatus, 15_000);
}

// ── Backend wake-up ping (Render free-tier cold start) ────────────────────
// Fires a lightweight /health ping immediately when Channel Studio opens.
// The backend may be asleep — this starts the warm-up in parallel with
// the initial data load so by the time the real API requests fire the
// backend has had a few seconds head start.
function _chsWakeBackend() {
  const base = _chsState.apiBase || '/api';
  // Silent fire-and-forget — no error handling needed
  fetch(base + '/health', { method: 'GET', cache: 'no-store' }).catch(() => {});
}

// ── Restore cached data immediately (prevents blank cards on cold start) ──
function _chsRestoreFromCache() {
  const cachedProg = _chsLoadCache(_chsState._cacheKeyProg);
  if (cachedProg && Array.isArray(cachedProg)) {
    _chsState.programming = cachedProg;
    _chsRenderProgramming();
  }
  const cachedFallback = _chsLoadCache(_chsState._cacheKeyFallback);
  if (cachedFallback && Array.isArray(cachedFallback)) {
    _chsState.fallback = cachedFallback;
    _chsRenderFallback();
  }
}

// ── Initial data load with connection management ──────────────────────────
async function _chsInitialLoad() {
  _chsState.retryCount = 0;
  await _chsTryLoad();
}

async function _chsTryLoad() {
  _chsSetConnState('connecting');
  // Always update backend status card independently — run in background
  _chsCheckBackend().catch(() => {});
  try {
    // Use allSettled so a single failing endpoint doesn't abort the rest
    const results = await Promise.allSettled([
      chsLoadStatus(),
      chsLoadProgramming(),
      chsLoadFallback(),
      chsLoadHistory(),
    ]);
    // Consider connected if at least status OR programming loaded successfully
    const anySuccess = results.some(r => r.status === 'fulfilled');
    if (anySuccess) {
      _chsSetConnState('connected');
      _chsState.retryCount = 0;
    } else {
      // All failed — enter reconnect cycle
      const firstErr = results.find(r => r.status === 'rejected');
      console.warn('[ChannelStudio] All loads failed:', firstErr?.reason?.message);
      _chsHandleConnFailure();
    }
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
    // Give a helpful message — the Render free tier can take 30-90s to wake
    const wakingMsg = _chsState.retryCount <= 2
      ? `BACKEND STARTING UP — Retry in ${sec}s (may take up to 60s on free hosting)`
      : `CONNECTION LOST — Retrying in ${sec}s…`;
    if (bannerTxt) bannerTxt.textContent = wakingMsg;
    if (retryBtn) retryBtn.style.display = '';
    if (backendEl) backendEl.innerHTML = _chsState.retryCount <= 2
      ? '<span class="chs-conn-connecting-text">● STARTING UP…</span>'
      : '<span class="chs-conn-lost">● RECONNECTING…</span>';
    if (reconnBtn) reconnBtn.style.display = '';
  } else if (state === 'offline') {
    banner.style.display = '';
    banner.classList.add('chs-conn-offline');
    if (bannerTxt) bannerTxt.textContent = 'CHANNEL SYSTEM OFFLINE — Press RECONNECT to try again';
    if (retryBtn) retryBtn.style.display = '';
    if (backendEl) backendEl.innerHTML = '<span class="chs-conn-lost">● OFFLINE</span>';
    if (reconnBtn) reconnBtn.style.display = '';
  }
}

window.chsManualRetry = function() {
  clearTimeout(_chsState.retryTimer);
  _chsState.retryCount = 0;
  // Allow retrying even after permanent offline
  _chsState.connState = 'idle';
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
// Includes a 15-second request timeout so no request can hang forever.
async function _chsApi(method, path, body, timeoutMs = 15000) {
  const base = _chsState.apiBase || '/api';
  let token = null;

  // Wait up to 8 s for Firebase auth to resolve before attempting to get a token.
  // This fixes the race condition where the page loads before the Firebase SDK has
  // restored the session from localStorage, causing all requests to fail immediately
  // with "Not authenticated" before the backend is ever contacted.
  const _deadline = Date.now() + 8000;
  while (!token && Date.now() < _deadline) {
    try {
      const auth = await window.AvenoraFirebase.getFirebaseAuth();
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken(false);
      }
    } catch (_) {}
    if (!token) {
      // If LegendState already has a user, Firebase session should be available soon.
      const _stateUser = (typeof LegendState !== 'undefined') ? LegendState.get('user') : null;
      if (!_stateUser) break; // No user at all — stop waiting
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (!token) {
    // One final attempt — force a fresh token in case the cached one expired
    try {
      const auth = await window.AvenoraFirebase.getFirebaseAuth();
      if (auth.currentUser) token = await auth.currentUser.getIdToken(true);
    } catch (_) {}
  }

  if (!token) throw new Error('Not authenticated — please sign in again');

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    signal: controller.signal,
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  try {
    const res  = await fetch(base + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out — backend may be starting up');
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

// ── Backend health check ──────────────────────────────────────────────────
async function _chsCheckBackend() {
  const el   = document.getElementById('chs-backend-status');
  const hint = document.getElementById('chs-backend-hint');
  if (!el) return;
  try {
    const base = _chsState.apiBase || '/api';
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    let res, d;
    try {
      res = await fetch(base + '/health', { signal: controller.signal });
      d   = await res.json();
    } finally {
      clearTimeout(tid);
    }
    if (d && d.ok) {
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
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    el.innerHTML = isTimeout
      ? '<span class="chs-conn-connecting-text">● WAKING UP…</span>'
      : '<span class="chs-conn-lost">● OFFLINE</span>';
    if (hint) hint.textContent = isTimeout
      ? 'Backend is starting up — this takes up to 60 seconds on free hosting'
      : 'Cannot reach backend server';
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
      if (_chsState.connState !== 'connected') {
        _chsSetConnState('connected');
        _chsCheckBackend().catch(() => {});
      }
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
      _chsSaveCache(_chsState._cacheKeyProg, _chsState.programming);
      // Clear any stale banners
      const stale = el?.parentNode?.querySelector('.chs-stale-banner');
      if (stale) stale.remove();
      _chsRenderProgramming();
    }
  } catch (e) {
    // Try last-known-good before showing error
    const cached = _chsLoadCache(_chsState._cacheKeyProg);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      _chsState.programming = cached;
      _chsRenderProgramming();
      // Show a subtle stale-data banner above the list if not already there
      if (el && !el.parentNode.querySelector('.chs-stale-banner')) {
        const stale = document.createElement('div');
        stale.className = 'chs-stale-banner';
        stale.textContent = '⚡ Showing last cached data — reconnecting…';
        el.parentNode.insertBefore(stale, el);
      }
    } else if (el) {
      el.innerHTML = _chsUnavailableBlock('PROGRAMMING TEMPORARILY UNAVAILABLE', e.message, 'chsLoadProgramming()');
    }
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
      // Clear any stale banners
      const stale = el?.parentNode?.querySelector('.chs-stale-banner');
      if (stale) stale.remove();
      _chsState.fallback = data.fallback || [];
      _chsSaveCache(_chsState._cacheKeyFallback, _chsState.fallback);
      _chsRenderFallback();
    }
  } catch (e) {
    // Try last-known-good before showing error
    const cached = _chsLoadCache(_chsState._cacheKeyFallback);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      _chsState.fallback = cached;
      _chsRenderFallback();
      if (el && !el.parentNode.querySelector('.chs-stale-banner')) {
        const stale = document.createElement('div');
        stale.className = 'chs-stale-banner';
        stale.textContent = '⚡ Showing last cached fallback data — reconnecting…';
        el.parentNode.insertBefore(stale, el);
      }
    } else if (el) {
      el.innerHTML = _chsUnavailableBlock('FALLBACK DATA TEMPORARILY UNAVAILABLE', e.message, 'chsLoadFallback()');
    }
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

// ══════════════════════════════════════════════════════════════════════════
//  MEDIA UPLOAD SECTION
// ══════════════════════════════════════════════════════════════════════════

// ── Toggle upload body ─────────────────────────────────────────────────────
window.chsToggleUpload = function() {
  const body = _chsEl('chs-upload-body');
  const btn  = _chsEl('chs-upload-toggle-btn');
  if (!body) return;
  _chsState.uploadExpanded = !_chsState.uploadExpanded;
  body.style.display = _chsState.uploadExpanded ? '' : 'none';
  if (btn) btn.textContent = _chsState.uploadExpanded ? '▲ Collapse' : '▼ Expand';
  if (_chsState.uploadExpanded && _chsState.myMedia.length === 0) {
    chsLoadMyMedia();
  }
};

// ── Trigger file picker ────────────────────────────────────────────────────
window.chsUploadTrigger = function(type) {
  if (type === 'audio') {
    const inp = _chsEl('chs-audio-input');
    if (inp) { inp.value = ''; inp.click(); }
  } else if (type === 'video') {
    const inp = _chsEl('chs-video-input');
    if (inp) { inp.value = ''; inp.click(); }
  }
};

// ── Validate format compatibility ─────────────────────────────────────────
function _chsValidateMediaFile(file, type) {
  const name = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  if (type === 'audio') {
    const ok = mime.startsWith('audio/') ||
      /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/.test(name);
    if (!ok) return `Incompatible audio format: ${file.name}. Use MP3, M4A, AAC, or WAV.`;
    if (file.size > 100 * 1024 * 1024) return `${file.name} is too large (max 100 MB for audio).`;
    return null;
  }
  if (type === 'video') {
    const preferred = mime === 'video/mp4' || /\.mp4$/i.test(name);
    const supported = mime.startsWith('video/') || /\.(mp4|webm|mov|avi)$/.test(name);
    if (!supported) return `Incompatible video format: ${file.name}. Use MP4 (H.264/AAC), WebM, or MOV.`;
    if (file.size > 500 * 1024 * 1024) return `${file.name} is too large (max 500 MB for video).`;
    return null;
  }
  if (type === 'image') {
    const ok = mime.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/.test(name);
    if (!ok) return `Incompatible image format: ${file.name}. Use JPEG, PNG, or WebP.`;
    if (file.size > 20 * 1024 * 1024) return `${file.name} is too large (max 20 MB per image).`;
    return null;
  }
  return null;
}

// ── Create a progress card in the upload area ──────────────────────────────
function _chsMakeProgressCard(id, filename) {
  const area = _chsEl('chs-upload-progress-area');
  if (!area) return null;
  const card = document.createElement('div');
  card.id = 'chs-prog-card-' + id;
  card.className = 'chs-upload-card';
  card.innerHTML = `
    <div class="chs-upload-card-info">
      <div class="chs-upload-card-name">${_esc(filename)}</div>
      <div class="chs-upload-card-status" id="chs-prog-status-${id}">Preparing…</div>
    </div>
    <div class="chs-upload-progress-wrap">
      <div class="chs-upload-progress-bar">
        <div class="chs-upload-progress-fill" id="chs-prog-fill-${id}" style="width:0%"></div>
      </div>
      <div class="chs-upload-progress-pct" id="chs-prog-pct-${id}">0%</div>
    </div>
    <div class="chs-upload-card-actions" id="chs-prog-actions-${id}" style="display:none"></div>
  `;
  area.prepend(card);
  return card;
}

function _chsUpdateProgress(id, pct, status) {
  const fill = _chsEl('chs-prog-fill-' + id);
  const pctEl = _chsEl('chs-prog-pct-' + id);
  const statEl = _chsEl('chs-prog-status-' + id);
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (status && statEl) statEl.textContent = status;
}

function _chsSetCardComplete(id, msg) {
  const card = _chsEl('chs-prog-card-' + id);
  if (card) card.classList.add('chs-upload-card-done');
  _chsUpdateProgress(id, 100, msg || 'Complete ✅');
  setTimeout(() => { const c = _chsEl('chs-prog-card-' + id); if (c) c.remove(); }, 4000);
}

function _chsSetCardError(id, msg, retryFn) {
  const card = _chsEl('chs-prog-card-' + id);
  if (card) card.classList.add('chs-upload-card-error');
  _chsUpdateProgress(id, 0, '❌ ' + msg);
  const fill = _chsEl('chs-prog-fill-' + id);
  if (fill) fill.style.background = 'var(--neon-red, #ff3333)';
  const actEl = _chsEl('chs-prog-actions-' + id);
  if (actEl && retryFn) {
    actEl.style.display = '';
    actEl.innerHTML = `<button class="chs-btn chs-btn-outline chs-btn-xs" onclick="(${retryFn})()">↻ Retry</button>
      <button class="chs-btn chs-btn-ghost chs-btn-xs" onclick="this.closest('.chs-upload-card').remove()">✕ Dismiss</button>`;
  }
}

// ── Handle Audio Upload ────────────────────────────────────────────────────
window.chsHandleAudioFile = async function(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  const err = _chsValidateMediaFile(file, 'audio');
  if (err) { _chsToast(err, 'error'); return; }

  const uid = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const card = _chsMakeProgressCard(uid, file.name);
  // Show title edit box inside card
  if (card) {
    const infoEl = card.querySelector('.chs-upload-card-info');
    if (infoEl) {
      const titleInp = document.createElement('input');
      titleInp.className = 'form-input chs-upload-title-input';
      titleInp.id = 'chs-prog-title-' + uid;
      titleInp.maxLength = 200;
      titleInp.placeholder = 'Track title';
      titleInp.value = file.name.replace(/\.[^.]+$/, '');
      infoEl.appendChild(titleInp);
    }
  }

  try {
    if (!window.AvenoraStorage) throw new Error('Storage not available — refresh and try again');
    _chsUpdateProgress(uid, 5, 'Uploading…');

    const result = await window.AvenoraStorage.upload('audio', file, pct => {
      _chsUpdateProgress(uid, pct, `Uploading… ${pct}%`);
    });

    _chsUpdateProgress(uid, 95, 'Saving to library…');

    const titleVal = (_chsEl('chs-prog-title-' + uid)?.value || file.name.replace(/\.[^.]+$/, '')).trim();

    // Save record to Firestore via backend
    const saved = await _chsApi('POST', '/media/save', {
      type: 'audio',
      title: titleVal,
      url: result.url,
      storagePath: result.storagePath,
      fileSize: file.size,
      mimeType: file.type,
    });

    _chsSetCardComplete(uid, `"${titleVal}" uploaded ✅`);
    _chsToast(`🎵 "${titleVal}" uploaded successfully`);

    // Refresh library
    await chsLoadMyMedia();
  } catch (e) {
    _chsSetCardError(uid, e.message || 'Upload failed', `function(){chsHandleAudioRetry('${_esc(String(uid))}')}`);
    console.error('[ChannelStudio] Audio upload failed:', e);
  }
};

// ── Handle Video Upload ────────────────────────────────────────────────────
window.chsHandleVideoFile = async function(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  const err = _chsValidateMediaFile(file, 'video');
  if (err) { _chsToast(err, 'error'); return; }

  // Warn about non-MP4
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (!mime.startsWith('video/mp4') && !name.endsWith('.mp4')) {
    const go = confirm(
      `⚠️ "${file.name}" may not be in MP4/H.264 format. ` +
      `Some browsers and the channel player work best with MP4. ` +
      `Tap OK to continue anyway, or Cancel to choose a different file.`
    );
    if (!go) return;
  }

  const uid = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const card = _chsMakeProgressCard(uid, file.name);
  if (card) {
    const infoEl = card.querySelector('.chs-upload-card-info');
    if (infoEl) {
      const titleInp = document.createElement('input');
      titleInp.className = 'form-input chs-upload-title-input';
      titleInp.id = 'chs-prog-title-' + uid;
      titleInp.maxLength = 200;
      titleInp.placeholder = 'Video title';
      titleInp.value = file.name.replace(/\.[^.]+$/, '');
      infoEl.appendChild(titleInp);
    }
  }

  try {
    if (!window.AvenoraStorage) throw new Error('Storage not available — refresh and try again');
    _chsUpdateProgress(uid, 3, 'Uploading video…');

    const result = await window.AvenoraStorage.upload('video', file, pct => {
      _chsUpdateProgress(uid, pct, `Uploading… ${pct}%`);
    });

    _chsUpdateProgress(uid, 95, 'Saving to library…');

    const titleVal = (_chsEl('chs-prog-title-' + uid)?.value || file.name.replace(/\.[^.]+$/, '')).trim();

    await _chsApi('POST', '/media/save', {
      type: 'video',
      title: titleVal,
      url: result.url,
      storagePath: result.storagePath,
      fileSize: file.size,
      mimeType: file.type,
    });

    _chsSetCardComplete(uid, `"${titleVal}" uploaded ✅`);
    _chsToast(`🎬 "${titleVal}" uploaded successfully`);
    await chsLoadMyMedia();
  } catch (e) {
    _chsSetCardError(uid, e.message || 'Upload failed', null);
    console.error('[ChannelStudio] Video upload failed:', e);
  }
};

// ── Load user's media library ──────────────────────────────────────────────
window.chsLoadMyMedia = async function() {
  const el = _chsEl('chs-media-library');
  if (!el) return;
  try {
    const data = await _chsApi('GET', '/media/library');
    if (data.success) {
      _chsState.myMedia = data.items || [];
      _chsRenderMediaLibrary();
    }
  } catch (e) {
    if (_chsState.myMedia.length > 0) {
      _chsRenderMediaLibrary(); // show stale
    } else {
      el.innerHTML = `<div class="chs-empty-state">
        <div class="chs-empty-icon">📁</div>
        <div class="chs-empty-title">Could not load media</div>
        <div class="chs-empty-desc">${_esc(e.message)}</div>
        <button class="chs-btn chs-btn-outline chs-btn-sm" onclick="chsLoadMyMedia()">↻ Retry</button>
      </div>`;
    }
  }
};

// ── Filter media ───────────────────────────────────────────────────────────
window.chsFilterMedia = function(filter) {
  _chsState.mediaFilter = filter;
  // Update tab active state
  const tabs = document.querySelectorAll('#chs-media-tabs .chs-media-tab');
  tabs.forEach(t => {
    t.classList.toggle('chs-media-tab-active', t.dataset.tab === filter);
  });
  _chsRenderMediaLibrary();
};

// ── Render media library ───────────────────────────────────────────────────
function _chsRenderMediaLibrary() {
  const el = _chsEl('chs-media-library');
  if (!el) return;

  const all = _chsState.myMedia || [];
  const filter = _chsState.mediaFilter || 'all';
  const items = filter === 'all' ? all : all.filter(m => m.type === filter);

  if (!items.length) {
    el.innerHTML = `<div class="chs-empty-state">
      <div class="chs-empty-icon">${filter === 'all' ? '📁' : filter === 'audio' ? '🎵' : filter === 'video' ? '🎬' : filter === 'slideshow' ? '🎞️' : '🖼️'}</div>
      <div class="chs-empty-title">No ${filter === 'all' ? 'media' : filter} uploaded yet</div>
      <div class="chs-empty-desc">Upload ${filter === 'all' ? 'music, videos, or photos' : filter} using the buttons above.</div>
    </div>`;
    return;
  }

  el.innerHTML = items.map(item => `
    <div class="chs-media-item" id="chs-media-item-${_esc(item.id)}">
      <div class="chs-media-item-thumb">
        ${item.thumbnailUrl
          ? `<img src="${_esc(item.thumbnailUrl)}" alt="" class="chs-media-thumb-img" loading="lazy">`
          : `<div class="chs-media-thumb-icon">${_chsTypeEmoji(item.type === 'audio' ? 'MUSIC' : item.type === 'video' ? 'VIDEO' : item.type === 'slideshow' ? 'SLIDESHOW' : 'IMAGE')}</div>`
        }
      </div>
      <div class="chs-media-item-info">
        <div class="chs-media-item-title">${_esc(item.title)}</div>
        <div class="chs-media-item-meta">
          <span class="chs-media-type-badge chs-media-type-${_esc(item.type)}">${_chsMediaTypeLabel(item.type)}</span>
          ${item.duration ? ` · <span>${_chsFmtDuration(item.duration)}</span>` : ''}
          ${item.fileSize ? ` · <span>${_chsFmtSize(item.fileSize)}</span>` : ''}
          ${item.createdAt ? ` · <span>${new Date(item.createdAt).toLocaleDateString()}</span>` : ''}
        </div>
        <div class="chs-media-item-status">
          <span class="chs-media-status-dot chs-media-status-${_esc(item.status || 'ready')}"></span>
          ${_esc(item.status || 'ready')}
        </div>
      </div>
      <div class="chs-media-item-actions">
        ${item.type === 'audio' || item.type === 'video'
          ? `<button class="chs-btn chs-btn-ghost chs-btn-xs" onclick="chsPreviewMedia('${_esc(item.id)}')" title="Preview">▶ Preview</button>`
          : ''}
        <button class="chs-btn chs-btn-primary chs-btn-xs" onclick="chsAddMediaToQueue('${_esc(item.id)}')" title="Add to Programming Queue">+ Queue</button>
        <button class="chs-btn chs-btn-outline chs-btn-xs" onclick="chsAddMediaToFallback('${_esc(item.id)}')" title="Add as Fallback">+ Fallback</button>
        <button class="chs-btn chs-btn-danger chs-btn-xs" onclick="chsDeleteMedia('${_esc(item.id)}')" title="Delete">✕</button>
      </div>
    </div>
  `).join('');
}

// ── Preview media ──────────────────────────────────────────────────────────
window.chsPreviewMedia = function(id) {
  const item = _chsState.myMedia.find(m => m.id === id);
  if (!item || !item.url) { _chsToast('No playable URL found', 'error'); return; }
  if (item.type === 'audio') {
    const existing = document.getElementById('chs-preview-audio-player');
    if (existing) existing.remove();
    const audio = document.createElement('audio');
    audio.id = 'chs-preview-audio-player';
    audio.controls = true;
    audio.autoplay = true;
    audio.src = item.url;
    audio.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;background:#111;border-radius:8px;padding:8px;max-width:90vw';
    audio.onended = () => audio.remove();
    document.body.appendChild(audio);
    _chsToast(`▶ Playing: ${item.title}`);
  } else if (item.type === 'video') {
    const existing = document.getElementById('chs-preview-video-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'chs-preview-video-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:16px';
    modal.innerHTML = `
      <video controls autoplay playsinline style="max-width:90vw;max-height:70vh;border-radius:8px;background:#000" src="${_esc(item.url)}"></video>
      <button style="background:rgba(255,255,255,0.1);border:none;color:#fff;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:0.9rem" onclick="this.closest('#chs-preview-video-modal').remove()">✕ Close</button>
    `;
    document.body.appendChild(modal);
  }
};

// ── Add media to programming queue ────────────────────────────────────────
window.chsAddMediaToQueue = async function(id) {
  const item = _chsState.myMedia.find(m => m.id === id);
  if (!item) return;
  const programItem = _chsMediaToProgramItem(item);
  try {
    await _chsApi('POST', '/channel/programming/add', programItem);
    _chsToast(`✅ "${item.title}" added to programming queue`);
    await chsLoadProgramming();
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

// ── Add media to fallback ─────────────────────────────────────────────────
window.chsAddMediaToFallback = async function(id) {
  const item = _chsState.myMedia.find(m => m.id === id);
  if (!item) return;
  const programItem = _chsMediaToProgramItem(item);
  try {
    await _chsApi('POST', '/channel/fallback/add', programItem);
    _chsToast(`✅ "${item.title}" added to fallback`);
    await chsLoadFallback();
  } catch (e) { _chsToast('Error: ' + e.message, 'error'); }
};

// ── Convert a media library item to a channel programming item ─────────────
function _chsMediaToProgramItem(item) {
  const typeMap = {
    audio:     'MUSIC',
    video:     'VIDEO',
    image:     'IMAGE',
    slideshow: 'SLIDESHOW',
  };
  const prog = {
    type:       typeMap[item.type] || 'MUSIC',
    title:      item.title,
    mediaUrl:   item.url,
    sourceType: 'direct',
    sourceUrl:  item.url,
    duration:   item.duration || 0,
  };
  // Slideshow
  if (item.type === 'slideshow') {
    prog.images = (item.images || []).map(img => ({ url: img.url, caption: img.caption || '' }));
    prog.perImageSecs = item.perImageSecs || 10;
    prog.duration = (item.images?.length || 0) * (item.perImageSecs || 10);
    delete prog.mediaUrl;
    delete prog.sourceUrl;
    // If there's audio, add it as a track so the channel player can use it
    if (item.audioTrack?.url) {
      prog.tracks = [{
        id:    item.id + '_audio',
        title: item.audioTrack.title || item.title + ' (music)',
        url:   item.audioTrack.url,
        duration: item.audioTrack.duration || 0,
      }];
    }
  }
  return prog;
}

// ── Delete media item ──────────────────────────────────────────────────────
window.chsDeleteMedia = async function(id) {
  const item = _chsState.myMedia.find(m => m.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
  try {
    await _chsApi('DELETE', '/media/' + id);
    _chsState.myMedia = _chsState.myMedia.filter(m => m.id !== id);
    _chsRenderMediaLibrary();
    _chsToast('Media deleted');
  } catch (e) { _chsToast('Delete failed: ' + e.message, 'error'); }
};

// ── Slideshow Builder ─────────────────────────────────────────────────────
window.chsShowSlideshowBuilder = function() {
  const builder = _chsEl('chs-slideshow-builder');
  if (builder) builder.style.display = '';
  // Make sure upload body is open
  if (!_chsState.uploadExpanded) chsToggleUpload();
  builder?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.chsCloseSlideshowBuilder = function() {
  const builder = _chsEl('chs-slideshow-builder');
  if (builder) builder.style.display = 'none';
};

// ── Set seconds per image ──────────────────────────────────────────────────
window.chsSetPerImage = function(secs) {
  _chsState.slideshow.perImageSecs = secs;
  [5, 10, 15, 30, 60].forEach(s => {
    const btn = _chsEl('chs-dur-' + s);
    if (btn) btn.classList.toggle('chs-duration-active', s === secs);
  });
  _chsUpdateSlideshowHint();
};

function _chsUpdateSlideshowHint() {
  const hint = _chsEl('chs-slideshow-duration-hint');
  if (!hint) return;
  const n = _chsState.slideshow.images.length;
  const s = _chsState.slideshow.perImageSecs;
  if (!n) { hint.textContent = ''; return; }
  hint.textContent = `${n} photos × ${s}s = ${_chsFmtDuration(n * s)} total slideshow duration`;
}

// ── Handle slideshow image selection ──────────────────────────────────────
window.chsHandleSlideImages = function(input) {
  const files = input.files;
  if (!files || !files.length) return;

  const errors = [];
  const newImages = [];

  for (const file of files) {
    const err = _chsValidateMediaFile(file, 'image');
    if (err) { errors.push(err); continue; }
    const blobUrl = URL.createObjectURL(file);
    newImages.push({ file, blobUrl, url: null, storagePath: null, caption: '' });
  }

  if (errors.length) _chsToast(errors.join('\n'), 'error');

  _chsState.slideshow.images = [..._chsState.slideshow.images, ...newImages];
  _chsRenderSlidePreview();
  _chsUpdateSlideshowHint();
};

// ── Render slideshow image preview grid ───────────────────────────────────
function _chsRenderSlidePreview() {
  const el = _chsEl('chs-slide-images-preview');
  if (!el) return;
  const imgs = _chsState.slideshow.images;

  if (!imgs.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="chs-slide-preview-grid">
      ${imgs.map((img, i) => `
        <div class="chs-slide-preview-item" id="chs-slide-img-${i}">
          <img src="${_esc(img.blobUrl || img.url || '')}" alt="" class="chs-slide-preview-thumb" loading="lazy">
          <div class="chs-slide-preview-num">${i + 1}</div>
          <div class="chs-slide-preview-controls">
            ${i > 0 ? `<button class="chs-slide-move-btn" onclick="chsMoveSlideImage(${i}, -1)" title="Move left">←</button>` : ''}
            ${i < imgs.length - 1 ? `<button class="chs-slide-move-btn" onclick="chsMoveSlideImage(${i}, 1)" title="Move right">→</button>` : ''}
            <button class="chs-slide-remove-btn" onclick="chsRemoveSlideImage(${i})" title="Remove">✕</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="chs-slide-preview-count">${imgs.length} photo${imgs.length !== 1 ? 's' : ''} selected</div>
  `;
}

window.chsMoveSlideImage = function(idx, direction) {
  const imgs = _chsState.slideshow.images;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= imgs.length) return;
  [imgs[idx], imgs[newIdx]] = [imgs[newIdx], imgs[idx]];
  _chsState.slideshow.images = [...imgs];
  _chsRenderSlidePreview();
  _chsUpdateSlideshowHint();
};

window.chsRemoveSlideImage = function(idx) {
  const img = _chsState.slideshow.images[idx];
  if (img?.blobUrl) URL.revokeObjectURL(img.blobUrl);
  _chsState.slideshow.images.splice(idx, 1);
  _chsRenderSlidePreview();
  _chsUpdateSlideshowHint();
};

// ── Handle slideshow audio file ────────────────────────────────────────────
window.chsHandleSlideAudio = function(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = '';
  const err = _chsValidateMediaFile(file, 'audio');
  if (err) { _chsToast(err, 'error'); return; }
  _chsState.slideshow.audioTrack = { file, url: null, storagePath: null, title: file.name.replace(/\.[^.]+$/, '') };
  _chsRenderSlideAudioInfo();
};

// ── Pick audio from media library for slideshow ───────────────────────────
window.chsPickMediaForSlide = function() {
  const audioItems = _chsState.myMedia.filter(m => m.type === 'audio');
  if (!audioItems.length) {
    _chsToast('No music in your library yet. Upload music first.', 'error');
    return;
  }
  const names = audioItems.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
  const choice = prompt(`Choose music by number:\n\n${names}`);
  if (!choice) return;
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= audioItems.length) {
    _chsToast('Invalid selection', 'error'); return;
  }
  const track = audioItems[idx];
  _chsState.slideshow.audioTrack = {
    file: null, url: track.url, storagePath: track.storagePath,
    title: track.title, duration: track.duration || 0,
  };
  _chsRenderSlideAudioInfo();
};

function _chsRenderSlideAudioInfo() {
  const el = _chsEl('chs-slide-audio-info');
  if (!el) return;
  const audio = _chsState.slideshow.audioTrack;
  if (!audio) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="chs-slide-audio-selected">
      🎵 <strong>${_esc(audio.title || audio.file?.name || 'Selected track')}</strong>
      <button class="chs-btn chs-btn-ghost chs-btn-xs" onclick="_chsState.slideshow.audioTrack=null;_chsRenderSlideAudioInfo()" style="margin-left:8px">✕ Remove</button>
    </div>
  `;
}

// ── Save slideshow ────────────────────────────────────────────────────────
window.chsSaveSlideshow = async function() {
  const errEl = _chsEl('chs-slideshow-error');
  const saveBtn = _chsEl('chs-slideshow-save-btn');
  if (errEl) errEl.style.display = 'none';

  const images = _chsState.slideshow.images;
  const perSecs = _chsState.slideshow.perImageSecs;
  const audioTrack = _chsState.slideshow.audioTrack;
  const name = (_chsEl('chs-slideshow-name')?.value || '').trim();

  if (!name) {
    if (errEl) { errEl.textContent = 'Please enter a slideshow title (Step 4)'; errEl.style.display = ''; }
    return;
  }
  if (!images.length) {
    if (errEl) { errEl.textContent = 'Add at least one photo (Step 1)'; errEl.style.display = ''; }
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Uploading photos…'; }

  try {
    // 1. Upload any images that haven't been uploaded yet
    const uploadedImages = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img.url) {
        // Already uploaded (from library)
        uploadedImages.push({ url: img.url, storagePath: img.storagePath || '', caption: img.caption || '' });
        continue;
      }
      if (saveBtn) saveBtn.textContent = `⏳ Uploading photo ${i + 1}/${images.length}…`;
      if (!window.AvenoraStorage) throw new Error('Storage not available');
      const result = await window.AvenoraStorage.upload('image', img.file, null);
      img.url = result.url;
      img.storagePath = result.storagePath;
      uploadedImages.push({ url: result.url, storagePath: result.storagePath, caption: img.caption || '' });
    }

    // 2. Upload audio if it has a file but no URL
    let audioPayload = null;
    if (audioTrack) {
      if (!audioTrack.url && audioTrack.file) {
        if (saveBtn) saveBtn.textContent = '⏳ Uploading music…';
        const result = await window.AvenoraStorage.upload('audio', audioTrack.file, null);
        audioTrack.url = result.url;
        audioTrack.storagePath = result.storagePath;
      }
      audioPayload = {
        url: audioTrack.url,
        storagePath: audioTrack.storagePath || '',
        title: audioTrack.title || 'Background Music',
        duration: audioTrack.duration || 0,
      };
    }

    if (saveBtn) saveBtn.textContent = '⏳ Saving to library…';

    // 3. Save slideshow record
    const saved = await _chsApi('POST', '/media/slideshow', {
      title: name,
      images: uploadedImages,
      perImageSecs: perSecs,
      audioTrack: audioPayload,
    });

    _chsToast(`✅ Slideshow "${name}" saved to My Media`);

    // Reset builder state
    _chsState.slideshow.images.forEach(img => { if (img.blobUrl) URL.revokeObjectURL(img.blobUrl); });
    _chsState.slideshow = { images: [], perImageSecs: 10, audioTrack: null };
    _chsEl('chs-slideshow-name').value = '';
    _chsRenderSlidePreview();
    _chsRenderSlideAudioInfo();
    chsCloseSlideshowBuilder();
    await chsLoadMyMedia();

  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    console.error('[ChannelStudio] Slideshow save failed:', e);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save & Add to Library'; }
  }
};

// ── Media type helpers ─────────────────────────────────────────────────────
function _chsMediaTypeLabel(type) {
  const MAP = { audio: '🎵 MUSIC', video: '🎬 VIDEO', image: '🖼️ PHOTO', slideshow: '🎞️ SLIDESHOW' };
  return MAP[type] || type.toUpperCase();
}

function _chsFmtSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

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
