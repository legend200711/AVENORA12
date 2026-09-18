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

  // ─── Supabase direct REST API ──────────────────────────────
  // Used only for READ operations (video list, video get by UUID).
  // All writes and deletes now route through the backend (keeps service-role key server-side).
  //
  // Tables used:
  //   music_library — stores both audio AND video files
  //                   video rows are identified by mime_type LIKE 'video/%'
  //
  // NOTE: Only the anon/public key is used here. The service-role key is NEVER in frontend JS.
  //       Write/delete operations that require elevated access go through the Avenora backend.
  const SUPABASE_PROJECT_URL = 'https://licuiqxkkfboqezzmsqu.supabase.co';
  const SUPABASE_ANON_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpY3VpcXhra2Zib3Flenptc3F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTYxMDQsImV4cCI6MjEwNDkzMjEwNH0.tsYOyCI7skF6Otz2W0oNYhxM63-0551lrqIDCO8NoJo';
  const SUPABASE_REST        = SUPABASE_PROJECT_URL + '/rest/v1';

  // Helper: make a Supabase REST call using the anon key (public, safe for frontend).
  // For writes that require elevated privileges, use the Avenora backend instead.
  async function _sbFetch(path, opts = {}) {
    const headers = {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    };
    const resp = await fetch(`${SUPABASE_REST}${path}`, {
      method:  opts.method || 'GET',
      headers,
      body:    opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: `HTTP ${resp.status}` }));
      const e = new Error(err.message || `Supabase error ${resp.status}`);
      e.status = resp.status;
      throw e;
    }
    // 204 No Content
    if (resp.status === 204) return null;
    return resp.json();
  }

  // Serialize a music_library video row to the shape the frontend expects
  function _sbVideoRow(row) {
    return {
      _id:             row.id,
      id:              row.id,
      title:           row.title || 'Untitled',
      description:     row.description || '',
      category:        row.genre    || 'other',
      visibility:      row.album_title || 'public',   // stored in album_title
      videoUrl:        row.file_url,
      thumbnailUrl:    null,
      storagePath:     row.storage_path,
      fileSize:        row.file_size,
      mimeType:        row.mime_type,
      processingStatus: 'ready',
      uploader: {
        _id:      row.uid,
        username: row.artist_name || row.uid,
        profile:  { displayName: row.artist_name || row.uid, avatarUrl: null },
      },
      createdAt: row.uploaded_at,
    };
  }

  // BASE_URL — resolved from window.LU_CONFIG.apiUrl if set.
  // Architecture: Firebase + Supabase. apiUrl is normally null.
  // Only set if a Supabase Edge Function or custom REST service is configured.
  const _rawApiUrl =
    (window.LU_CONFIG && window.LU_CONFIG.apiUrl) ||
    (typeof __VITE_API_BASE_URL__ !== 'undefined' ? __VITE_API_BASE_URL__ : null) ||
    null;

  let BASE_URL;
  if (_rawApiUrl) {
    let _url = String(_rawApiUrl).replace(/\/+$/, '');
    let _hasApiSuffix = false;
    try {
      const _parsed = new URL(_url);
      _hasApiSuffix = /\/api(\/|$)/.test(_parsed.pathname);
    } catch {
      _hasApiSuffix = /\/api(\/|$)/.test(_url);
    }
    BASE_URL = _hasApiSuffix ? _url : _url + '/api';
  } else {
    BASE_URL = null;
    // No external API configured — Firebase + Supabase handle all operations.
    console.info('[AVENORA] apiUrl not configured (Firebase + Supabase architecture). ' +
      'Direct Supabase/Firebase calls handle all backend operations.');
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

  // ─── Firebase auth readiness gate ────────────────────────
  // Waits up to 6 s for Firebase Auth to determine the current user.
  // This prevents "Bearer null" tokens when the first request fires
  // before onAuthStateChanged has resolved.
  let _authReady = false;
  let _authReadyCallbacks = [];
  window.addEventListener('lu:auth-ready', function _onAuthReady() {
    _authReady = true;
    _authReadyCallbacks.forEach(fn => fn());
    _authReadyCallbacks = [];
    window.removeEventListener('lu:auth-ready', _onAuthReady);
  });
  function _waitForAuthReady(timeoutMs) {
    if (_authReady) return Promise.resolve();
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        _authReadyCallbacks = _authReadyCallbacks.filter(fn => fn !== resolve);
        resolve(); // proceed even if auth is slow
      }, timeoutMs || 6000);
      _authReadyCallbacks.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // ─── _diagNetworkError: classify "Failed to fetch" ───────
  // "Failed to fetch" is the browser's generic error for:
  //   - service not reachable / wrong URL
  //   - CORS preflight failure (browser suppresses the response body)
  //   - no internet connection
  // We classify the error, log a diagnostic, and return a typed Error
  // so the UI can show a specific message instead of "Failed to fetch".
  function _diagNetworkError(networkErr, method, fullUrl) {
    const isLocalhost = fullUrl.includes('localhost') || fullUrl.includes('127.0.0.1');
    const serviceHost = (() => {
      try { return new URL(fullUrl).origin; } catch { return fullUrl; }
    })();
    let msg;
    if (isLocalhost) {
      msg = `Service unavailable (local) — ${method} ${fullUrl}. ` +
            'Make sure the local service is running.';
    } else {
      msg = `Cannot reach service — ${method} ${fullUrl}. ` +
            'Possible causes: (1) the service is not reachable, ' +
            '(2) the URL "' + serviceHost + '" is wrong, ' +
            '(3) CORS blocked the request, ' +
            '(4) no internet connection. ' +
            'Open DevTools → Network tab and check for the failed request.';
    }
    console.error(
      '[AVENORA] Network error — ' + method + ' ' + fullUrl,
      {
        originalError: networkErr.message,
        requestUrl:    fullUrl,
        method,
        serviceHost,
        fullMessage: msg,
      }
    );
    const err = new Error(msg);
    err.code = isLocalhost ? 'SERVICE_NOT_RUNNING' : 'SERVICE_UNREACHABLE';
    err.originalError = networkErr.message;
    return err;
  }

  async function request(method, path, opts = {}) {
    // Guard: fail fast and clearly if the API is not configured
    if (!BASE_URL) {
      const user = window.AvenoraFirebase?.Auth?.getUser?.() || null;
      const uid  = user?.uid || user?.id || null;
      const cfgErr = new Error(
        '[AVENORA] Avenora API endpoint is not configured. ' +
        'Set window.LU_CONFIG = { apiUrl: "https://your-backend" } in index.html ' +
        'or VITE_API_BASE_URL in your .env file.'
      );
      cfgErr.code = 'API_NOT_CONFIGURED';
      console.error(
        '[AVENORA] API request blocked — endpoint not configured',
        { method, path, firebaseAuthState: !!uid, uid }
      );
      throw cfgErr;
    }

    // (No placeholder guard needed — apiUrl is null in Firebase+Supabase architecture.)

    const fullUrl = `${BASE_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

    // Wait for Firebase auth state to resolve before attaching a token.
    // Skip the wait for read-only public endpoints that don't require auth.
    const isPublicEndpoint = opts._public ||
      (method === 'GET' && /^\/videos|^\/streams|^\/live|^\/music/.test(path));
    if (!isPublicEndpoint) {
      await _waitForAuthReady(4000);
    }

    // Prefer a fresh Firebase ID token; fall back to stored JWT for legacy backend calls
    let token = null;
    if (window.AvenoraFirebase?.Auth) {
      token = await window.AvenoraFirebase.Auth.getIdToken().catch(() => null);
    }
    if (!token) token = TokenStore.getAccess();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Diagnostic: log the current auth state for protected requests
    const _user = window.AvenoraFirebase?.Auth?.getUser?.() || null;
    const _uid  = _user?.uid || _user?.id || null;

    // ── Request timeout ──────────────────────────────────────
    // Default: 15 s for regular requests, 30 s for uploads (set opts._timeoutMs).
    const _timeoutMs = opts._timeoutMs || 15000;
    const _aborter = new AbortController();
    const _timeoutId = setTimeout(() => _aborter.abort(), _timeoutMs);
    // Merge caller-supplied signal with our timeout signal (both can abort)
    let _signal = _aborter.signal;
    if (opts.signal) {
      // If the caller also has an abort signal, abort on whichever fires first
      const _callerSignal = opts.signal;
      const _combined = new AbortController();
      _callerSignal.addEventListener('abort', () => _combined.abort());
      _aborter.signal.addEventListener('abort', () => _combined.abort());
      _signal = _combined.signal;
    }

    const config = {
      method,
      headers,
      signal: _signal,
    };
    if (opts.body && method !== 'GET') config.body = JSON.stringify(opts.body);

    let res;
    try {
      res = await fetch(fullUrl, config);
      clearTimeout(_timeoutId);
    } catch (networkErr) {
      clearTimeout(_timeoutId);
      // AbortError from our timeout → convert to a clear "unreachable" message
      if (networkErr.name === 'AbortError') {
        const timeoutErr = new Error(
          'Unable to connect to AVENORA servers. The server may be starting up — please try again in a moment.'
        );
        timeoutErr.code = 'BACKEND_UNREACHABLE';
        timeoutErr.originalError = 'Request timed out after ' + (_timeoutMs / 1000) + 's';
        console.error(
          '[AVENORA] Request timeout — ' + method + ' ' + fullUrl,
          { timeoutMs: _timeoutMs, backendHost: (() => { try { return new URL(fullUrl).origin; } catch { return fullUrl; } })() }
        );
        throw timeoutErr;
      }
      throw _diagNetworkError(networkErr, method, fullUrl);
    }

    // Auto-refresh on 401 using Firebase token (not legacy refresh token).
    // The legacy JWT refresh path is kept for backwards compat with the old backend.
    if (res.status === 401 && !opts._retried) {
      // First try a Firebase token refresh
      if (window.AvenoraFirebase?.Auth) {
        try {
          // Force a fresh token from Firebase (bypasses the SDK cache)
          const auth = await window.AvenoraFirebase.getFirebaseAuth?.();
          if (auth?.currentUser) {
            const freshToken = await auth.currentUser.getIdToken(/* forceRefresh= */true);
            if (freshToken) {
              return request(method, path, {
                ...opts,
                _retried: true,
                headers: { ...opts.headers, Authorization: `Bearer ${freshToken}` },
              });
            }
          }
        } catch (_) {}
      }
      // Legacy JWT refresh fallback
      if (TokenStore.getRefresh() && !isRefreshing) {
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
            // Legacy JWT expired AND Firebase token unavailable → sign-out only if
            // Firebase also has no user (avoid unnecessary logouts on backend errors)
            if (!window.AvenoraFirebase?.Auth?.getUser?.()) {
              TokenStore.clear();
              LegendState.set('user', null);
              window.dispatchEvent(new Event('lu:logged-out'));
            }
          }
        } finally {
          isRefreshing = false;
          refreshQueue = [];
        }
        return request(method, path, { ...opts, _retried: true });
      }
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
      // Detailed diagnostic log
      console.error(
        `[AVENORA] API error — ${method} ${fullUrl}`,
        {
          status:            res.status,
          statusText:        res.statusText,
          responseBody:      data,
          firebaseAuthState: !!_uid,
          uid:               _uid,
          hasAuthHeader:     !!token,
          errorMessage:      data?.message || `HTTP ${res.status}`,
          errorCode:         data?.code,
        }
      );
      const err = new Error(data?.message || `Request failed: ${res.status}`);
      err.status = res.status;
      err.code = data?.code;
      err.details = data?.details;
      // Classify common errors for better UI messages
      if (res.status === 401) {
        err.code = err.code || 'UNAUTHORIZED';
        err.userMessage = 'Your session has expired. Please sign in again.';
      } else if (res.status === 403) {
        err.code = err.code || 'FORBIDDEN';
        err.userMessage = 'You do not have permission to perform this action.';
      } else if (res.status === 503) {
        err.code = err.code || 'SERVICE_UNAVAILABLE';
        err.userMessage = data?.message || 'Service temporarily unavailable. Check backend configuration.';
      }
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
    resetPassword: (token, email, password) => post('/auth/reset-password', { token, email, password }),
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
  // Primary source: Supabase music_library table (mime_type like 'video/%').
  // Falls back to backend MongoDB, then Firestore, for legacy videos.
  //
  // ID strategy: Supabase music_library rows use UUID strings as IDs.
  //   MongoDB ObjectIds are 24-char hex strings.
  //   A UUID looks like: "550e8400-e29b-41d4-a716-446655440000" (36 chars with dashes).
  //   We detect the source by checking whether the ID matches UUID or ObjectId format.
  const _isUUID   = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
  const _isMongoId = (id) => /^[0-9a-f]{24}$/i.test(String(id));

  const VideosAPI = {
    async list(params = {}) {
      // Query Supabase music_library for video rows (primary source — no backend needed)
      try {
        const limit = Math.min(50, parseInt(params.limit) || 20);
        const sort  = params.sort || 'new';
        const category = params.category;

        let qs = `mime_type=like.video/*&limit=${limit}`;
        if (category && category !== 'all') qs += `&genre=eq.${encodeURIComponent(category)}`;
        qs += sort === 'trending' ? '&order=file_size.desc' : '&order=uploaded_at.desc';

        const rows = await _sbFetch(`/music_library?${qs}`, { prefer: 'count=exact' });
        if (Array.isArray(rows) && rows.length > 0) {
          return { videos: rows.map(_sbVideoRow), total: rows.length };
        }
      } catch (sbErr) {
        console.warn('[AVN] Supabase video list failed:', sbErr.message);
      }

      // Backend MongoDB fallback
      try {
        return await get(`/videos?limit=${params.limit || 20}&sort=${params.sort || 'new'}${params.category ? `&category=${params.category}` : ''}`);
      } catch (_) {}

      // Firestore legacy fallback
      if (window.AvenoraFirebase) {
        try {
          const videos = await _listVideosFromFirestore(params);
          return { videos, total: videos.length };
        } catch (_) {}
      }

      return { videos: [], total: 0 };
    },

    async get(id) {
      const sid = String(id);

      // Supabase music_library lookup (UUID ID or any ID not recognized as MongoDB ObjectId)
      if (_isUUID(sid) || !_isMongoId(sid)) {
        try {
          const rows = await _sbFetch(`/music_library?id=eq.${encodeURIComponent(sid)}&limit=1`);
          if (Array.isArray(rows) && rows.length > 0) {
            return { video: _sbVideoRow(rows[0]) };
          }
        } catch (sbErr) {
          console.warn('[AVN] Supabase video get failed:', sbErr.message);
        }
      }

      // Backend MongoDB lookup (for 24-char hex ObjectIds or fallback)
      try {
        return await get(`/videos/${sid}`);
      } catch (apiErr) {
        // Firestore fallback for pre-migration videos
        if (window.AvenoraFirebase && (apiErr.status === 404 || apiErr.code === 'API_NOT_CONFIGURED' || apiErr.code === 'BACKEND_UNREACHABLE')) {
          try {
            const video = await _getVideoFromFirestore(sid);
            if (video) return { video };
          } catch (_) {}
        }
        throw apiErr;
      }
    },

    // Get a fresh playback URL from the backend (re-generates Supabase signed URL / public URL)
    async getPlaybackUrl(id) {
      const sid = String(id);
      // For Supabase-stored videos: construct the public URL directly from storagePath if known
      // Otherwise call the backend which can generate it server-side
      try {
        const urlData = await get(`/videos/${sid}/url`);
        return urlData?.url || urlData?.playbackUrl || null;
      } catch (_) {
        return null;
      }
    },

    like: (id) => {
      // Supabase IDs: no backend like route — skip silently
      if (_isUUID(String(id))) return Promise.resolve({ liked: true });
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
      if (!_isUUID(String(videoId))) {
        return get(`/videos/${videoId}/comments?page=${page}`).catch(() => ({ comments: [] }));
      }
      return { comments: [] };
    },
    async addComment(videoId, content) {
      if (window.AvenoraFirebase) {
        try { return _addVideoCommentToFirestore(videoId, content); } catch (_) {}
      }
      if (!_isUUID(String(videoId))) {
        return post(`/videos/${videoId}/comments`, { content });
      }
      return { ok: true };
    },
    deleteComment: (videoId, commentId) => {
      if (_isUUID(String(videoId))) return Promise.resolve({});
      return del(`/videos/${videoId}/comments/${commentId}`);
    },

    // Watch Later / History — local (SOM state) for now; no backend required
    toggleWatchLater: (id) => {
      if (_isUUID(String(id))) return Promise.resolve({ ok: true });
      return post(`/videos/${id}/watchlater`, {}).catch(() => ({ ok: true }));
    },
    getWatchLater:    ()   => get('/videos/me/watchlater').catch(() => ({ videos: [] })),
    updateHistory:    (id, position) => {
      if (_isUUID(String(id))) return Promise.resolve({});
      return post(`/videos/${id}/history`, { position }).catch(() => ({}));
    },
    getHistory:       ()   => get('/videos/me/history').catch(() => ({ videos: [] })),
    deleteHistory:    (videoId) => {
      if (_isUUID(String(videoId))) return Promise.resolve({});
      return del(`/videos/history/${videoId}`).catch(() => ({}));
    },

    // Channels
    channels: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/videos/channels?${q}`).catch(() => ({ channels: [] }));
    },
    channel: (id) => get(`/videos/channel/${id}`).catch(() => null),
    subscribeChannel: (id) => post(`/videos/channel/${id}/subscribe`, {}).catch(() => ({})),

    // Report
    reportVideo: (id, reason, details) => {
      if (_isUUID(String(id))) return Promise.resolve({});
      return post(`/videos/${id}/report`, { reason, details }).catch(() => ({}));
    },

    // Moderation
    async deleteVideo(id) {
      const sid = String(id);
      if (_isUUID(sid)) {
        // Supabase music_library row — route through the video-delete Edge Function.
        // The anon key cannot prove Firebase identity so direct DELETE is blocked by RLS.
        // The Edge Function verifies the Firebase ID token and authorises the deletion.
        let token = null;
        if (window.AvenoraFirebase?.Auth) {
          token = await window.AvenoraFirebase.Auth.getIdToken().catch(() => null);
        }
        if (!token && window.AvenoraFirebase?.getFirebaseAuth) {
          try {
            const auth = await window.AvenoraFirebase.getFirebaseAuth();
            token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
          } catch (_) {}
        }
        if (!token) throw new Error('Not authenticated — please sign in before deleting a video.');

        const fnUrl = `${SUPABASE_PROJECT_URL}/functions/v1/video-delete?id=${encodeURIComponent(sid)}`;
        let res;
        try {
          res = await fetch(fnUrl, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
        } catch (networkErr) {
          console.error('[AVN] video-delete Edge Function network error:', networkErr);
          throw new Error('Network error while deleting video. Check your connection.');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data.message || `Delete failed (HTTP ${res.status})`;
          const err = new Error(msg);
          err.status = res.status;
          console.error('[AVN] video-delete Edge Function error:', { status: res.status, data });
          throw err;
        }
        return { success: true };
      }

      // Firestore-backed video (non-UUID id)
      try {
        const db = await window.AvenoraFirebase.getFirestore();
        const { doc: fsDoc, deleteDoc } = await import(
          `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`
        );
        await deleteDoc(fsDoc(db, 'videos', sid));
        return { success: true };
      } catch (err) {
        console.error('[AVN] Firestore video delete error:', err.code, err.message);
        throw new Error(err.message || 'Could not delete video from Firestore.');
      }
    },
    restoreVideo: (id) => put(`/videos/${id}/restore`, {}),
    featureVideo: (id, featured = true) => {
      if (_isUUID(String(id))) return Promise.resolve({ success: true });
      return put(`/videos/${id}/feature`, { featured });
    },
    suspendChannel: (id, reason) => put(`/videos/channel/${id}/suspend`, { reason }),
    unsuspendChannel: (id) => put(`/videos/channel/${id}/unsuspend`, {}),

    // Save metadata for a video already uploaded directly to Supabase Storage.
    // Tries the backend /api/videos/save-meta first (saves to MongoDB for admin dashboard).
    // Falls back to direct Supabase music_library insert when backend is not available.
    async saveMeta(data) {
      const user = LegendState.get('user');
      const uid  = user?.uid || user?.id || TokenStore.getAccess();
      if (!uid) {
        const err = new Error('Not authenticated — please sign in before uploading.');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      if (!data.title?.trim()) {
        const err = new Error('Title is required.');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      if (!data.videoUrl || !data.storagePath) {
        const err = new Error('videoUrl and storagePath are required.');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }

      // Try the backend first (stores in MongoDB — shows in admin dashboard)
      if (BASE_URL) {
        try {
          const result = await post('/videos/save-meta', data);
          if (result?.video) return { success: true, video: result.video };
        } catch (backendErr) {
          // If it's a config/auth/validation error, propagate immediately
          if (backendErr.code === 'BACKEND_NOT_CONFIGURED' ||
              backendErr.code === 'API_NOT_CONFIGURED' ||
              backendErr.status === 401 ||
              backendErr.status === 403 ||
              backendErr.status === 422) {
            throw backendErr;
          }
          // Network/server error — fall through to Supabase direct write
          console.warn('[AVN] Backend save-meta failed, falling back to Supabase direct write:', backendErr.message);
        }
      }

      // Direct Supabase music_library write (fallback when backend is unavailable)
      const VALID_CATEGORIES = ['movies','shows','music','short','gaming','education','comedy','other'];
      const VALID_VISIBILITY  = ['public','unlisted','private'];

      // Check for duplicate (idempotent)
      try {
        const existing = await _sbFetch(
          `/music_library?uid=eq.${encodeURIComponent(uid)}&storage_path=eq.${encodeURIComponent(data.storagePath)}&mime_type=like.video/*&limit=1`
        );
        if (Array.isArray(existing) && existing.length > 0) {
          return { success: true, video: _sbVideoRow(existing[0]) };
        }
      } catch (_) {}

      const displayName = user?.profile?.displayName || user?.username || uid;
      const row = {
        uid,
        title:        String(data.title).trim().slice(0, 200),
        description:  String(data.description || '').trim().slice(0, 2000),
        artist_name:  displayName,
        album_title:  VALID_VISIBILITY.includes(data.visibility) ? data.visibility : 'public',
        genre:        VALID_CATEGORIES.includes(data.category) ? data.category : 'other',
        file_url:     data.videoUrl,
        storage_path: data.storagePath,
        file_size:    Number(data.fileSize) || 0,
        mime_type:    String(data.mimeType || '').startsWith('video/') ? data.mimeType : 'video/mp4',
        original_name: data.originalFilename || data.storagePath.split('/').pop() || 'video',
      };

      const inserted = await _sbFetch('/music_library', {
        method: 'POST',
        body: row,
        prefer: 'return=representation',
      });

      const videoRow = Array.isArray(inserted) ? inserted[0] : inserted;
      return { success: true, video: _sbVideoRow(videoRow) };
    },
  };

  // ── Firestore helpers for video CRUD ────────────────────────
  function _mapVideoDoc(id, data) {
    return {
      id:          id,
      _id:         id,
      title:       data.title       || 'Untitled',
      description: data.description || '',
      category:    data.category    || 'other',
      visibility:  data.visibility  || 'public',
      videoUrl:    data.videoUrl    || '',
      thumbnailUrl: data.thumbnailUrl || null,
      storagePath: data.storagePath || null,
      uid:         data.uid         || null,
      views:       data.views       || 0,
      likes:       data.likes       || [],
      likeCount:   (data.likes      || []).length,
      commentCount: data.commentCount || 0,
      processingStatus: data.processingStatus || 'ready',
      uploader:    data.owner       || {},
      owner:       data.owner       || {},
      createdAt:   data.createdAt,
    };
  }

  async function _listVideosFromFirestore({ sort = 'new', limit: lim = 24, category } = {}) {
    const db = await window.AvenoraFirebase.getFirestore();
    const SDK_VER = '10.12.2';
    const { collection, query, orderBy, limit, getDocs, where } =
      await import(`https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-firestore.js`);

    const constraints = [
      // Only show public and unlisted videos in the public list
      where('visibility', 'in', ['public', 'unlisted']),
      orderBy('createdAt', 'desc'),
      limit(lim),
    ];
    if (category) constraints.push(where('category', '==', category));
    const q = query(collection(db, 'videos'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => _mapVideoDoc(d.id, d.data()));
  }

  async function _getVideoFromFirestore(id) {
    const db = await window.AvenoraFirebase.getFirestore();
    const SDK_VER = '10.12.2';
    const { doc, getDoc } =
      await import(`https://www.gstatic.com/firebasejs/${SDK_VER}/firebase-firestore.js`);
    const snap = await getDoc(doc(db, 'videos', id));
    if (!snap.exists()) return null;
    return _mapVideoDoc(snap.id, snap.data());
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
              role: merged.role || 'user',
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
              role: fsProfile.role || 'user',
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

  // ─── Upload API — delegates directly to Supabase Storage via AvenoraStorage ─
  // Waits up to 5 s for the supabase.js script to initialise (covers slow
  // connections where the script loads after the user taps Upload).
  async function _awaitStorage() {
    if (window.AvenoraStorage) return window.AvenoraStorage;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 250)); // 20 × 250 ms = 5 s max
      if (window.AvenoraStorage) return window.AvenoraStorage;
    }
    throw new Error(
      'Storage service failed to load. ' +
      'Hard-refresh the page (Ctrl+Shift+R / ⌘+Shift+R) to clear the browser cache and try again. ' +
      'If the problem persists, check your internet connection.'
    );
  }

  const UploadAPI = {
    async image(file, onProgress) {
      const storage = await _awaitStorage();
      return storage.uploadImage(file, onProgress);
    },
    async avatar(file, onProgress) {
      const storage = await _awaitStorage();
      return storage.uploadAvatar(file, onProgress);
    },
    async audio(file, onProgress) {
      const storage = await _awaitStorage();
      return storage.uploadAudio(file, onProgress);
    },
    async video(file, onProgress) {
      const storage = await _awaitStorage();
      return storage.uploadVideo(file, onProgress);
    },
  };

  // ─── Notifications API ────────────────────────────────────
  const NotificationsAPI = {
    list: (page = 1) => get(`/notifications?page=${page}&limit=20`),
    markRead: (id) => put(`/notifications/${id}/read`, {}),
    markAllRead: () => put('/notifications/read-all', {}),
  };

  // ─── Web Push API ─────────────────────────────────────────
  const PushAPI = {
    /** Fetch the VAPID public key from the backend (no auth required). */
    getVapidKey: () => get('/push/vapid-public-key').catch(() => null),

    /**
     * Register a Web Push subscription with the backend.
     * @param {PushSubscription} subscription — from PushManager.subscribe()
     */
    subscribe: (subscription) => post('/push/subscribe', { subscription: subscription.toJSON() }),

    /**
     * Unregister a Web Push subscription from the backend.
     * @param {string} endpoint
     */
    unsubscribe: (endpoint) => request('DELETE', '/push/subscribe', { endpoint }),
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
      // Upload directly to Supabase Storage via AvenoraStorage.
      // No silent fallback to an unavailable backend route.
      if (!window.AvenoraStorage) {
        throw new Error('Storage service not loaded. Refresh the page and try again.');
      }
      const file     = formData.get('file');
      const category = formData.get('category') || 'artwork';
      const title    = formData.get('title') || '';
      if (!file) throw new Error('No file selected.');
      const result = await window.AvenoraStorage.uploadImage(file);
      try {
        if (window.AvenoraFirebase?.Firestore?.addGalleryItem) {
          await window.AvenoraFirebase.Firestore.addGalleryItem(result.url, category, title);
        }
      } catch (_) {}
      return { images: [{ _id: Date.now().toString(), url: result.url, title, category,
        uploader: { username: LegendAPI?.auth?.getUser()?.username }, createdAt: new Date().toISOString() }] };
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
    async dashboard() {
      // Client-side role gate (UI only — server enforces real authorization via FOUNDER_EMAIL)
      const user = LegendState.get('user');
      if (!user) {
        const err = new Error('Not authenticated'); err.status = 401; err.code = 'UNAUTHORIZED'; throw err;
      }
      if (!['founder','admin'].includes(user.role)) {
        const err = new Error('Access restricted to the authorized founder account');
        err.status = 403; err.code = 'FORBIDDEN'; throw err;
      }
      // Always use the real backend — it has MongoDB stats, DB health, and live-stream counts
      return get('/admin/dashboard');
    },
    users: (page, search) => get(`/admin/users?page=${page || 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    setRole: (userId, role) => put(`/admin/users/${userId}/role`, { role }),
    suspend: (userId, reason, until) => put(`/admin/users/${userId}/suspend`, { reason, until }),
    unsuspend: (userId) => put(`/admin/users/${userId}/unsuspend`, {}),
    flaggedPosts: () => get('/admin/posts/flagged'),
    reports: (status = 'pending', page = 1) => get(`/admin/reports?status=${status}&page=${page}`),
    deletePost: (id) => del(`/admin/posts/${id}`),
    system: () => get('/admin/system'),
  };

  // ─── Founder Theme API — backed by Firestore founderThemes collection ────
  //
  // Schema (founderThemes/{id}):
  //   name       string
  //   tokens     object   — design token map
  //   notes      string
  //   presetKey  string
  //   status     'draft' | 'published' | 'archived'
  //   createdAt  ISO string
  //   updatedAt  ISO string
  //   publishedAt ISO string (when status == 'published')
  //
  // founderThemes/active is a pointer { themeId, tokens, name }
  // readable by all for themeService to load the published theme.
  const FounderThemeAPI = (() => {
    const _FS = `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`;

    async function _m() {
      const db = await window.AvenoraFirebase.getFirestore();
      const m  = await import(_FS);
      return { db, ...m };
    }

    function _doc(raw, id) {
      return {
        _id: id, id,
        name: raw.name || 'Untitled',
        tokens: raw.tokens || {},
        notes: raw.notes || '',
        presetKey: raw.presetKey || null,
        status: raw.status || 'draft',
        createdAt: raw.createdAt || null,
        updatedAt: raw.updatedAt || null,
        publishedAt: raw.publishedAt || null,
      };
    }

    return {
      async list() {
        const { db, collection, query, orderBy, getDocs } = await _m();
        let snap;
        try {
          snap = await getDocs(query(collection(db, 'founderThemes'), orderBy('updatedAt', 'desc')));
        } catch (indexErr) {
          // Index may still be building — fall back to unordered fetch
          console.warn('[AVN] FounderThemeAPI.list() ordered query failed (index may be building):', indexErr.code, indexErr.message);
          snap = await getDocs(collection(db, 'founderThemes'));
        }
        const themes = snap.docs.filter(d => d.id !== 'active').map(d => _doc(d.data(), d.id));
        return { themes };
      },

      async published() {
        const { db, doc: fsDoc, getDoc } = await _m();
        const activeSnap = await getDoc(fsDoc(db, 'founderThemes', 'active'));
        if (!activeSnap.exists()) return { theme: null };
        const active = activeSnap.data();
        if (!active.themeId) return { theme: null };
        const ts = await getDoc(fsDoc(db, 'founderThemes', active.themeId));
        if (!ts.exists()) return { theme: { _id: active.themeId, name: active.name || 'Theme', tokens: active.tokens || {} } };
        return { theme: _doc(ts.data(), ts.id) };
      },

      async history() {
        const { db, collection, query, where, orderBy, getDocs } = await _m();
        const snap = await getDocs(query(
          collection(db, 'founderThemes'),
          where('status', '==', 'published'),
          orderBy('publishedAt', 'desc')
        ));
        return { themes: snap.docs.filter(d => d.id !== 'active').map(d => _doc(d.data(), d.id)) };
      },

      async get(id) {
        const { db, doc: fsDoc, getDoc } = await _m();
        const snap = await getDoc(fsDoc(db, 'founderThemes', id));
        if (!snap.exists()) throw new Error('Theme not found');
        return { theme: _doc(snap.data(), snap.id) };
      },

      async create(data) {
        const { db, collection, addDoc } = await _m();
        const now = new Date().toISOString();
        const row = {
          name: String(data.name || 'Untitled').slice(0, 120),
          tokens: data.tokens || {},
          notes: String(data.notes || '').slice(0, 1000),
          presetKey: data.presetKey || null,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };
        const ref = await addDoc(collection(db, 'founderThemes'), row);
        return { theme: _doc(row, ref.id) };
      },

      async update(id, data) {
        const { db, doc: fsDoc, updateDoc } = await _m();
        const patch = { updatedAt: new Date().toISOString() };
        if (data.name   !== undefined) patch.name   = String(data.name).slice(0, 120);
        if (data.tokens !== undefined) patch.tokens = data.tokens;
        if (data.notes  !== undefined) patch.notes  = String(data.notes).slice(0, 1000);
        await updateDoc(fsDoc(db, 'founderThemes', id), patch);
        return { theme: { _id: id, ...patch } };
      },

      async publish(id) {
        const { db, doc: fsDoc, getDoc, updateDoc, setDoc } = await _m();
        const snap = await getDoc(fsDoc(db, 'founderThemes', id));
        if (!snap.exists()) throw new Error('Theme not found');
        const themeData = snap.data();
        const now = new Date().toISOString();
        await updateDoc(fsDoc(db, 'founderThemes', id), { status: 'published', publishedAt: now, updatedAt: now });
        await setDoc(fsDoc(db, 'founderThemes', 'active'), {
          themeId: id, name: themeData.name || 'Theme',
          tokens: themeData.tokens || {}, publishedAt: now,
        });
        return { success: true };
      },

      async rollback(id) { return this.publish(id); },

      async delete(id) {
        const { db, doc: fsDoc, getDoc, deleteDoc } = await _m();
        const activeSnap = await getDoc(fsDoc(db, 'founderThemes', 'active'));
        if (activeSnap.exists() && activeSnap.data().themeId === id) {
          throw new Error('Cannot delete the currently published theme. Publish another theme first.');
        }
        await deleteDoc(fsDoc(db, 'founderThemes', id));
        return { success: true };
      },

      async active() {
        try {
          const { db, doc: fsDoc, getDoc } = await _m();
          const snap = await getDoc(fsDoc(db, 'founderThemes', 'active'));
          if (!snap.exists()) return { success: false, theme: null };
          const d = snap.data();
          return { success: true, theme: { _id: d.themeId, name: d.name, tokens: d.tokens } };
        } catch { return { success: false, theme: null }; }
      },
    };
  })();

  // ─── Cloud Stream Admin API — backed by Firestore cloudStreams collection ──
  //
  // The Founder Control Cloud Stream panel shows live stream status and lets
  // the Founder manage active streams. All operations are direct Firestore writes
  // to cloudStreams/{streamId} — no backend server required.
  //
  // Collections:
  //   cloudStreams/{streamId}          — broadcast record
  //   studioCloudStreamMusic/{id}      — live Now Playing
  //   music_library (Supabase)         — audio files for the media list
  const CloudStreamAPI = (() => {
    const _FS = `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`;

    async function _m() {
      const db = await window.AvenoraFirebase.getFirestore();
      const m  = await import(_FS);
      return { db, ...m };
    }

    function _buildStatus(streams) {
      if (!streams.length) {
        return {
          state: 'stopped', running: false, paused: false,
          currentTrack: null, nextTrack: null, queueSize: 0,
          consecutiveErrors: 0, lastActivity: null,
          mediaDir: '(Supabase Storage — stream-media bucket)',
          shuffle: false, repeat: false,
          rtmpConfigured: false, rtmpTargetCount: 0,
          ffmpeg: { available: true },
          recentErrors: [],
        };
      }
      const s = streams[0];
      const qLen = Array.isArray(s.queue) ? s.queue.length : 0;
      return {
        state: s.status === 'active' ? 'running' : (s.status === 'paused' ? 'paused' : 'stopped'),
        running: s.status === 'active',
        paused:  s.status === 'paused',
        currentTrack: s.nowPlaying?.title || s.currentTrack || null,
        nextTrack: (Array.isArray(s.queue) && s.queue.length > 1)
          ? (typeof s.queue[1] === 'string' ? s.queue[1] : s.queue[1]?.title || null) : null,
        queueSize: qLen,
        consecutiveErrors: s.errorCount || 0,
        lastActivity: s.updatedAt || s.startedAt || null,
        mediaDir: '(Supabase Storage — stream-media bucket)',
        shuffle: s.shuffle || false,
        repeat:  s.repeat  || false,
        rtmpConfigured: !!(s.rtmpUrl),
        rtmpTargetCount: s.rtmpUrl ? 1 : 0,
        ffmpeg: { available: true },
        recentErrors: s.recentErrors || [],
        _streamId: s._id,
        _uid: s.uid,
      };
    }

    async function _getActive() {
      const { db, collection, query, where, orderBy, limit: fsLimit, getDocs } = await _m();
      try {
        const snap = await getDocs(query(
          collection(db, 'cloudStreams'),
          where('status', 'in', ['active', 'paused', 'starting', 'recovering']),
          orderBy('startedAt', 'desc'),
          fsLimit(10)
        ));
        return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      } catch (indexErr) {
        // Composite index may still be building — fall back to status filter only
        console.warn('[AVN] CloudStreamAPI._getActive() index query failed (index may be building):', indexErr.code, indexErr.message);
        const fallback = await getDocs(query(
          collection(db, 'cloudStreams'),
          where('status', 'in', ['active', 'paused', 'starting', 'recovering']),
          fsLimit(10)
        ));
        return fallback.docs.map(d => ({ _id: d.id, ...d.data() }));
      }
    }

    async function _getAll(lim) {
      const { db, collection, query, orderBy, limit: fsLimit, getDocs } = await _m();
      const snap = await getDocs(query(
        collection(db, 'cloudStreams'),
        orderBy('startedAt', 'desc'),
        fsLimit(lim || 10)
      ));
      return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    }

    async function _founderStream() {
      const user = LegendState.get('user');
      if (!user) throw new Error('Not authenticated');
      const uid = user.uid || user.id;
      const streams = await _getActive();
      return streams.find(s => s.uid === uid) || null;
    }

    async function _updateStream(streamId, patch) {
      const { db, doc: fsDoc, updateDoc } = await _m();
      await updateDoc(fsDoc(db, 'cloudStreams', streamId), { ...patch, updatedAt: new Date().toISOString() });
      return { success: true };
    }

    return {
      async status() {
        const active = await _getActive();
        const streams = active.length ? active : await _getAll(5);
        return { status: _buildStatus(streams) };
      },

      async queue() {
        const active = await _getActive();
        if (!active.length) return { queue: [] };
        const s = active[0];
        const q = (Array.isArray(s.queue) ? s.queue : []).map((item, i) => ({
          name: typeof item === 'string' ? item : (item.title || item.name || `Track ${i + 1}`),
          active: i === 0 && s.status === 'active',
          url: (item && item.url) || (item && item.fileUrl) || null,
        }));
        return { queue: q };
      },

      async media() {
        try {
          const rows = await _sbFetch(
            `/music_library?mime_type=like.audio/*&order=uploaded_at.desc&limit=50`
          ).catch(() => []);
          const files = (Array.isArray(rows) ? rows : []).map(r => ({
            name: r.original_name || r.title || (r.storage_path || '').split('/').pop() || 'track',
            url: r.file_url,
            storagePath: r.storage_path,
          }));
          return { files };
        } catch (err) {
          console.error('[AVN] CloudStreamAPI.media error:', err);
          return { files: [] };
        }
      },

      async start() {
        const user = LegendState.get('user');
        if (!user) throw new Error('Not authenticated');
        const uid = user.uid || user.id;
        const { db, collection, addDoc } = await _m();
        const now = new Date().toISOString();
        const ref = await addDoc(collection(db, 'cloudStreams'), {
          uid, status: 'active',
          title: 'Avenora 24-Hour Cloud Stream',
          startedAt: now, updatedAt: now,
          queue: [], shuffle: false, repeat: true,
          errorCount: 0, recentErrors: [],
        });
        return { success: true, streamId: ref.id };
      },

      async stop() {
        const s = await _founderStream();
        if (!s) return { success: true };
        await _updateStream(s._id, { status: 'stopped', stoppedAt: new Date().toISOString() });
        return { success: true };
      },

      async pause() {
        const s = await _founderStream();
        if (!s) throw new Error('No active stream');
        await _updateStream(s._id, { status: 'paused' });
        return { success: true };
      },

      async resume() {
        const s = await _founderStream();
        if (!s) throw new Error('No paused stream');
        await _updateStream(s._id, { status: 'active' });
        return { success: true };
      },

      async skip() {
        const s = await _founderStream();
        if (!s) throw new Error('No active stream');
        const queue = Array.isArray(s.queue) ? s.queue.slice(1) : [];
        await _updateStream(s._id, { queue });
        return { success: true };
      },

      async refresh() {
        try {
          const rows = await _sbFetch(`/music_library?mime_type=like.audio/*&select=id`).catch(() => []);
          return { playlistSize: Array.isArray(rows) ? rows.length : 0 };
        } catch { return { playlistSize: 0 }; }
      },

      async addToQueue(files) {
        if (!Array.isArray(files) || !files.length) return { added: [] };
        const s = await _founderStream();
        if (!s) throw new Error('No active stream');
        const queue = Array.isArray(s.queue) ? [...s.queue] : [];
        const added = [];
        for (const f of files) { if (typeof f === 'string') { queue.push(f); added.push(f); } }
        await _updateStream(s._id, { queue });
        return { added };
      },

      async removeFromQueue(index) {
        const s = await _founderStream();
        if (!s) throw new Error('No active stream');
        const queue = Array.isArray(s.queue) ? [...s.queue] : [];
        queue.splice(index, 1);
        await _updateStream(s._id, { queue });
        return { success: true };
      },

      async reorderQueue(from, to) {
        const s = await _founderStream();
        if (!s) throw new Error('No active stream');
        const queue = Array.isArray(s.queue) ? [...s.queue] : [];
        const [item] = queue.splice(from, 1);
        queue.splice(to, 0, item);
        await _updateStream(s._id, { queue });
        return { success: true };
      },

      async clearQueue() {
        const s = await _founderStream();
        if (!s) return { success: true };
        await _updateStream(s._id, { queue: [] });
        return { success: true };
      },

      async setSettings(shuffle, repeat) {
        const s = await _founderStream();
        if (!s) throw new Error('No active stream');
        const patch = {};
        if (shuffle !== undefined) patch.shuffle = shuffle;
        if (repeat  !== undefined) patch.repeat  = repeat;
        await _updateStream(s._id, patch);
        return { success: true };
      },
    };
  })();

  // ─── Health ───────────────────────────────────────────────
  // Checks reachability of the backend and Supabase.
  // Uses AbortController with a 10 s timeout so the check never hangs.
  const HealthAPI = {
    check: () => {
      function _timedFetch(url, options, timeoutMs) {
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(), timeoutMs);
        return fetch(url, { ...options, signal: ac.signal })
          .finally(() => clearTimeout(tid));
      }

      // Supabase connectivity check (uses anon key — public)
      const checks = [
        _timedFetch(`${SUPABASE_PROJECT_URL}/rest/v1/`, {
          method: 'HEAD',
          headers: { apikey: SUPABASE_ANON_KEY },
        }, 8000)
          .then(r => ({
            service:         'Supabase',
            status:          (r.ok || r.status === 401 || r.status === 404) ? 'ok' : 'error',
            supabaseProject: SUPABASE_PROJECT_URL,
            httpStatus:      r.status,
          }))
          .catch(e => ({ service: 'Supabase', status: 'error', error: e.name === 'AbortError' ? 'Timed out' : e.message })),
      ];

      // Backend health check (if configured) — 10 s timeout
      if (BASE_URL) {
        checks.push(
          _timedFetch(`${BASE_URL}/health`, {}, 10000)
            .then(r => r.json())
            .then(d => ({ service: 'Backend', status: (d.ok || d.status === 'ok') ? 'ok' : 'error', config: d.config, ok: d.ok }))
            .catch(e => ({ service: 'Backend', status: 'error', error: e.name === 'AbortError' ? 'Timed out (backend may be starting up)' : e.message }))
        );
      }

      return Promise.all(checks).then(results => ({
        status: results.every(r => r.status === 'ok') ? 'ok' : 'degraded',
        services: results,
      }));
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
    push: PushAPI,
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
