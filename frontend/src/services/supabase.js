/**
 * AVENORA — Supabase Storage Client (Direct Browser Upload)
 *
 * Uploads go straight from the browser to Supabase Storage using the
 * anon key. No backend server is required for file uploads.
 *
 * Buckets:
 *   gallery      — Feed images, gallery uploads          (public)
 *   thumbnails   — Video/playlist artwork                (public)
 *   avatars      — Profile pictures                      (public)
 *   music        — Audio tracks                          (public)
 *   videos       — Video files                           (public)
 *   stream-media — 24-hour cloud stream media            (public)
 *
 * Configuration (set in index.html window.LU_CONFIG):
 *   supabaseUrl  — https://licuiqxkkfboqezzmsqu.supabase.co
 *   supabaseAnon — eyJ... (anon/public key)
 *
 * Exposed as window.AvenoraStorage with the same API as before so
 * no page code needs to change.
 */

(function (global) {
  'use strict';

  const SUPABASE_URL  = 'https://licuiqxkkfboqezzmsqu.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpY3VpcXhra2Zib3Flenptc3F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTYxMDQsImV4cCI6MjEwNDkzMjEwNH0.tsYOyCI7skF6Otz2W0oNYhxM63-0551lrqIDCO8NoJo';

  const STORAGE_BASE  = `${SUPABASE_URL}/storage/v1`;

  // ─── Unique path generator ────────────────────────────────
  // Sanitises the file extension to only safe alphanumeric chars so that
  // the resulting storage path never contains spaces, parens, or other
  // characters that would break the public CDN URL.
  function _storagePath(bucket, uid, filename) {
    const rawExt = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    // Keep only a-z 0-9 — strip any unsafe chars from the extension
    const ext    = rawExt ? '.' + rawExt.replace(/[^a-z0-9]/g, '') : '';
    const rand   = Math.random().toString(36).slice(2, 10);
    const ts     = Date.now();
    return `${uid}/${ts}-${rand}${ext}`;
  }

  // ─── Public URL for public buckets ───────────────────────
  // Each path segment is percent-encoded so that filenames with spaces,
  // parentheses, or other special characters resolve correctly on Android
  // Chrome (which rejects unencoded URLs with MediaError code 4).
  // We decode first to avoid double-encoding paths that were already
  // percent-encoded at upload time (e.g. "uid%2Ftimestamp-rand.mp3").
  function _publicUrl(bucket, path) {
    let decoded;
    try { decoded = decodeURIComponent(path); } catch (_) { decoded = path; }
    const encoded = decoded.split('/').map(encodeURIComponent).join('/');
    return `${STORAGE_BASE}/object/public/${bucket}/${encoded}`;
  }

  // ─── Detect MIME type for video files ────────────────────
  // Android Chrome rejects application/octet-stream for video playback
  // (MediaError code 4).  Always use the correct video MIME type.
  function _detectMime(file) {
    if (file.type && file.type !== 'application/octet-stream') return file.type;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const map = {
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4',
      webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg',
      avi: 'video/x-msvideo', mkv: 'video/x-matroska',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
      ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', opus: 'audio/ogg',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', gif: 'image/gif',
    };
    return map[ext] || 'application/octet-stream';
  }

  // ─── XHR upload (≤ 6 MB) ─────────────────────────────────
  // Sends the file as raw body via XHR POST to Supabase Storage REST API.
  function _xhrUpload(bucket, storagePath, file, mimeType, onProgress) {
    return new Promise((resolve, reject) => {
      const url = `${STORAGE_BASE}/object/${bucket}/${storagePath}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('apikey', SUPABASE_ANON);
      xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.setRequestHeader('x-upsert', 'true');

      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ url: _publicUrl(bucket, storagePath), storagePath, bucket });
        } else {
          let rawMsg = '';
          try { rawMsg = JSON.parse(xhr.responseText).message || ''; } catch {}
          reject(_storageError(rawMsg, xhr.status, bucket));
        }
      };
      xhr.onerror = () => {
        // xhr.onerror fires for: CORS rejection, network down, wrong URL.
        // On Android + Supabase this usually means the bucket is missing an
        // INSERT policy for the anon role. See SUPABASE_SETUP.md.
        const diagMsg =
          'UPLOAD FAILED — Network error reaching Supabase Storage.\n\n' +
          'UPLOAD ENDPOINT: ' + url + '\n' +
          'BUCKET: ' + bucket + '\n\n' +
          'Most likely cause: the "' + bucket + '" bucket has no INSERT policy for the anon role.\n' +
          'Fix: Supabase Dashboard → Storage → ' + bucket + ' → Policies → Add INSERT policy for anon.\n' +
          'See SUPABASE_SETUP.md for the exact SQL.\n\n' +
          'Other causes: no internet connection, Supabase project paused/deleted.';
        console.error('[AvenoraStorage] ' + diagMsg);
        reject(new Error(
          'UPLOAD FAILED\n\nReason: Network error — cannot reach Supabase Storage.\n\n' +
          'UPLOAD ENDPOINT:\n' + url + '\n\n' +
          'BUCKET: ' + bucket + '\n\n' +
          'Most likely cause: "' + bucket + '" bucket needs an INSERT policy for the anon role.\n' +
          'See SUPABASE_SETUP.md for the required SQL policies.'
        ));
      };
      xhr.onabort = () => reject(new Error('Upload cancelled'));
      xhr.send(file);
    });
  }

  // ─── TUS resumable upload (> 6 MB) ───────────────────────
  // Implements a minimal TUS 1.0.0 client against the Supabase Storage
  // resumable endpoint. Uses chunked PATCH requests so large files survive
  // Android Chrome's 50 MB default XHR body limit and the Supabase plan
  // free-tier single-request size cap.
  const TUS_CHUNK = 6 * 1024 * 1024; // 6 MB

  function _tusUpload(bucket, storagePath, file, mimeType, onProgress) {
    return new Promise((resolve, reject) => {
      const endpoint = `${SUPABASE_URL}/storage/v1/upload/resumable`;

      // base64url helper (no external dep)
      function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

      // 1 — Create upload (POST)
      const createXhr = new XMLHttpRequest();
      createXhr.open('POST', endpoint);
      createXhr.setRequestHeader('apikey', SUPABASE_ANON);
      createXhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);
      createXhr.setRequestHeader('x-upsert', 'true');
      createXhr.setRequestHeader('Tus-Resumable', '1.0.0');
      createXhr.setRequestHeader('Upload-Length', String(file.size));
      createXhr.setRequestHeader(
        'Upload-Metadata',
        [
          `bucketName ${b64(bucket)}`,
          `objectName ${b64(storagePath)}`,
          `contentType ${b64(mimeType)}`,
          `cacheControl ${b64('3600')}`,
        ].join(',')
      );

      createXhr.onload = () => {
        if (createXhr.status !== 201) {
          let rawMsg = '';
          try { rawMsg = JSON.parse(createXhr.responseText).message || ''; } catch {}
          return reject(_storageError(rawMsg, createXhr.status, bucket));
        }

        let uploadUrl = createXhr.getResponseHeader('Location');
        if (!uploadUrl) {
          return reject(new Error('TUS creation failed: no Location header returned by Supabase.'));
        }
        // Supabase may return a relative path — resolve it against the base
        if (uploadUrl.startsWith('/')) {
          uploadUrl = `${SUPABASE_URL}${uploadUrl}`;
        }

        // 2 — PATCH chunks sequentially
        let offset = 0;

        function patchChunk() {
          const chunk = file.slice(offset, offset + TUS_CHUNK);
          const chunkSize = chunk.size;

          const patchXhr = new XMLHttpRequest();
          patchXhr.open('PATCH', uploadUrl);
          patchXhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
          patchXhr.setRequestHeader('Content-Length', String(chunkSize));
          patchXhr.setRequestHeader('Upload-Offset', String(offset));
          patchXhr.setRequestHeader('Tus-Resumable', '1.0.0');
          patchXhr.setRequestHeader('apikey', SUPABASE_ANON);
          patchXhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);

          if (onProgress && patchXhr.upload) {
            patchXhr.upload.addEventListener('progress', e => {
              if (e.lengthComputable) {
                const totalDone = offset + e.loaded;
                onProgress(Math.min(99, Math.round((totalDone / file.size) * 100)));
              }
            });
          }

          patchXhr.onload = () => {
            if (patchXhr.status !== 204) {
              let rawMsg = '';
              try { rawMsg = JSON.parse(patchXhr.responseText).message || ''; } catch {}
              return reject(_storageError(rawMsg, patchXhr.status, bucket));
            }

            const newOffset = parseInt(patchXhr.getResponseHeader('Upload-Offset') || String(offset + chunkSize), 10);
            offset = newOffset;

            if (offset >= file.size) {
              // Upload complete
              if (onProgress) onProgress(100);
              resolve({ url: _publicUrl(bucket, storagePath), storagePath, bucket });
            } else {
              patchChunk();
            }
          };

          patchXhr.onerror = () => reject(new Error('TUS chunk upload failed: network error.'));
          patchXhr.onabort = () => reject(new Error('Upload cancelled'));
          patchXhr.send(chunk);
        }

        patchChunk();
      };

      createXhr.onerror = () => {
        const url2 = `${SUPABASE_URL}/storage/v1/upload/resumable`;
        console.error(
          '[AvenoraStorage] TUS upload init failed.\n' +
          'TUS ENDPOINT: ' + url2 + '\n' +
          'BUCKET: ' + bucket + '\n' +
          'Cause: network error — CORS rejection or Supabase project paused.\n' +
          'Fix: ensure "' + bucket + '" bucket has INSERT policy for anon in Supabase Dashboard.'
        );
        reject(new Error(
          'UPLOAD FAILED\n\nReason: Network error — cannot reach Supabase Storage (TUS).\n\n' +
          'TUS ENDPOINT:\n' + url2 + '\n\n' +
          'BUCKET: ' + bucket + '\n\n' +
          'Most likely cause: "' + bucket + '" bucket needs an INSERT policy for the anon role.\n' +
          'See SUPABASE_SETUP.md for the required SQL policies.'
        ));
      };
      createXhr.send();
    });
  }

  // ─── Shared error builder ─────────────────────────────────
  function _storageError(rawMsg, status, bucket) {
    let msg = rawMsg || `Upload failed (HTTP ${status})`;

    if (
      rawMsg.toLowerCase().includes('exceeded the maximum allowed size') ||
      rawMsg.toLowerCase().includes('file size limit') ||
      status === 413
    ) {
      const limitMB = bucket === 'videos' ? 500
                    : bucket === 'music' || bucket === 'stream-media' ? 100
                    : 20;
      msg =
        'Upload failed because the storage limit rejected this file. ' +
        'Maximum allowed size for ' + bucket + ' is ' + limitMB + ' MB. ' +
        'If your file is under ' + limitMB + ' MB, the bucket limit may need ' +
        'to be updated — run scripts/fix-video-bucket-limit.js.';
      const err = new Error(msg);
      err.code = 'FILE_TOO_LARGE_FOR_STORAGE';
      err.limitMB = limitMB;
      console.error(`[AvenoraStorage] ${msg}`);
      return err;
    }

    if (status === 400 && rawMsg.toLowerCase().includes('policy')) {
      msg =
        'Upload blocked by storage policy. ' +
        'Open Supabase dashboard → Storage → ' + bucket +
        ' → Policies and add an INSERT policy for the anon role. ' +
        'See SUPABASE_SETUP.md for the exact SQL.';
    }
    if (status === 401 || status === 403) {
      msg =
        'Upload rejected (permission denied). ' +
        'Check that the "' + bucket + '" bucket has an INSERT policy for the anon role. ' +
        'See SUPABASE_SETUP.md for the required SQL policies.';
    }
    console.error(`[AvenoraStorage] ${msg}`);
    return new Error(msg);
  }

  // ─── Upload dispatcher ────────────────────────────────────
  // Uses TUS for files > 6 MB (avoids Supabase plan single-request limits),
  // plain XHR POST for smaller files (faster, simpler).
  function _upload(bucket, storagePath, file, onProgress) {
    const mimeType = _detectMime(file);
    if (file.size > TUS_CHUNK) {
      return _tusUpload(bucket, storagePath, file, mimeType, onProgress);
    }
    return _xhrUpload(bucket, storagePath, file, mimeType, onProgress);
  }

  // ─── Get current user UID ─────────────────────────────────
  // Prefer Firebase UID from AvenoraFirebase.Auth. Never generate a
  // random fallback for real uploads — an upload without a UID would
  // land in an orphaned folder that cannot be associated with any user.
  function _uid() {
    // Synchronous fast path — Firebase stores the user in LegendState
    const stateUser = (global.LegendState && global.LegendState.get)
      ? global.LegendState.get('user')
      : null;
    if (stateUser) return stateUser.uid || stateUser.id;

    // Second attempt — ask AvenoraFirebase.Auth directly
    const fbUser = global.AvenoraFirebase?.Auth?.getUser?.();
    if (fbUser) return fbUser.uid || fbUser.id;

    // Final fallback: read the persisted UID (set by firebase.js _persistUid)
    const persisted = sessionStorage.getItem('lu_uid') || localStorage.getItem('lu_uid');
    if (persisted) return persisted;

    // No authenticated user — caller should check LegendAPI.auth.isLoggedIn() first
    return null;
  }

  // ─── Require UID or throw ─────────────────────────────────
  function _requireUid(operation) {
    const uid = _uid();
    if (!uid) {
      throw new Error(
        `You must be signed in to ${operation || 'upload files'}. ` +
        'Please sign in and try again.'
      );
    }
    return uid;
  }

  // ─── Startup connectivity check ───────────────────────────
  // Use a HEAD request to a known public URL rather than the /bucket list
  // endpoint (which requires service-role key to enumerate all buckets).
  // We just verify that the Supabase project is reachable.
  fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'HEAD',
    headers: { apikey: SUPABASE_ANON },
  })
    .then(r => {
      // 200 or 401 both confirm the project is reachable
      if (r.ok || r.status === 401 || r.status === 404) {
        console.info('[AvenoraStorage] ✅ Supabase Storage connected — direct upload mode');
      } else {
        console.warn(`[AvenoraStorage] ⚠️  Supabase responded ${r.status} — check project status`);
      }
    })
    .catch(() => console.error('[AvenoraStorage] ❌ Cannot reach Supabase. Check your internet connection.'));

  // ─── Public API ───────────────────────────────────────────
  const AvenoraStorage = {

    get storageAvailable() { return true; },
    get storageStatusMessage() { return 'Direct Supabase Storage upload mode.'; },

    /**
     * Upload a file to a bucket by category.
     * @param {'image'|'avatar'|'audio'|'video'|'thumbnail'|'stream-media'} category
     * @param {File} file
     * @param {Function} [onProgress]
     * @returns {Promise<{url, storagePath, bucket}>}
     */
    async upload(category, file, onProgress) {
      const bucketMap = {
        image:          'gallery',
        avatar:         'avatars',
        audio:          'music',
        video:          'videos',
        thumbnail:      'thumbnails',
        'stream-media': 'stream-media',
      };
      const bucket = bucketMap[category] || 'gallery';
      const uid    = _requireUid('upload files');
      const path   = _storagePath(bucket, uid, file.name);
      return _upload(bucket, path, file, onProgress);
    },

    async uploadAvatar(file, onProgress) {
      if (!file.type.startsWith('image/')) throw new Error('Avatar must be an image file (JPEG, PNG, WebP, or GIF).');
      if (file.size > 10 * 1024 * 1024) throw new Error('Avatar must be under 10 MB');
      const uid  = _requireUid('upload an avatar');
      // Use a stable path (no random suffix) so re-uploading overwrites the old avatar.
      // x-upsert:true is always set in _upload, so this is safe.
      const ext  = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '.jpg';
      const path = `${uid}/avatar${ext}`;
      return _upload('avatars', path, file, onProgress);
    },

    async uploadImage(file, onProgress) {
      if (!file.type.startsWith('image/')) throw new Error('File must be an image (JPEG, PNG, WebP, or GIF).');
      if (file.size > 20 * 1024 * 1024) throw new Error('Image must be under 20 MB');
      return this.upload('image', file, onProgress);
    },

    async uploadAudio(file, onProgress) {
      if (!file.type.startsWith('audio/')) throw new Error('File must be an audio file (MP3, WAV, OGG, FLAC, AAC, M4A, OPUS).');
      if (file.size > 100 * 1024 * 1024) throw new Error('Audio must be under 100 MB');
      return this.upload('audio', file, onProgress);
    },

    async uploadVideo(file, onProgress) {
      if (!file.type.startsWith('video/')) throw new Error('File must be a video file (MP4, WebM, MOV, AVI).');
      if (file.size > 500 * 1024 * 1024) throw new Error('Video is too large. Maximum video size is 500 MB.');
      return this.upload('video', file, onProgress);
    },

    async uploadThumbnail(file, onProgress) {
      if (!file.type.startsWith('image/')) throw new Error('Thumbnail must be an image file.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Thumbnail must be under 5 MB');
      return this.upload('thumbnail', file, onProgress);
    },

    async uploadStreamMedia(file, onProgress) {
      if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
        throw new Error('Stream media must be an audio or video file.');
      }
      if (file.size > 500 * 1024 * 1024) throw new Error('Stream media must be under 500 MB');
      return this.upload('stream-media', file, onProgress);
    },

    /**
     * Batch-upload gallery images, save each to Firestore gallery collection.
     */
    async uploadGallery(files, meta = {}) {
      const uid = _requireUid('upload gallery images');
      const results = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          console.warn('[AvenoraStorage] Skipping non-image file:', file.name);
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          throw new Error(`File "${file.name}" is too large (max 20 MB).`);
        }
        const path   = _storagePath('gallery', uid, file.name);
        const result = await _upload('gallery', path, file, null);
        results.push(result);
        // Save to Firestore gallery collection
        try {
          if (global.AvenoraFirebase?.Firestore?.addGalleryItem) {
            await global.AvenoraFirebase.Firestore.addGalleryItem(
              result.url, meta.category || 'artwork', meta.title || ''
            );
          }
        } catch (fsErr) {
          console.warn('[AvenoraStorage] Firestore gallery save skipped:', fsErr.message);
        }
      }
      return { success: true, images: results.map(r => ({ url: r.url, storagePath: r.storagePath })) };
    },

    /**
     * Upload music + save metadata to Firestore cloudStreamTracks.
     * Returns { track } shaped like the old backend response.
     * Throws if the Firestore save fails — the track URL is only discoverable
     * via the database record so a silent failure means the track is unplayable.
     */
    async uploadMusic(file, meta = {}, onProgress) {
      if (!file.type.startsWith('audio/')) throw new Error('File must be an audio file (MP3, WAV, OGG, FLAC, AAC, M4A, OPUS).');
      if (file.size > 100 * 1024 * 1024) throw new Error('Audio must be under 100 MB');
      const uid  = _requireUid('upload music');

      // Extract real audio duration BEFORE uploading so it is stored accurately.
      // This is essential for the radio engine to schedule tracks correctly.
      // We create a temporary object URL, load it into an Audio element, then revoke it.
      let audioDurationSec = 0;
      try {
        audioDurationSec = await new Promise((resolve) => {
          const tmpUrl = URL.createObjectURL(file);
          const tmpAudio = new Audio();
          const cleanup = (val) => { URL.revokeObjectURL(tmpUrl); tmpAudio.src = ''; resolve(val); };
          tmpAudio.addEventListener('loadedmetadata', () => {
            const d = tmpAudio.duration;
            cleanup(isFinite(d) && d > 0 ? Math.round(d) : 0);
          }, { once: true });
          tmpAudio.addEventListener('error', () => cleanup(0), { once: true });
          // Timeout after 8 s in case the browser can't read the file header
          setTimeout(() => cleanup(0), 8000);
          tmpAudio.src = tmpUrl;
          tmpAudio.load();
        });
      } catch (_) {}

      const path = _storagePath('music', uid, file.name);
      const { url, storagePath } = await _upload('music', path, file, onProgress);

      const track = {
        id:          `${uid}_${Date.now()}`,
        title:       meta.title || file.name.replace(/\.[^.]+$/, ''),
        artistName:  meta.artist || '',
        albumTitle:  meta.album  || '',
        genre:       meta.genre  || 'Other',
        fileUrl:     url,
        storagePath,
        fileSize:    file.size,
        mimeType:    file.type,
        duration:    audioDurationSec,
        visibility:  meta.visibility || 'public',
        createdAt:   new Date().toISOString(),
      };

      // Save to Firestore — required. Without this the track cannot appear in the library.
      if (!global.AvenoraFirebase?.getFirestore) {
        throw new Error(
          'Firebase is not available. The audio file was uploaded to storage but ' +
          'the track record could not be saved. Refresh the page and try again.'
        );
      }
      const fsDb = await global.AvenoraFirebase.getFirestore();
      const { doc, setDoc, serverTimestamp } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const docId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(fsDb, 'cloudStreamTracks', uid, 'tracks', docId), {
        uid,
        title:       track.title,
        artist:      track.artistName,
        album:       track.albumTitle,
        genre:       track.genre,
        url,
        storagePath,
        duration:    audioDurationSec,
        fileName:    file.name,
        fileSize:    file.size,
        mimeType:    file.type,
        visibility:  track.visibility,
        status:      'ready',
        createdAt:   serverTimestamp(),
      });
      track.id = docId;

      return { success: true, track };
    },

    /**
     * Upload video + optional thumbnail, save metadata to Firestore videos collection.
     * Returns { video } shaped like the old backend response.
     * Throws if the Firestore save fails — without the database record the video
     * cannot be discovered on the Video page.
     */
    async uploadVideoWithMeta(videoFile, thumbnailFile, meta = {}, onProgress) {
      if (!videoFile.type.startsWith('video/')) throw new Error('File must be a video file (MP4, WebM, MOV, AVI).');
      if (videoFile.size > 500 * 1024 * 1024) throw new Error('Video is too large. Maximum video size is 500 MB.');
      const uid = _requireUid('upload a video');

      // Upload video
      const videoPath = _storagePath('videos', uid, videoFile.name);
      const { url: videoUrl, storagePath } = await _upload('videos', videoPath, videoFile, onProgress);

      // Upload thumbnail if provided
      let thumbnailUrl = '';
      if (thumbnailFile) {
        try {
          if (!thumbnailFile.type.startsWith('image/')) {
            console.warn('[AvenoraStorage] Thumbnail is not an image — skipping');
          } else if (thumbnailFile.size > 5 * 1024 * 1024) {
            console.warn('[AvenoraStorage] Thumbnail too large (max 5 MB) — skipping');
          } else {
            const thumbPath = _storagePath('thumbnails', uid, thumbnailFile.name);
            const t = await _upload('thumbnails', thumbPath, thumbnailFile, null);
            thumbnailUrl = t.url;
          }
        } catch (e) {
          console.warn('[AvenoraStorage] Thumbnail upload skipped:', e.message);
        }
      }

      const video = {
        id:          `${uid}_${Date.now()}`,
        title:       meta.title || videoFile.name.replace(/\.[^.]+$/, ''),
        description: meta.description || '',
        category:    meta.category    || 'other',
        visibility:  meta.visibility  || 'public',
        videoUrl,
        thumbnailUrl,
        storagePath,
        fileSize:    videoFile.size,
        createdAt:   new Date().toISOString(),
      };

      // Save metadata to the backend (MongoDB) via POST /api/videos/save-meta.
      // This replaces the old Firestore write which was blocked by permission-denied errors.
      if (!global.LegendAPI?.videos?.saveMeta) {
        throw new Error(
          'LegendAPI is not available. The video file was uploaded to storage but ' +
          'the video record could not be saved. Refresh the page and try again.'
        );
      }

      // Build the metadata payload with consistent field names.
      const metaPayload = {
        title:        video.title,
        description:  video.description,
        category:     video.category,
        visibility:   video.visibility,
        videoUrl,
        thumbnailUrl: thumbnailUrl || null,
        storagePath,
        fileSize:     videoFile.size,
        mimeType:     videoFile.type,
      };

      // Attempt metadata save with up to 3 retries (network transience / token refresh).
      // The file is already in Supabase Storage — do not re-upload it.
      let savedVideo = null;
      let lastMetaErr = null;
      const MAX_META_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_META_RETRIES; attempt++) {
        try {
          const result = await global.LegendAPI.videos.saveMeta(metaPayload);
          savedVideo = result.video;
          lastMetaErr = null;
          break; // success
        } catch (apiErr) {
          lastMetaErr = apiErr;
          const status = apiErr.status;

          // Non-retryable errors — propagate immediately
          if (apiErr.code === 'BACKEND_NOT_CONFIGURED' || apiErr.code === 'API_NOT_CONFIGURED') {
            // Re-throw as-is — these are configuration errors, not transient failures.
            // The file is uploaded but metadata cannot be saved until the URL is fixed.
            const metaErr = new Error(
              'Video metadata save failed: ' + apiErr.message
            );
            metaErr.code       = apiErr.code;
            metaErr.storagePath = storagePath;
            metaErr.videoUrl    = videoUrl;
            metaErr.metaPayload = metaPayload;
            metaErr.isOrphanRisk = true;
            throw metaErr;
          }
          if (status === 401 || status === 403) {
            const metaErr = new Error(
              status === 401
                ? 'Video metadata save failed: your session has expired. Please sign in and try again.'
                : 'Video metadata save failed: you do not have permission to upload videos.'
            );
            metaErr.code = status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN';
            metaErr.storagePath = storagePath;
            metaErr.videoUrl    = videoUrl;
            metaErr.metaPayload = metaPayload; // allow caller to retry with fresh token
            throw metaErr;
          }
          if (status === 422) {
            const metaErr = new Error('Video metadata save failed: ' + apiErr.message);
            metaErr.code = 'VALIDATION_ERROR';
            metaErr.storagePath = storagePath;
            metaErr.videoUrl    = videoUrl;
            throw metaErr;
          }
          if (status === 409) {
            // Duplicate — a record already exists for this storagePath, treat as success
            // by trying to recover the existing video from the error response.
            savedVideo = apiErr.existingVideo || null;
            lastMetaErr = null;
            break;
          }

          // Network/backend errors — retryable
          console.warn(
            `[AvenoraStorage] Metadata save attempt ${attempt}/${MAX_META_RETRIES} failed:`,
            apiErr.message || apiErr.code || 'unknown'
          );

          if (attempt < MAX_META_RETRIES) {
            // Exponential back-off: 1 s, 2 s
            await new Promise(r => setTimeout(r, attempt * 1000));
          }
        }
      }

      if (lastMetaErr) {
        // All retries exhausted. Preserve storagePath so the caller can offer a retry UI.
        // The file is intact in Supabase Storage and is NOT orphaned yet.
        const metaErr = new Error(
          'Video metadata save failed after ' + MAX_META_RETRIES + ' attempts: ' +
          (lastMetaErr.message || lastMetaErr.originalError || 'unknown error') + '. ' +
          'The video file was uploaded successfully. ' +
          'Click "Retry Metadata" to save the record without re-uploading the file.'
        );
        metaErr.code          = lastMetaErr.code || 'METADATA_SAVE_FAILED';
        metaErr.storagePath   = storagePath;
        metaErr.videoUrl      = videoUrl;
        metaErr.thumbnailUrl  = thumbnailUrl;
        metaErr.metaPayload   = metaPayload;  // pass back for retry button
        metaErr.isOrphanRisk  = true;         // flag for the upload UI
        throw metaErr;
      }

      video.id = savedVideo?._id || savedVideo?.id || video.id;

      return { success: true, video: { ...video, ...savedVideo } };
    },

    /**
     * Save video metadata only — does NOT re-upload the file.
     * Call this after a failed uploadVideoWithMeta() to retry without
     * uploading the file again. Pass the `metaPayload` from the error object.
     *
     * @param {object} metaPayload — the same payload that uploadVideoWithMeta would have sent
     * @returns {Promise<{success: true, video: object}>}
     */
    async retryMetadataOnly(metaPayload) {
      if (!global.LegendAPI?.videos?.saveMeta) {
        throw new Error('LegendAPI is not available. Refresh the page and try again.');
      }
      const result = await global.LegendAPI.videos.saveMeta(metaPayload);
      return { success: true, video: result.video };
    },

    // Kept for API compatibility — all buckets in this client are public
    async refreshSignedUrl(bucket, storagePath) {
      return _publicUrl(bucket, storagePath);
    },

    /**
     * Get the public CDN URL for a file in a given bucket.
     * Used by MusicService.resolveAudioUrl() when only a storagePath is known.
     * @param {string} bucket — e.g. 'music'
     * @param {string} storagePath — e.g. 'uid/timestamp-rand.mp3'
     * @returns {string}
     */
    getPublicUrl(bucket, storagePath) {
      return _publicUrl(bucket, storagePath);
    },
  };

  global.AvenoraStorage = AvenoraStorage;

})(window);
