/**
 * Gallery Routes — Firestore + Supabase Storage
 */
'use strict';

const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const { authenticate, optionalAuth, requireModerator } = require('../middleware/auth');
const { uploadRateLimiter } = require('../middleware/rateLimiter');
const { AppError, NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
const { getDb, FieldValue } = require('../../config/firestore');
const storageSvc = require('../../services/storage/supabaseStorage');

const ALLOWED_MIME  = new Set(['image/jpeg','image/png','image/webp','image/gif']);
const MAX_BYTES     = 20 * 1024 * 1024;
const CATEGORIES    = ['artwork','wallpapers','album-art','promotional','community'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new AppError(`File type ${file.mimetype} not allowed`, 415));
    cb(null, true);
  },
});

// GET /api/gallery/categories
router.get('/categories', (req, res) => res.json({ success: true, categories: CATEGORIES }));

// GET /api/gallery
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = Math.min(50, parseInt(req.query.limit) || 24);
    const { category, uploader } = req.query;
    const db = getDb();

    let q = db.collection('gallery').where('isDeleted', '==', false).orderBy('createdAt', 'desc').limit(limit * page);
    if (category && CATEGORIES.includes(category)) q = q.where('category', '==', category);
    // Note: Firestore requires composite index for multiple where clauses — uploader filter applied client-side
    const snap = await q.get();
    let docs   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (uploader) docs = docs.filter(d => d.uploader === uploader);

    const all   = docs.slice((page - 1) * limit, page * limit);
    const uid   = req.user?.id;
    const enriched = all.map(img => ({
      ...img,
      likeCount: (img.likes || []).length,
      likedByMe: uid ? (img.likes || []).includes(uid) : false,
    }));
    res.json({ success: true, images: enriched, total: docs.length, page, limit });
  } catch (err) { next(err); }
});

// POST /api/gallery/upload
router.post('/upload', authenticate, uploadRateLimiter, upload.array('file', 10), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: true, message: 'No files uploaded' });
    const { title, caption, category } = req.body;
    const safeCategory = CATEGORIES.includes(category) ? category : 'artwork';
    const db = getDb();

    const docs = await Promise.all(req.files.map(async f => {
      const storagePath = storageSvc.uploadFilePath('gallery', req.user.id, f.originalname);
      const result = await storageSvc.uploadBuffer({ bucket: 'gallery', storagePath, buffer: f.buffer, mimetype: f.mimetype });
      const url  = result.publicUrl || result.signedUrl;
      const ref  = db.collection('gallery').doc();
      const doc  = {
        id: ref.id, uploader: req.user.id, url, storagePath,
        title: (title || 'Untitled').slice(0, 200),
        caption: (caption || '').slice(0, 500),
        category: safeCategory, tags: [], likes: [], isDeleted: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await ref.set(doc);
      return doc;
    }));
    res.status(201).json({ success: true, images: docs });
  } catch (err) { next(err); }
});

// POST /api/gallery/:id/like
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('gallery').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Image'));
    const uid   = req.user.id;
    const likes = snap.data().likes || [];
    const liked = likes.includes(uid);
    if (liked) {
      await db.collection('gallery').doc(snap.id).update({ likes: FieldValue.arrayRemove(uid) });
    } else {
      await db.collection('gallery').doc(snap.id).update({ likes: FieldValue.arrayUnion(uid) });
    }
    res.json({ success: true, liked: !liked, likeCount: liked ? likes.length - 1 : likes.length + 1 });
  } catch (err) { next(err); }
});

// DELETE /api/gallery/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('gallery').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Image'));
    const img  = snap.data();
    const isOwner = img.uploader === req.user.id;
    const isMod   = ['moderator','founder','admin'].includes(req.user.role);
    if (!isOwner && !isMod) return next(new ForbiddenError());
    await db.collection('gallery').doc(snap.id).update({ isDeleted: true, updatedAt: new Date().toISOString() });
    if (img.storagePath) storageSvc.deleteFile('gallery', img.storagePath).catch(() => {});
    res.json({ success: true, message: 'Image deleted' });
  } catch (err) { next(err); }
});

router.use((err, req, res, next) => {
  if (err.constructor?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: true, message: 'Image too large. Max 20 MB.' });
    return res.status(400).json({ error: true, message: err.message });
  }
  next(err);
});

module.exports = router;
