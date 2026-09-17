/**
 * AVENORA — Avenora 24-Hour Cloud Stream (SPA page)
 *
 * Renders entirely inside the main SPA — no standalone HTML redirects.
 *
 * The Cloud Stream interface is a complex ES module app (importmap + type=module
 * scripts, audio Web APIs, Firebase Firestore auth).  It is embedded here as
 * an <iframe> pointing to cloud-stream/index.html which is deployed alongside
 * the main app under frontend/cloud-stream/.
 *
 * This avoids rewriting ~1 500 lines of ES module code while still keeping
 * the feature inside the single-page entry point with no external redirects.
 */

registerPage('cloudstream', {
  async render(container) {
    // Derive the base path so the iframe resolves correctly on any host
    // (GitHub Pages: /AVENORA1/, local dev: /).
    const basePath = (window.AVENORA_BUILD && window.AVENORA_BUILD.basePath) || '/';
    // Build the src without escapeHtml — the path only contains safe URL characters.
    const src = basePath.replace(/\/$/, '') + '/cloud-stream/index.html';

    container.innerHTML = `
      <div style="padding:var(--space-lg)">
        <div class="page-header" style="padding-top:var(--space-xl);padding-bottom:var(--space-md)">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:var(--space-md)">
            <div>
              <h1 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:4px">
                <span style="color:var(--neon-green)">AVENORA</span> 24-HOUR CLOUD STREAM
              </h1>
              <p class="tagline">24-HOUR ALWAYS-ON CHANNEL</p>
            </div>
            <button class="btn btn-primary btn-sm" onclick="navigateTo('cloudstudio')"
                    title="Manage playlists and upload music for your broadcast">
              🎛 Creator Studio
            </button>
          </div>
        </div>

        <div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid var(--border-subtle);background:#060810">
          <iframe
            id="csr-frame"
            src="${src}"
            style="width:100%;height:calc(100svh - 130px);min-height:600px;border:none;display:block"
            allow="camera; microphone; autoplay; clipboard-write"
            title="Avenora 24-Hour Cloud Stream"
            loading="lazy"
          ></iframe>
        </div>
      </div>
    `;

    // After the iframe loads, forward two things to the cloud-stream iframe:
    //   1. AVN_CONFIG  — the runtime API URL (window.LU_CONFIG) so the iframe
    //                    can reach the AVENORA backend (its own window.LU_CONFIG
    //                    is undefined because iframes have an isolated window).
    //   2. AVN_AUTH_TOKEN — the current Firebase ID token so the iframe can
    //                    confirm the user is already signed in before its own
    //                    onAuthStateChanged fires (eliminates auth-gate flash).
    const frame = document.getElementById('csr-frame');
    if (frame) {
      const sendConfig = () => {
        try {
          if (frame.contentWindow && window.LU_CONFIG) {
            frame.contentWindow.postMessage(
              { type: 'AVN_CONFIG', apiUrl: window.LU_CONFIG.apiUrl || '', socketUrl: window.LU_CONFIG.socketUrl || '' },
              '*'
            );
          }
        } catch (_) {}
      };

      const sendToken = async () => {
        try {
          if (window.AvenoraFirebase && window.AvenoraFirebase.Auth) {
            const token = await window.AvenoraFirebase.Auth.getIdToken();
            const user  = window.AvenoraFirebase.Auth.getUser();
            if (token && user && frame.contentWindow) {
              frame.contentWindow.postMessage(
                { type: 'AVN_AUTH_TOKEN', idToken: token, uid: user.uid || user.id },
                '*'
              );
            }
          }
        } catch (_) {}
      };

      frame.addEventListener('load', () => {
        sendConfig();
        sendToken();
      });
    }

    return () => {};
  }
});
