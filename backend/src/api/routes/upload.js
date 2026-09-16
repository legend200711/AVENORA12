/**
 * Upload Routes
 * Handles file uploads via Supabase Storage.
 * Replaces the old local-disk multer storage and Cloudflare R2 references.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { uploadRateLimiter } = require('../middleware/rateLimiter');
const { AppError } = require('../middleware/errorHandler');
const storage = require('../../services/storage/supabaseStorage');

const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB) || 500;

// Allowed MIME types per category
const ALLOWED_TYPES = {
  image:  ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video:  ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'],
  audio:  ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/x-m4a', 'audio/mp4', 'audio/opus', 'audio/webm'],
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
};

const SIZE_LIMITS = {
  image:  20  * 1024 * 1024,
  video:  MAX_MB * 1024 * 1024,
  audio:  50  * 1024 * 1024,
  avatar: 5   * 1024 * 1024,
};

// Use memory storage — files go straight to Supabase, never touch disk
const memStorage = multer.memoryStorage();

function createUploader(category) {
  return multer({
    storage: memStorage,
    limits: { fileSize: SIZE_LIMITS[category] || SIZE_LIMITS.image },
    fileFilter: (req, file, cb) => {
      const allowed = ALLOWED_TYPES[category] || [];
      if (!allowed.includes(file.mimetype)) {
        return cb(new AppError(`File type ${file.mimetype} not allowed for ${category}`, 415, 'INVALID_FILE_TYPE'));
      }
      cb(null, true);
    },
  });
}

// ── Bucket mapping ────────────────────────────────────────────────────────────
const CATEGORY_BUCKET = {
  image:  'gallery',
  avatar: 'avatars',
  audio:  'music',
  video:  'videos',
};

// POST /api/upload/image
router.post('/image', authenticate, uploadRateLimiter, createUploader('image').single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: true, message: 'No file uploaded' });
  try {
    const uid = req.user.id;
    const storagePath = storage.uploadFilePath('gallery', uid, req.file.originalname);
    const result = await storage.uploadBuffer({
      bucket: 'gallery',
      storagePath,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    res.json({ success: true, url: result.publicUrl || result.signedUrl, storagePath });
  } catch (err) { next(err); }
});

// POST /api/upload/avatar
router.post('/avatar', authenticate, uploadRateLimiter, createUploader('avatar').single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: true, message: 'No file uploaded' });
  try {
    const uid = req.user.id;
    const path = require('path');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const storagePath = `${uid}${ext}`;
    // Delete existing avatar first (upsert handles this via Supabase)
    const result = await storage.uploadBuffer({
      bucket: 'avatars',
      storagePath,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    const url = result.publicUrl || await storage.getSignedUrl('avatars', storagePath);
    res.json({ success: true, url, storagePath });
  } catch (err) { next(err); }
});

// POST /api/upload/audio
router.post('/audio', authenticate, uploadRateLimiter, createUploader('audio').single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: true, message: 'No file uploaded' });
  try {
    const uid = req.user.id;
    const storagePath = storage.uploadFilePath('music', uid, req.file.originalname);
    const result = await storage.uploadBuffer({
      bucket: 'music',
      storagePath,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    const url = result.signedUrl || await storage.getSignedUrl('music', storagePath);
    res.json({
      success: true,
      url,
      storagePath,
      filename: req.file.originalname,
      size: req.file.size,
    });
  } catch (err) { next(err); }
});

// POST /api/upload/video
router.post('/video', authenticate, uploadRateLimiter, createUploader('video').single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: true, message: 'No file uploaded' });
  try {
    const uid = req.user.id;
    const storagePath = storage.uploadFilePath('videos', uid, req.file.originalname);
    const result = await storage.uploadBuffer({
      bucket: 'videos',
      storagePath,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    const url = result.signedUrl || await storage.getSignedUrl('videos', storagePath);
    res.json({
      success: true,
      url,
      storagePath,
      filename: req.file.originalname,
      size: req.file.size,
    });
  } catch (err) { next(err); }
});

// POST /api/upload/thumbnail
router.post('/thumbnail', authenticate, uploadRateLimiter, createUploader('image').single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: true, message: 'No file uploaded' });
  try {
    const uid = req.user.id;
    const storagePath = storage.uploadFilePath('thumbnails', uid, req.file.originalname);
    const result = await storage.uploadBuffer({
      bucket: 'thumbnails',
      storagePath,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    res.json({ success: true, url: result.publicUrl, storagePath });
  } catch (err) { next(err); }
});

// GET /api/upload/signed-url?bucket=music&path=uid/file.mp3
// Refresh a signed URL for a private file — never exposes service-role key.
router.get('/signed-url', authenticate, async (req, res, next) => {
  try {
    const { bucket, path: storagePath } = req.query;
    if (!bucket || !storagePath) {
      return res.status(400).json({ error: true, message: 'bucket and path query params required' });
    }
    const PRIVATE_BUCKETS = new Set(['avatars', 'music', 'videos', 'stream-media']);
    if (!PRIVATE_BUCKETS.has(bucket)) {
      return res.status(400).json({ error: true, message: `Bucket "${bucket}" does not use signed URLs` });
    }
    const signedUrl = await storage.getSignedUrl(bucket, storagePath, 3600);
    res.json({ success: true, signedUrl });
  } catch (err) { next(err); }
});

// Handle multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: true, message: 'File too large. Maximum size exceeded.' });
    }
    return res.status(400).json({ error: true, message: err.message });
  }
  next(err);
});

module.exports = router;
