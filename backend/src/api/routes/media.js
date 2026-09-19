/**
 * AVENORA — User Media Library Routes
 *
 * Mount point: /api/media
 *
 * Manages the per-user media library stored in Firestore under
 *   userMedia/{uid}/items/{docId}
 *
 * Endpoints:
 *   GET  /api/media/library          — list all items for the authenticated user
 *   POST /api/media/save             — save a media record after upload
 *   DELETE /api/media/:id            — delete a record (owner only)
 *   POST /api/media/slideshow        — save a Photo+Music slideshow definition
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { ValidationError, ForbiddenError, NotFoundError } = require('../middleware/errorHandler');
const { getDb } = require('../../config/firestore');
const logger = require('../../utils/logger');
const storage = require('../../services/storage/supabaseStorage');

// ─── Allowed media types ──────────────────────────────────────────────────
const VALID_MEDIA_TYPES = ['audio', 'video', 'image', 'slideshow'];

// ─── Sanitize a media item from untrusted input ──────────────────────────
function _sanitize(body, uid) {
  const type = String(body.type || '').toLowerCase();
  if (!VALID_MEDIA_TYPES.includes(type)) {
    throw new ValidationError(`type must be one of: ${VALID_MEDIA_TYPES.join(', ')}`);
  }
  const title = String(body.title || '').slice(0, 200).trim();
  if (!title) throw new ValidationError('title is required');

  const item = {
    uid,
    type,
    title,
    url:          typeof body.url          === 'string' ? body.url.slice(0, 2000)          : null,
    storagePath:  typeof body.storagePath  === 'string' ? body.storagePath.slice(0, 500)   : null,
    thumbnailUrl: typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl.slice(0, 2000) : null,
    duration:     typeof body.duration     === 'number' ? Math.max(0, Math.floor(body.duration)) : 0,
    fileSize:     typeof body.fileSize     === 'number' ? body.fileSize : 0,
    mimeType:     typeof body.mimeType     === 'string' ? body.mimeType.slice(0, 100) : '',
    status:       'ready',
    createdAt:    new Date().toISOString(),
  };

  // Slideshow-specific fields
  if (type === 'slideshow') {
    if (Array.isArray(body.images)) {
      item.images = body.images.slice(0, 100).map(img => ({
        url:          String(img.url || '').slice(0, 2000),
        storagePath:  String(img.storagePath || '').slice(0, 500),
        caption:      String(img.caption || '').slice(0, 200),
      }));
    } else {
      item.images = [];
    }
    item.perImageSecs = typeof body.perImageSecs === 'number'
      ? Math.min(Math.max(body.perImageSecs, 3), 300)
      : 10;
    // Optional background audio track for the slideshow
    if (body.audioTrack && typeof body.audioTrack === 'object') {
      item.audioTrack = {
        url:         String(body.audioTrack.url || '').slice(0, 2000),
        storagePath: String(body.audioTrack.storagePath || '').slice(0, 500),
        title:       String(body.audioTrack.title || '').slice(0, 200),
        duration:    typeof body.audioTrack.duration === 'number' ? body.audioTrack.duration : 0,
      };
    }
    // Total duration: images.length * perImageSecs
    item.duration = (item.images.length || 0) * item.perImageSecs;
  }

  return item;
}

// ─── GET /api/media/library ───────────────────────────────────────────────
router.get('/library', authenticate, async (req, res, next) => {
  try {
    const uid = req.user.id;
    const db = getDb();
    const snap = await db.collection('userMedia').doc(uid)
      .collection('items')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, items });
  } catch (err) { next(err); }
});

// ─── POST /api/media/save ─────────────────────────────────────────────────
// Called by the frontend after a successful Supabase upload.
// Saves the media record so it appears in the user's library.
router.post('/save', authenticate, async (req, res, next) => {
  try {
    const uid = req.user.id;
    const item = _sanitize(req.body, uid);
    const db = getDb();
    const ref = await db.collection('userMedia').doc(uid)
      .collection('items')
      .add(item);
    logger.info(`[Media] Saved ${item.type} "${item.title}" for ${uid}`);
    res.json({ success: true, id: ref.id, item: { id: ref.id, ...item } });
  } catch (err) { next(err); }
});

// ─── POST /api/media/slideshow ────────────────────────────────────────────
// Save (or update) a Photo+Music slideshow definition.
router.post('/slideshow', authenticate, async (req, res, next) => {
  try {
    const uid = req.user.id;
    const body = { ...req.body, type: 'slideshow', uid };
    const item = _sanitize(body, uid);

    // Require at least one image
    if (!item.images || item.images.length === 0) {
      return next(new ValidationError('A slideshow must contain at least one image'));
    }

    const db = getDb();
    let id;
    if (req.body.id) {
      // Update existing slideshow
      const docRef = db.collection('userMedia').doc(uid).collection('items').doc(req.body.id);
      const existing = await docRef.get();
      if (!existing.exists) return next(new NotFoundError('Slideshow'));
      if (existing.data().uid !== uid) return next(new ForbiddenError());
      await docRef.update({ ...item, updatedAt: new Date().toISOString() });
      id = req.body.id;
    } else {
      const ref = await db.collection('userMedia').doc(uid).collection('items').add(item);
      id = ref.id;
    }

    logger.info(`[Media] Slideshow "${item.title}" saved for ${uid} (${item.images.length} images)`);
    res.json({ success: true, id, item: { id, ...item } });
  } catch (err) { next(err); }
});

// ─── DELETE /api/media/:id ────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const uid = req.user.id;
    const db = getDb();
    const docRef = db.collection('userMedia').doc(uid).collection('items').doc(req.params.id);
    const snap = await docRef.get();
    if (!snap.exists) return next(new NotFoundError('Media item'));

    const item = snap.data();
    // Only owner (or admin/founder) can delete
    if (item.uid !== uid && req.user.role !== 'admin' && req.user.role !== 'founder') {
      return next(new ForbiddenError());
    }

    // Delete from Supabase Storage if we have the path
    const bucketMap = { audio: 'music', video: 'videos', image: 'gallery', slideshow: null };
    const bucket = bucketMap[item.type];
    if (bucket && item.storagePath) {
      try { await storage.deleteFile(bucket, item.storagePath); } catch (e) {
        logger.warn(`[Media] Storage delete failed for ${item.storagePath}: ${e.message}`);
      }
    }
    // For slideshows, also clean up individual image files
    if (item.type === 'slideshow' && Array.isArray(item.images)) {
      for (const img of item.images) {
        if (img.storagePath) {
          try { await storage.deleteFile('gallery', img.storagePath); } catch (_) {}
        }
      }
    }

    await docRef.delete();
    logger.info(`[Media] Deleted item ${req.params.id} for ${uid}`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
