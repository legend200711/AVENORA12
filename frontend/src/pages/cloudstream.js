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
    // ROOT CAUSE OF THE AUTH LOOP:
    //   The old code called AvenoraFirebase.Auth.getIdToken() on every retry.
    //   getIdToken() returns null if the parent's own Firebase Auth hasn't
    //   hydrated from localStorage yet.  If the parent auth takes > 500 ms
    //   (cold page load, slow CDN) the first several retries all produce null
    //   tokens, so no AVN_AUTH_TOKEN message is ever sent.  The iframe's own
    //   10 s gate timer then expires and shows "Sign In Required".
    //
    // FIX:
    //   Subscribe to Firebase's onIdTokenChanged on the parent.  This callback
    //   fires exactly once when auth hydration completes (with the signed-in
    //   user's current ID token) and again on every token refresh.  We use
    //   this as the canonical token source instead of polling getIdToken().
    //
    //   Token-forwarding order:
    //     1. onIdTokenChanged fires → parent pushes token to iframe immediately.
    //     2. If iframe is not loaded yet, the token is cached and sent on load.
    //     3. On every subsequent token refresh, the new token is forwarded.
    //     4. The iframe ACKs receipt → parent stops forwarding until next refresh.
    //
    //   Security:
    //     postMessage uses the iframe's exact same-origin URL as targetOrigin
    //     instead of '*' so the message is only delivered to the correct frame.
    //
    const frame = document.getElementById('csr-frame');
    if (!frame) return () => {};

    // Determine the safe targetOrigin for postMessage.
    // Both pages are on the same origin, so we use location.origin.
    const _targetOrigin = location.origin;

    let _frameLoaded     = false;
    let _latestToken     = null;  // most recent ID token from onIdTokenChanged
    let _latestUid       = null;  // UID matching _latestToken
    let _ackReceived     = false;
    let _unsubIdToken    = null;  // Firebase onIdTokenChanged unsubscribe fn

    // ── Helper: send config + auth token to iframe (fire-and-forget) ────────
    const _pushToFrame = (token, uid) => {
      if (!frame.contentWindow || !_frameLoaded) return;
      try {
        // 1. Runtime config (idempotent — iframe ignores dupes)
        if (window.LU_CONFIG) {
          frame.contentWindow.postMessage(
            { type: 'AVN_CONFIG', apiUrl: window.LU_CONFIG.apiUrl || '', socketUrl: window.LU_CONFIG.socketUrl || '' },
            _targetOrigin
          );
        }
        // 2. Auth token — only if we have one
        if (token && uid) {
          frame.contentWindow.postMessage(
            { type: 'AVN_AUTH_TOKEN', idToken: token, uid },
            _targetOrigin
          );
        }
      } catch (_) {}
    };

    // ── Listen for ACK from iframe ───────────────────────────────────────────
    const _ackHandler = (evt) => {
      // Only accept messages from our iframe (same origin)
      if (!evt.data || evt.data.type !== 'AVN_AUTH_ACK') return;
      if (evt.source !== frame.contentWindow) return;
      _ackReceived = true;
      window.removeEventListener('message', _ackHandler);
    };
    window.addEventListener('message', _ackHandler);

    // ── Subscribe to Firebase token changes on the parent ───────────────────
    // onIdTokenChanged fires immediately with the current user (or null) once
    // Firebase resolves auth from localStorage, and again on every token refresh.
    const _startTokenSubscription = async () => {
      try {
        const auth = await window.AvenoraFirebase.getFirebaseAuth();
        const { onIdTokenChanged } = await import(
          `https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js`
        );
        _unsubIdToken = onIdTokenChanged(auth, async (fbUser) => {
          if (!fbUser) return; // user is signed out — do nothing
          try {
            const token = await fbUser.getIdToken();
            _latestToken = token;
            _latestUid   = fbUser.uid;
            // Push to iframe immediately (if loaded); reset ACK so refresh
            // is forwarded even after a previous successful handshake.
            _ackReceived = false;
            window.addEventListener('message', _ackHandler);  // re-register (idempotent)
            _pushToFrame(token, fbUser.uid);
          } catch (_) {}
        });
      } catch (_) {}
    };
    _startTokenSubscription();

    // ── On iframe load: send config + any already-available token ───────────
    frame.addEventListener('load', () => {
      _frameLoaded = true;
      // Always send config first
      if (window.LU_CONFIG && frame.contentWindow) {
        try {
          frame.contentWindow.postMessage(
            { type: 'AVN_CONFIG', apiUrl: window.LU_CONFIG.apiUrl || '', socketUrl: window.LU_CONFIG.socketUrl || '' },
            _targetOrigin
          );
        } catch (_) {}
      }
      // If we already have a token from onIdTokenChanged, send it now.
      // If not, onIdTokenChanged will fire shortly and push it.
      if (_latestToken && _latestUid) {
        _pushToFrame(_latestToken, _latestUid);
      }
    });

    // ── Cleanup when the user navigates away ────────────────────────────────
    return () => {
      if (typeof _unsubIdToken === 'function') {
        try { _unsubIdToken(); } catch (_) {}
        _unsubIdToken = null;
      }
      window.removeEventListener('message', _ackHandler);
    };
  }
});
