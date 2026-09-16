/**
 * AVENORA — Supabase Storage Client (Frontend)
 *
 * Provides a thin, frontend-safe wrapper around Supabase Storage.
 * Uses the ANON key only — never exposes the service-role key.
 *
 * All uploads are proxied through the AVENORA backend API
 * (/api/upload/*, /api/music/upload, /api/videos/upload, /api/gallery/upload)
 * rather than uploading directly to Supabase from the browser.
 *
 * This file exposes:
 *   AvenoraStorage.upload(category, file, onProgress)
 *   AvenoraStorage.uploadAvatar(file, onProgress)
 *   AvenoraStorage.uploadAudio(file, onProgress)
 *   AvenoraStorage.uploadVideo(file, onProgress)
 *   AvenoraStorage.uploadImage(file, onProgress)
 *   AvenoraStorage.uploadThumbnail(file, onProgress)
 *   AvenoraStorage.uploadGallery(files, meta)  — batch, returns array
 *   AvenoraStorage.refreshSignedUrl(bucket, storagePath, expirySecs)
 *
 * Upload progress is tracked via XMLHttpRequest so real progress events fire.
 */

(function (global) {
  'use strict';

  // ─── Resolve API base URL ─────────────────────────────────
  // Returns a URL that ends with /api (no trailing slash).
  // Handles both:
  //   'https://api.avenora.app'      -> 'https://api.avenora.app/api'
  //   'https://api.avenora.app/api'  -> 'https://api.avenora.app/api'  (no double /api)
  function _apiBase() {
    const raw =
      (window.LU_CONFIG && window.LU_CONFIG.apiUrl) || null;
    if (!raw) return null;
    // Strip trailing slash
    let url = String(raw).replace(/\/$/, '');
    // If the URL already ends with /api or contains /api/, don't append again
    if (!url.endsWith('/api') && !url.includes('/api/')) url += '/api';
    return url;
  }

  // ─── Auth token ───────────────────────────────────────────
  async function _getToken() {
    if (window.AvenoraFirebase?.Auth) {
      const t = await window.AvenoraFirebase.Auth.getIdToken().catch(() => null);
      if (t) return t;
    }
    return sessionStorage.getItem('lu_uid') ||
           localStorage.getItem('lu_uid') ||
           sessionStorage.getItem('lu_access') ||
           localStorage.getItem('lu_access') ||
           null;
  }

  // ─── XHR upload with progress ─────────────────────────────
  function _xhrUpload(url, formData, token, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { data = { message: xhr.responseText }; }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          // Map HTTP status codes to actionable error messages
          const serverMsg = data?.message || '';
          const message =
            xhr.status === 0   ? 'Upload failed: could not reach the server. Check your connection and that the backend is running.' :
            xhr.status === 401 ? 'Upload failed: your session has expired. Please sign in again.' :
            xhr.status === 403 ? 'Upload failed: you do not have permission to upload.' :
            xhr.status === 413 ? 'Upload failed: file too large. Maximum sizes — images: 20 MB, videos: 2 GB, avatars: 5 MB.' :
            xhr.status === 415 ? `Upload failed: unsupported file type. ${serverMsg}` :
            xhr.status === 503 ? 'Upload failed: storage service unavailable. The Supabase configuration may be missing on the server.' :
            serverMsg || `Upload failed (HTTP ${xhr.status})`;
          const err = new Error(message);
          err.status = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error(
        'Upload failed: could not reach the server. ' +
        'Check your internet connection and that the backend is running at the configured URL.'
      ));
      xhr.onabort = () => reject(new Error('Upload cancelled'));
      xhr.send(formData);
    });
  }

  // ─── Public API ───────────────────────────────────────────
  const AvenoraStorage = {

    /**
     * Generic upload via the backend proxy.
     * @param {'avatar'|'image'|'audio'|'video'|'thumbnail'} category
     * @param {File} file
     * @param {Function} [onProgress]  — called with 0–100
     * @returns {Promise<{url: string, storagePath: string}>}
     */
    async upload(category, file, onProgress) {
      const base = _apiBase();
      if (!base) throw new Error('API endpoint not configured. Set window.LU_CONFIG.apiUrl.');
      const token = await _getToken();
      const fd = new FormData();
      fd.append('file', file);
      const data = await _xhrUpload(`${base}/upload/${category}`, fd, token, onProgress);
      if (!data.success) throw new Error(data.message || 'Upload failed');
      return { url: data.url, storagePath: data.storagePath || null };
    },

    /**
     * Upload an avatar.
     * Returns { url } — the signed/public URL to use in profile.
     */
    async uploadAvatar(file, onProgress) {
      if (file.size > 10 * 1024 * 1024) throw new Error('Avatar must be under 10 MB');
      return this.upload('avatar', file, onProgress);
    },

    /**
     * Upload a banner/cover image.
     */
    async uploadImage(file, onProgress) {
      if (file.size > 20 * 1024 * 1024) throw new Error('Image must be under 20 MB');
      return this.upload('image', file, onProgress);
    },

    /**
     * Upload an audio file.
     * For Music Hub use /api/music/upload directly (includes metadata).
     * This is for generic audio (e.g. stream-media).
     */
    async uploadAudio(file, onProgress) {
      if (file.size > 100 * 1024 * 1024) throw new Error('Audio must be under 100 MB');
      return this.upload('audio', file, onProgress);
    },

    /**
     * Upload a video file.
     */
    async uploadVideo(file, onProgress) {
      if (file.size > 2 * 1024 * 1024 * 1024) throw new Error('Video must be under 2 GB');
      return this.upload('video', file, onProgress);
    },

    /**
     * Upload a thumbnail / artwork image.
     */
    async uploadThumbnail(file, onProgress) {
      if (file.size > 5 * 1024 * 1024) throw new Error('Thumbnail must be under 5 MB');
      return this.upload('thumbnail', file, onProgress);
    },

    /**
     * Batch-upload gallery images.
     * @param {File[]} files
     * @param {{ category?: string, title?: string, caption?: string }} meta
     * @returns {Promise<{images: Array}>}
     */
    async uploadGallery(files, meta = {}) {
      const base = _apiBase();
      if (!base) throw new Error('API endpoint not configured.');
      const token = await _getToken();
      const fd = new FormData();
      files.forEach(f => fd.append('file', f));
      if (meta.category) fd.append('category', meta.category);
      if (meta.title)    fd.append('title', meta.title);
      if (meta.caption)  fd.append('caption', meta.caption);
      const data = await _xhrUpload(`${base}/gallery/upload`, fd, token, null);
      if (!data.success) throw new Error(data.message || 'Gallery upload failed');
      return data;
    },

    /**
     * Upload music with metadata (Music Hub).
     * @param {File} file
     * @param {{ title, artist, album, genre, description, visibility }} meta
     * @param {Function} [onProgress]
     * @returns {Promise<{track}>}
     */
    async uploadMusic(file, meta = {}, onProgress) {
      const base = _apiBase();
      if (!base) throw new Error('API endpoint not configured.');
      const token = await _getToken();
      const fd = new FormData();
      fd.append('file', file);
      if (meta.title)       fd.append('title',       meta.title);
      if (meta.artist)      fd.append('artistName',  meta.artist);
      if (meta.album)       fd.append('albumTitle',  meta.album);
      if (meta.genre)       fd.append('genre',       meta.genre);
      const data = await _xhrUpload(`${base}/music/upload`, fd, token, onProgress);
      if (!data.success) throw new Error(data.message || 'Music upload failed');
      return data;
    },

    /**
     * Upload video with metadata.
     * @param {File} videoFile
     * @param {File|null} thumbnailFile
     * @param {{ title, description, category, visibility }} meta
     * @param {Function} [onProgress]
     * @returns {Promise<{video}>}
     */
    async uploadVideoWithMeta(videoFile, thumbnailFile, meta = {}, onProgress) {
      const base = _apiBase();
      if (!base) throw new Error('API endpoint not configured.');
      const token = await _getToken();
      const fd = new FormData();
      fd.append('video', videoFile);
      if (thumbnailFile) fd.append('thumbnail', thumbnailFile);
      if (meta.title)       fd.append('title',       meta.title);
      if (meta.description) fd.append('description', meta.description);
      if (meta.category)    fd.append('category',    meta.category);
      if (meta.visibility)  fd.append('visibility',  meta.visibility);
      const data = await _xhrUpload(`${base}/videos/upload`, fd, token, onProgress);
      if (!data.success) throw new Error(data.message || 'Video upload failed');
      return data;
    },

    /**
     * Refresh a signed URL for a private Supabase Storage file.
     * Routes through the backend — the service-role key never reaches the browser.
     *
     * @param {'music'|'videos'|'avatars'|'stream-media'} bucket
     * @param {string} storagePath
     * @returns {Promise<string>}
     */
    async refreshSignedUrl(bucket, storagePath) {
      const base = _apiBase();
      if (!base) throw new Error('API endpoint not configured.');
      const token = await _getToken();

      // Route per bucket
      let url;
      if (bucket === 'music') {
        // Extract track id if possible, else use query param route
        url = `${base}/upload/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`;
      } else if (bucket === 'videos') {
        url = `${base}/upload/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`;
      } else {
        url = `${base}/upload/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`;
      }

      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not refresh signed URL');
      return data.signedUrl || data.url;
    },
  };

  global.AvenoraStorage = AvenoraStorage;

})(window);
