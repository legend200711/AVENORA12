/**
 * SETTINGS PAGE
 * Account settings, preferences, PWA install, notifications
 */

registerPage('settings', {
  async render(container) {
    const user = LegendAPI.auth.getUser();

    container.innerHTML = `
      <div style="max-width:700px;margin:0 auto;padding:var(--space-lg)">
        <div class="page-header" style="padding-top:var(--space-xl);padding-bottom:var(--space-lg)">
          <h1 style="font-family:var(--font-display);letter-spacing:0.1em">
            <span style="color:var(--neon-blue)">SETTINGS</span>
          </h1>
          <p class="tagline">ACCOUNT & PREFERENCES</p>
        </div>

        ${!user ? `
          <div class="card" style="text-align:center;padding:var(--space-2xl)">
            <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Sign in to access your settings.</p>
            <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
          </div>
        ` : `

          <!-- Account section -->
          <div class="card" style="margin-bottom:var(--space-lg)">
            <h3 style="font-family:var(--font-display);color:var(--neon-blue);letter-spacing:0.08em;margin-bottom:var(--space-md)">ACCOUNT</h3>
            <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg)">
              ${avatarHtml(user, 'lg')}
              <div>
                <p style="font-weight:700;font-size:1.1rem">${escapeHtml(user.profile?.displayName || user.username)}</p>
                <p style="color:var(--text-muted)">@${escapeHtml(user.username)}</p>
                ${roleBadgeHtml(user.role)}
              </div>
            </div>
            <button class="btn btn-outline" onclick="navigateTo('profile')">View Profile</button>
            <button class="btn btn-ghost" onclick="editProfile()" style="margin-left:8px">Edit Profile</button>
          </div>

          <!-- Customize Avenora — prominent entry point -->
          <div class="card" style="margin-bottom:var(--space-lg);border-color:rgba(184,149,75,0.25)">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-md)">
              <div>
                <h3 style="font-family:var(--font-display);color:var(--neon-blue);letter-spacing:0.08em;margin-bottom:var(--space-sm)">CUSTOMIZE AVENORA</h3>
                <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:var(--space-md);max-width:480px">
                  Personalize how Avenora looks and behaves — choose which cards appear on your home page,
                  adjust notification preferences, pick your theme and accent colour, and more.
                </p>
              </div>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--avenora-gold)" stroke-width="1.6"
                   style="flex-shrink:0;margin-top:2px" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </div>
            <a href="#customize" class="btn btn-primary">Open Customize Avenora →</a>
          </div>

          <!-- App Preferences -->
          <div class="card" style="margin-bottom:var(--space-lg)">
            <h3 style="font-family:var(--font-display);color:var(--neon-blue);letter-spacing:0.08em;margin-bottom:var(--space-md)">APP PREFERENCES</h3>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-md) 0;border-bottom:1px solid var(--border-subtle)">
              <div>
                <p style="font-weight:600">Animations & Effects</p>
                <p style="font-size:0.85rem;color:var(--text-muted)">Stars, rain, eclipse visuals. Respects prefers-reduced-motion.</p>
              </div>
              <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer">
                <input type="checkbox" id="setting-animations" style="opacity:0;width:0;height:0"
                  ${!LegendVisual?.prefersReducedMotion ? 'checked' : ''}
                  onchange="settingToggleAnimations(this.checked)">
                <span id="anim-toggle-track" style="position:absolute;inset:0;background:${!LegendVisual?.prefersReducedMotion ? 'var(--neon-blue)' : 'var(--bg-elevated)'};border-radius:12px;transition:background 200ms"></span>
                <span id="anim-toggle-thumb" style="position:absolute;top:3px;left:${!LegendVisual?.prefersReducedMotion ? '23px' : '3px'};width:18px;height:18px;background:#fff;border-radius:50%;transition:left 200ms"></span>
              </label>
            </div>
          </div>

          <!-- PWA Install -->
          <div class="card" style="margin-bottom:var(--space-lg)" id="pwa-settings-card">
            <h3 style="font-family:var(--font-display);color:var(--neon-green);letter-spacing:0.08em;margin-bottom:var(--space-md)">INSTALL APP</h3>
            <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Install Avenora as a native app on your device for offline access and a full-screen experience.</p>
            <div id="pwa-install-status"></div>
          </div>

          <!-- Danger zone -->
          <div class="card" style="border-color:rgba(255,50,70,0.2)">
            <h3 style="font-family:var(--font-display);color:var(--neon-red);letter-spacing:0.08em;margin-bottom:var(--space-md)">SIGN OUT</h3>
            <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">You will be signed out of Avenora on this device.</p>
            <button class="btn btn-danger" onclick="handleLogout()">Sign Out</button>
          </div>

          <!-- Account deletion -->
          <div class="card" style="border-color:rgba(255,50,70,0.15);margin-top:var(--space-lg)">
            <h3 style="font-family:var(--font-display);color:var(--neon-red);letter-spacing:0.08em;margin-bottom:var(--space-md)">DELETE ACCOUNT</h3>
            <p style="color:var(--text-secondary);margin-bottom:var(--space-md);font-size:0.9rem">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button class="btn btn-ghost" style="border-color:rgba(255,50,70,0.3);color:var(--neon-red)" onclick="confirmDeleteAccount()">
              Delete My Account
            </button>
          </div>
        `}
      </div>
    `;

    if (user) {
      initPWAInstall();
    }

    return () => {};
  }
});

function initPWAInstall() {
  const statusEl = document.getElementById('pwa-install-status');
  if (!statusEl) return;

  // Check if already installed (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--neon-green)"><span>✓</span><span>App is already installed.</span></div>`;
    return;
  }

  // Use stored install prompt if available
  if (window._pwaInstallPrompt) {
    statusEl.innerHTML = `
      <button class="btn btn-green" onclick="triggerPWAInstall()">📲 Install on this Device</button>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">Click above then follow your browser's prompt.</p>
    `;
  } else {
    statusEl.innerHTML = `
      <p style="color:var(--text-muted);font-size:0.9rem">
        To install: use your browser's <strong>Add to Home Screen</strong> or <strong>Install App</strong> option in the address bar or share menu.
      </p>
    `;
  }
}

window.triggerPWAInstall = async function () {
  const prompt = window._pwaInstallPrompt;
  if (!prompt) return;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') {
    Toast.success('Avenora installed! 🌅');
    window._pwaInstallPrompt = null;
    initPWAInstall();
  }
};

window.editProfile = function () {
  if (typeof SNProfile !== 'undefined' && SNProfile.openEdit) {
    SNProfile.openEdit();
  } else {
    navigateTo('profile');
  }
};

window.confirmDeleteAccount = function () {
  Modal.create({
    id: 'delete-account-modal',
    title: '⚠️ Delete Account',
    body: `
      <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">
        This will permanently delete your account, posts, and all associated data.
        <strong style="color:var(--neon-red)">This cannot be undone.</strong>
      </p>
      <div class="form-group">
        <label class="form-label">Type your username to confirm</label>
        <input class="form-input" id="delete-confirm-username" placeholder="${escapeHtml(LegendAPI.auth.getUser()?.username || '')}">
      </div>
      <div id="delete-account-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem"></div>
    `,
    actions: [
      { label: 'Cancel', class: 'btn-ghost', onclick: "Modal.close('delete-account-modal')" },
      { label: 'DELETE MY ACCOUNT', class: 'btn-danger', onclick: 'executeDeleteAccount()' },
    ],
  });
  Modal.open('delete-account-modal');
};

window.executeDeleteAccount = async function () {
  const user = LegendAPI.auth.getUser();
  const input = document.getElementById('delete-confirm-username')?.value?.trim();
  const errEl = document.getElementById('delete-account-error');

  if (input !== user?.username) {
    if (errEl) { errEl.textContent = 'Username does not match.'; errEl.classList.remove('hidden'); }
    return;
  }

  try {
    // For Firebase-authenticated accounts: delete via Firebase Auth then call backend
    const fbUser = window.AvenoraFirebase?.Auth?.getUser?.();
    if (fbUser) {
      // Delete application data via backend first (best effort)
      try {
        await LegendAPI.request('DELETE', '/users/me/account');
      } catch (backendErr) {
        // 422 means Firebase-only account — backend can't delete the Firebase auth record,
        // but we can still delete the Firebase account below.
        if (backendErr.status !== 422) {
          console.warn('[AVN] Backend account deletion error:', backendErr.message);
        }
      }
      // Delete the Firebase Authentication account
      const { getAuth, deleteUser } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      const auth = getAuth();
      if (auth.currentUser) {
        await deleteUser(auth.currentUser);
      }
    } else {
      // MongoDB-only account
      await LegendAPI.request('DELETE', '/users/me/account');
    }

    Modal.close('delete-account-modal');
    // Sign out and clear local state
    try { await LegendAPI.auth.logout(); } catch {}
    Toast.info('Your account has been permanently deleted.');
    navigateTo('hub');
  } catch (err) {
    console.warn('[AVN] Account delete error:', err);
    // Firebase "requires-recent-login" means user must re-authenticate first
    const msg = (err.code === 'auth/requires-recent-login')
      ? 'Please sign out and sign back in, then try deleting your account again.'
      : 'Account deletion failed. Please try again or contact support.';
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
  }
};

window.settingToggleAnimations = function (enabled) {
  const track = document.getElementById('anim-toggle-track');
  const thumb = document.getElementById('anim-toggle-thumb');
  if (track) track.style.background = enabled ? 'var(--neon-blue)' : 'var(--bg-elevated)';
  if (thumb) thumb.style.left = enabled ? '23px' : '3px';
  LS.set('lu_animations_disabled', !enabled);
  Toast.info(enabled ? 'Animations enabled' : 'Animations disabled — reload to apply');
};
