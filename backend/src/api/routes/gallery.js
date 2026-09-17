/**
 * AVENORA GALLERY — Backend API Routes
 *
 * GET    /api/gallery            — list public images (paginated, filterable)
 * POST   /api/gallery/upload     — upload image (auth required, multer)
 * DELETE /api/gallery/:id        — delete own image (owner or moderator)
 * GET    /api/gallery/categories — list categories
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const { authenticate, optionalAuth, requireModerator } = require('../middleware/auth');
const { uploadRateLimiter } = require('../middleware/rateLimiter');
const { AppError, NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
const storageSvc = require('../../services/storage/supabaseStorage');

// ─── Gallery Image model (inline schema — kept in this file for simplicity) ──
let GalleryImage;
try {
  GalleryImage = mongoose.model('GalleryImage');
} catch {
  const schema = new mongoose.Schema({
    uploader:    { type: String, required: true },  // Firebase UID
    url:         { type: String, required: true },
    storagePath: { type: String },   // Supabase Storage path (gallery bucket)
    title:       { type: String, maxlength: 200, default: 'Untitled' },
    caption:     { type: String, maxlength: 500 },
    category: {
      type: String,
      enum: ['artwork', 'wallpapers', 'album-art', 'promotional', 'community'],
      default: 'artwork',
    },
    tags:      [{ type: String, maxlength: 50 }],
    likes:     [{ type: String }],                  // Firebase UIDs
    isDeleted: { type: Boolean, default: false },
  }, { timestamps: true });

  schema.index({ category: 1, createdAt: -1 });
  schema.index({ uploader: 1, createdAt: -1 });
  schema.index({ isDeleted: 1 });

  GalleryImage = mongoose.model('GalleryImage', schema);
}

// ─── Multer setup (memory storage — files go to Supabase) ─────
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new AppError(`File type ${file.mimetype} not allowed. Use JPEG, PNG, WebP, or GIF.`, 415));
    }
    cb(null, true);
  },
});

const CATEGORIES = ['artwork', 'wallpapers', 'album-art', 'promotional', 'community'];

// ─── Routes ───────────────────────────────────────────────────

// GET /api/gallery/categories
router.get('/categories', (req, res) => {
  res.json({ success: true, categories: CATEGORIES });
});

// GET /api/gallery — list images
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 24);
    const skip = (page - 1) * limit;
    const { category, uploader, q } = req.query;

    const filter = { isDeleted: false };
    if (category && CATEGORIES.includes(category)) filter.category = category;
    if (uploader) filter.uploader = uploader;
    if (q) {
      const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: regex }, { caption: regex }];
    }

    const [images, total] = await Promise.all([
      GalleryImage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      GalleryImage.countDocuments(filter),
    ]);

    const currentUserId = req.user?.id;
    const enriched = images.map(img => ({
      ...img,
      likeCount: (img.likes || []).length,
      likedByMe: currentUserId ? (img.likes || []).some(id => id.toString() === currentUserId) : false,
    }));

    res.json({ success: true, images: enriched, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// POST /api/gallery/upload — upload one or more images
router.post(
  '/upload',
  authenticate,
  uploadRateLimiter,
  upload.array('file', 10),
  async (req, res, next) => {
    try {
      if (!req.files?.length) {
        return res.status(400).json({ error: true, message: 'No files uploaded' });
      }

      const { title, caption, category } = req.body;
      const safeCategory = CATEGORIES.includes(category) ? category : 'artwork';

      // Upload each file to Supabase Storage (gallery bucket — public)
      const docs = await Promise.all(
        req.files.map(async (f) => {
          const storagePath = storageSvc.uploadFilePath('gallery', req.user.id, f.originalname);
          const result = await storageSvc.uploadBuffer({
            bucket:      'gallery',
            storagePath,
            buffer:      f.buffer,
            mimetype:    f.mimetype,
          });
          const url = result.publicUrl || result.signedUrl;
          return GalleryImage.create({
            uploader:    req.user.id,
            url,
            storagePath,
            title:       (title || 'Untitled').slice(0, 200),
            caption:     (caption || '').slice(0, 500),
            category:    safeCategory,
          });
        })
      );

      const images = await GalleryImage.find({ _id: { $in: docs.map(d => d._id) } }).lean();

      res.status(201).json({ success: true, images });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/gallery/:id/like — toggle like
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const img = await GalleryImage.findOne({ _id: req.params.id, isDeleted: false });
    if (!img) return next(new NotFoundError('Image'));

    const uid = req.user.id;
    const liked = img.likes.some(id => id.toString() === uid);
    if (liked) {
      img.likes.pull(uid);
    } else {
      img.likes.push(uid);
    }
    await img.save();

    res.json({ success: true, liked: !liked, likeCount: img.likes.length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/gallery/:id — delete image (owner or moderator)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const img = await GalleryImage.findOne({ _id: req.params.id, isDeleted: false });
    if (!img) return next(new NotFoundError('Image'));

    const isOwner = img.uploader.toString() === req.user.id;
    const isMod = ['moderator', 'founder', 'admin'].includes(req.user.role);
    if (!isOwner && !isMod) return next(new ForbiddenError());

    // Soft-delete the record
    img.isDeleted = true;
    await img.save();

    // Best-effort delete from Supabase Storage
    if (img.storagePath) {
      storageSvc.deleteFile('gallery', img.storagePath).catch(() => {});
    }

    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    next(err);
  }
});

// ─── Multer error handler ─────────────────────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: true, message: 'Image too large. Maximum 20 MB per image.' });
    }
    return res.status(400).json({ error: true, message: err.message });
  }
  next(err);
});

module.exports = router;
