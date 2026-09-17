/**
 * AVENORA - API Client Service
 * All backend communication goes through this module.
 *
 * API endpoint resolution order:
 *   1. window.LU_CONFIG.apiUrl  (injected by index.html at runtime)
 *   2. VITE_API_BASE_URL build-time env var (if using Vite)
 *   3. Configuration error — shown in console; requests will fail clearly.
 *
 * Auth is handled by Firebase Authentication (AvenoraFirebase.Auth).
 * The TokenStore shim below reads the Firebase UID so that isLoggedIn()
 * keeps working for all callers without changes.
 */

(function (global) {
  'use strict';

  // ─── Central API base URL ─────────────────────────────────
  // Priority: runtime config → build-time env var → error
  // Accepts relative URLs (e.g. '/api') for same-host deployments,
  // or absolute URLs (e.g. 'https://api.avenora.app/api') for cross-host.
  const _rawApiUrl =
    (window.LU_CONFIG && window.LU_CONFIG.apiUrl) ||
    (typeof __VITE_API_BASE_URL__ !== 'undefined' ? __VITE_API_BASE_URL__ : null) ||
    null;

  let BASE_URL;
  if (_rawApiUrl) {
    // Strip trailing slash
    let _url = String(_rawApiUrl).replace(/\/$/, '');
    // Check path only (not hostname) — avoids false match on hostnames like api.avenora.app
    try {
      const _parsed = new URL(_url);
      const _path = _parsed.pathname;
      if (!_path.endsWith('/api') && !_path.startsWith('/api/')) {
        _url = _url + '/api';
      }
    } catch {
      // Relative URL (e.g. '/api') — check path directly
      if (!_url.endsWith('/api') && !_url.startsWith('/api/')) {
        _url = _url + '/api';
      }
    }
    BASE_URL = _url;
  } else {
    BASE_URL = null;
    console.error(
      '[AVENORA] ⚠️  Avenora API endpoint is not configured.\n' +
      '  Set window.LU_CONFIG = { apiUrl: "https://your-backend/api" } in index.html,\n' +
      '  or set VITE_API_BASE_URL=https://your-backend in your .env file.\n' +
      '  All API requests will fail until this is resolved.\n' +
      '  See backend/.env.example for configuration reference.'
    );
  }

  // ─── Token management (Firebase shim) ─────────────────────
  // Firebase manages its own ID tokens; we keep the UID in storage
  // as the "access token" sentinel so all isLoggedIn() checks pass.
  const TokenStore = {
    getAccess()   { return sessionStorage.getItem('lu_uid') || localStorage.getItem('lu_uid')
                        || sessionStorage.getItem('lu_access') || localStorage.getItem('lu_access'); },
    getRefresh()  { return localStorage.getItem('lu_refresh'); },
    setAccess(t)  { sessionStorage.setItem('lu_access', t); localStorage.setItem('lu_access', t); },
    setRefresh(t) { localStorage.setItem('lu_refresh', t); },
    clear() {
      ['lu_uid', 'lu_access', 'lu_refresh'].forEach(k => {
        sessionStorage.removeItem(k);
        localStorage.removeItem(k);
      });
    },
  };

  // ─── HTTP helpers ─────────────────────────────────────────
  let isRefreshing = false;
  let refreshQueue = [];

  async function request(method, path, opts = {}) {
    // Guard: fail fast and clearly if the API is not configured
    if (!BASE_URL) {
      const user = window.AvenoraFirebase?.Auth?.getUser?.() || null;
      const uid  = user?.uid || user?.id || null;
      const cfgErr = new Error(
        '[AVENORA] Avenora API endpoint is not configured. ' +
        'Set window.LU_CONFIG = { apiUrl: "https://your-backend/api" } in index.html ' +
        'or VITE_API_BASE_URL in your .env file.'
      );
      cfgErr.code = 'API_NOT_CONFIGURED';
      console.error(
        '[AVENORA] API request blocked — endpoint not configured',
        { method, path, firebaseAuthState: !!uid, uid }
      );
      throw cfgErr;
    }

    const fullUrl = `${BASE_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

    // Prefer a fresh Firebase ID token; fall back to stored JWT for legacy backend calls
    let token = null;
    if (window.AvenoraFirebase?.Auth) {
      token = await window.AvenoraFirebase.Auth.getIdToken().catch(() => null);
    }
    if (!token) token = TokenStore.getAccess();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Diagnostic: log the current auth state
    const _user = window.AvenoraFirebase?.Auth?.getUser?.() || null;
    const _uid  = _user?.uid || _user?.id || null;

    const config = {
      method,
      headers,
      signal: opts.signal,
    };
    if (opts.body && method !== 'GET') config.body = JSON.stringify(opts.body);

    let res;
    try {
      res = await fetch(fullUrl, config);
    } catch (networkErr) {
      console.error(
        `[AVENORA] Network error — ${method} ${fullUrl}`,
        { firebaseAuthState: !!_uid, uid: _uid, error: networkErr.message }
      );
      throw networkErr;
    }

    // Auto-refresh on 401
    if (res.status === 401 && TokenStore.getRefresh() && !opts._retried) {
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: TokenStore.getRefresh() }),
          });
          if (refreshRes.ok) {
            const { accessToken } = await refreshRes.json();
            TokenStore.setAccess(accessToken);
            refreshQueue.forEach(fn => fn(accessToken));
          } else {
            TokenStore.clear();
            LegendState.set('user', null);
            window.dispatchEvent(new Event('lu:logged-out'));
          }
        } finally {
          isRefreshing = false;
          refreshQueue = [];
        }
      }
      // Retry once
      return request(method, path, { ...opts, _retried: true });
    }

    // Parse response
    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      // Detailed diagnostic log — always show in console regardless of page-level error handling
      console.error(
        `[AVENORA] API error — ${method} ${fullUrl}`,
        {
          status:            res.status,
          statusText:        res.statusText,
          responseBody:      data,
          firebaseAuthState: !!_uid,
          uid:               _uid,
          errorMessage:      data?.message || `HTTP ${res.status}`,
          errorCode:         data?.code,
        }
      );
      const err = new Error(data?.message || `Request failed: ${res.status}`);
      err.status = res.status;
      err.code = data?.code;
      err.details = data?.details;
      throw err;
    }

    return data;
  }

  const get = (path, opts) => request('GET', path, opts);
  const post = (path, body, opts) => request('POST', path, { body, ...opts });
  const put = (path, body, opts) => request('PUT', path, { body, ...opts });
  const patch = (path, body, opts) => request('PATCH', path, { body, ...opts });
  const del = (path, opts) => request('DELETE', path, opts);

  // ─── Upload (multipart) ───────────────────────────────────
  async function upload(path, formData) {
    if (!BASE_URL) {
      console.error('[AVENORA] Upload blocked — API endpoint not configured', { path });
      throw new Error('[AVENORA] Avenora API endpoint is not configured.');
    }

    // Prefer a fresh Firebase ID token — the backend authenticate middleware
    // requires an RS256 Firebase JWT or a local HS256 JWT.  TokenStore.getAccess()
    // stores the Firebase UID (not a token), so we must ask Firebase for a real
    // ID token first.
    let token = null;
    if (window.AvenoraFirebase?.Auth) {
      token = await window.AvenoraFirebase.Auth.getIdToken().catch(() => null);
    }
    if (!token) token = TokenStore.getAccess();

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const fullUrl = `${BASE_URL}${path}`;
    let res;
    try {
      res = await fetch(fullUrl, { method: 'POST', headers, body: formData });
    } catch (networkErr) {
      console.error(`[AVENORA] Network error — upload to ${fullUrl}:`, networkErr.message);
      throw new Error(
        'Upload failed: could not reach the server. ' +
        'Check your internet connection and that the backend is running.'
      );
    }

    let data;
    try { data = await res.json(); } catch { data = { message: `HTTP ${res.status}` }; }

    if (!res.ok) {
      const message =
        res.status === 401 ? 'Upload failed: authentication expired. Please sign in again.' :
        res.status === 403 ? 'Upload failed: you do not have permission to upload.' :
        res.status === 413 ? 'Upload failed: file too large.' :
        res.status === 415 ? `Upload failed: unsupported file type. ${data?.message || ''}` :
        res.status === 503 ? 'Upload failed: storage service unavailable. Check Supabase configuration.' :
        data?.message || `Upload failed (HTTP ${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      console.error(`[AVENORA] Upload error — ${path}:`, { status: res.status, body: data });
      throw err;
    }
    return data;
  }

  // ─── Auth API — delegates to Firebase, falls back to REST ─
  const AuthAPI = {
    async register(username, email, password) {
      if (window.AvenoraFirebase?.Auth) {
        return window.AvenoraFirebase.Auth.register(username, email, password);
      }
      // Legacy REST fallback
      const data = await post('/auth/register', { username, email, password });
      TokenStore.setAccess(data.accessToken);
      TokenStore.setRefresh(data.refreshToken);
      LegendState.set('user', data.user);
      return data;
    },
    async login(email, password) {
      if (window.AvenoraFirebase?.Auth) {
        return window.AvenoraFirebase.Auth.login(email, password);
      }
      // Legacy REST fallback
      const data = await post('/auth/login', { email, password });
      TokenStore.setAccess(data.accessToken);
      TokenStore.setRefresh(data.refreshToken);
      LegendState.set('user', data.user);
      return data;
    },
    async logout() {
      if (window.AvenoraFirebase?.Auth) {
        return window.AvenoraFirebase.Auth.logout();
      }
      try { await post('/auth/logout', {}); } catch {}
      TokenStore.clear();
      LegendState.set('user', null);
      window.dispatchEvent(new Event('lu:logged-out'));
    },
    async me() {
      if (window.AvenoraFirebase?.Auth) {
        return window.AvenoraFirebase.Auth.me();
      }
      const data = await get('/auth/me');
      LegendState.set('user', data.user);
      return data.user;
    },
    async forgotPassword(email) {
      if (window.AvenoraFirebase?.Auth) {
        return window.AvenoraFirebase.Auth.forgotPassword(email);
      }
      return post('/auth/forgot-password', { email });
    },
    resetPassword: (token, password) => post('/auth/reset-password', { token, password }),
    isLoggedIn() { return !!TokenStore.getAccess(); },
    getUser() { return LegendState.get('user'); },
  };

  // ─── Posts API — backed by Firestore ─────────────────────
  const PostsAPI = {
    async feed(page = 1) {
      if (window.AvenoraFirebase?.Firestore) {
        const posts = await window.AvenoraFirebase.Firestore.getPosts(20 * page);
        const slice = posts.slice((page - 1) * 20, page * 20);
        return { posts: slice };
      }
      return get(`/posts?page=${page}&limit=20`);
    },
    async feedByAuthor(authorId, page = 1) {
      if (window.AvenoraFirebase?.Firestore) {
        const all = await window.AvenoraFirebase.Firestore.getPosts(200);
        const filtered = all.filter(p => p.author?.id === authorId);
        return { posts: filtered.slice((page - 1) * 20, page * 20) };
      }
      return get(`/posts?author=${authorId}&page=${page}&limit=20`);
    },
    async create(content, mediaUrls = [], tags = []) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.createPost(content, mediaUrls, tags);
      }
      return post('/posts', { content, mediaUrls, tags });
    },
    async update(id, content) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.updatePost(id, content);
      }
      return put(`/posts/${id}`, { content });
    },
    async delete(id) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.deletePost(id);
      }
      return del(`/posts/${id}`);
    },
    async like(id) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.likePost(id);
      }
      return post(`/posts/${id}/like`, {});
    },
    async comment(id, content) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.addComment(id, content);
      }
      return post(`/posts/${id}/comment`, { content });
    },
    async deleteComment(postId, commentId) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.deleteComment(postId, commentId);
      }
      return del(`/posts/${postId}/comment/${commentId}`);
    },
    async comments(postId) {
      if (window.AvenoraFirebase?.Firestore) {
        const comments = await window.AvenoraFirebase.Firestore.getComments(postId);
        return { comments };
      }
      return get(`/posts/${postId}/comments`);
    },
    repost: (id, comment) => post(`/posts/${id}/repost`, { comment }),
  };

  // ─── Videos API ───────────────────────────────────────────
  // Reads from Firestore first (where our direct-upload metadata lives).
  // Falls back to the REST API if Firestore is unavailable.
  const VideosAPI = {
    async list(params = {}) {
      if (window.AvenoraFirebase) {
        try {
          const videos = await _listVideosFromFirestore(params);
          return { videos, total: videos.length };
        } catch (fsErr) {
          console.warn('[AVN] Firestore video list failed, falling back to API:', fsErr.message);
        }
      }
      const q = new URLSearchParams(params).toString();
      return get(`/videos?${q}`);
    },
    async get(id) {
      if (window.AvenoraFirebase) {
        try {
          const video = await _getVideoFromFirestore(id);
          if (video) return { video };
        } catch (_) {}
      }
      return get(`/videos/${id}`);
    },
    like: (id) => {
      // Like in Firestore if available
      if (window.AvenoraFirebase?.Firestore) {
        return _likeVideoInFirestore(id);
      }
      return post(`/videos/${id}/like`, {});
    },

    // Comments — Firestore sub-collection
    async comments(videoId, page = 1) {
      if (window.AvenoraFirebase) {
        try {
          const items = await _getVideoCommentsFromFirestore(videoId);
          const start = (page - 1) * 20;
          return { comments: items.slice(start, start + 20) };
        } catch (_) {}
      }
      return get(`/videos/${videoId}/comments?page=${page}`);
    },
    async addComment(videoId, content) {
      if (window.AvenoraFirebase) {
        try { return _addVideoCommentToFirestore(videoId, content); } catch (_) {}
      }
      return post(`/videos/${videoId}/comments`, { content });
    },
    deleteComment: (videoId, commentId) => del(`/videos/${videoId}/comments/${commentId}`),

    // Watch Later / History — local (SOM state) for now; no backend required
    toggleWatchLater: (id) => post(`/videos/${id}/watchlater`, {}).catch(() => ({ ok: true })),
    getWatchLater:    ()   => get('/videos/me/watchlater').catch(() => ({ videos: [] })),
    updateHistory:    (id, position) => post(`/videos/${id}/history`, { position }).catch(() => ({})),
    getHistory:       ()   => get('/videos/me/history').catch(() => ({ videos: [] })),
    deleteHistory:    (videoId) => del(`/videos/history/${videoId}`).catch(() => ({})),

    // Channels
    channels: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/videos/channels?${q}`).catch(() => ({ channels: [] }));
    },
    channel: (id) => get(`/videos/channel/${id}`).catch(() => null),
    subscribeChannel: (id) => post(`/videos/channel/${id}/subscribe`, {}).catch(() => ({})),

    // Report
    reportVideo: (id, reason, details) =>
      post(`/videos/${id}/report`, { reason, details }).catch(() => ({})),

    // Moderation
    deleteVideo: (id) => del(`/videos/${id}`),
    restoreVideo: (id) => put(`/videos/${id}/restore`, {}),
    featureVideo: (id, featured = true) => put(`/videos/${id}/feature`, { featured }),
    suspendChannel: (id, reason) => put(`/videos/channel/${id}/suspend`, { reason }),
    unsuspendChannel: (id) => put(`/videos/channel/${id}/unsuspend`, {}),
  };

  // ── Firestore helpers for video CRUD ────────────────────────
  async function _listVideosFromFirestore({ sort = 'new', limit: lim = 24, category } = {}) {
    const db = await window.AvenoraFirebase.getFirestore();
    const SDK_VER = '10.12.2';
    const { collection, query, orderBy, limit, getDocs, where } =
      await import(`https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-firestore.js`);

    const constraints = [
      orderBy('createdAt', 'desc'),
      limit(lim),
    ];
    if (category) constraints.push(where('category', '==', category));
    // Only show public and unlisted videos
    // (private requires owner filter which we don't do at list level)
    const q = query(collection(db, 'videos'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id:          d.id,
        _id:         d.id,
        title:       data.title || 'Untitled',
        description: data.description || '',
        category:    data.category || 'other',
        visibility:  data.visibility || 'public',
        videoUrl:    data.videoUrl || '',
        thumbnailUrl: data.thumbnailUrl || null,
        views:       data.views || 0,
        likes:       data.likes || [],
        likeCount:   (data.likes || []).length,
        commentCount: data.commentCount || 0,
        processingStatus: data.processingStatus || 'ready',
        uploader:    data.owner || {},
        owner:       data.owner || {},
        createdAt:   data.createdAt,
      };
    });
  }

  async function _getVideoFromFirestore(id) {
    const db = await window.AvenoraFirebase.getFirestore();
    const SDK_VER = '10.12.2';
    const { doc, getDoc } =
      await import(`https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-firestore.js`);
    const snap = await getDoc(doc(db, 'videos', id));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      id: snap.id, _id: snap.id,
      title: data.title, description: data.description,
      category: data.category, visibility: data.visibility,
      videoUrl: data.videoUrl, thumbnailUrl: data.thumbnailUrl,
      views: data.views || 0, likes: data.likes || [],
      likeCount: (data.likes || []).length,
      commentCount: data.commentCount || 0,
      processingStatus: data.processingStatus || 'ready',
      uploader: data.owner || {}, owner: data.owner || {},
      createdAt: data.createdAt,
    };
  }

  async function _likeVideoInFirestore(id) {
    const db = await window.AvenoraFirebase.getFirestore();
    const SDK_VER = '10.12.2';
    const { doc, updateDoc, arrayUnion, arrayRemove, getDoc } =
      await import(`https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-firestore.js`);
    const user = LegendState.get('user');
    if (!user) throw new Error('Not authenticated');
    const uid = user.uid || user.id;
    const ref = doc(db, 'videos', id);
    const snap = await getDoc(ref);
    const likes = snap.data()?.likes || [];
    if (likes.includes(uid)) {
      await updateDoc(ref, { likes: arrayRemove(uid) });
      return { liked: false, likeCount: likes.length - 1 };
    } else {
      await updateDoc(ref, { likes: arrayUnion(uid) });
      return { liked: true, likeCount: likes.length + 1 };
    }
  }

  async function _getVideoCommentsFromFirestore(videoId) {
    const db = await window.AvenoraFirebase.getFirestore();
    const SDK_VER = '10.12.2';
    const { collection, query, orderBy, getDocs } =
      await import(`https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-firestore.js`);
    const q = query(collection(db, 'videos', videoId, 'comments'), orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function _addVideoCommentToFirestore(videoId, content) {
    const db = await window.AvenoraFirebase.getFirestore();
    const SDK_VER = '10.12.2';
    const { collection, addDoc, doc, updateDoc, increment, serverTimestamp } =
      await import(`https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-firestore.js`);
    const user = LegendState.get('user');
    if (!user) throw new Error('Not authenticated');
    const ref = await addDoc(collection(db, 'videos', videoId, 'comments'), {
      content,
      author: { id: user.uid || user.id, username: user.username, avatarUrl: user.profile?.avatarUrl || null },
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'videos', videoId), { commentCount: increment(1) });
    return { id: ref.id };
  }

  // ─── Streams API — legacy read-only list/get ──────────────
  const StreamsAPI = {
    list: (status = 'live') => get(`/streams?status=${status}`),
    get: (id) => get(`/streams/${id}`),
  };

  // ─── Live API — browser-based WHIP/HLS live sessions ──────
  // Replaces OBS/RTMP/Streamlabs flow. Publisher uses WebRTC/WHIP
  // from the browser; viewers receive HLS from MediaMTX.
  const LiveAPI = {
    // Public list of live streams
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/live?${q}`);
    },
    // Get a single stream (public)
    get: (id) => get(`/live/${id}`),
    // Get playback info (HLS URL, publisher status) — public
    playback: (id) => get(`/live/${id}/playback`),
    // Get viewer count — public
    viewers: (id) => get(`/live/${id}/viewers`),
    // Current user's own sessions — authenticated
    mySessions: () => get('/live/my/sessions'),
    // Create a new live session — authenticated
    create: (data) => post('/live', data),
    // Update title/description/category — authenticated
    update: (id, data) => request('PATCH', `/live/${id}`, { body: data }),
    // Signal publisher is about to connect WHIP — authenticated
    startPublishing: (id) => post(`/live/${id}/start-publishing`, {}),
    // Signal publisher is disconnecting — authenticated
    stopPublishing: (id) => post(`/live/${id}/stop-publishing`, {}),
    // Heartbeat from publisher — authenticated
    // metrics: { bitrate, fps, resolution, errors }
    reportHealth: (id, metrics = {}) => post(`/live/${id}/health`, metrics),
    // Report a stream error — authenticated
    reportError: (id, code, message, phase) =>
      post(`/live/${id}/error`, { code, message, phase }),
    // Admin: MediaMTX health check — requires founder role
    mediaMTXHealth: () => get('/live/health-check'),
  };

  // ─── Search API ───────────────────────────────────────────
  const SearchAPI = {
    async search(query, type) {
      // Firebase Firestore is the primary search backend.
      // Wait up to 4 s for Firebase to finish its async initialisation before
      // falling through — this avoids "API_NOT_CONFIGURED" errors when the user
      // types quickly right after page load.
      let fs = window.AvenoraFirebase?.Firestore;
      if (!fs?.search) {
        // Poll for up to 4 seconds (16 × 250 ms)
        for (let i = 0; i < 16 && !fs?.search; i++) {
          await new Promise(r => setTimeout(r, 250));
          fs = window.AvenoraFirebase?.Firestore;
        }
      }

      if (fs?.search) {
        try {
          const results = await fs.search(query);
          // If a specific type filter is active, zero out the others
          if (type && type !== 'all') {
            return {
              results: {
                users:  type === 'users'  ? results.users  : [],
                posts:  type === 'posts'  ? results.posts  : [],
                videos: type === 'videos' ? results.videos : [],
              },
            };
          }
          return { results };
        } catch (fsErr) {
          console.error('[AVN] Firestore search error:', fsErr);
          // Surface a clear, actionable error instead of a generic "Something went wrong"
          const msg = fsErr.code === 'permission-denied'
            ? 'Search permission denied — please sign in and try again.'
            : `Search failed: ${fsErr.message || 'unknown Firestore error'}`;
          const err = new Error(msg);
          err.code = fsErr.code || 'FIRESTORE_SEARCH_ERROR';
          err.original = fsErr;
          throw err;
        }
      }

      // Firebase genuinely unavailable — do not silently hit a missing REST endpoint
      const cfgErr = new Error(
        'Firebase is not available. Check your internet connection and reload the page.'
      );
      cfgErr.code = 'FIREBASE_NOT_READY';
      throw cfgErr;
    },
  };

  // ─── Users API ────────────────────────────────────────────
  const UsersAPI = {
    async profile(username) {
      if (window.AvenoraFirebase?.Firestore) {
        const currentUser = LegendState.get('user');
        // If viewing own profile, look up by UID directly (faster)
        if (currentUser && currentUser.username === username) {
          const fsProfile = await window.AvenoraFirebase.Firestore.getProfile(currentUser.id);
          const merged = { ...currentUser, ...(fsProfile || {}) };
          return {
            user: {
              id: merged.id || currentUser.id,
              username: merged.username || username,
              role: merged.role || 'member',
              profile: merged.profile || {},
              stats: merged.stats || {},
              createdAt: merged.createdAt || new Date().toISOString(),
              isOwnProfile: true,
              isFollowing: false,
            },
          };
        }
        // Viewing another user's profile — query by username field
        const fsProfile = await window.AvenoraFirebase.Firestore.getProfileByUsername(username);
        if (fsProfile) {
          return {
            user: {
              id: fsProfile.id,
              username: fsProfile.username || username,
              role: fsProfile.role || 'member',
              profile: fsProfile.profile || {},
              stats: fsProfile.stats || {},
              createdAt: fsProfile.createdAt || new Date().toISOString(),
              isOwnProfile: false,
              isFollowing: false,
            },
          };
        }
      }
      return get(`/users/${username}`);
    },
    async posts(username, page = 1) {
      if (window.AvenoraFirebase?.Firestore) {
        const currentUser = LegendState.get('user');
        let authorId = (currentUser?.username === username) ? currentUser.id : null;
        if (!authorId) {
          const fsProfile = await window.AvenoraFirebase.Firestore.getProfileByUsername(username);
          authorId = fsProfile?.id || null;
        }
        if (authorId) {
          return PostsAPI.feedByAuthor(authorId, page);
        }
      }
      return get(`/users/${username}/posts?page=${page}&limit=20`);
    },
    follow: (id) => post(`/users/${id}/follow`, {}),
    unfollow: (id) => del(`/social/follow/${id}`),
    followStatus: (id) => get(`/social/follow/status/${id}`),
    followers: (id, page = 1) => get(`/social/followers/${id}?page=${page}`),
    following: (id, page = 1) => get(`/social/following/${id}?page=${page}`),
    updateProfile: async (data) => {
      // Always persist to the MongoDB backend (the authoritative record for follow
      // counts, role, and profile fields like avatarUrl / bannerUrl used everywhere).
      // Additionally mirror to Firestore so Firestore-backed pages stay in sync.
      let result;
      try {
        result = await put('/users/profile', data);
      } catch (backendErr) {
        // Backend unavailable — fall back to Firestore-only update
        console.warn('[AVN] Profile backend update failed, falling back to Firestore:', backendErr.message);
        if (window.AvenoraFirebase?.Firestore) {
          const user = LegendState.get('user');
          if (!user) throw new Error('Not authenticated');
          await window.AvenoraFirebase.Firestore.upsertProfile(user.id, { profile: { ...user.profile, ...data } });
          const updated = { ...user, profile: { ...user.profile, ...data } };
          LegendState.set('user', updated);
          return { user: updated };
        }
        throw backendErr;
      }
      // Backend succeeded — mirror to Firestore as a secondary sync (non-critical)
      try {
        if (window.AvenoraFirebase?.Firestore) {
          const user = LegendState.get('user');
          if (user) {
            await window.AvenoraFirebase.Firestore.upsertProfile(user.id, { profile: { ...user.profile, ...data } });
          }
        }
      } catch (_) {}
      return result;
    },
  };

  // ─── Upload API — delegates to Supabase Storage via AvenoraStorage ───────────
  const UploadAPI = {
    async image(file, onProgress) {
      if (window.AvenoraStorage) return window.AvenoraStorage.uploadImage(file, onProgress);
      const fd = new FormData(); fd.append('file', file);
      return upload('/upload/image', fd);
    },
    async avatar(file, onProgress) {
      if (window.AvenoraStorage) return window.AvenoraStorage.uploadAvatar(file, onProgress);
      const fd = new FormData(); fd.append('file', file);
      return upload('/upload/avatar', fd);
    },
    async audio(file, onProgress) {
      if (window.AvenoraStorage) return window.AvenoraStorage.uploadAudio(file, onProgress);
      const fd = new FormData(); fd.append('file', file);
      return upload('/upload/audio', fd);
    },
    async video(file, onProgress) {
      if (window.AvenoraStorage) return window.AvenoraStorage.uploadVideo(file, onProgress);
      const fd = new FormData(); fd.append('file', file);
      return upload('/upload/video', fd);
    },
  };

  // ─── Notifications API ────────────────────────────────────
  const NotificationsAPI = {
    list: (page = 1) => get(`/notifications?page=${page}&limit=20`),
    markRead: (id) => put(`/notifications/${id}/read`, {}),
    markAllRead: () => put('/notifications/read-all', {}),
  };

  // ─── Reports API ─────────────────────────────────────────
  const ReportsAPI = {
    submit: (targetType, targetId, reason, details) =>
      post('/reports', { targetType, targetId, reason, details }),
    list: (status = 'pending', page = 1) => get(`/reports?status=${status}&page=${page}`),
    review: (id, status, reviewNote) => put(`/reports/${id}`, { status, reviewNote }),
  };

  // ─── Stories API — backed by Firestore ───────────────────
  const StoriesAPI = {
    async feed() {
      if (window.AvenoraFirebase?.Firestore) {
        const stories = await window.AvenoraFirebase.Firestore.getStories();
        return { stories };
      }
      return get('/stories');
    },
    async byUser(userId) {
      if (window.AvenoraFirebase?.Firestore) {
        const stories = await window.AvenoraFirebase.Firestore.getStoriesByUser(userId);
        return { stories };
      }
      return get(`/stories/${userId}`);
    },
    async create(mediaUrl, mediaType, caption) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.createStory(mediaUrl, mediaType, caption);
      }
      return post('/stories', { mediaUrl, mediaType, caption });
    },
    view: (id) => post(`/stories/${id}/view`, {}),
    async delete(id) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.deleteStory(id);
      }
      return del(`/stories/${id}`);
    },
  };

  // ─── Gallery API — backed by Firestore + Supabase Storage ──
  const GalleryAPI = {
    async list(params = {}) {
      if (window.AvenoraFirebase?.Firestore) {
        const items = await window.AvenoraFirebase.Firestore.getGallery(params.limit || 24);
        // Client-side filter by category / search query
        const filtered = items.filter(i => {
          const catOk = !params.category || params.category === 'all' || i.mediaType === params.category || i.category === params.category;
          const qOk   = !params.q || (i.caption || i.title || '').toLowerCase().includes(params.q.toLowerCase());
          return catOk && qOk;
        });
        return { images: filtered.map(i => ({
          _id: i.id, url: i.url, title: i.caption || i.title || 'Untitled',
          category: i.mediaType || i.category || 'artwork',
          uploader: { username: i.author?.username, _id: i.author?.id },
          likeCount: (i.likes || []).length,
          likedByMe: (i.likes || []).includes(LegendAPI?.auth?.getUser()?.id),
          createdAt: i.createdAt,
        })), total: filtered.length };
      }
      const q = new URLSearchParams(params).toString();
      return get(`/gallery?${q}`);
    },
    async upload(formData) {
      // Primary path: upload via the backend multipart API which routes through
      // Supabase Storage server-side with the service-role key.
      // AvenoraStorage direct upload is the fallback when the backend is unreachable.
      try {
        return await upload('/gallery/upload', formData);
      } catch (backendErr) {
        // Backend unreachable — fall back to direct Supabase upload + Firestore metadata
        console.warn('[AVN] Gallery backend upload failed, trying direct upload:', backendErr.message);
        if (window.AvenoraStorage) {
          const file     = formData.get('file');
          const category = formData.get('category') || 'artwork';
          const title    = formData.get('title') || '';
          if (!file) throw backendErr;
          const result = await window.AvenoraStorage.uploadImage(file);
          try {
            if (window.AvenoraFirebase?.Firestore?.addGalleryItem) {
              await window.AvenoraFirebase.Firestore.addGalleryItem(result.url, category, title);
            }
          } catch (_) {}
          return { images: [{ _id: Date.now().toString(), url: result.url, title, category,
            uploader: { username: LegendAPI?.auth?.getUser()?.username }, createdAt: new Date().toISOString() }] };
        }
        throw backendErr;
      }
    },
    async like(id) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.likeGalleryItem(id);
      }
      return post(`/gallery/${id}/like`, {});
    },
    async delete(id) {
      if (window.AvenoraFirebase?.Firestore) {
        return window.AvenoraFirebase.Firestore.deleteGalleryItem(id);
      }
      return del(`/gallery/${id}`);
    },
  };

  // ─── Music API ────────────────────────────────────────────
  const MusicAPI = {
    tracks: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/music/tracks?${q}`);
    },
    track: (id) => get(`/music/tracks/${id}`),
    albums: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/music/albums?${q}`);
    },
    album: (id) => get(`/music/albums/${id}`),
    artists: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/music/artists?${q}`);
    },
    artist: (id) => get(`/music/artists/${id}`),
    playlists: () => get('/music/playlists'),
    playlist: (id) => get(`/music/playlists/${id}`),
    like: (id) => post(`/music/tracks/${id}/like`, {}),
    upload: (formData) => upload('/music/upload', formData),
    search: (q, limit = 20) => get(`/music/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  };

  // ─── Chat API ─────────────────────────────────────────────
  const ChatAPI = {
    rooms: () => get('/chat/rooms'),
    history: (roomId, limit = 50) => get(`/chat/rooms/${roomId}/history?limit=${limit}`),
    deleteMessage: (id) => del(`/chat/messages/${id}`),
    reportMessage: (id, reason = 'other', details) => post(`/chat/messages/${id}/report`, { reason, details }),
    block: (userId) => post(`/chat/users/${userId}/block`, {}),
    unblock: (userId) => post(`/chat/users/${userId}/unblock`, {}),
    blocks: () => get('/chat/blocks'),
  };

  // ─── Private Rooms API ────────────────────────────────────
  const PrivateRoomsAPI = {
    list: () => get('/rooms'),
    discover: (q) => get(`/rooms/discover${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    get: (roomId) => get(`/rooms/${roomId}`),
    create: (data) => post('/rooms', data),
    update: (roomId, data) => patch(`/rooms/${roomId}`, data),
    delete: (roomId, action = 'archive') => del(`/rooms/${roomId}?action=${action}`),
    join: (roomId) => post(`/rooms/${roomId}/join`, {}),
    invite: (roomId, username) => post(`/rooms/${roomId}/invite`, { username }),
    approveJoin: (roomId, uid) => post(`/rooms/${roomId}/join-requests/${uid}/approve`, {}),
    rejectJoin: (roomId, uid) => post(`/rooms/${roomId}/join-requests/${uid}/reject`, {}),
    removeMember: (roomId, uid) => del(`/rooms/${roomId}/members/${uid}`),
    ban: (roomId, uid, reason) => post(`/rooms/${roomId}/ban/${uid}`, { reason }),
    unban: (roomId, uid) => del(`/rooms/${roomId}/ban/${uid}`),
    mute: (roomId, uid, minutes = 60) => post(`/rooms/${roomId}/mute/${uid}`, { minutes }),
    history: (roomId, limit = 50, before) => get(`/rooms/${roomId}/history?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  };

  // ─── Direct Messages API ──────────────────────────────────
  const DMAPI = {
    list: () => get('/dm'),
    create: (data) => post('/dm', data),
    conversation: (id) => get(`/dm/${id}`),
    messages: (id, limit = 50, before) => get(`/dm/${id}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
    send: (id, content, replyToId) => post(`/dm/${id}/messages`, { content, replyToId }),
    deleteMessage: (conversationId, msgId) => del(`/dm/${conversationId}/messages/${msgId}`),
    read: (id) => post(`/dm/${id}/read`, {}),
    mute: (id, mute = true, hours = 24) => post(`/dm/${id}/mute`, { mute, hours }),
    block: (id) => post(`/dm/${id}/block`, {}),
    unblock: (id) => post(`/dm/${id}/unblock`, {}),
  };

  // ─── Inbox API ────────────────────────────────────────────
  const InboxAPI = {
    list: () => get('/inbox'),
    unread: () => get('/inbox/unread'),
  };

  // ─── Admin API ────────────────────────────────────────────
  const AdminAPI = {
    dashboard: () => get('/admin/dashboard'),
    users: (page, search) => get(`/admin/users?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    setRole: (userId, role) => put(`/admin/users/${userId}/role`, { role }),
    suspend: (userId, reason, until) => put(`/admin/users/${userId}/suspend`, { reason, until }),
    unsuspend: (userId) => put(`/admin/users/${userId}/unsuspend`, {}),
    flaggedPosts: () => get('/admin/posts/flagged'),
    reports: (status = 'pending', page = 1) => get(`/admin/reports?status=${status}&page=${page}`),
    deletePost: (id) => del(`/admin/posts/${id}`),
    system: () => get('/admin/system'),
  };

  // ─── Founder Theme API ────────────────────────────────────
  const FounderThemeAPI = {
    list:           ()              => get('/admin/themes'),
    published:      ()              => get('/admin/themes/published'),
    history:        ()              => get('/admin/themes/history'),
    get:            (id)            => get(`/admin/themes/${id}`),
    create:         (data)          => post('/admin/themes', data),
    update:         (id, data)      => put(`/admin/themes/${id}`, data),
    publish:        (id)            => post(`/admin/themes/${id}/publish`, {}),
    rollback:       (id)            => post(`/admin/themes/${id}/rollback`, {}),
    delete:         (id)            => del(`/admin/themes/${id}`),
    // Public endpoint — no auth required, used on every page load
    active: () => {
      if (!BASE_URL) return Promise.resolve({ success: false, theme: null });
      return fetch(`${BASE_URL}/themes/active`).then(r => r.json()).catch(() => ({ success: false, theme: null }));
    },
  };

  // ─── Cloud Stream API ─────────────────────────────────────
  const CloudStreamAPI = {
    status:         ()              => get('/admin/cloud-stream/status'),
    queue:          ()              => get('/admin/cloud-stream/queue'),
    media:          ()              => get('/admin/cloud-stream/media'),
    start:          ()              => post('/admin/cloud-stream/start', {}),
    stop:           ()              => post('/admin/cloud-stream/stop', {}),
    pause:          ()              => post('/admin/cloud-stream/pause', {}),
    resume:         ()              => post('/admin/cloud-stream/resume', {}),
    skip:           ()              => post('/admin/cloud-stream/skip', {}),
    refresh:        ()              => post('/admin/cloud-stream/refresh', {}),
    addToQueue:     (files)         => post('/admin/cloud-stream/queue/add', { files }),
    removeFromQueue:(index)         => del(`/admin/cloud-stream/queue/${index}`),
    reorderQueue:   (from, to)      => put('/admin/cloud-stream/queue/reorder', { from, to }),
    clearQueue:     ()              => del('/admin/cloud-stream/queue'),
    setSettings: (shuffle, repeat) => {
      const body = {};
      if (shuffle !== undefined) body.shuffle = shuffle;
      if (repeat  !== undefined) body.repeat  = repeat;
      return put('/admin/cloud-stream/settings', body);
    },
  };

  // ─── Health ───────────────────────────────────────────────
  const HealthAPI = {
    check: () => {
      if (!BASE_URL) return Promise.resolve({ status: 'error', error: 'API endpoint not configured' });
      const healthUrl = BASE_URL.replace(/\/api$/, '') + '/api/health';
      return fetch(healthUrl).then(r => r.json()).catch(() => ({ status: 'error' }));
    },
  };

  // ─── Companion API — backed directly by Firestore ─────────────
  // The companion feature has no REST backend; all reads and writes
  // go to the companions/{uid} Firestore document so they work
  // without any server configuration.
  const CompanionAPI = {
    // ── Load companion data for the current user ───────────
    async me() {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const fs = window.AvenoraFirebase?.Firestore;
      if (!fs) throw new Error('Firebase not ready');
      const data = await fs.getCompanion(user.id || user.uid);
      return { companion: data };
    },

    // ── Mark as discovered ─────────────────────────────
    async discover() {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const fs = window.AvenoraFirebase?.Firestore;
      if (!fs) throw new Error('Firebase not ready');
      await fs.saveCompanion(user.id || user.uid, { discovered: true });
      return { success: true };
    },

    // ── Save name / appearance / personality ─────────────────
    async setup(data) {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const fs = window.AvenoraFirebase?.Firestore;
      if (!fs) throw new Error('Firebase not ready');
      const patch = {};
      if (data.name        !== undefined) patch.name        = data.name;
      if (data.appearance  !== undefined) patch.appearance  = data.appearance;
      if (data.personality !== undefined) patch.personality = data.personality;
      await fs.saveCompanion(user.id || user.uid, patch);
      return { success: true };
    },

    // ── Care actions: feed / water ─────────────────────────
    async care(action) {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const fs = window.AvenoraFirebase?.Firestore;
      if (!fs) throw new Error('Firebase not ready');
      const uid = user.id || user.uid;

      // Read current state
      const existing = (await fs.getCompanion(uid)) || {};
      const care = {
        hunger:    existing.care?.hunger    ?? 80,
        water:     existing.care?.water     ?? 80,
        happiness: existing.care?.happiness ?? 80,
        energy:    existing.care?.energy    ?? 80,
      };

      // Apply the action
      const cap = v => Math.min(100, Math.max(0, v));
      const messages = {
        feed:  'Delicious! Thank you for the offering.',
        water: 'So refreshing. Thank you.',
      };
      switch (action) {
        case 'feed':
          care.hunger    = cap(care.hunger    + 25);
          care.energy    = cap(care.energy    + 10);
          care.happiness = cap(care.happiness + 5);
          break;
        case 'water':
          care.water     = cap(care.water     + 25);
          care.energy    = cap(care.energy    + 10);
          care.happiness = cap(care.happiness + 5);
          break;
        default:
          care.happiness = cap(care.happiness + 10);
      }

      await fs.saveCompanion(uid, { care });
      return { care, message: messages[action] || 'Thank you.' };
    },

    // ── Task actions: complete / toggle_enabled ────────────────
    async taskAction(key, action) {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const fs = window.AvenoraFirebase?.Firestore;
      if (!fs) throw new Error('Firebase not ready');
      const uid = user.id || user.uid;

      const existing = (await fs.getCompanion(uid)) || {};
      const tasks = existing.dailyTasks || [];
      const task = tasks.find(t => t.key === key);
      if (!task) return { success: true };

      if (action === 'complete') {
        task.completedToday = true;
        task.lastCompleted  = new Date().toISOString();
      } else if (action === 'toggle_enabled') {
        task.enabled = !task.enabled;
      }

      await fs.saveCompanion(uid, { dailyTasks: tasks });
      return { success: true };
    },

    // ── Mini-game high score ───────────────────────────────
    async gameScore(score) {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const fs = window.AvenoraFirebase?.Firestore;
      if (!fs) throw new Error('Firebase not ready');
      const uid = user.id || user.uid;

      const existing = (await fs.getCompanion(uid)) || {};
      const current  = existing.miniGame?.highScore ?? 0;
      const isHighScore = score > current;
      const miniGame = {
        ...(existing.miniGame || {}),
        gamesPlayed: (existing.miniGame?.gamesPlayed || 0) + 1,
        ...(isHighScore ? { highScore: score } : {}),
      };
      await fs.saveCompanion(uid, { miniGame });
      return { isHighScore, highScore: isHighScore ? score : current };
    },

    // ── Widget visibility / disabled ─────────────────────────
    async widget(data) {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const fs = window.AvenoraFirebase?.Firestore;
      if (!fs) throw new Error('Firebase not ready');
      const patch = {};
      if (data.widgetVisible !== undefined) patch.widgetVisible = data.widgetVisible;
      if (data.disabled      !== undefined) patch.disabled      = data.disabled;
      await fs.saveCompanion(user.id || user.uid, patch);
      return { success: true };
    },
  };

  // ─── Preferences API ─────────────────────────────────────
  // Keys that are safe to round-trip through Firestore.
  // Any field not in this list (e.g. Firestore metadata like updatedAt)
  // is stripped before the data enters client state or goes back to Firestore,
  // preventing "Unsupported field value: a plain object" errors caused by
  // Timestamp objects being JSON-serialised into {seconds, nanoseconds} dicts.
  const PREF_KEYS = [
    'theme','accentColor','textSize','gothicIntensity','highContrast',
    'reducedMotion','soundEnabled','autoplay','captions',
    'notifications','homeCards',
    'startSection','continueWatching','continueListening',
    'recentlyVisited','savedItems','mutedTopics',
  ];

  function _stripPrefs(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const k of PREF_KEYS) {
      if (raw[k] !== undefined) out[k] = raw[k];
    }
    return out;
  }

  const PreferencesAPI = {
    async get() {
      const user = LegendState.get('user');
      if (window.AvenoraFirebase?.Firestore && user) {
        const raw = await window.AvenoraFirebase.Firestore.getUserPreferences(user.id).catch(() => null);
        // Strip Firestore metadata (Timestamp objects etc.) — only keep known pref keys
        const stored = _stripPrefs(raw);
        const founderAccess = ['founder','admin'].includes(user.role);
        return { preferences: { ...stored, _founderAccess: founderAccess } };
      }
      return get('/preferences');
    },

    async save(prefs) {
      const user = LegendState.get('user');
      if (window.AvenoraFirebase?.Firestore && user) {
        // Only send known preference keys — never _founderAccess or metadata
        const toSave = _stripPrefs(prefs);
        await window.AvenoraFirebase.Firestore.setUserPreferences(user.id, toSave);
        return {
          success: true,
          preferences: { ...toSave, _founderAccess: ['founder','admin'].includes(user.role) }
        };
      }
      return put('/preferences', prefs);
    },

    async reset() {
      const user = LegendState.get('user');
      if (window.AvenoraFirebase?.Firestore && user) {
        // Write an empty object — setUserPreferences will add only updatedAt
        await window.AvenoraFirebase.Firestore.setUserPreferences(user.id, {});
        return this.get();
      }
      return post('/preferences/reset', {});
    },
  };

  // ─── Exports ──────────────────────────────────────────────
  global.LegendAPI = {
    request,
    auth: AuthAPI,
    posts: PostsAPI,
    videos: VideosAPI,
    streams: StreamsAPI,
    live: LiveAPI,
    search: SearchAPI,
    users: UsersAPI,
    upload: UploadAPI,
    notifications: NotificationsAPI,
    reports: ReportsAPI,
    stories: StoriesAPI,
    music: MusicAPI,
    chat: ChatAPI,
    privateRooms: PrivateRoomsAPI,
    dm: DMAPI,
    inbox: InboxAPI,
    gallery: GalleryAPI,
    admin: AdminAPI,
    founderTheme: FounderThemeAPI,
    cloudStream: CloudStreamAPI,
    health: HealthAPI,
    companion: CompanionAPI,
    preferences: PreferencesAPI,
    TokenStore,
  };

})(window);
