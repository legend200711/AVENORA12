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
  function _storagePath(bucket, uid, filename) {
    const ext   = filename.includes('.') ? '.' + filename.split('.').pop().toLowerCase() : '';
    const rand  = Math.random().toString(36).slice(2, 10);
    const ts    = Date.now();
    return `${uid}/${ts}-${rand}${ext}`;
  }

  // ─── Public URL for public buckets ───────────────────────
  function _publicUrl(bucket, path) {
    return `${STORAGE_BASE}/object/public/${bucket}/${path}`;
  }

  // ─── XHR upload directly to Supabase Storage REST API ────
  // Uses the anon key. Bucket must have RLS policy allowing INSERT for anon role.
  function _upload(bucket, storagePath, file, onProgress) {
    return new Promise((resolve, reject) => {
      const url = `${STORAGE_BASE}/object/${bucket}/${storagePath}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('apikey', SUPABASE_ANON);
      xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      // x-upsert: true allows overwriting (important for avatar re-uploads)
      xhr.setRequestHeader('x-upsert', 'true');

      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const publicUrl = _publicUrl(bucket, storagePath);
          resolve({ url: publicUrl, storagePath, bucket });
        } else {
          let msg = `Upload failed (HTTP ${xhr.status})`;
          try { msg = JSON.parse(xhr.responseText).message || msg; } catch {}
          if (xhr.status === 400 && msg.toLowerCase().includes('policy')) {
            msg =
              'Upload blocked by storage policy. ' +
              'Open Supabase dashboard → Storage → ' + bucket +
              ' → Policies and add an INSERT policy for the anon role. ' +
              'See SUPABASE_SETUP.md for the exact SQL.';
          }
          if (xhr.status === 401 || xhr.status === 403) {
            msg =
              'Upload rejected (permission denied). ' +
              'Check that the "' + bucket + '" bucket has an INSERT policy for the anon role. ' +
              'See SUPABASE_SETUP.md for the required SQL policies.';
          }
          console.error(`[AvenoraStorage] ${msg}`);
          reject(new Error(msg));
        }
      };
      xhr.onerror  = () => reject(new Error('Upload failed: network error. Check your internet connection.'));
      xhr.onabort  = () => reject(new Error('Upload cancelled'));
      xhr.send(file);
    });
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
      if (file.size > 2 * 1024 * 1024 * 1024) throw new Error('Video must be under 2 GB');
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
        duration:    0,
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
      if (videoFile.size > 2 * 1024 * 1024 * 1024) throw new Error('Video must be under 2 GB');
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
      let savedVideo;
      try {
        const result = await global.LegendAPI.videos.saveMeta({
          title:        video.title,
          description:  video.description,
          category:     video.category,
          visibility:   video.visibility,
          videoUrl,
          thumbnailUrl,
          storagePath,
          fileSize:     videoFile.size,
          mimeType:     videoFile.type,
        });
        savedVideo = result.video;
      } catch (apiErr) {
        const status = apiErr.status;
        if (status === 401 || status === 403) {
          throw new Error(
            'Video metadata save failed: you must be signed in to save videos. ' +
            'Please sign in and try again.'
          );
        }
        if (status === 422) {
          throw new Error(`Video metadata save failed: ${apiErr.message}`);
        }
        throw new Error(
          `Video metadata save failed: ${apiErr.message || 'unknown error'}. ` +
          'The video file was uploaded to storage. Reload the page and try again.'
        );
      }
      video.id = savedVideo?._id || savedVideo?.id || video.id;

      return { success: true, video: { ...video, ...savedVideo } };
    },

    // Kept for API compatibility — all buckets in this client are public
    async refreshSignedUrl(bucket, storagePath) {
      return _publicUrl(bucket, storagePath);
    },
  };

  global.AvenoraStorage = AvenoraStorage;

})(window);
