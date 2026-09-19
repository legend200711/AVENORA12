/**
 * AVENORA - Main App Router & Bootstrap
 * Hash-based SPA routing. Each page module registers itself.
 */

(function () {
  'use strict';

  // ─── Page Registry ────────────────────────────────────────
  const pageRegistry = {};

  function registerPage(name, module) {
    pageRegistry[name] = module;
  }

  // Replace the stub set in index.html and drain any queued registrations.
  // Page scripts execute before app.js and called the stub's queue; we now
  // flush those into the real registry.
  window.registerPage = registerPage;
  (window._pageQueue || []).forEach(function (entry) {
    registerPage(entry.name, entry.mod);
  });
  window._pageQueue = null; // free memory; stub no longer needed

  // ─── Router ───────────────────────────────────────────────
  const defaultPage = 'hub';
  let currentPage = null;
  let currentCleanup = null;

  function getPageFromHash() {
    const hash = location.hash.replace('#', '') || defaultPage;
    // Support sub-routes: #live-room/abc123 → page 'live-room'
    const segments = hash.split('/');
    return segments[0] || defaultPage;
  }

  function navigateTo(page, params = {}) {
    const target = page || defaultPage;
    location.hash = `#${target}`;
  }
  window.navigateTo = navigateTo;

  async function renderPage(pageName) {
    const container = document.getElementById('page-container');
    if (!container) return;

    // Clean up previous page
    if (typeof currentCleanup === 'function') {
      try { currentCleanup(); } catch {}
    }
    currentCleanup = null;
    currentPage = pageName;

    // Update nav active states
    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === pageName);
    });

    // Update header subtitle
    const subtitleMap = {
      hub:            'HOME',
      social:         'FEED',
      video:          'VIDEO',
      live:           'LIVE',
      'live-room':    'LIVE ROOM',
      channel:        '24-HOUR CHANNEL',
      channelstudio:  'CHANNEL STUDIO',
      cloudstream:    'CLOUD STREAM',
      cloudstudio:    'CREATOR STUDIO',
      dj:             'DJ SYSTEM',
      music:          'MUSIC HUB',
      radio:          'AVENORA RADIO',
      radioadmin:     'RADIO ADMIN',
      arcade:         'ARCADE',
      chat:           'CHAT',
      gallery:        'GALLERY',
      admin:          'FOUNDER CONTROL',
      search:         'SEARCH',
      profile:        'PROFILE',
      settings:       'SETTINGS',
      customize:      'CUSTOMIZE AVENORA',
      auth:           'SIGN IN',
    };
    const subtitle = document.getElementById('nav-subtitle');
    if (subtitle) subtitle.textContent = subtitleMap[pageName] || 'HUB CORE';

    // Update back button visibility
    const backBtn = document.getElementById('btn-back');
    if (backBtn) backBtn.style.display = pageName !== 'hub' ? 'flex' : 'none';

    // Show loading (for pages other than hub during auth check use generic spinner;
    // hub.js handles its own authLoading screen)
    container.innerHTML = `<div class="loading-state" style="min-height:60vh"><div class="spinner spinner-lg"></div><span>Loading...</span></div>`;

    const module = pageRegistry[pageName];
    if (!module) {
      container.innerHTML = `
        <div class="error-state" style="min-height:60vh">
          <div class="error-icon">🌌</div>
          <h3>Page Not Found</h3>
          <p>This section doesn't exist yet or hasn't been loaded.</p>
          <button class="btn btn-primary" onclick="navigateTo('hub')">Return to Hub</button>
        </div>
      `;
      return;
    }

    try {
      const cleanup = await module.render(container);
      if (typeof cleanup === 'function') currentCleanup = cleanup;
    } catch (err) {
      console.error(`[AVN] Page render error [${pageName}]:`, err);
      const isNetwork = (err.message === 'Failed to fetch') || err.message?.includes('NetworkError') || err.message?.includes('net::ERR');
      const display = isNetwork
        ? 'Could not connect. Check your connection and try again.'
        : 'Something went wrong. Please try again.';
      showError(container, display, () => renderPage(pageName));
    }
  }

  // ─── Auth state ───────────────────────────────────────────
  function updateNavAuthState(user) {
    const userDropdown = document.getElementById('user-dropdown');
    const authBtn = document.getElementById('btn-auth');
    const navUsername = document.getElementById('nav-username');
    const navAvatar = document.getElementById('nav-avatar');
    const adminLink = document.getElementById('admin-link');
    const channelStudioLink = document.getElementById('channel-studio-link');

    if (user) {
      if (userDropdown) userDropdown.style.display = 'flex';
      if (authBtn) authBtn.style.display = 'none';
      if (navUsername) navUsername.textContent = user.username;
      if (navAvatar) {
        const initial = (user.profile?.displayName || user.username || '?')[0].toUpperCase();
        navAvatar.textContent = initial;
        if (user.profile?.avatarUrl) {
          navAvatar.style.backgroundImage = `url(${user.profile.avatarUrl})`;
          navAvatar.style.backgroundSize = 'cover';
          navAvatar.textContent = '';
        }
      }
      // Show admin/founder links
      if (adminLink && ['founder', 'admin'].includes(user.role)) {
        adminLink.style.display = 'flex';
      }
      if (channelStudioLink && ['founder', 'admin'].includes(user.role)) {
        channelStudioLink.style.display = 'flex';
      }
    } else {
      if (userDropdown) userDropdown.style.display = 'none';
      if (authBtn) authBtn.style.display = 'flex';
      if (adminLink) adminLink.style.display = 'none';
      if (channelStudioLink) channelStudioLink.style.display = 'none';
    }
  }

  // ─── Dropdown handling ────────────────────────────────────
  function initDropdowns() {
    document.getElementById('btn-notif')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('notif-menu');
      const isOpen = !menu.classList.contains('hidden');
      document.getElementById('user-menu')?.classList.add('hidden');
      menu.classList.toggle('hidden', isOpen);
      document.getElementById('btn-notif').setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) loadNotifications();
    });

    document.getElementById('btn-user-menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('user-menu');
      const isOpen = !menu.classList.contains('hidden');
      document.getElementById('notif-menu')?.classList.add('hidden');
      menu.classList.toggle('hidden', isOpen);
      document.getElementById('btn-user-menu').setAttribute('aria-expanded', String(!isOpen));
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
      document.getElementById('notif-menu')?.classList.add('hidden');
      document.getElementById('user-menu')?.classList.add('hidden');
    });

    // Mobile search toggle
    document.getElementById('btn-search-mobile')?.addEventListener('click', () => {
      const panel = document.getElementById('mobile-search-panel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        document.getElementById('search-input-mobile')?.focus();
      }
    });
  }

  // ─── Search ───────────────────────────────────────────────
  function initSearch() {
    const handleSearch = debounce(async (query) => {
      if (!query.trim() || query.length < 2) return;
      navigateTo('search');
      LegendState.set('searchQuery', query);
    }, 400);

    document.getElementById('search-input-desktop')?.addEventListener('input', e => handleSearch(e.target.value));
    document.getElementById('search-input-mobile')?.addEventListener('input', e => handleSearch(e.target.value));

    // Enter key
    ['search-input-desktop', 'search-input-mobile'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.value.trim()) {
          navigateTo('search');
          LegendState.set('searchQuery', e.target.value.trim());
        }
      });
    });
  }

  // ─── Notifications ────────────────────────────────────────
  async function loadNotifications() {
    if (!LegendAPI.auth.isLoggedIn()) return;
    try {
      const data = await LegendAPI.notifications.list();
      const badge = document.getElementById('notif-badge');
      const list = document.getElementById('notif-list');
      if (badge) {
        badge.textContent = data.unreadCount || '';
        badge.classList.toggle('hidden', !data.unreadCount);
      }
      if (list) {
        if (!data.notifications?.length) {
          list.innerHTML = '<p style="padding:12px;color:var(--text-muted);font-size:0.85rem;text-align:center">No notifications</p>';
        } else {
          list.innerHTML = data.notifications.map(n => `
            <div class="dropdown-item" style="cursor:default">
              <span>${escapeHtml(n.message || 'Notification')}</span>
              <span style="font-size:0.75rem;color:var(--text-muted)">${formatTimeAgo(n.createdAt)}</span>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      console.warn('Could not load notifications:', err.message);
    }
  }
  window.loadNotifications = loadNotifications;

  // ─── Auth handlers ────────────────────────────────────────
  window.handleLogout = async function () {
    await LegendAPI.auth.logout();
    Toast.success('Signed out. See you soon! ✨');
    navigateTo('hub');
  };

  window.switchAuthTab = function (tab) {
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const forgotForm = document.getElementById('forgot-form');
    const loginTab = document.getElementById('tab-login');
    const regTab = document.getElementById('tab-register');

    [loginForm, regForm, forgotForm].forEach(f => f?.classList.add('hidden'));
    [loginTab, regTab].forEach(t => t?.classList.remove('active'));

    if (tab === 'login') {
      loginForm?.classList.remove('hidden');
      loginTab?.classList.add('active');
    } else if (tab === 'register') {
      regForm?.classList.remove('hidden');
      regTab?.classList.add('active');
    } else if (tab === 'forgot') {
      forgotForm?.classList.remove('hidden');
    }
  };

  window.handleForgotPassword = async function (e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email')?.value?.trim();
    const errEl = document.getElementById('forgot-error');
    const successEl = document.getElementById('forgot-success');
    const btn = document.getElementById('forgot-btn');

    if (errEl) errEl.classList.add('hidden');
    if (successEl) successEl.classList.add('hidden');
    if (!email) {
      if (errEl) { errEl.textContent = 'Email required'; errEl.classList.remove('hidden'); }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'SENDING...'; }

    try {
      const data = await LegendAPI.auth.forgotPassword(email);
      if (successEl) {
        successEl.textContent = data.message || 'If that email is registered, a reset link will be sent.';
        successEl.classList.remove('hidden');
      }
    } catch (err) {
      console.warn('[AVN] Forgot password error:', err);
      if (errEl) { errEl.textContent = 'Something went wrong. Please try again.'; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'SEND RESET LINK'; }
    }
  };

  window.handleLogin = async function (e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'SIGNING IN...';

    try {
      const data = await LegendAPI.auth.login(email, password);
      Modal.close('auth-modal');
      Toast.success(`Welcome back, ${data.user.username}! You belong here. 🌅`);
      updateNavAuthState(data.user);
    } catch (err) {
      console.warn('[AVN] Login error:', err);
      // Map Firebase error codes to friendly messages
      const msg = _friendlyAuthError(err);
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'SIGN IN';
    }
  };

  window.handleRegister = async function (e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    const btn = document.getElementById('reg-btn');

    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'CREATING ACCOUNT...';

    try {
      const data = await LegendAPI.auth.register(username, email, password);
      Modal.close('auth-modal');
      Toast.success(`Welcome to Avenora, ${data.user.username}! A place where everyone belongs. 🌅`);
      updateNavAuthState(data.user);
    } catch (err) {
      console.warn('[AVN] Register error:', err);
      const msg = _friendlyAuthError(err);
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'CREATE ACCOUNT';
    }
  };

  // ─── Friendly auth error mapper ───────────────────────────
  function _friendlyAuthError(err) {
    const code = err?.code || '';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return 'Incorrect email or password. Please try again.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'That email address is already in use.';
    }
    if (code === 'auth/weak-password') {
      return 'Password must be at least 8 characters.';
    }
    if (code === 'auth/invalid-email') {
      return 'Please enter a valid email address.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (code === 'auth/network-request-failed' || err?.message === 'Failed to fetch') {
      return 'Could not connect. Check your connection and try again.';
    }
    // Generic fallback — never expose internal error details
    return 'Something went wrong. Please try again.';
  }

  // ─── Password reset handler (for reset links from email) ──
  window.handleResetPassword = async function (token, email) {
    const pw   = document.getElementById('reset-new-password')?.value || '';
    const errEl = document.getElementById('reset-error');
    const succEl = document.getElementById('reset-success');
    const btn   = document.getElementById('reset-submit-btn');

    if (errEl) errEl.classList.add('hidden');
    if (succEl) succEl.classList.add('hidden');

    if (pw.length < 8) {
      if (errEl) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.classList.remove('hidden'); }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'RESETTING...'; }

    try {
      // Firebase users: use Firebase's built-in password reset (oobCode flow)
      // Legacy MongoDB users: use the backend reset endpoint
      if (window.AvenoraFirebase?.Auth?.resetPassword) {
        await window.AvenoraFirebase.Auth.resetPassword(token, pw);
      } else {
        const data = await LegendAPI.auth.resetPassword(token, email, pw);
        if (!data.success) throw new Error(data.message || 'Reset failed');
      }
      if (succEl) {
        succEl.textContent = 'Password reset! You can now sign in with your new password.';
        succEl.classList.remove('hidden');
      }
      Toast.success('Password reset successfully!');
      setTimeout(() => { switchAuthTab('login'); }, 2000);
    } catch (err) {
      const msg = err.message || 'Reset failed. The link may have expired.';
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'RESET PASSWORD'; }
    }
  };

  // Override btn-auth to open modal instead of navigate
  function initAuthButton() {
    const btn = document.getElementById('btn-auth');
    if (btn) {
      btn.onclick = () => Modal.open('auth-modal');
    }
  }

  // ─── Visual Engine init ───────────────────────────────────
  function initVisuals() {
    if (LegendVisual.prefersReducedMotion) return;
    const tier = LegendVisual.getDeviceTier();

    // Starfield
    const starCanvas = document.getElementById('canvas-stars');
    if (starCanvas) {
      const sf = new LegendVisual.Starfield(starCanvas);
      sf.start();
    }

    // Rain (only medium/high tier)
    if (tier !== 'low') {
      const rainCanvas = document.getElementById('canvas-rain');
      if (rainCanvas) {
        const rain = new LegendVisual.Rain(rainCanvas);
        rain.start();
      }
    }

    // Eclipse
    const eclipseMount = document.getElementById('eclipse-mount');
    if (eclipseMount) {
      LegendVisual.createEclipse(eclipseMount);
    }

    // Ambient lighting
    LegendVisual.createAmbientLighting(document.getElementById('visual-bg'));
  }

  // ─── Bootstrap ────────────────────────────────────────────
  async function init() {
    initVisuals();
    initDropdowns();
    initSearch();
    initAuthButton();

    // ── Firebase Auth: persistent listener ─────────────────
    // listenAuthState() now returns a Promise that resolves only after the
    // first onAuthStateChanged callback fires — i.e. after Firebase has
    // confirmed whether a persisted session exists or not.
    // We await it here so the first renderPage() call always has the correct
    // auth state and never shows the wrong homepage view.
    if (window.AvenoraFirebase?.Auth) {
      await window.AvenoraFirebase.Auth.listenAuthState((user) => {
        updateNavAuthState(user);
        if (user) loadNotifications();
      });
    } else {
      // Legacy fallback: REST-based session restore
      if (LegendAPI.auth.isLoggedIn()) {
        try {
          const user = await LegendAPI.auth.me();
          updateNavAuthState(user);
          loadNotifications();
        } catch {
          LegendAPI.TokenStore.clear();
          updateNavAuthState(null);
        }
      }
      // Mark auth check done for the legacy path (no Firebase)
      LegendState.set('authLoading', false);
      // Signal api.js that auth state is known
      window.dispatchEvent(new CustomEvent('lu:auth-ready'));
    }

    // Keep nav in sync with state changes (covers all auth paths)
    LegendState.subscribe('user', (user) => {
      updateNavAuthState(user);
    });

    // Listen for logout events
    window.addEventListener('lu:logged-out', () => {
      updateNavAuthState(null);
      Toast.info('You have been signed out.');
    });

    // Service worker message handler — respond to GET_API_URL requests (used by
    // the background sync handler to know which API endpoint to use).
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data?.type === 'GET_API_URL' && event.ports?.[0]) {
        event.ports[0].postMessage({ apiUrl: window.LU_CONFIG?.apiUrl || null });
      }
      // SW_UPDATED is handled separately in index.html
    });

    // ── FCM push notifications ──────────────────────────────
    if (window.AvenoraFirebase?.Messaging) {
      window.AvenoraFirebase.Messaging.setup().catch(() => {});
      // Show foreground push as a Toast
      window.AvenoraFirebase.Messaging.onForegroundMessage((payload) => {
        const title = payload.notification?.title || 'AVENORA';
        const body  = payload.notification?.body  || '';
        Toast.info(`🔔 ${title}${body ? ': ' + body : ''}`);
      });
    }

    // ── Password-reset link handling ────────────────────────
    // Emails link to: #reset-password?token=<tok>&email=<email>
    // We intercept this before rendering the page, show the auth modal
    // with the reset form, and navigate to hub.
    const _hash = location.hash || '';
    if (_hash.startsWith('#reset-password')) {
      const _params = new URLSearchParams(_hash.replace('#reset-password', '').replace(/^\?/, ''));
      const _rstToken = _params.get('token');
      const _rstEmail = _params.get('email');
      if (_rstToken && _rstEmail) {
        // Navigate away from the reset-password hash before showing modal
        history.replaceState(null, '', location.pathname + '#hub');
        await renderPage('hub');
        // Show reset password form in the auth modal
        setTimeout(() => {
          Modal.open('auth-modal');
          switchAuthTab('login'); // ensure modal is visible
          const authModal = document.getElementById('auth-modal');
          if (authModal) {
            const resetSection = document.getElementById('forgot-form');
            if (resetSection) {
              // Swap forgot form for a reset form
              resetSection.innerHTML = `
                <h4 style="margin-bottom:12px;font-family:var(--font-display);letter-spacing:0.1em">SET NEW PASSWORD</h4>
                <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px">Enter a new password for <strong>${escapeHtml(decodeURIComponent(_rstEmail))}</strong>.</p>
                <div class="form-group">
                  <input type="password" id="reset-new-password" class="form-input" placeholder="New password (min 8 chars)" minlength="8" autocomplete="new-password">
                </div>
                <div id="reset-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-bottom:8px"></div>
                <div id="reset-success" class="hidden" style="color:var(--neon-green);font-size:0.85rem;margin-bottom:8px"></div>
                <button type="button" class="btn btn-primary w-full" id="reset-submit-btn"
                  onclick="handleResetPassword('${escapeHtml(_rstToken)}','${escapeHtml(decodeURIComponent(_rstEmail))}')">
                  RESET PASSWORD
                </button>
                <p style="margin-top:8px;font-size:0.82rem;text-align:center">
                  <a href="#" onclick="switchAuthTab('login');return false" style="color:var(--text-muted)">Back to Sign In</a>
                </p>`;
              switchAuthTab('forgot');
            }
          }
        }, 200);
        // Skip normal renderPage — hub was already rendered above
        // Set up hash change listener before returning
        window.addEventListener('hashchange', async () => {
          const newPage = getPageFromHash();
          if (newPage !== currentPage) {
            await renderPage(newPage);
            if (window.AvenoraFirebase?.Analytics) {
              window.AvenoraFirebase.Analytics.logPageView(newPage);
            }
          }
        });
        return; // do not fall through to the normal renderPage call
      }
    }

    // Initial route
    const page = getPageFromHash();
    await renderPage(page);

    // ── Analytics: track every page navigation ──────────────
    if (window.AvenoraFirebase?.Analytics) {
      window.AvenoraFirebase.Analytics.logPageView(page);
    }

    // Hash change routing
    window.addEventListener('hashchange', async () => {
      const newPage = getPageFromHash();
      if (newPage !== currentPage) {
        await renderPage(newPage);
        if (window.AvenoraFirebase?.Analytics) {
          window.AvenoraFirebase.Analytics.logPageView(newPage);
        }
      }
    });
  }

  // ─── Mini Radio Player (global persistent) ───────────────────
  // Shown when the user navigated away from the radio page while audio is playing.
  // Subscribes to the Firestore stationNowPlaying doc and shows/hides based on
  // whether there is an active audio element from the radio page.
  (function initMiniRadioPlayer() {
    let _miniUnsubscribe = null;
    let _miniVisible = false;

    function _updateMiniTrack(title, artist) {
      const el = document.getElementById('radio-mini-track');
      if (el) el.textContent = artist ? `${title} • ${artist}` : title;
    }

    function _showMini(show) {
      const el = document.getElementById('radio-mini-player');
      if (!el) return;
      _miniVisible = show;
      el.classList.toggle('hidden', !show);
    }

    function _syncMiniPlayBtn() {
      const audio = document.getElementById('radio-audio');
      const btn   = document.getElementById('radio-mini-play');
      if (btn) btn.textContent = (audio && !audio.paused) ? '⏸' : '▶';
    }

    // Listen to the Firestore doc for now-playing updates (modular SDK)
    async function _subscribeMini() {
      try {
        const { getFirestore } = window.AvenoraFirebase || {};
        if (!getFirestore) return;
        const db = await getFirestore();
        const { doc, onSnapshot } = await import(
          'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
        );
        _miniUnsubscribe = onSnapshot(
          doc(db, 'stationNowPlaying', 'avenoraRadio'),
          (snap) => {
            if (!snap.exists()) return;
            const d = snap.data();
            if (d.status === 'playing' && d.currentTitle) {
              _updateMiniTrack(d.currentTitle, d.currentArtist || '');
            }
          },
          () => {}
        );
      } catch {}
    }

    // Show the mini player whenever user navigates away from the radio page
    // but audio is still loaded/playing.
    window.addEventListener('hashchange', () => {
      const page    = (location.hash.replace('#', '') || 'hub').split('/')[0];
      const audio   = document.getElementById('radio-audio');
      const hasAudio = audio && audio.src && !audio.ended;

      if (page !== 'radio' && hasAudio) {
        _showMini(true);
        _syncMiniPlayBtn();
        if (!_miniUnsubscribe) _subscribeMini();
      } else {
        _showMini(false);
      }
    });

    // Global mini player controls (referenced in index.html)
    window.radioMiniTogglePlay = function () {
      const audio = document.getElementById('radio-audio');
      if (!audio || !audio.src) { navigateTo('radio'); return; }
      if (audio.paused) { audio.play().catch(() => {}); }
      else              { audio.pause(); }
      _syncMiniPlayBtn();
    };

    window.radioMiniClose = function () {
      const audio = document.getElementById('radio-audio');
      if (audio) { audio.pause(); audio.src = ''; }
      _showMini(false);
      if (_miniUnsubscribe) { _miniUnsubscribe(); _miniUnsubscribe = null; }
    };
  })();

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
