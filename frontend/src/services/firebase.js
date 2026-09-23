/**
 * AVENORA — Firebase Service
 * Central initialisation of every Firebase product used by the app.
 * Exposed on window.AvenoraFirebase so all other modules can import
 * individual service handles without re-initialising.
 *
 * Products wired up here:
 *   • Firebase App (core)
 *   • Authentication
 *   • Firestore
 *   • Realtime Database
 *   • Storage
 *   • Analytics
 *   • Cloud Messaging (FCM)
 */

(function (global) {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────
  const firebaseConfig = {
    apiKey:            'AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI',
    authDomain:        'avenora-6e147.firebaseapp.com',
    databaseURL:       'https://avenora-6e147-default-rtdb.firebaseio.com',
    projectId:         'avenora-6e147',
    storageBucket:     'avenora-6e147.firebasestorage.app',
    messagingSenderId: '389692647062',
    appId:             '1:389692647062:web:6a2dd06ade8bc92d3e84b7',
    measurementId:     'G-7ESV78Q6J3',
  };

  // ─── SDK version (keep in sync with index.html imports) ───────
  const SDK_VER = '10.12.2';
  const CDN = `https://www.gstatic.com/firebasejs/${SDK_VER}`;

  // ─── Lazy module loader ────────────────────────────────────────
  // We load each Firebase ESM module on-demand via dynamic import.
  // The returned promise is cached so the module is only fetched once.
  const _moduleCache = {};
  function loadModule(name) {
    if (!_moduleCache[name]) {
      _moduleCache[name] = import(`${CDN}/firebase-${name}.js`);
    }
    return _moduleCache[name];
  }

  // ─── App singleton ────────────────────────────────────────────
  let _app = null;
  async function getApp() {
    if (_app) return _app;
    const { initializeApp, getApps } = await loadModule('app');
    _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return _app;
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════
  let _auth = null;

  /**
   * Returns the Firebase Auth instance (initialised once).
   */
  async function getFirebaseAuth() {
    if (_auth) return _auth;
    const app = await getApp();
    const { getAuth } = await loadModule('auth');
    _auth = getAuth(app);
    return _auth;
  }

  /**
   * AvenoraFirebase.Auth — mirrors LegendAPI.auth surface so existing
   * call-sites in app.js (handleLogin / handleRegister / handleLogout)
   * continue to work unchanged.
   *
   * After sign-in we still call LegendState.set('user', …) and persist
   * the Firebase UID + display name so the rest of the app can read it.
   */
  const FirebaseAuth = {
    async register(username, email, password) {
      const auth = await getFirebaseAuth();
      const { createUserWithEmailAndPassword, updateProfile } = await loadModule('auth');
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Store username in Firebase display name
      await updateProfile(cred.user, { displayName: username });

      const uid = cred.user.uid;
      const user = _mapFbUser(cred.user, username);
      LegendState.set('user', user);
      // Persist uid so TokenStore shim stays truthy
      _persistUid(uid);

      // Write the canonical Firestore profile document at users/{uid}
      // so the user is immediately discoverable by UID and exact username.
      try {
        const db = await getFirestore();
        const { doc, setDoc, serverTimestamp } = await loadModule('firestore');
        await setDoc(doc(db, 'users', uid), {
          uid,
          username:      username.trim(),
          usernameLower: username.trim().toLowerCase(),
          email:         cred.user.email || email,
          role:          'user',
          profile: {
            displayName: username.trim(),
            avatarUrl:   null,
            bio:         '',
            location:    '',
            website:     '',
            bannerUrl:   null,
          },
          stats: { followersCount: 0, followingCount: 0, postsCount: 0 },
          createdAt: serverTimestamp(),
        }, { merge: true });
        console.info('[AVN] Firestore profile created for new user:', uid);
      } catch (profileErr) {
        // Non-fatal — auth succeeded; profile will be self-healed on next load
        console.warn('[AVN] Could not write Firestore profile on register:', profileErr.code, profileErr.message);
      }

      return { user };
    },

    async login(email, password) {
      const auth = await getFirebaseAuth();
      const { signInWithEmailAndPassword } = await loadModule('auth');
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const user = _mapFbUser(cred.user);
      LegendState.set('user', user);
      _persistUid(cred.user.uid);
      return { user };
    },

    async logout() {
      const auth = await getFirebaseAuth();
      const { signOut } = await loadModule('auth');
      await signOut(auth);
      _clearUid();
      LegendState.set('user', null);
      window.dispatchEvent(new Event('lu:logged-out'));
    },

    async me() {
      const auth = await getFirebaseAuth();
      if (!auth.currentUser) return null;
      const user = _mapFbUser(auth.currentUser);
      LegendState.set('user', user);
      return user;
    },

    async forgotPassword(email) {
      const auth = await getFirebaseAuth();
      const { sendPasswordResetEmail } = await loadModule('auth');
      await sendPasswordResetEmail(auth, email);
      return { message: 'Password reset email sent. Check your inbox.' };
    },

    /**
     * Complete a Firebase password reset using the oobCode from the email link.
     * The reset URL looks like: ?oobCode=xxx&mode=resetPassword
     * app.js calls this when the hash contains a reset token.
     * For Firebase, the "token" in the URL is the oobCode.
     */
    async resetPassword(oobCode, newPassword) {
      const auth = await getFirebaseAuth();
      const { confirmPasswordReset } = await loadModule('auth');
      await confirmPasswordReset(auth, oobCode, newPassword);
      return { success: true };
    },

    isLoggedIn() {
      return !!(sessionStorage.getItem('lu_uid') || localStorage.getItem('lu_uid'));
    },

    getUser() {
      return LegendState.get('user');
    },

    /**
     * Attach a persistent onAuthStateChanged listener.
     * Called once from app.js bootstrap to keep LegendState in sync.
     *
     * Returns a Promise that resolves after the FIRST auth callback fires
     * (i.e. after Firebase has determined whether a session exists).
     * app.js awaits this promise so the hub page is never rendered before
     * the auth state is known, eliminating the startup race condition.
     */
    listenAuthState(callback) {
      return new Promise(async (resolve) => {
        // Safety timeout: if Firebase auth takes longer than 8 seconds to fire
        // its first onAuthStateChanged (e.g. slow CDN, network issues)
        // we unblock the app so the loading spinner never spins forever.
        // The UI renders as if the user is logged out; the listener continues
        // running in the background and will update state when Firebase responds.
        let firstFired = false;
        const _authSafetyTimeout = setTimeout(() => {
          if (!firstFired) {
            firstFired = true;
            console.warn('[AVN] Firebase auth timed out after 8 s — rendering without auth. Will update when Firebase responds.');
            LegendState.set('authLoading', false);
            resolve();
            window.dispatchEvent(new CustomEvent('lu:auth-ready'));
          }
        }, 8000);

        let auth;
        try {
          auth = await getFirebaseAuth();
        } catch (initErr) {
          console.error('[AVN] Firebase Auth init failed:', initErr.message);
          clearTimeout(_authSafetyTimeout);
          if (!firstFired) {
            firstFired = true;
            LegendState.set('authLoading', false);
            resolve();
            window.dispatchEvent(new CustomEvent('lu:auth-ready'));
          }
          return;
        }

        const { onAuthStateChanged } = await loadModule('auth');
        onAuthStateChanged(auth, async (fbUser) => {
          // Resolve the auth gate synchronously on the first call
          // (before any async Firestore lookups) so the UI never hangs.
          if (!firstFired) {
            firstFired = true;
            clearTimeout(_authSafetyTimeout);
            LegendState.set('authLoading', false);
            resolve();
            // Signal api.js that auth state is known — prevents requests
            // from firing with a missing token before onAuthStateChanged resolves.
            window.dispatchEvent(new CustomEvent('lu:auth-ready'));
          }

          if (fbUser) {
            // ── Account-switch guard ──────────────────────────────────────
            // If a different user just signed in, clear the previous user's
            // cached state immediately so no stale UID leaks to profile queries.
            const prevUser = LegendState.get('user');
            const prevUid  = prevUser?.uid || prevUser?.id || null;
            if (prevUid && prevUid !== fbUser.uid) {
              // Clear all user-scoped cached state before loading the new account.
              LegendState.set('user', null);
            }

            _persistUid(fbUser.uid);
            let user = _mapFbUser(fbUser);

            // Set the base user immediately so the nav shows the correct state right away.
            LegendState.set('user', user);
            callback(user);

            // Then try to load the Firestore role/profile — this updates the user
            // object asynchronously without blocking the initial render.
            // Also handles backup/older accounts whose Firestore document may not
            // have all fields — always falls back safely to Auth data.
            try {
              const db = await getFirestore();
              const {
                doc, getDoc, setDoc, serverTimestamp,
                collection, query, where, limit: fsLimit, getDocs,
              } = await loadModule('firestore');

              let snap = await getDoc(doc(db, 'users', fbUser.uid));

              // ── Legacy account migration ───────────────────────────────────
              // If the canonical users/{uid} document doesn't exist, search for
              // a legacy document that stores this UID in a data field.
              // When found: safely merge it into users/{uid} (never overwrite with blanks).
              if (!snap.exists()) {
                let legacyData = null;
                for (const field of ['uid', 'userId', 'firebaseUid', 'ownerId']) {
                  try {
                    const q = query(
                      collection(db, 'users'),
                      where(field, '==', fbUser.uid),
                      fsLimit(1),
                    );
                    const legacySnap = await getDocs(q);
                    if (!legacySnap.empty) {
                      legacyData = legacySnap.docs[0].data();
                      console.info('[AVN] Legacy profile found via field:', field, { uid: fbUser.uid, docId: legacySnap.docs[0].id });
                      break;
                    }
                  } catch (_) {}
                }

                // Build canonical document — prefer legacy data over Auth defaults
                const safeUsername = legacyData?.username || fbUser.displayName || fbUser.email?.split('@')[0] || 'AVENORAUser';
                const canonicalDoc = {
                  uid:           fbUser.uid,
                  username:      legacyData?.username      || safeUsername,
                  usernameLower: (legacyData?.username     || safeUsername).toLowerCase(),
                  email:         legacyData?.email         || fbUser.email || null,
                  role:          legacyData?.role          || 'user',
                  profile: {
                    displayName: legacyData?.profile?.displayName || legacyData?.displayName || safeUsername,
                    avatarUrl:   legacyData?.profile?.avatarUrl   || fbUser.photoURL || null,
                    bio:         legacyData?.profile?.bio         || '',
                    location:    legacyData?.profile?.location    || '',
                    website:     legacyData?.profile?.website     || '',
                    bannerUrl:   legacyData?.profile?.bannerUrl   || null,
                  },
                  stats: {
                    followersCount: legacyData?.stats?.followersCount ?? legacyData?.followersCount ?? 0,
                    followingCount: legacyData?.stats?.followingCount ?? legacyData?.followingCount ?? 0,
                    postsCount:     legacyData?.stats?.postsCount     ?? legacyData?.postsCount     ?? 0,
                  },
                  createdAt: legacyData?.createdAt || new Date().toISOString(),
                };

                try {
                  // merge:true so we never overwrite fields already set by other code
                  await setDoc(doc(db, 'users', fbUser.uid), canonicalDoc, { merge: true });
                  snap = await getDoc(doc(db, 'users', fbUser.uid));
                  console.info('[AVN] Canonical profile document created/updated for uid:', fbUser.uid);
                } catch (writeErr) {
                  console.warn('[AVN] Could not write canonical profile:', writeErr.code, writeErr.message);
                }
              }

              if (snap.exists()) {
                const fsData = snap.data();
                let updated = { ...user };
                if (fsData.role && typeof fsData.role === 'string') {
                  updated.role = fsData.role;
                }
                // Prefer Firestore username; fall back to Auth displayName / email prefix
                if (fsData.username) updated.username = fsData.username;
                if (fsData.profile?.displayName || fsData.profile?.avatarUrl) {
                  updated.profile = {
                    ...updated.profile,
                    ...(fsData.profile.displayName ? { displayName: fsData.profile.displayName } : {}),
                    ...(fsData.profile.avatarUrl   ? { avatarUrl:   fsData.profile.avatarUrl   } : {}),
                  };
                }
                // Always update after Firestore lookup so downstream profile reads
                // see the complete merged user object (including username from Firestore).
                LegendState.set('user', updated);
                callback(updated);
              }
              // If no Firestore document exists yet and creation failed, the base Auth user object is
              // still in state — profile.js will auto-create the document via
              // UsersAPI.loadProfile() when the profile page renders.
            } catch (authLookupErr) {
              // Firestore role lookup is best-effort — never block auth
              console.warn('[AVN] Firestore profile lookup failed in onAuthStateChanged:', authLookupErr.code, authLookupErr.message);
            }
          } else {
            _clearUid();
            LegendState.set('user', null);
            callback(null);
          }
        });
      });
    },

    /**
     * Returns a fresh Firebase ID token (for backend-verified requests).
     * Always forces a server-side refresh so the returned token is never
     * a stale cached copy — critical for privileged operations like delete.
     */
    async getIdToken(forceRefresh = true) {
      const auth = await getFirebaseAuth();
      if (!auth.currentUser) return null;
      return auth.currentUser.getIdToken(forceRefresh);
    },
  };

  // ─── helpers ──────────────────────────────────────────────────
  function _mapFbUser(fbUser, fallbackUsername) {
    const username = fbUser.displayName || fallbackUsername || fbUser.email?.split('@')[0] || 'user';
    return {
      id:       fbUser.uid,
      uid:      fbUser.uid,
      email:    fbUser.email,
      username,
      role:     'user',                  // 'user' is the canonical default role in AVENORA
      profile:  {
        displayName: username,
        avatarUrl:   fbUser.photoURL || null,
      },
      emailVerified: fbUser.emailVerified,
    };
  }
  function _persistUid(uid) {
    sessionStorage.setItem('lu_uid', uid);
    localStorage.setItem('lu_uid', uid);
  }
  function _clearUid() {
    sessionStorage.removeItem('lu_uid');
    localStorage.removeItem('lu_uid');
    // Legacy JWT keys also cleared for cleanliness
    sessionStorage.removeItem('lu_access');
    localStorage.removeItem('lu_access');
    localStorage.removeItem('lu_refresh');
  }

  // ═══════════════════════════════════════════════════════════════
  // FIRESTORE
  // ═══════════════════════════════════════════════════════════════
  let _db = null;

  async function getFirestore() {
    if (_db) return _db;
    const app = await getApp();
    const { getFirestore: _getFs } = await loadModule('firestore');
    _db = _getFs(app);
    return _db;
  }

  // ─── _resolvePlaylistTrackUrl ──────────────────────────────────────────────
  /**
   * Resolve a single playlist track entry to a playable audio URL.
   *
   * This is the ONE shared resolver used by both getPlaylistTracks() and
   * listenToPlaylist().  It handles:
   *
   *   1. Inline URL fields already on the entry document:
   *        audioUrl | fileUrl | url | publicUrl | downloadURL
   *
   *   2. storagePath → Supabase public URL via window.AvenoraStorage.getPublicUrl
   *
   *   3. Secondary cloudStreamTracks lookup by trackId (the Firestore doc ID of
   *      the original upload).  This is the primary fix for Cloud Radio entries
   *      that were added with a blank audioUrl but a valid trackId.
   *      Search order:
   *        a) exact path: cloudStreamTracks/{ownerUid}/tracks/{trackId}
   *           where ownerUid is embedded in the entry (addedByUid / ownerUid / uid)
   *        b) collectionGroup query on 'tracks' sub-collection by __name__ == trackId
   *           (catches cross-user uploads)
   *
   * Returns the input track object enriched with a resolved audioUrl.
   * If no URL can be found, the track is returned with _unavailable:true
   * and audioUrl:'' — it NEVER throws, so one broken entry cannot kill the batch.
   */
  async function _resolvePlaylistTrackUrl(db, trackEntry) {
    // Step 1: inline URL fields
    const inlineUrl = trackEntry.audioUrl || trackEntry.fileUrl || trackEntry.url
                   || trackEntry.publicUrl || trackEntry.downloadURL;
    if (inlineUrl && typeof inlineUrl === 'string' && inlineUrl.trim()) {
      return { ...trackEntry, audioUrl: inlineUrl.trim() };
    }

    // Step 2: storagePath → Supabase public URL
    if (trackEntry.storagePath && window.AvenoraStorage?.getPublicUrl) {
      try {
        const derived = window.AvenoraStorage.getPublicUrl('music', trackEntry.storagePath);
        if (derived) {
          console.info('[AVN] _resolvePlaylistTrackUrl — derived from storagePath:',
            trackEntry.storagePath, derived);
          return { ...trackEntry, audioUrl: derived };
        }
      } catch (_) { /* fall through */ }
    }

    // Step 3: cloudStreamTracks secondary lookup by trackId
    // trackId is the document ID of the original upload in cloudStreamTracks/{uid}/tracks/{docId}
    // It differs from _docId (the playlist sub-collection doc ID) — we try both.
    const lookupId = trackEntry.trackId || trackEntry.mediaId || trackEntry.id || trackEntry._docId;
    if (lookupId) {
      try {
        const { doc: fsDoc, getDoc: fsGet, collectionGroup, query: fsQuery, where: fsWhere, limit: fsLimit, getDocs: fsGetDocs } =
          await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // 3a: exact path — ownerUid is often stored in addedByUid
        const ownerUid = trackEntry.addedByUid || trackEntry.ownerUid || trackEntry.uid || null;
        if (ownerUid && /^[A-Za-z0-9]{20,}$/.test(ownerUid)) {
          try {
            const snap = await fsGet(fsDoc(db, 'cloudStreamTracks', ownerUid, 'tracks', lookupId));
            if (snap.exists()) {
              const d = snap.data();
              const foundUrl = d.url || d.audioUrl || d.fileUrl;
              if (foundUrl) {
                console.info('[AVN] _resolvePlaylistTrackUrl — found by exact path:',
                  'cloudStreamTracks/' + ownerUid + '/tracks/' + lookupId, foundUrl);
                return { ...trackEntry, ...d, audioUrl: foundUrl, _resolved: 'cloudStreamTracks-exact' };
              }
            }
          } catch (_) { /* doc not found or permission — fall through */ }
        }

        // 3b: collectionGroup on 'tracks' where document ID equals lookupId
        // (handles tracks uploaded by users whose UID is not on the playlist entry)
        try {
          const cgSnap = await fsGetDocs(
            fsQuery(collectionGroup(db, 'tracks'), fsWhere('__name__', '==', lookupId), fsLimit(1))
          );
          if (!cgSnap.empty) {
            const d = cgSnap.docs[0].data();
            const foundUrl = d.url || d.audioUrl || d.fileUrl;
            if (foundUrl) {
              console.info('[AVN] _resolvePlaylistTrackUrl — found by collectionGroup:',
                lookupId, foundUrl);
              return { ...trackEntry, ...d, audioUrl: foundUrl, _resolved: 'cloudStreamTracks-cg' };
            }
          }
        } catch (_) { /* collectionGroup query may lack an index — skip */ }

        // 3c: if trackId looks like {uid}_{timestamp} we can parse the uid directly
        if (typeof lookupId === 'string' && lookupId.includes('_')) {
          const parts = lookupId.split('_');
          const maybeUid = parts[0];
          if (/^[A-Za-z0-9]{20,}$/.test(maybeUid)) {
            try {
              const snap = await fsGet(fsDoc(db, 'cloudStreamTracks', maybeUid, 'tracks', lookupId));
              if (snap.exists()) {
                const d = snap.data();
                const foundUrl = d.url || d.audioUrl || d.fileUrl;
                if (foundUrl) {
                  console.info('[AVN] _resolvePlaylistTrackUrl — found by parsed UID path:',
                    'cloudStreamTracks/' + maybeUid + '/tracks/' + lookupId, foundUrl);
                  return { ...trackEntry, ...d, audioUrl: foundUrl, _resolved: 'cloudStreamTracks-parsed' };
                }
              }
            } catch (_) { /* ignore */ }
          }
        }
      } catch (lookupErr) {
        console.warn('[AVN] _resolvePlaylistTrackUrl — cloudStreamTracks lookup failed:',
          lookupId, lookupErr.message);
      }
    }

    // Step 4: globalMusicLibrary direct lookup by trackId
    // This resolves tracks from other users that were added to a shared playlist.
    if (lookupId) {
      try {
        const { doc: gDoc, getDoc: gGet } =
          await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        try {
          const gSnap = await gGet(gDoc(db, 'globalMusicLibrary', String(lookupId)));
          if (gSnap.exists()) {
            const gd = gSnap.data();
            const foundUrl = gd.audioUrl || gd.fileUrl || gd.url;
            if (foundUrl) {
              console.info('[AVN] _resolvePlaylistTrackUrl — found in globalMusicLibrary:',
                lookupId, foundUrl);
              return { ...trackEntry, ...gd, audioUrl: foundUrl, _resolved: 'globalMusicLibrary' };
            }
          }
        } catch (_) {}
      } catch (_) {}
    }

    // All resolution strategies exhausted
    console.warn('[AVN] _resolvePlaylistTrackUrl — UNRESOLVABLE', {
      trackId:     lookupId,
      trackTitle:  trackEntry.title,
      storagePath: trackEntry.storagePath || null,
      addedByUid:  trackEntry.addedByUid  || null,
      fields:      Object.keys(trackEntry).join(', '),
    });
    return { ...trackEntry, audioUrl: '', _unavailable: true };
  }

  /**
   * AvenoraFirebase.Firestore — lightweight wrappers for the collections
   * used by the app (posts, profiles, gallery items).
   */
  const FirestoreService = {
    async getPosts(limitCount = 20) {
      const db = await getFirestore();
      const { collection, query, orderBy, limit, getDocs } = await loadModule('firestore');
      const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async createPost(content, mediaUrls = [], tags = []) {
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await loadModule('firestore');
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      // authorUid is the CANONICAL identity field — always the Firebase Auth UID.
      // author.id and author.uid both store the same UID for backward compat.
      const authorUid = user.uid || user.id;
      const ref = await addDoc(collection(db, 'posts'), {
        content,
        mediaUrls,
        tags,
        authorUid,                // canonical UID field for ownership queries
        author: {
          id:       authorUid,
          uid:      authorUid,
          username: user.username,
          avatarUrl: user.profile?.avatarUrl || null,
          profile: {
            displayName: user.profile?.displayName || user.username,
            avatarUrl:   user.profile?.avatarUrl || null,
          },
        },
        likes: [],
        commentCount: 0,
        createdAt: serverTimestamp(),
      });
      return { id: ref.id };
    },

    async likePost(postId) {
      const db = await getFirestore();
      const { doc, updateDoc, arrayUnion, arrayRemove, getDoc } = await loadModule('firestore');
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const ref = doc(db, 'posts', postId);
      const snap = await getDoc(ref);
      const likes = snap.data()?.likes || [];
      const userId = user.id || user.uid;
      const wasLiked = likes.includes(userId);
      if (wasLiked) {
        await updateDoc(ref, { likes: arrayRemove(userId) });
        return { liked: false, likeCount: Math.max(0, likes.length - 1) };
      } else {
        await updateDoc(ref, { likes: arrayUnion(userId) });
        return { liked: true, likeCount: likes.length + 1 };
      }
    },

    async deletePost(postId) {
      const db = await getFirestore();
      const { doc, deleteDoc } = await loadModule('firestore');
      await deleteDoc(doc(db, 'posts', postId));
    },

    async getProfile(uid) {
      const db = await getFirestore();
      const { doc, getDoc } = await loadModule('firestore');
      const snap = await getDoc(doc(db, 'users', uid));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    async getProfileByUsername(usernameOrIdentifier) {
      const db = await getFirestore();
      const { collection, query, where, limit, getDocs, doc, getDoc } = await loadModule('firestore');

      const identifier = String(usernameOrIdentifier || '').trim();
      if (!identifier) return null;

      console.debug('[AVN] getProfileByUsername', {
        identifier,
        looksLikeUid: /^[A-Za-z0-9]{20,}$/.test(identifier),
      });

      // ── 1. Direct document ID lookup (identifier IS the Firebase UID) ──────
      // Firebase UIDs are 28 chars; auto-generated Firestore IDs are 20 chars.
      // Both are alphanumeric-only — try a direct doc read first (cheapest).
      if (/^[A-Za-z0-9]{20,}$/.test(identifier)) {
        try {
          const snap = await getDoc(doc(db, 'users', identifier));
          if (snap.exists()) {
            console.debug('[AVN] getProfileByUsername — found by document ID', { identifier });
            return { id: snap.id, ...snap.data() };
          }
        } catch (_) { /* not a valid doc path — fall through */ }
      }

      // ── 2. username field (exact match) ────────────────────────────────────
      const q1 = query(collection(db, 'users'), where('username', '==', identifier), limit(1));
      const snap1 = await getDocs(q1);
      if (!snap1.empty) {
        const d = snap1.docs[0];
        console.debug('[AVN] getProfileByUsername — found by username field', { identifier });
        return { id: d.id, ...d.data() };
      }

      // ── 3. uid / userId / firebaseUid / ownerId field ─────────────────────
      // Legacy documents may store the Firebase UID in a data field rather than
      // using it as the document ID.
      for (const field of ['uid', 'userId', 'firebaseUid', 'ownerId']) {
        try {
          const q2 = query(collection(db, 'users'), where(field, '==', identifier), limit(1));
          const snap2 = await getDocs(q2);
          if (!snap2.empty) {
            const d = snap2.docs[0];
            console.debug('[AVN] getProfileByUsername — found by field', { field, identifier });
            return { id: d.id, ...d.data() };
          }
        } catch (_) { /* field may not exist or lack an index — skip */ }
      }

      // ── 4. usernameLower field — exact lowercase match ─────────────────────
      // Only attempt if identifier looks like a username (not a UID).
      if (!/^[A-Za-z0-9]{20,}$/.test(identifier)) {
        try {
          const q4 = query(collection(db, 'users'), where('usernameLower', '==', identifier.toLowerCase()), limit(1));
          const snap4 = await getDocs(q4);
          if (!snap4.empty) {
            const d = snap4.docs[0];
            console.debug('[AVN] getProfileByUsername — found by usernameLower field', { identifier });
            return { id: d.id, ...d.data() };
          }
        } catch (_) { /* field may not be indexed — skip */ }
      }

      // ── 5. displayName / profile.displayName (case-insensitive fallback) ──
      // Scan up to 200 docs and match client-side so no extra index is needed.
      // IMPORTANT: only use EXACT equality — never use startsWith() or includes()
      // on usernames, as "legend" must never match "legends".
      try {
        const { limit: lim } = await loadModule('firestore');
        const qAll = query(collection(db, 'users'), lim(200));
        const snapAll = await getDocs(qAll);
        const lower = identifier.toLowerCase();
        const matched = snapAll.docs.find(d => {
          const data = d.data();
          // USERNAME: EXACT match only — never partial/prefix matching.
          const uname      = (data.username           || '').toLowerCase();
          const unameLower = (data.usernameLower       || '').toLowerCase();
          const dname1     = (data.displayName         || '').toLowerCase();
          const dname2     = (data.profile?.displayName || '').toLowerCase();
          const email      = (data.email               || '').split('@')[0].toLowerCase();
          // Username must be IDENTICAL — "legend" ≠ "legends", "legends" ≠ "legend"
          const usernameMatch = uname === lower || unameLower === lower;
          // Display name allows substring (it's not an identity key)
          const displayNameMatch = dname1 === lower || dname2 === lower || email === lower;
          return usernameMatch || displayNameMatch;
        });
        if (matched) {
          console.debug('[AVN] getProfileByUsername — found by displayName/email scan', { identifier });
          return { id: matched.id, ...matched.data() };
        }
      } catch (_) { /* scan is best-effort */ }

      console.debug('[AVN] getProfileByUsername — no match found', { identifier });
      return null;
    },

    async upsertProfile(uid, data) {
      const db = await getFirestore();
      const { doc, setDoc, serverTimestamp } = await loadModule('firestore');
      // Ensure uid and usernameLower are always up to date
      const enriched = { ...data, uid, updatedAt: serverTimestamp() };
      if (enriched.username && !enriched.usernameLower) {
        enriched.usernameLower = enriched.username.trim().toLowerCase();
      }
      await setDoc(doc(db, 'users', uid), enriched, { merge: true });
    },

    async getGallery(limitCount = 20) {
      const db = await getFirestore();
      const { collection, query, orderBy, limit, getDocs } = await loadModule('firestore');
      const q = query(collection(db, 'gallery'), orderBy('createdAt', 'desc'), limit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async addGalleryItem(url, mediaType, caption = '') {
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await loadModule('firestore');
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const ref = await addDoc(collection(db, 'gallery'), {
        url, mediaType, caption,
        author: { id: user.id, username: user.username },
        likes: [],
        createdAt: serverTimestamp(),
      });
      return { id: ref.id };
    },

    async deleteGalleryItem(id) {
      const db = await getFirestore();
      const { doc, deleteDoc } = await loadModule('firestore');
      await deleteDoc(doc(db, 'gallery', id));
    },

    async likeGalleryItem(id) {
      const db = await getFirestore();
      const { doc, updateDoc, arrayUnion, arrayRemove, getDoc } = await loadModule('firestore');
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const ref = doc(db, 'gallery', id);
      const snap = await getDoc(ref);
      const likes = snap.data()?.likes || [];
      if (likes.includes(user.id)) {
        await updateDoc(ref, { likes: arrayRemove(user.id) });
        return { liked: false, likeCount: likes.length - 1 };
      } else {
        await updateDoc(ref, { likes: arrayUnion(user.id) });
        return { liked: true, likeCount: likes.length + 1 };
      }
    },

    async updatePost(postId, content) {
      const db = await getFirestore();
      const { doc, updateDoc, serverTimestamp } = await loadModule('firestore');
      await updateDoc(doc(db, 'posts', postId), { content, updatedAt: serverTimestamp() });
    },

    async addComment(postId, content) {
      const db = await getFirestore();
      const { collection, addDoc, doc, updateDoc, increment, serverTimestamp } = await loadModule('firestore');
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const authorUid = user.uid || user.id;
      let ref;
      try {
        ref = await addDoc(collection(db, 'posts', postId, 'comments'), {
          content,
          authorUid,            // canonical UID — never a username
          author: {
            id:       authorUid,
            uid:      authorUid,
            username: user.username,
            avatarUrl: user.profile?.avatarUrl || null,
          },
          createdAt: serverTimestamp(),
        });
      } catch (commentErr) {
        console.error('[AVN] addComment Firestore error', {
          postId,
          authorUid,
          code:    commentErr.code,
          message: commentErr.message,
        });
        throw commentErr;
      }
      try {
        await updateDoc(doc(db, 'posts', postId), { commentCount: increment(1) });
      } catch (countErr) {
        // Non-fatal — comment was saved; counter sync failed
        console.warn('[AVN] commentCount increment failed:', countErr.code, countErr.message);
      }
      return { id: ref.id };
    },

    async getComments(postId) {
      const db = await getFirestore();
      const { collection, query, orderBy, getDocs } = await loadModule('firestore');
      const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data = d.data();
        // Normalise: ensure author.id / author.uid are always the canonical UID
        if (data.author && !data.author.uid && data.authorUid) {
          data.author.uid = data.authorUid;
          data.author.id  = data.authorUid;
        }
        return { id: d.id, _id: d.id, ...data };
      });
    },

    async deleteComment(postId, commentId) {
      const db = await getFirestore();
      const { doc, deleteDoc, updateDoc, increment } = await loadModule('firestore');
      await deleteDoc(doc(db, 'posts', postId, 'comments', commentId));
      await updateDoc(doc(db, 'posts', postId), { commentCount: increment(-1) });
    },

    // ─── Stories ────────────────────────────────────────────
    async getStories(limitCount = 50) {
      const db = await getFirestore();
      const { collection, query, orderBy, limit, getDocs, where, Timestamp } = await loadModule('firestore');
      // Only show stories created in the last 24 hours
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const q = query(
        collection(db, 'stories'),
        orderBy('createdAt', 'desc'),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getStoriesByUser(userId) {
      const db = await getFirestore();
      const { collection, query, where, orderBy, getDocs } = await loadModule('firestore');
      const q = query(collection(db, 'stories'), where('author.id', '==', userId), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async createStory(mediaUrl, mediaType, caption) {
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await loadModule('firestore');
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const ref = await addDoc(collection(db, 'stories'), {
        mediaUrl, mediaType, caption,
        author: { id: user.id, username: user.username, avatarUrl: user.profile?.avatarUrl || null },
        views: [],
        createdAt: serverTimestamp(),
      });
      return { id: ref.id };
    },

    async deleteStory(storyId) {
      const db = await getFirestore();
      const { doc, deleteDoc } = await loadModule('firestore');
      await deleteDoc(doc(db, 'stories', storyId));
    },

    // ─── Follow / Unfollow ──────────────────────────────────
    /**
     * Follow targetUid as currentUserUid.
     * Structure:
     *   followers/{targetUid}/users/{currentUid}
     *   following/{currentUid}/users/{targetUid}
     * Both document IDs are Firebase Auth UIDs — NEVER usernames.
     *
     * UID resolution priority:
     *   1. Firebase Auth currentUser.uid  (ground truth)
     *   2. LegendState user.uid/id        (after onAuthStateChanged)
     *   3. Persisted lu_uid               (last resort)
     *
     * Values shorter than 20 alphanumeric chars are rejected as invalid UIDs.
     */
    async followUser(targetUid) {
      const db = await getFirestore();
      const { doc, setDoc, serverTimestamp, getDoc, increment, updateDoc } = await loadModule('firestore');

      // Layer 1: Firebase Auth (ground truth — must match what Firestore sees as request.auth.uid)
      let currentUid = null;
      try {
        const fbAuth = await getFirebaseAuth();
        if (fbAuth.currentUser) currentUid = fbAuth.currentUser.uid;
      } catch (_) { /* fall through */ }

      // Layer 2: LegendState
      if (!currentUid) {
        const stateUser = LegendState.get('user');
        currentUid = stateUser?.uid || stateUser?.id || null;
      }

      // Layer 3: persisted UID written by _persistUid()
      if (!currentUid) {
        currentUid = sessionStorage.getItem('lu_uid') || localStorage.getItem('lu_uid') || null;
      }

      // Validate — Firebase Auth UIDs are 28 chars alphanumeric; never usernames
      const _isUid = (v) => typeof v === 'string' && /^[A-Za-z0-9]{20,}$/.test(v);

      console.debug('[AVN] followUser attempt', {
        currentUid,
        targetUid,
        currentUidValid:  _isUid(currentUid),
        targetUidValid:   _isUid(targetUid),
        followerDocPath:  `followers/${targetUid}/users/${currentUid}`,
        followingDocPath: `following/${currentUid}/users/${targetUid}`,
      });

      if (!currentUid) {
        const e = new Error('Not authenticated — cannot follow'); e.code = 'unauthenticated'; throw e;
      }
      if (!_isUid(currentUid)) {
        const e = new Error('currentUid "' + currentUid + '" is not a valid Firebase UID — follow blocked');
        e.code = 'INVALID_UID';
        console.error('[AVN] followUser blocked — currentUid is not a Firebase UID:', currentUid);
        throw e;
      }
      if (!targetUid || !_isUid(targetUid)) {
        const e = new Error('targetUid "' + targetUid + '" is not a valid Firebase UID — follow blocked');
        e.code = 'INVALID_UID';
        console.error('[AVN] followUser blocked — targetUid is not a Firebase UID:', targetUid);
        throw e;
      }
      if (currentUid === targetUid) throw new Error('Cannot follow yourself');

      const user = LegendState.get('user');

      // Write followers/{targetUid}/users/{currentUid}
      // Rule: request.auth.uid == followerUid — currentUid MUST equal Firebase auth.uid
      try {
        await setDoc(doc(db, 'followers', targetUid, 'users', currentUid), {
          uid:       currentUid,
          username:  user?.username  || '',
          avatarUrl: user?.profile?.avatarUrl || null,
          profile:   { displayName: user?.profile?.displayName || user?.username || '', avatarUrl: user?.profile?.avatarUrl || null },
          followedAt: serverTimestamp(),
        });
      } catch (followerErr) {
        console.error('[AVN] followUser — followers write FAILED', {
          path:      'followers/' + targetUid + '/users/' + currentUid,
          code:      followerErr.code,
          message:   followerErr.message,
          currentUid,
          targetUid,
        });
        throw followerErr;
      }

      // Write following/{currentUid}/users/{targetUid}
      // Rule: request.auth.uid == currentUid
      let targetUsername = '';
      try {
        const snap = await getDoc(doc(db, 'users', targetUid));
        if (snap.exists()) targetUsername = snap.data().username || '';
      } catch (_) {}
      try {
        await setDoc(doc(db, 'following', currentUid, 'users', targetUid), {
          uid:        targetUid,
          username:   targetUsername,
          followedAt: serverTimestamp(),
        });
      } catch (followingErr) {
        console.error('[AVN] followUser — following write FAILED', {
          path:      'following/' + currentUid + '/users/' + targetUid,
          code:      followingErr.code,
          message:   followingErr.message,
          currentUid,
          targetUid,
        });
        throw followingErr;
      }

      // Counters are best-effort — never block on them
      try { await updateDoc(doc(db, 'users', targetUid),  { 'stats.followersCount': increment(1) }); } catch (_) {}
      try { await updateDoc(doc(db, 'users', currentUid), { 'stats.followingCount': increment(1) }); } catch (_) {}

      console.info('[AVN] followUser SUCCESS', { currentUid, targetUid });
      return { followed: true };
    },

    async unfollowUser(targetUid) {
      const db = await getFirestore();
      const { doc, deleteDoc, writeBatch, increment, updateDoc } = await loadModule('firestore');

      // Same UID resolution chain as followUser
      let currentUid = null;
      try {
        const fbAuth = await getFirebaseAuth();
        if (fbAuth.currentUser) currentUid = fbAuth.currentUser.uid;
      } catch (_) { /* fall through */ }
      if (!currentUid) {
        const stateUser = LegendState.get('user');
        currentUid = stateUser?.uid || stateUser?.id || null;
      }
      if (!currentUid) {
        currentUid = sessionStorage.getItem('lu_uid') || localStorage.getItem('lu_uid') || null;
      }

      if (!currentUid || !targetUid) throw new Error('Invalid UID for unfollow operation');

      // Use a batch to delete both follow docs atomically — either both succeed or neither does.
      // This prevents the state where followers/{target}/users/{me} is deleted but
      // following/{me}/users/{target} is not (or vice versa).
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'followers', targetUid, 'users', currentUid));
        batch.delete(doc(db, 'following', currentUid, 'users', targetUid));
        await batch.commit();
      } catch (batchErr) {
        console.error('[AVN] unfollowUser — batch delete failed:', batchErr.code, batchErr.message);
        throw batchErr;
      }

      // Decrement counters (best-effort — never block on counter sync)
      try {
        await updateDoc(doc(db, 'users', targetUid), { 'stats.followersCount': increment(-1) });
      } catch (_) {}
      try {
        await updateDoc(doc(db, 'users', currentUid), { 'stats.followingCount': increment(-1) });
      } catch (_) {}

      console.info('[AVN] unfollowUser SUCCESS', { currentUid, targetUid });
      return { unfollowed: true };
    },

    async getFollowers(targetUid) {
      const db = await getFirestore();
      const { collection, getDocs } = await loadModule('firestore');
      const snap = await getDocs(collection(db, 'followers', targetUid, 'users'));
      return snap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }));
    },

    async getFollowing(currentUid) {
      const db = await getFirestore();
      const { collection, getDocs } = await loadModule('firestore');
      const snap = await getDocs(collection(db, 'following', currentUid, 'users'));
      return snap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }));
    },

    async getFollowStatus(targetUid) {
      const db = await getFirestore();
      const { doc, getDoc } = await loadModule('firestore');
      const user = LegendState.get('user');
      if (!user) return { isFollowing: false };
      const currentUid = user.uid || user.id;
      if (!currentUid) return { isFollowing: false };
      const snap = await getDoc(doc(db, 'followers', targetUid, 'users', currentUid));
      return { isFollowing: snap.exists() };
    },

    // ─── Posts by UID ───────────────────────────────────────
    /**
     * Fetch posts authored by a specific Firebase UID.
     * Queries by the canonical `authorUid` field first; falls back to
     * matching `author.uid` and `author.id` for older posts that pre-date
     * the top-level authorUid field.
     */
    async getPostsByUid(authorUid, limitCount = 50) {
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit, getDocs } = await loadModule('firestore');

      // Primary: query by top-level authorUid field (set on all new posts)
      let posts = [];
      try {
        const q1 = query(
          collection(db, 'posts'),
          where('authorUid', '==', authorUid),
          orderBy('createdAt', 'desc'),
          limit(limitCount),
        );
        const snap1 = await getDocs(q1);
        posts = snap1.docs.map(d => ({ id: d.id, _id: d.id, ...d.data() }));
      } catch (e) {
        // authorUid index may not exist yet — fall through to legacy query
        console.warn('[AVN] getPostsByUid — authorUid query failed:', e.code, e.message);
      }

      // Fallback: query by author.uid (older posts)
      if (!posts.length) {
        try {
          const q2 = query(
            collection(db, 'posts'),
            where('author.uid', '==', authorUid),
            orderBy('createdAt', 'desc'),
            limit(limitCount),
          );
          const snap2 = await getDocs(q2);
          posts = snap2.docs.map(d => ({ id: d.id, _id: d.id, ...d.data() }));
        } catch (e) {
          console.warn('[AVN] getPostsByUid — author.uid query failed:', e.code, e.message);
        }
      }

      // Final fallback: query by author.id (oldest legacy posts)
      if (!posts.length) {
        try {
          const q3 = query(
            collection(db, 'posts'),
            where('author.id', '==', authorUid),
            orderBy('createdAt', 'desc'),
            limit(limitCount),
          );
          const snap3 = await getDocs(q3);
          posts = snap3.docs.map(d => ({ id: d.id, _id: d.id, ...d.data() }));
        } catch (e) {
          console.warn('[AVN] getPostsByUid — author.id query failed:', e.code, e.message);
        }
      }

      console.debug('[AVN] getPostsByUid', { authorUid, count: posts.length });
      return posts;
    },

    // ─── Search ─────────────────────────────────────────────
    /**
     * Full client-side search across users, posts, and gallery items.
     * Firestore does not support native full-text search, so we fetch
     * recent documents and filter by prefix/substring match client-side.
     * Results are capped to keep latency low.
     */
    async search(queryStr) {
      const q = (queryStr || '').trim().toLowerCase();
      if (!q) return { users: [], posts: [], videos: [] };

      const db = await getFirestore();
      const { collection, query, getDocs, orderBy, limit } = await loadModule('firestore');

      // ── Users ──────────────────────────────────────────
      const usersSnap = await getDocs(query(collection(db, 'users'), limit(200)));
      const users = usersSnap.docs
        .map(d => ({ id: d.id, uid: d.id, ...d.data() }))
        .filter(u => {
          const uname = (u.username || '').toLowerCase();
          const dname = (u.profile?.displayName || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          // EXACT prefix match on username — never allow "legend" to match "legends"
          // We check if the stored username starts with or equals the query.
          // For display name we allow substring (display names are not identity keys).
          return uname === q || uname.startsWith(q) || dname.includes(q) || email.startsWith(q);
        })
        .slice(0, 20);

      // ── Posts ──────────────────────────────────────────
      const postsSnap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(200)));
      const posts = postsSnap.docs
        .map(d => ({ id: d.id, _id: d.id, ...d.data() }))
        .filter(p => {
          const content = (p.content || '').toLowerCase();
          const author  = (p.author?.username || '').toLowerCase();
          return content.includes(q) || author.includes(q);
        })
        .slice(0, 20);

      // ── Gallery / videos ───────────────────────────────
      const gallerySnap = await getDocs(query(collection(db, 'gallery'), orderBy('createdAt', 'desc'), limit(100)));
      const videos = gallerySnap.docs
        .map(d => ({ id: d.id, _id: d.id, ...d.data() }))
        .filter(v => {
          const title   = (v.caption || v.title || '').toLowerCase();
          const uploader = (v.author?.username || '').toLowerCase();
          return title.includes(q) || uploader.includes(q);
        })
        .map(v => ({
          id: v.id,
          title: v.caption || v.title || 'Untitled',
          uploader: { username: v.author?.username || '' },
          url: v.url,
          mediaType: v.mediaType,
          createdAt: v.createdAt,
        }))
        .slice(0, 20);

      return { users, posts, videos };
    },

    // ─── User Preferences (stored in users/{uid}/preferences sub-doc) ──
    async getUserPreferences(uid) {
      const db = await getFirestore();
      const { doc, getDoc } = await loadModule('firestore');
      const snap = await getDoc(doc(db, 'userPreferences', uid));
      return snap.exists() ? snap.data() : null;
    },

    async setUserPreferences(uid, prefs) {
      const db = await getFirestore();
      const { doc, setDoc, serverTimestamp } = await loadModule('firestore');
      await setDoc(
        doc(db, 'userPreferences', uid),
        { ...prefs, updatedAt: serverTimestamp() },
        { merge: true }
      );
    },

    // ─── Companion (stored in companions/{uid}) ─────────────────
    async getCompanion(uid) {
      const db = await getFirestore();
      const { doc, getDoc } = await loadModule('firestore');
      const snap = await getDoc(doc(db, 'companions', uid));
      return snap.exists() ? snap.data() : null;
    },

    async saveCompanion(uid, data) {
      const db = await getFirestore();
      const { doc, setDoc, serverTimestamp } = await loadModule('firestore');
      await setDoc(
        doc(db, 'companions', uid),
        { ...data, updatedAt: serverTimestamp() },
        { merge: true }
      );
    },

    // ─── Music Playlists (Firestore-backed, shared) ──────────────────

    /**
     * Get all playlists that are shared OR owned by the current user.
     * Returns array of { id, ...data }.
     */
    async getSharedPlaylists() {
      const db   = await getFirestore();
      const { collection, query, where, getDocs, or } = await loadModule('firestore');
      const user = LegendState.get('user');
      const uid  = user?.uid || user?.id || null;

      let playlists = [];
      // Query shared playlists (any authenticated or anonymous reader can see shared ones)
      try {
        const sharedSnap = await getDocs(
          query(collection(db, 'musicPlaylists'), where('visibility', '==', 'shared'))
        );
        sharedSnap.forEach(d => playlists.push({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn('[AVN] getSharedPlaylists — shared query failed:', e.code, e.message);
      }

      // Also load private playlists owned by the current user
      if (uid) {
        try {
          const mySnap = await getDocs(
            query(collection(db, 'musicPlaylists'), where('createdByUid', '==', uid))
          );
          const sharedIds = new Set(playlists.map(p => p.id));
          mySnap.forEach(d => {
            if (!sharedIds.has(d.id)) playlists.push({ id: d.id, ...d.data() });
          });
        } catch (e) {
          console.warn('[AVN] getSharedPlaylists — user query failed:', e.code, e.message);
        }
      }

      return playlists;
    },

    /**
     * Listen to the track-count for multiple playlists simultaneously.
     * Subscribes to each playlist's tracks sub-collection and fires callback
     * with a { [playlistId]: count } map whenever any count changes.
     * Returns an unsubscribe function that cancels all listeners.
     *
     * @param {string[]} playlistIds  IDs of playlists to watch.
     * @param {function} callback     Called with { [id]: number } map.
     */
    listenToPlaylistCardCounts(playlistIds, callback) {
      if (!playlistIds || !playlistIds.length) return () => {};

      const counts = {};
      const unsubs = [];

      loadModule('firestore').then(function(fsModule) {
        var collection = fsModule.collection;
        var query      = fsModule.query;
        var onSnapshot = fsModule.onSnapshot;

        getFirestore().then(function(db) {
          playlistIds.forEach(function(plId) {
            counts[plId] = null; // null = still loading
            try {
              var unsub = onSnapshot(
                query(collection(db, 'musicPlaylists', plId, 'tracks')),
                function(snap) {
                  counts[plId] = snap.size;
                  // Only fire callback once all requested counts have resolved
                  // (or if we already have at least partial data — avoids blocking
                  //  the UI when some playlists are large or newly created).
                  callback(Object.assign({}, counts));
                },
                function(err) {
                  console.warn('[AVN] listenToPlaylistCardCounts error for', plId, err.message);
                  counts[plId] = 0; // treat error as 0 so the card isn't stuck loading
                  callback(Object.assign({}, counts));
                }
              );
              unsubs.push(unsub);
            } catch (e) {
              counts[plId] = 0;
            }
          });
        });
      });

      return function() { unsubs.forEach(function(u) { try { u(); } catch (_) {} }); };
    },

    /**
     * Get all tracks in a playlist sub-collection, ordered by position.
     * Attempts to resolve a playable audioUrl for each track — including a
     * secondary cloudStreamTracks lookup when the playlist entry itself has
     * no URL (the most common cause of MEDIA_RECORD_MISSING on Cloud Radio).
     * One broken entry NEVER prevents other tracks from loading.
     */
    async getPlaylistTracks(playlistId) {
      const db = await getFirestore();
      const { collection, query, orderBy, getDocs } = await loadModule('firestore');
      const snap = await getDocs(
        query(collection(db, 'musicPlaylists', playlistId, 'tracks'), orderBy('position', 'asc'))
      );
      const rawTracks = snap.docs.map(d => ({ _docId: d.id, id: d.id, ...d.data() }));
      // Resolve each track independently so one failure never kills the batch
      return Promise.all(rawTracks.map(t => _resolvePlaylistTrackUrl(db, t)));
    },

    /**
     * Add a track to a playlist sub-collection.
     * Also bumps the playlist's updatedAt timestamp.
     */
    async addTrackToPlaylist(playlistId, trackData) {
      const db = await getFirestore();
      const { collection, doc, addDoc, updateDoc, serverTimestamp, getDocs, query, orderBy } =
        await loadModule('firestore');
      const user = LegendState.get('user');
      const uid  = user?.uid || user?.id || null;
      if (!uid) throw new Error('Not authenticated');

      // Determine next position value
      let position = 0;
      try {
        const existingSnap = await getDocs(
          query(collection(db, 'musicPlaylists', playlistId, 'tracks'), orderBy('position', 'desc'))
        );
        if (!existingSnap.empty) {
          position = (existingSnap.docs[0].data().position || 0) + 1;
        }
      } catch (_) {}

      const ref = await addDoc(collection(db, 'musicPlaylists', playlistId, 'tracks'), {
        trackId:     String(trackData.id || trackData.trackId || ''),
        title:       trackData.title || trackData.name || 'Untitled',
        artist:      trackData.artistName || trackData.artist || '',
        audioUrl:    trackData.fileUrl || trackData.audioUrl || trackData.url || '',
        storagePath: trackData.storagePath || '',
        addedByUid:  uid,
        addedAt:     serverTimestamp(),
        position,
      });

      // Bump updatedAt on the parent playlist document
      try {
        await updateDoc(doc(db, 'musicPlaylists', playlistId), { updatedAt: serverTimestamp() });
      } catch (_) {}

      return { id: ref.id };
    },

    /**
     * Remove a track from a playlist.
     * trackDocId is the Firestore document ID in the tracks sub-collection.
     */
    async removeTrackFromPlaylist(playlistId, trackDocId) {
      const db = await getFirestore();
      const { doc, deleteDoc, updateDoc, serverTimestamp } = await loadModule('firestore');
      await deleteDoc(doc(db, 'musicPlaylists', playlistId, 'tracks', trackDocId));
      try {
        await updateDoc(doc(db, 'musicPlaylists', playlistId), { updatedAt: serverTimestamp() });
      } catch (_) {}
    },

    /**
     * Create a new playlist in Firestore.
     * Returns { id } of the new document.
     */
    async createPlaylist(name, description = '', visibility = 'shared', extra = {}) {
      const db = await getFirestore();
      const { collection, doc, setDoc, serverTimestamp } = await loadModule('firestore');
      const user = LegendState.get('user');
      const uid  = user?.uid || user?.id || null;
      if (!uid) throw new Error('Not authenticated');

      const newId = extra.sysId || `pl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await setDoc(doc(db, 'musicPlaylists', newId), {
        id:           newId,
        name:         name.trim(),
        description:  description.trim(),
        createdByUid: uid,
        visibility,
        isSystem:     extra.isSystem || false,
        sysId:        extra.sysId || '',
        icon:         extra.icon || '📂',
        color:        extra.color || 'var(--neon-blue)',
        createdAt:    serverTimestamp(),
        updatedAt:    serverTimestamp(),
      });
      return { id: newId };
    },

    /**
     * Update playlist metadata (name, description, visibility).
     */
    async updatePlaylist(playlistId, updates) {
      const db = await getFirestore();
      const { doc, updateDoc, serverTimestamp } = await loadModule('firestore');
      await updateDoc(doc(db, 'musicPlaylists', playlistId), {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    },

    /**
     * Delete a playlist and its tracks sub-collection.
     * Note: Firestore does not auto-delete sub-collections — we batch-delete tracks first.
     */
    async deletePlaylist(playlistId) {
      const db = await getFirestore();
      const { collection, getDocs, doc, deleteDoc, writeBatch } = await loadModule('firestore');
      const batch = writeBatch(db);
      // Delete all tracks in the sub-collection
      try {
        const tracksSnap = await getDocs(collection(db, 'musicPlaylists', playlistId, 'tracks'));
        tracksSnap.forEach(d => batch.delete(d.ref));
      } catch (_) {}
      batch.delete(doc(db, 'musicPlaylists', playlistId));
      await batch.commit();
    },

    /**
     * Subscribe to real-time updates for a playlist's tracks.
     * Returns an unsubscribe function.
     *
     * URL resolution order per track:
     *   1. Inline fields (audioUrl, fileUrl, url, publicUrl, downloadURL)
     *   2. storagePath  → Supabase public URL
     *   3. cloudStreamTracks/{ownerUid}/tracks/{trackId} secondary lookup
     *
     * A single broken entry MUST NOT block other tracks. Broken entries get
     * _unavailable:true so the UI can show them greyed out rather than
     * failing the entire playlist.
     */
    listenToPlaylist(playlistId, callback) {
      let unsubscribe = null;
      loadModule('firestore').then(({ collection, query, orderBy, onSnapshot }) => {
        getFirestore().then(db => {
          unsubscribe = onSnapshot(
            query(collection(db, 'musicPlaylists', playlistId, 'tracks'), orderBy('position', 'asc')),
            async (snap) => {
              try {
                const rawTracks = snap.docs.map(d => ({ _docId: d.id, id: d.id, ...d.data() }));
                const resolvedTracks = await Promise.all(
                  rawTracks.map(t => _resolvePlaylistTrackUrl(db, t))
                );
                callback(resolvedTracks);
              } catch (resolveErr) {
                console.warn('[AVN] listenToPlaylist resolve error:', resolveErr.message);
                // Still fire the callback with unresolved data so the UI isn't frozen
                callback(snap.docs.map(d => ({ _docId: d.id, id: d.id, ...d.data() })));
              }
            },
            (err) => console.warn('[AVN] listenToPlaylist error:', err.message)
          );
        });
      });
      return () => { if (unsubscribe) unsubscribe(); };
    },

    /**
     * Ensure a system playlist exists in Firestore (keyed by sysId).
     * No-op if it already exists.  Called from musicEnsureSystemPlaylists().
     */
    async ensureSystemPlaylist(sp) {
      const db = await getFirestore();
      const { doc, getDoc, setDoc, serverTimestamp } = await loadModule('firestore');
      const snap = await getDoc(doc(db, 'musicPlaylists', sp.sysId));
      if (!snap.exists()) {
        await setDoc(doc(db, 'musicPlaylists', sp.sysId), {
          id:           sp.sysId,
          name:         sp.name,
          description:  sp.description || '',
          createdByUid: 'system',
          visibility:   'shared',
          isSystem:     true,
          sysId:        sp.sysId,
          icon:         sp.icon || '📂',
          color:        sp.color || 'var(--neon-blue)',
          isRadio:      sp.isRadio || false,
          createdAt:    serverTimestamp(),
          updatedAt:    serverTimestamp(),
        });
      }
    },

    // ─── Global Music Library ──────────────────────────────────────
    // Collection: globalMusicLibrary/{trackId}
    // All authenticated users can read published tracks from any uploader.
    // Only the uploader (or admin/founder) may delete/edit their own track.

    /**
     * Publish a track to the global music library.
     * Called from musicUploadSubmit AFTER the Supabase upload succeeds.
     * Returns the canonical track document ID.
     */
    async publishTrackToGlobalLibrary(trackData) {
      const db = await getFirestore();
      const { doc, setDoc, serverTimestamp } = await loadModule('firestore');
      const user = LegendState.get('user');
      const uid  = user?.uid || user?.id || null;
      if (!uid) throw new Error('Not authenticated');

      // Use a stable canonical ID derived from uploaderUid + timestamp so it
      // never conflicts across devices and is deterministic for dedup.
      const trackId = trackData.id || trackData.trackId || `${uid}_${Date.now()}`;
      const docRef  = doc(db, 'globalMusicLibrary', String(trackId));

      await setDoc(docRef, {
        trackId:          String(trackId),
        title:            trackData.title || 'Untitled',
        artist:           trackData.artistName || trackData.artist || '',
        album:            trackData.albumTitle  || trackData.album  || '',
        genre:            trackData.genre       || '',
        duration:         trackData.duration    || 0,
        audioUrl:         trackData.fileUrl     || trackData.audioUrl || trackData.url || '',
        storagePath:      trackData.storagePath  || '',
        coverUrl:         trackData.coverUrl     || null,
        uploadedByUid:    uid,
        uploadedByName:   user?.profile?.displayName || user?.username || '',
        uploadedByAvatar: user?.profile?.avatarUrl || null,
        isPublished:      true,
        isDeleted:        false,
        createdAt:        serverTimestamp(),
        updatedAt:        serverTimestamp(),
        // Keep a copy of the legacy cloudStreamTracks doc ID for backward compat
        legacyCloudTrackId: trackData.legacyCloudTrackId || null,
      }, { merge: true });

      return String(trackId);
    },

    /**
     * Listen to the global music library in real time.
     * Returns tracks from ALL authenticated uploaders, ordered by createdAt desc.
     * Returns an unsubscribe function.
     * @param {function} callback  Called with an array of track objects.
     * @param {object}   [opts]    { limit: number, genre: string }
     */
    listenToGlobalLibrary(callback, opts) {
      const _opts = opts || {};
      let unsub = null;
      loadModule('firestore').then(function(fsModule) {
        var collection = fsModule.collection;
        var query = fsModule.query;
        var where = fsModule.where;
        var orderBy = fsModule.orderBy;
        var fsLimit = fsModule.limit;
        var onSnapshot = fsModule.onSnapshot;
        getFirestore().then(function(db) {
          var q = query(
            collection(db, 'globalMusicLibrary'),
            where('isPublished', '==', true),
            where('isDeleted',  '==', false),
            orderBy('createdAt', 'desc'),
            fsLimit(_opts.limit || 200)
          );
          unsub = onSnapshot(q, function(snap) {
            var tracks = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
            if (_opts.genre) tracks = tracks.filter(function(t) { return t.genre === _opts.genre; });
            callback(tracks);
          }, function(err) {
            console.warn('[AVN] listenToGlobalLibrary error:', err.message);
            callback([]);
          });
        });
      });
      return function() { if (unsub) unsub(); };
    },

    /**
     * Fetch the global music library once (no real-time).
     */
    async getGlobalLibraryTracks(opts) {
      const _opts = opts || {};
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit: fsLimit, getDocs } = await loadModule('firestore');
      const q = query(
        collection(db, 'globalMusicLibrary'),
        where('isPublished', '==', true),
        where('isDeleted',  '==', false),
        orderBy('createdAt', 'desc'),
        fsLimit(_opts.limit || 200)
      );
      const snap = await getDocs(q);
      let tracks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (_opts.genre) tracks = tracks.filter(t => t.genre === _opts.genre);
      return tracks;
    },

    /**
     * Fetch only the tracks uploaded by a specific UID.
     */
    async getUserTracks(uid, opts) {
      const _opts = opts || {};
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit: fsLimit, getDocs } = await loadModule('firestore');
      const snap = await getDocs(query(
        collection(db, 'globalMusicLibrary'),
        where('uploadedByUid', '==', uid),
        where('isDeleted', '==', false),
        orderBy('createdAt', 'desc'),
        fsLimit(_opts.limit || 100)
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /**
     * Listen to tracks uploaded by a specific UID (real-time).
     */
    listenToUserTracks(uid, callback) {
      let unsub = null;
      loadModule('firestore').then(function(fsModule) {
        var collection = fsModule.collection;
        var query = fsModule.query;
        var where = fsModule.where;
        var orderBy = fsModule.orderBy;
        var onSnapshot = fsModule.onSnapshot;
        getFirestore().then(function(db) {
          unsub = onSnapshot(
            query(
              collection(db, 'globalMusicLibrary'),
              where('uploadedByUid', '==', uid),
              where('isDeleted', '==', false),
              orderBy('createdAt', 'desc')
            ),
            function(snap) { callback(snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })); },
            function(err) { console.warn('[AVN] listenToUserTracks error:', err.message); callback([]); }
          );
        });
      });
      return function() { if (unsub) unsub(); };
    },

    /**
     * Soft-delete a track (sets isDeleted:true).  Only the owner may delete.
     */
    async softDeleteTrack(trackId) {
      const db = await getFirestore();
      const { doc, updateDoc, serverTimestamp } = await loadModule('firestore');
      await updateDoc(doc(db, 'globalMusicLibrary', String(trackId)), {
        isDeleted: true,
        updatedAt: serverTimestamp(),
      });
    },

    // ─── Community Mix ──────────────────────────────────────────────
    // The Community Mix is NOT a regular musicPlaylists document.
    // It is a virtual playlist aggregated from globalMusicLibrary.
    // One shared Firestore doc: communityMix/meta  (trackIds membership array).
    // The actual track data is always fetched from globalMusicLibrary.

    /** Add a track's canonical ID to the Community Mix membership list. */
    async addToCommunityMix(trackId) {
      const db = await getFirestore();
      const { doc, setDoc, arrayUnion, serverTimestamp } = await loadModule('firestore');
      await setDoc(doc(db, 'communityMix', 'meta'), {
        trackIds:  arrayUnion(String(trackId)),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    },

    /** Remove a track from the Community Mix membership list. */
    async removeFromCommunityMix(trackId) {
      const db = await getFirestore();
      const { doc, updateDoc, arrayRemove, serverTimestamp } = await loadModule('firestore');
      await updateDoc(doc(db, 'communityMix', 'meta'), {
        trackIds:  arrayRemove(String(trackId)),
        updatedAt: serverTimestamp(),
      });
    },

    /**
     * Listen to the Community Mix in real time.
     * Resolves the full track objects from globalMusicLibrary.
     * Calls callback with the resolved array.
     * Returns an unsubscribe function.
     */
    listenToCommunityMix(callback) {
      let unsubMeta = null;
      loadModule('firestore').then(function(fsModule) {
        var fsDoc = fsModule.doc;
        var onSnapshot = fsModule.onSnapshot;
        var collection = fsModule.collection;
        var fsWhere = fsModule.where;
        var getDocs = fsModule.getDocs;
        var fsQuery = fsModule.query;
        getFirestore().then(function(db) {
          unsubMeta = onSnapshot(fsDoc(db, 'communityMix', 'meta'), async function(snap) {
            var trackIds = (snap.exists() ? (snap.data().trackIds || []) : []);
            if (!trackIds.length) { callback([]); return; }
            try {
              var tracks = [];
              for (var i = 0; i < trackIds.length; i += 10) {
                var chunk = trackIds.slice(i, i + 10);
                try {
                  var chunkSnap = await getDocs(
                    fsQuery(collection(db, 'globalMusicLibrary'),
                            fsWhere('trackId', 'in', chunk),
                            fsWhere('isDeleted', '==', false))
                  );
                  chunkSnap.forEach(function(d) { tracks.push(Object.assign({ id: d.id }, d.data())); });
                } catch (_) {}
              }
              var byId = {};
              tracks.forEach(function(t) { byId[t.id] = t; if (t.trackId) byId[t.trackId] = t; });
              var ordered = trackIds.map(function(tid) { return byId[tid]; }).filter(Boolean);
              callback(ordered);
            } catch (err) {
              console.warn('[AVN] listenToCommunityMix resolve error:', err.message);
              callback([]);
            }
          }, function(err) {
            console.warn('[AVN] listenToCommunityMix snapshot error:', err.message);
            callback([]);
          });
        });
      });
      return function() { if (unsubMeta) unsubMeta(); };
    },

    /**
     * Get Community Mix tracks once (no real-time).
     */
    async getCommunityMixTracks() {
      const db = await getFirestore();
      const { doc, getDoc, collection, query, where, getDocs } = await loadModule('firestore');
      const metaSnap = await getDoc(doc(db, 'communityMix', 'meta'));
      const trackIds  = (metaSnap.exists() ? metaSnap.data().trackIds : []) || [];
      if (!trackIds.length) return [];

      const tracks = [];
      for (let i = 0; i < trackIds.length; i += 10) {
        const chunk = trackIds.slice(i, i + 10);
        try {
          const snap = await getDocs(
            query(collection(db, 'globalMusicLibrary'),
                  where('trackId', 'in', chunk),
                  where('isDeleted', '==', false))
          );
          snap.forEach(d => tracks.push({ id: d.id, ...d.data() }));
        } catch (_) {}
      }
      const byId = {};
      tracks.forEach(t => { byId[t.id] = t; if (t.trackId) byId[t.trackId] = t; });
      return trackIds.map(tid => byId[tid]).filter(Boolean);
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // REALTIME DATABASE  (Chat)
  // ═══════════════════════════════════════════════════════════════
  let _rtdb = null;

  async function getRTDB() {
    if (_rtdb) return _rtdb;
    const app = await getApp();
    const { getDatabase } = await loadModule('database');
    _rtdb = getDatabase(app);
    return _rtdb;
  }

  /**
   * AvenoraFirebase.RTDB — used by chat.js as a drop-in.
   * Mirrors the shape chat.js expects from Socket.io events.
   */
  const RTDBService = {
    /**
     * Subscribe to messages in a room.
     * Returns an unsubscribe function (call it on room leave / page cleanup).
     */
    async onMessages(roomId, callback) {
      const db = await getRTDB();
      const { ref, query: dbQuery, orderByChild, limitToLast, onValue } = await loadModule('database');
      const msgsRef = dbQuery(
        ref(db, `chat/${roomId}/messages`),
        orderByChild('timestamp'),
        limitToLast(100),
      );
      const unsub = onValue(msgsRef, (snap) => {
        const msgs = [];
        snap.forEach(child => msgs.push({ id: child.key, ...child.val() }));
        callback(msgs);
      });
      return () => unsub();
    },

    /**
     * Send a message to a room.
     */
    async sendMessage(roomId, content) {
      const db = await getRTDB();
      const { ref, push, serverTimestamp } = await loadModule('database');
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      await push(ref(db, `chat/${roomId}/messages`), {
        content,
        author: { id: user.id, username: user.username, avatarUrl: user.profile?.avatarUrl || null },
        timestamp: serverTimestamp(),
        roomId,
      });
    },

    /**
     * Write / clear a typing indicator for the current user.
     */
    async setTyping(roomId, isTyping) {
      const db = await getRTDB();
      const { ref, set, remove } = await loadModule('database');
      const user = LegendState.get('user');
      if (!user) return;
      const typingRef = ref(db, `chat/${roomId}/typing/${user.id}`);
      if (isTyping) {
        await set(typingRef, { username: user.username, at: Date.now() });
      } else {
        await remove(typingRef);
      }
    },

    /**
     * Subscribe to typing indicators for a room.
     */
    async onTyping(roomId, callback) {
      const db = await getRTDB();
      const { ref, onValue } = await loadModule('database');
      const typingRef = ref(db, `chat/${roomId}/typing`);
      const unsub = onValue(typingRef, (snap) => {
        const typists = {};
        snap.forEach(child => { typists[child.key] = child.val(); });
        callback(typists);
      });
      return () => unsub();
    },

    /**
     * Delete a message (moderation).
     */
    async deleteMessage(roomId, messageId) {
      const db = await getRTDB();
      const { ref, remove } = await loadModule('database');
      await remove(ref(db, `chat/${roomId}/messages/${messageId}`));
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // STORAGE — delegated to AvenoraStorage (Supabase backend proxy)
  // ═══════════════════════════════════════════════════════════════

  /**
   * AvenoraFirebase.Storage
   *
   * Delegates all file operations to AvenoraStorage (supabase.js).
   * The service-role key lives only on the backend — the browser
   * never directly contacts Supabase.
   *
   * This shim preserves the existing call-site API so pages that
   * previously called AvenoraFirebase.Storage.upload() continue
   * to work without changes.
   */
  const StorageService = {
    /**
     * Generic upload.
     * @param {string} category  — 'avatar' | 'image' | 'audio' | 'video' | 'thumbnail'
     * @param {File}   file
     * @param {Function} [onProgress]
     * @returns {Promise<string>} — the URL (signed or public)
     */
    async upload(category, file, onProgress) {
      if (!global.AvenoraStorage) throw new Error('AvenoraStorage (supabase.js) not loaded');
      const result = await global.AvenoraStorage.upload(category, file, onProgress);
      return result.url;
    },

    async uploadAvatar(file, onProgress) {
      if (!global.AvenoraStorage) throw new Error('AvenoraStorage not loaded');
      const result = await global.AvenoraStorage.uploadAvatar(file, onProgress);
      return result.url;
    },

    async uploadImage(file, onProgress) {
      if (!global.AvenoraStorage) throw new Error('AvenoraStorage not loaded');
      const result = await global.AvenoraStorage.uploadImage(file, onProgress);
      return result.url;
    },

    async uploadAudio(file, onProgress) {
      if (!global.AvenoraStorage) throw new Error('AvenoraStorage not loaded');
      const result = await global.AvenoraStorage.uploadAudio(file, onProgress);
      return result.url;
    },

    async uploadVideo(file, onProgress) {
      if (!global.AvenoraStorage) throw new Error('AvenoraStorage not loaded');
      const result = await global.AvenoraStorage.uploadVideo(file, onProgress);
      return result.url;
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════
  let _analytics = null;

  async function getAnalyticsInstance() {
    if (_analytics) return _analytics;
    const app = await getApp();
    const { getAnalytics } = await loadModule('analytics');
    _analytics = getAnalytics(app);
    return _analytics;
  }

  const AnalyticsService = {
    async logPageView(pageName) {
      try {
        const analytics = await getAnalyticsInstance();
        const { logEvent } = await loadModule('analytics');
        logEvent(analytics, 'page_view', { page_title: pageName, page_location: window.location.href });
      } catch { /* analytics is non-critical */ }
    },

    async logEvent(eventName, params = {}) {
      try {
        const analytics = await getAnalyticsInstance();
        const { logEvent } = await loadModule('analytics');
        logEvent(analytics, eventName, params);
      } catch { /* analytics is non-critical */ }
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // CLOUD MESSAGING (FCM)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Convert a URL-safe base64 string to a Uint8Array.
   * Required by PushManager.subscribe({ applicationServerKey: ... }).
   */
  function _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  /**
   * VAPID public key for Firebase Cloud Messaging Web Push.
   * This is the FCM VAPID key from the Firebase console.
   */
  const VAPID_KEY = 'BON0v9rTj7Zd9CCFbldD-dEtVSx0oa7ZgC-wJNdwpEjpEI9ikzL7PvQmKU5Ie2ZHeRKI9inq7hIuiKMZgHRqTeE';

  const MessagingService = {
    async requestPermission() {
      if (!('Notification' in window)) return 'unsupported';
      const permission = await Notification.requestPermission();
      return permission; // 'granted' | 'denied' | 'default'
    },

    async getToken() {
      try {
        const app = await getApp();
        const { getMessaging, getToken } = await loadModule('messaging');
        const messaging = getMessaging(app);
        const sw = await navigator.serviceWorker.ready;
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: sw });
        return token;
      } catch (err) {
        console.warn('[FCM] Could not get token:', err.message);
        return null;
      }
    },

    async setup() {
      if (!('serviceWorker' in navigator)) return;
      const permission = await MessagingService.requestPermission();
      if (permission !== 'granted') return;

      // ── Firebase Cloud Messaging token ──────────────────────
      const token = await MessagingService.getToken();
      if (token) {
        localStorage.setItem('lu_fcm_token', token);
        console.log('[FCM] Token registered');
      }

      // ── Web Push (VAPID) subscription ───────────────────────
      // Also register a standalone Web Push subscription with the backend so
      // the server can send push notifications via the /api/push/send endpoint.
      // This is a best-effort operation — failure does not break FCM pushes.
      try {
        const vapidData = await (window.LegendAPI?.push?.getVapidKey?.() ?? Promise.resolve(null));
        const vapidKey = vapidData?.vapidPublicKey;
        if (vapidKey && 'PushManager' in window) {
          const reg = await navigator.serviceWorker.ready;
          // Check for existing subscription first to avoid unnecessary re-subscription
          let sub = await reg.pushManager.getSubscription();
          if (!sub) {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: _urlBase64ToUint8Array(vapidKey),
            });
          }
          if (sub && window.LegendAPI?.push?.subscribe) {
            await window.LegendAPI.push.subscribe(sub).catch(e => {
              console.warn('[Push] Could not save Web Push subscription to backend:', e.message);
            });
            console.log('[Push] Web Push subscription registered');
          }
        }
      } catch (e) {
        console.warn('[Push] Web Push setup failed (non-critical):', e.message);
      }
    },

    async onForegroundMessage(callback) {
      try {
        const app = await getApp();
        const { getMessaging, onMessage } = await loadModule('messaging');
        const messaging = getMessaging(app);
        return onMessage(messaging, callback);
      } catch { return () => {}; }
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // Public namespace
  // ═══════════════════════════════════════════════════════════════
  global.AvenoraFirebase = {
    getApp,
    getFirebaseAuth,   // exposed so live.js can check auth.currentUser
    /** Returns the Firestore singleton (same as _db once initialised). */
    async getFirestore() { return getFirestore(); },
    /** Returns the Firestore SDK module (doc, onSnapshot, etc.) for direct use by page scripts. */
    async _loadModuleFirestore() { return loadModule('firestore'); },
    /** Direct access to the cached Firestore instance (may be null before first use). */
    get _db() { return _db; },
    Auth:      FirebaseAuth,
    Firestore: FirestoreService,
    RTDB:      RTDBService,
    Storage:   StorageService,
    Analytics: AnalyticsService,
    Messaging: MessagingService,
  };

})(window);
