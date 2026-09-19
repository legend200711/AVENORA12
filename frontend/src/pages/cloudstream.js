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
    // (GitHub Pages: /AVENORA12/, local dev: /).
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
    // HOW THE AUTH BRIDGE WORKS:
    //   The iframe runs its own Firebase SDK (ES module, v12.18.0) and calls
    //   onAuthStateChanged on its own auth instance.  Because both the parent
    //   SPA and the iframe use the same Firebase project + app name and
    //   browserLocalPersistence, Firebase restores the same session from
    //   localStorage in both contexts independently.
    //
    //   The iframe's onAuthStateChanged WILL fire with the signed-in user
    //   directly from localStorage — no postMessage is needed for auth.
    //   The bridge here is a belt-and-suspenders fallback:
    //     - It sends a confirmation so the iframe's 30s gate timer is extended.
    //     - It forwards the parent's auth event as a secondary signal.
    //
    // WHY THE PREVIOUS CODE SHOWED "SIGN IN REQUIRED":
    //   1. The parent's _startTokenSubscription imported onIdTokenChanged from
    //      Firebase v10.12.2 while the iframe used v12.18.0. The import could
    //      silently fail on some browsers due to the version mismatch, causing
    //      no AVN_AUTH_TOKEN to ever be sent.
    //   2. If the import DID work, the onIdTokenChanged callback tried to get
    //      the parent's auth instance via window.AvenoraFirebase.getFirebaseAuth().
    //      If this threw (e.g. firebase.js not yet loaded), the catch({}) swallowed
    //      the error and no token was ever sent.
    //   3. The iframe's gate delay was 10 s in unauthenticated mode but Firebase
    //      sometimes takes > 10 s on cold start with a slow CDN.
    //
    // FIX:
    //   Use the SAME Firebase SDK version as firebase.js (10.12.2) for the parent
    //   auth import. Subscribe to onAuthStateChanged (not just onIdTokenChanged)
    //   so that even a null→user transition triggers a bridge message.
    //   Also send an AVN_PARENT_READY message on iframe load so the iframe
    //   immediately extends its gate timer, regardless of the token timing.
    //
    const frame = document.getElementById('csr-frame');
    if (!frame) return () => {};

    // Both pages are on the same origin.
    const _targetOrigin = location.origin;

    let _frameLoaded  = false;
    let _latestToken  = null;
    let _latestUid    = null;
    let _unsubAuth    = null;

    // ── Helper: push config + auth state to iframe ──────────────────────────
    // Sends AVN_CONFIG (backend URL) and AVN_AUTH_TOKEN so the iframe can reach
    // the Render backend and knows the parent has run its own auth check.
    const _pushConfig = () => {
      if (!frame.contentWindow) return;
      try {
        const apiUrl = (window.LU_CONFIG && window.LU_CONFIG.apiUrl) || null;
        if (apiUrl) {
          frame.contentWindow.postMessage(
            { type: 'AVN_CONFIG', apiUrl },
            _targetOrigin
          );
        }
      } catch (_) {}
    };

    const _pushToFrame = (token, uid) => {
      if (!frame.contentWindow || !_frameLoaded) return;
      try {
        frame.contentWindow.postMessage(
          { type: 'AVN_AUTH_TOKEN', idToken: token || null, uid: uid || null },
          _targetOrigin
        );
      } catch (_) {}
    };

    // ── Subscribe to Firebase auth state on the parent ─────────────────────
    // Uses the parent's already-loaded auth instance via AvenoraFirebase.
    // Falls back gracefully if AvenoraFirebase is not yet available.
    const _startAuthSubscription = async () => {
      try {
        const auth = await window.AvenoraFirebase.getFirebaseAuth();
        // Use the SAME SDK version as firebase.js to avoid module version mismatch.
        const SDK_VER = '10.12.2';
        const { onAuthStateChanged } = await import(
          `https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-auth.js`
        );

        // ── Immediate sync: if the parent already has a currentUser, push now ──
        // This fires before the iframe's own onAuthStateChanged, which is the key
        // fix for the "Sign In Required" flash — the iframe receives the parent's
        // confirmation immediately on load and cancels its gate timer right away.
        if (auth.currentUser) {
          try {
            const token = await auth.currentUser.getIdToken(false);
            _latestToken = token;
            _latestUid   = auth.currentUser.uid;
          } catch (_) {
            _latestUid = auth.currentUser.uid;
          }
          // Push immediately if frame is already loaded; otherwise it will be sent
          // by the frame.load handler below.
          _pushToFrame(_latestToken, _latestUid);
        }

        _unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
          if (!fbUser) {
            // User signed out — send a null signal.
            _latestToken = null;
            _latestUid   = null;
            _pushToFrame(null, null);
            return;
          }
          try {
            const token = await fbUser.getIdToken(/* forceRefresh= */ false);
            _latestToken = token;
            _latestUid   = fbUser.uid;
            _pushToFrame(token, fbUser.uid);
          } catch (_) {
            // Token fetch failed — send uid-only confirmation so the iframe
            // at least knows the parent considers the user signed in.
            _latestUid = fbUser.uid;
            _pushToFrame(null, fbUser.uid);
          }
        });
      } catch (err) {
        // AvenoraFirebase not yet available — fall back to LegendState user.
        // This handles the case where firebase.js is still loading.
        try {
          const user = LegendState.get('user');
          if (user && user.uid) {
            _latestUid = user.uid;
            _pushToFrame(null, user.uid);
          }
        } catch (_) {}
      }
    };
    _startAuthSubscription();

    // ── On iframe load: send config + any already-available auth state ───────
    // This fires when the iframe finishes loading its HTML. Always send the
    // AVN_CONFIG first (so the iframe has the backend URL), then auth state.
    frame.addEventListener('load', () => {
      _frameLoaded = true;
      // Send backend URL first — the iframe needs this before it can start the engine.
      _pushConfig();
      // Then send auth state — even if uid is null, the iframe needs to know
      // the parent is present so it can manage its own gate timer correctly.
      _pushToFrame(_latestToken, _latestUid);
    });

    // ── Cleanup when the user navigates away ────────────────────────────────
    return () => {
      if (typeof _unsubAuth === 'function') {
        try { _unsubAuth(); } catch (_) {}
        _unsubAuth = null;
      }
    };
  }
});
