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

      const user = _mapFbUser(cred.user, username);
      LegendState.set('user', user);
      // Persist uid so TokenStore shim stays truthy
      _persistUid(cred.user.uid);
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
            _persistUid(fbUser.uid);
            let user = _mapFbUser(fbUser);

            // Set the base user immediately so the nav shows the correct state right away.
            LegendState.set('user', user);
            callback(user);

            // Then try to load the Firestore role/profile — this updates the user
            // object asynchronously without blocking the initial render.
            try {
              const db = await getFirestore();
              const { doc, getDoc } = await loadModule('firestore');
              const snap = await getDoc(doc(db, 'users', fbUser.uid));
              if (snap.exists()) {
                const fsData = snap.data();
                let updated = { ...user };
                if (fsData.role && typeof fsData.role === 'string') {
                  updated.role = fsData.role;
                }
                if (fsData.username) updated.username = fsData.username;
                if (fsData.profile?.displayName || fsData.profile?.avatarUrl) {
                  updated.profile = {
                    ...updated.profile,
                    ...(fsData.profile.displayName ? { displayName: fsData.profile.displayName } : {}),
                    ...(fsData.profile.avatarUrl   ? { avatarUrl:   fsData.profile.avatarUrl   } : {}),
                  };
                }
                // Only update if role/profile actually changed — avoids unnecessary re-renders
                if (updated.role !== user.role || updated.username !== user.username) {
                  LegendState.set('user', updated);
                  callback(updated);
                }
              }
            } catch (_) {
              // Firestore role lookup is best-effort — never block auth
            }
          } else {
            _clearUid();
            LegendState.set('user', null);
            callback(null);
          }
        });
      });
    },

    /** Returns a fresh Firebase ID token (for backend-verified requests). */
    async getIdToken() {
      const auth = await getFirebaseAuth();
      if (!auth.currentUser) return null;
      return auth.currentUser.getIdToken();
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
      const ref = await addDoc(collection(db, 'posts'), {
        content,
        mediaUrls,
        tags,
        author: {
          id: user.id,
          uid: user.uid || user.id,
          username: user.username,
          avatarUrl: user.profile?.avatarUrl || null,
          profile: { displayName: user.profile?.displayName || user.username, avatarUrl: user.profile?.avatarUrl || null },
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

    async getProfileByUsername(username) {
      const db = await getFirestore();
      const { collection, query, where, limit, getDocs } = await loadModule('firestore');
      const q = query(collection(db, 'users'), where('username', '==', username), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async upsertProfile(uid, data) {
      const db = await getFirestore();
      const { doc, setDoc, serverTimestamp } = await loadModule('firestore');
      await setDoc(doc(db, 'users', uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
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
      const ref = await addDoc(collection(db, 'posts', postId, 'comments'), {
        content,
        author: { id: user.id, username: user.username, avatarUrl: user.profile?.avatarUrl || null },
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'posts', postId), { commentCount: increment(1) });
      return { id: ref.id };
    },

    async getComments(postId) {
      const db = await getFirestore();
      const { collection, query, orderBy, getDocs } = await loadModule('firestore');
      const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
          return uname.includes(q) || dname.includes(q) || email.includes(q);
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
