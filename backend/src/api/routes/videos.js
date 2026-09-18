/**
 * Videos Routes — Firestore + Supabase Storage
 * Replaces the old Mongoose-backed implementation.
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');

const { authenticate, optionalAuth } = require('../middleware/auth');
const { NotFoundError, ForbiddenError, ValidationError } = require('../middleware/errorHandler');
const { getDb, FieldValue } = require('../../config/firestore');
const storageSvc = require('../../services/storage/supabaseStorage');

const ALLOWED_VIDEO_MIME = new Set(['video/mp4','video/webm','video/ogg','video/quicktime','video/x-msvideo']);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg','image/png','image/webp']);

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.fieldname === 'video'     && !ALLOWED_VIDEO_MIME.has(file.mimetype)) return cb(new ValidationError('Unsupported video format.'));
    if (file.fieldname === 'thumbnail' && !ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(new ValidationError('Thumbnail must be JPG, PNG, or WebP.'));
    cb(null, true);
  },
}).fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

// GET /api/videos
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category, page = 1, limit = 20, sort = 'new', q, tag } = req.query;
    const limitN = Math.min(50, parseInt(limit) || 20);
    const db     = getDb();

    let query = db.collection('videos')
      .where('isDeleted', '==', false)
      .where('isPublished', '==', true)
      .where('processingStatus', '==', 'ready')
      .where('visibility', '==', 'public');

    if (category) query = query.where('category', '==', category);
    // Sort
    const sortField = sort === 'trending' ? 'views' : 'createdAt';
    query = query.orderBy(sortField, 'desc').limit(limitN * parseInt(page));

    const snap = await query.get();
    let videos = snap.docs.map(d => ({ id: d.id, ...d.data(), videoUrl: d.data().hlsUrl || d.data().originalFileUrl || null }));

    // Client-side filter for text search and tag (Firestore limitation)
    if (q) {
      const lq = q.toLowerCase();
      videos = videos.filter(v => v.title?.toLowerCase().includes(lq) || v.description?.toLowerCase().includes(lq) || (v.tags || []).some(t => t.toLowerCase().includes(lq)));
    }
    if (tag) videos = videos.filter(v => (v.tags || []).includes(tag));

    const page_n = Math.max(1, parseInt(page));
    const paged  = videos.slice((page_n - 1) * limitN, page_n * limitN);
    res.json({ success: true, videos: paged, total: videos.length, page: page_n, limit: limitN });
  } catch (err) { next(err); }
});

// GET /api/videos/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const snap = await getDb().collection('videos').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Video'));
    const v   = { id: snap.id, ...snap.data(), videoUrl: snap.data().hlsUrl || snap.data().originalFileUrl || null };
    const uid = req.user?.id;
    res.json({ success: true, video: {
      ...v,
      likedByMe:      uid ? (v.likes || []).includes(uid) : false,
      watchLaterByMe: uid ? (v.watchLaterBy || []).includes(uid) : false,
    }});
  } catch (err) { next(err); }
});

// POST /api/videos/:id/view
router.post('/:id/view', optionalAuth, async (req, res, next) => {
  try {
    const { position = 0 } = req.body;
    const db   = getDb();
    await db.collection('videos').doc(req.params.id).update({ views: FieldValue.increment(1) });
    // Save watch history (authenticated users only)
    if (req.user) {
      const histId = `${req.user.id}_${req.params.id}`;
      await db.collection('watchHistory').doc(histId).set({
        user: req.user.id, videoId: req.params.id, position: Number(position) || 0,
        watchedAt: new Date().toISOString(),
      }, { merge: true });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/videos/:id/like
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('videos').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Video'));
    const uid   = req.user.id;
    const liked = (snap.data().likes || []).includes(uid);
    if (liked) {
      await db.collection('videos').doc(snap.id).update({ likes: FieldValue.arrayRemove(uid) });
    } else {
      await db.collection('videos').doc(snap.id).update({ likes: FieldValue.arrayUnion(uid) });
    }
    res.json({ success: true, liked: !liked });
  } catch (err) { next(err); }
});

// POST /api/videos/:id/watch-later
router.post('/:id/watch-later', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('videos').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Video'));
    const uid   = req.user.id;
    const saved = (snap.data().watchLaterBy || []).includes(uid);
    if (saved) {
      await db.collection('videos').doc(snap.id).update({ watchLaterBy: FieldValue.arrayRemove(uid) });
    } else {
      await db.collection('videos').doc(snap.id).update({ watchLaterBy: FieldValue.arrayUnion(uid) });
    }
    res.json({ success: true, saved: !saved });
  } catch (err) { next(err); }
});

// GET /api/videos/:id/comments
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const snap  = await getDb().collection('videoComments')
      .where('videoId', '==', req.params.id).where('isDeleted', '==', false)
      .orderBy('createdAt', 'desc').limit(limit).get();
    const uid      = req.user?.id;
    const comments = snap.docs.map(d => ({ id: d.id, ...d.data(), isOwn: uid ? d.data().author === uid : false }));
    res.json({ success: true, comments });
  } catch (err) { next(err); }
});

// POST /api/videos/:id/comments
router.post('/:id/comments', authenticate, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(422).json({ error: true, message: 'Comment cannot be empty' });
    const db  = getDb();
    const ref = db.collection('videoComments').doc();
    await ref.set({
      id: ref.id, videoId: req.params.id, author: req.user.id,
      content: content.slice(0, 2000).trim(), isDeleted: false, isFlagged: false, reportCount: 0,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ success: true, commentId: ref.id });
  } catch (err) { next(err); }
});

// DELETE /api/videos/:id/comments/:commentId
router.delete('/:id/comments/:commentId', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('videoComments').doc(req.params.commentId).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Comment'));
    const isOwner = snap.data().author === req.user.id;
    const isMod   = ['moderator','founder','admin'].includes(req.user.role);
    if (!isOwner && !isMod) return next(new ForbiddenError());
    await db.collection('videoComments').doc(snap.id).update({ isDeleted: true });
    res.json({ success: true, message: 'Comment deleted' });
  } catch (err) { next(err); }
});

// GET /api/videos/watch-later — user's watch-later list
router.get('/watch-later', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const snap  = await getDb().collection('videos')
      .where('watchLaterBy', 'array-contains', req.user.id)
      .where('isDeleted', '==', false)
      .orderBy('createdAt', 'desc').limit(limit).get();
    const videos = snap.docs.map(d => ({ id: d.id, ...d.data(), videoUrl: d.data().hlsUrl || d.data().originalFileUrl || null }));
    res.json({ success: true, videos });
  } catch (err) { next(err); }
});

// GET /api/videos/history
router.get('/history', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const snap  = await getDb().collection('watchHistory')
      .where('user', '==', req.user.id).orderBy('watchedAt', 'desc').limit(limit).get();
    const history = snap.docs.map(d => d.data());
    res.json({ success: true, history });
  } catch (err) { next(err); }
});

// POST /api/videos/upload
router.post('/upload', authenticate, videoUpload, async (req, res, next) => {
  try {
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];
    if (!videoFile) return res.status(400).json({ error: true, message: 'No video file provided' });

    const { title, description = '', category = 'General', tags = [] } = req.body;
    if (!title?.trim()) return res.status(422).json({ error: true, message: 'Title is required' });

    const db  = getDb();
    const ref = db.collection('videos').doc();

    // Upload video
    const videoPath = storageSvc.uploadFilePath('videos', req.user.id, videoFile.originalname);
    const videoResult = await storageSvc.uploadBuffer({ bucket: 'videos', storagePath: videoPath, buffer: videoFile.buffer, mimetype: videoFile.mimetype });
    const videoUrl = videoResult.publicUrl || videoResult.signedUrl;

    // Upload thumbnail (optional)
    let thumbnailUrl = null;
    if (thumbFile) {
      const thumbPath = storageSvc.uploadFilePath('thumbnails', req.user.id, thumbFile.originalname);
      const thumbResult = await storageSvc.uploadBuffer({ bucket: 'thumbnails', storagePath: thumbPath, buffer: thumbFile.buffer, mimetype: thumbFile.mimetype });
      thumbnailUrl = thumbResult.publicUrl || thumbResult.signedUrl;
    }

    const video = {
      id: ref.id, title: title.trim().slice(0, 200), description: description.slice(0, 5000),
      uploader: req.user.id, uploaderInfo: { uid: req.user.id, username: req.user.username },
      originalFileUrl: videoUrl, hlsUrl: null, storagePath: videoPath,
      thumbnailUrl, processingStatus: 'ready', isPublished: true, isDeleted: false,
      visibility: 'public', category, tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
      views: 0, likes: [], watchLaterBy: [], isFlagged: false, reportCount: 0,
      fileSize: videoFile.size, mimeType: videoFile.mimetype,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await ref.set(video);
    res.status(201).json({ success: true, video: { ...video, videoUrl } });
  } catch (err) { next(err); }
});

// POST /api/videos/save-meta — save video metadata without file upload
router.post('/save-meta', authenticate, async (req, res, next) => {
  try {
    const { videoUrl, title, description, category, thumbnailUrl, tags, duration } = req.body;
    if (!videoUrl) return res.status(422).json({ error: true, message: 'videoUrl required' });
    const db  = getDb();
    const ref = db.collection('videos').doc();
    const video = {
      id: ref.id, title: (title || 'Untitled').slice(0, 200), description: (description || '').slice(0, 5000),
      uploader: req.user.id, uploaderInfo: { uid: req.user.id, username: req.user.username },
      originalFileUrl: videoUrl, hlsUrl: null, storagePath: null,
      thumbnailUrl: thumbnailUrl || null, processingStatus: 'ready', isPublished: true, isDeleted: false,
      visibility: 'public', category: category || 'General', tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
      views: 0, likes: [], watchLaterBy: [], isFlagged: false, reportCount: 0,
      duration: duration || 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await ref.set(video);
    res.status(201).json({ success: true, video });
  } catch (err) { next(err); }
});

// GET /api/videos/library/:uploaderId
router.get('/library/:uploaderId', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const snap  = await getDb().collection('videos')
      .where('uploader', '==', req.params.uploaderId).where('isDeleted', '==', false)
      .orderBy('createdAt', 'desc').limit(limit).get();
    const videos = snap.docs.map(d => ({ id: d.id, ...d.data(), videoUrl: d.data().hlsUrl || d.data().originalFileUrl || null }));
    res.json({ success: true, videos });
  } catch (err) { next(err); }
});

// DELETE /api/videos/library/:id
router.delete('/library/:id', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('videos').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Video'));
    const isOwner = snap.data().uploader === req.user.id;
    const isMod   = ['moderator','founder','admin'].includes(req.user.role);
    if (!isOwner && !isMod) return next(new ForbiddenError());
    await db.collection('videos').doc(snap.id).update({ isDeleted: true, deletedAt: new Date().toISOString() });
    if (snap.data().storagePath) storageSvc.deleteFile('videos', snap.data().storagePath).catch(() => {});
    res.json({ success: true, message: 'Video deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
