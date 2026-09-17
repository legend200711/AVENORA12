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
          ></iframe>
        </div>
      </div>
    `;

    // ── Auth + config bridge to the cloud-stream iframe ─────────────────────
    //
    // The iframe has an isolated window so it cannot access window.LU_CONFIG
    // or the parent's Firebase Auth instance.  We bridge both via postMessage.
    //
    // Problem this solves:
    //   Firebase browserLocalPersistence writes auth state to localStorage.
    //   The iframe shares the same localStorage (same origin) so it WILL
    //   resolve auth automatically — but it is async.  On slow/cold loads
    //   the iframe's onAuthStateChanged fires null first, and a naive timeout
    //   shows the auth gate before persistence hydration finishes.
    //
    //   The previous code used loading="lazy" which means the iframe only
    //   starts loading when it enters the viewport.  The parent sent the
    //   postMessage on the iframe's load event, but with lazy loading the
    //   load event fires late — sometimes after the 6s gate timer already
    //   expired inside the iframe.  The messages arrived too late and were
    //   effectively missed.
    //
    // Solution:
    //   1. Remove loading="lazy" — iframe loads immediately so the load
    //      event fires promptly and messages arrive before the gate timer.
    //   2. Send both AVN_CONFIG and AVN_AUTH_TOKEN on the iframe's load event.
    //   3. Retry sending AVN_AUTH_TOKEN every 500 ms for up to 8 s so that
    //      token refresh races are covered and the iframe always gets the
    //      message even if it initialises slowly.
    //   4. Stop retrying once the iframe acknowledges (AVN_AUTH_ACK).
    //
    const frame = document.getElementById('csr-frame');
    if (frame) {
      let _retryTimer = null;
      let _ackReceived = false;

      // Listen for acknowledgement from the iframe so we can stop retrying.
      const _ackHandler = (evt) => {
        if (evt.data && evt.data.type === 'AVN_AUTH_ACK') {
          _ackReceived = true;
          if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
          window.removeEventListener('message', _ackHandler);
        }
      };
      window.addEventListener('message', _ackHandler);

      const _sendBoth = async () => {
        try {
          if (!frame.contentWindow) return;
          // 1. Runtime config
          if (window.LU_CONFIG) {
            frame.contentWindow.postMessage(
              { type: 'AVN_CONFIG', apiUrl: window.LU_CONFIG.apiUrl || '', socketUrl: window.LU_CONFIG.socketUrl || '' },
              '*'
            );
          }
          // 2. Auth token
          if (window.AvenoraFirebase && window.AvenoraFirebase.Auth) {
            const token = await window.AvenoraFirebase.Auth.getIdToken();
            const user  = window.AvenoraFirebase.Auth.getUser();
            if (token && user) {
              frame.contentWindow.postMessage(
                { type: 'AVN_AUTH_TOKEN', idToken: token, uid: user.uid || user.id },
                '*'
              );
            }
          }
        } catch (_) {}
      };

      frame.addEventListener('load', () => {
        _sendBoth();
        // Retry every 500 ms for up to 8 s in case the iframe SDK is slow to init.
        let _retryCount = 0;
        _retryTimer = setInterval(() => {
          if (_ackReceived || _retryCount >= 16) {
            clearInterval(_retryTimer);
            _retryTimer = null;
            return;
          }
          _retryCount++;
          _sendBoth();
        }, 500);
      });
    }

    return () => {};
  }
});
