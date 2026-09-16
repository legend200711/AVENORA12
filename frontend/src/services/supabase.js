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
  // Uses the anon key. Bucket must have RLS policy allowing INSERT.
  function _upload(bucket, storagePath, file, onProgress) {
    return new Promise((resolve, reject) => {
      const url = `${STORAGE_BASE}/object/${bucket}/${storagePath}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('apikey', SUPABASE_ANON);
      xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
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
          if (xhr.status === 400 && msg.includes('policy')) {
            msg = 'Upload blocked by storage policy. Open Supabase dashboard → Storage → ' + bucket + ' → Policies and add an INSERT policy for anon role.';
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
  function _uid() {
    const u = window.AvenoraFirebase?.Auth?.getUser?.();
    return u?.uid || u?.id || 'anon-' + Math.random().toString(36).slice(2, 8);
  }

  // ─── Startup check ────────────────────────────────────────
  fetch(`${STORAGE_BASE}/bucket`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  })
    .then(r => r.ok
      ? console.info('[AvenoraStorage] ✅ Supabase Storage connected — direct upload mode')
      : console.warn(`[AvenoraStorage] ⚠️  Supabase Storage responded ${r.status}`)
    )
    .catch(() => console.error('[AvenoraStorage] ❌ Cannot reach Supabase Storage. Check your internet connection.'));

  // ─── Public API ───────────────────────────────────────────
  const AvenoraStorage = {

    get storageAvailable() { return true; },
    get storageStatusMessage() { return 'Direct Supabase Storage upload mode.'; },

    /**
     * Upload a file to a bucket by category.
     * @param {'image'|'avatar'|'audio'|'video'|'thumbnail'} category
     * @param {File} file
     * @param {Function} [onProgress]
     * @returns {Promise<{url, storagePath}>}
     */
    async upload(category, file, onProgress) {
      const bucketMap = {
        image:     'gallery',
        avatar:    'avatars',
        audio:     'music',
        video:     'videos',
        thumbnail: 'thumbnails',
      };
      const bucket = bucketMap[category] || 'gallery';
      const uid    = _uid();
      const path   = _storagePath(bucket, uid, file.name);
      return _upload(bucket, path, file, onProgress);
    },

    async uploadAvatar(file, onProgress) {
      if (file.size > 10 * 1024 * 1024) throw new Error('Avatar must be under 10 MB');
      const uid  = _uid();
      const ext  = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
      const path = `${uid}/avatar${ext}`;
      return _upload('avatars', path, file, onProgress);
    },

    async uploadImage(file, onProgress) {
      if (file.size > 20 * 1024 * 1024) throw new Error('Image must be under 20 MB');
      return this.upload('image', file, onProgress);
    },

    async uploadAudio(file, onProgress) {
      if (file.size > 100 * 1024 * 1024) throw new Error('Audio must be under 100 MB');
      return this.upload('audio', file, onProgress);
    },

    async uploadVideo(file, onProgress) {
      if (file.size > 2 * 1024 * 1024 * 1024) throw new Error('Video must be under 2 GB');
      return this.upload('video', file, onProgress);
    },

    async uploadThumbnail(file, onProgress) {
      if (file.size > 5 * 1024 * 1024) throw new Error('Thumbnail must be under 5 MB');
      return this.upload('thumbnail', file, onProgress);
    },

    /**
     * Batch-upload gallery images, save each to Firestore gallery collection.
     */
    async uploadGallery(files, meta = {}) {
      const uid = _uid();
      const results = [];
      for (const file of files) {
        const path   = _storagePath('gallery', uid, file.name);
        const result = await _upload('gallery', path, file, null);
        results.push(result);
        // Save to Firestore gallery collection
        try {
          if (window.AvenoraFirebase?.Firestore?.addGalleryItem) {
            await window.AvenoraFirebase.Firestore.addGalleryItem(
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
     */
    async uploadMusic(file, meta = {}, onProgress) {
      if (file.size > 100 * 1024 * 1024) throw new Error('Audio must be under 100 MB');
      const uid  = _uid();
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

      // Save to Firestore so Music Hub library and Cloud Stream can read it
      try {
        if (window.AvenoraFirebase?.getFirestore) {
          const fsDb = await window.AvenoraFirebase.getFirestore();
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
        }
      } catch (fsErr) {
        console.warn('[AvenoraStorage] Firestore track save skipped:', fsErr.message);
      }

      return { success: true, track };
    },

    /**
     * Upload video + optional thumbnail, save metadata to Firestore videos collection.
     * Returns { video } shaped like the old backend response.
     */
    async uploadVideoWithMeta(videoFile, thumbnailFile, meta = {}, onProgress) {
      const uid = _uid();

      // Upload video
      const videoPath = _storagePath('videos', uid, videoFile.name);
      const { url: videoUrl, storagePath } = await _upload('videos', videoPath, videoFile, onProgress);

      // Upload thumbnail if provided
      let thumbnailUrl = '';
      if (thumbnailFile) {
        try {
          const thumbPath = _storagePath('thumbnails', uid, thumbnailFile.name);
          const t = await _upload('thumbnails', thumbPath, thumbnailFile, null);
          thumbnailUrl = t.url;
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

      // Save to Firestore videos collection
      try {
        if (window.AvenoraFirebase?.getFirestore) {
          const fsDb = await window.AvenoraFirebase.getFirestore();
          const { collection, addDoc, serverTimestamp } =
            await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
          const user = window.AvenoraFirebase?.Auth?.getUser?.();
          const docRef = await addDoc(collection(fsDb, 'videos'), {
            uid,
            owner: {
              uid,
              username: user?.username || user?.displayName || 'user',
              avatarUrl: user?.profile?.avatarUrl || '',
            },
            title:        video.title,
            description:  video.description,
            category:     video.category,
            visibility:   video.visibility,
            videoUrl,
            thumbnailUrl,
            storagePath,
            fileSize:     videoFile.size,
            views:        0,
            likes:        [],
            processingStatus: 'ready',
            createdAt:    serverTimestamp(),
          });
          video.id = docRef.id;
        }
      } catch (fsErr) {
        console.warn('[AvenoraStorage] Firestore video save skipped:', fsErr.message);
      }

      return { success: true, video };
    },

    // Kept for API compatibility — not needed in direct mode
    async refreshSignedUrl(bucket, storagePath) {
      return _publicUrl(bucket, storagePath);
    },
  };

  global.AvenoraStorage = AvenoraStorage;

})(window);
