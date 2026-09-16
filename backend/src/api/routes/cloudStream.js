/**
 * Cloud Stream Routes — Founder Control Center
 *
 * All routes require authentication + founder/admin role.
 * Exposes the 24-hour cloud stream service over a secure REST API.
 *
 * Mount point: /api/admin/cloud-stream
 *
 * NEW: POST /api/admin/cloud-stream/media/upload
 *   Uploads a media file to Supabase Storage (stream-media bucket).
 *   Returns the storagePath and a 7-day signed URL usable by the stream engine.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authenticate, requireFounder } = require('../middleware/auth');
const { ValidationError } = require('../middleware/errorHandler');
const cloudStream = require('../../services/stream/cloudStreamService');
const storageSvc  = require('../../services/storage/supabaseStorage');
const logger = require('../../utils/logger');

// ─── Auth guard for all routes ────────────────────────────
router.use(authenticate, requireFounder);

// ─── Dedicated rate limiter for control actions ───────────
const controlLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many stream control requests. Please slow down.', code: 'RATE_LIMIT_EXCEEDED' },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── Helper: log admin action ─────────────────────────────
function logAction(req, action, extra = '') {
  logger.info(`[CloudStream] Admin action: "${action}" by ${req.user.username}${extra ? ' — ' + extra : ''}`);
}

// ─────────────────────────────────────────────────────────
// GET  /api/admin/cloud-stream/status
// Full service status snapshot.
// ─────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const status = cloudStream.getStatus();
  res.json({ success: true, status });
});

// ─────────────────────────────────────────────────────────
// GET  /api/admin/cloud-stream/queue
// Ordered list of queued tracks with playing indicator.
// ─────────────────────────────────────────────────────────
router.get('/queue', (req, res) => {
  const queue = cloudStream.getQueue();
  res.json({ success: true, queue });
});

// ─────────────────────────────────────────────────────────
// GET  /api/admin/cloud-stream/media
// List all media files available in the configured media dir.
// ─────────────────────────────────────────────────────────
router.get('/media', (req, res) => {
  const files = cloudStream.listMediaFiles();
  res.json({ success: true, files });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/start
// Start the cloud stream. No-op if already running.
// ─────────────────────────────────────────────────────────
router.post('/start', controlLimiter, (req, res) => {
  logAction(req, 'start');
  const result = cloudStream.start();
  if (!result.ok) {
    return res.status(409).json({ error: true, message: result.message });
  }
  const status = cloudStream.getStatus();
  res.json({ success: true, message: 'Stream started', status });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/stop
// Stop the cloud stream.
// ─────────────────────────────────────────────────────────
router.post('/stop', controlLimiter, (req, res) => {
  logAction(req, 'stop');
  cloudStream.stop();
  res.json({ success: true, message: 'Stream stopped' });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/pause
// Pause the current track (terminates ffmpeg; resumes from next).
// ─────────────────────────────────────────────────────────
router.post('/pause', controlLimiter, (req, res) => {
  logAction(req, 'pause');
  const result = cloudStream.pause();
  if (!result.ok) {
    return res.status(409).json({ error: true, message: result.message });
  }
  res.json({ success: true, message: 'Stream paused' });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/resume
// Resume a paused stream.
// ─────────────────────────────────────────────────────────
router.post('/resume', controlLimiter, (req, res) => {
  logAction(req, 'resume');
  const result = cloudStream.resume();
  if (!result.ok) {
    return res.status(409).json({ error: true, message: result.message });
  }
  res.json({ success: true, message: 'Stream resumed' });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/skip
// Skip the currently playing track.
// ─────────────────────────────────────────────────────────
router.post('/skip', controlLimiter, (req, res) => {
  logAction(req, 'skip');
  const result = cloudStream.skip();
  if (!result.ok) {
    return res.status(409).json({ error: true, message: result.message });
  }
  res.json({ success: true, message: 'Track skipped' });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/refresh
// Rescan the media directory and rebuild the playlist.
// ─────────────────────────────────────────────────────────
router.post('/refresh', controlLimiter, (req, res) => {
  logAction(req, 'refresh playlist');
  const result = cloudStream.refreshPlaylist();
  res.json({ success: true, ...result });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/queue/add
// Add one or more files (by filename) to the managed queue.
// Body: { files: ["track1.mp3", "track2.mp4"] }
// ─────────────────────────────────────────────────────────
router.post('/queue/add', controlLimiter, (req, res, next) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || !files.length) {
      return next(new ValidationError('files must be a non-empty array of filenames'));
    }
    // Sanitise: basenames only — prevent path traversal
    const safeFiles = files.map(f => {
      if (typeof f !== 'string') throw new ValidationError('Each file entry must be a string');
      const base = require('path').basename(f);
      if (!base || base === '.' || base === '..') throw new ValidationError(`Invalid filename: ${f}`);
      return base;
    });
    logAction(req, 'queue/add', safeFiles.join(', '));
    const added = cloudStream.addToQueue(safeFiles);
    const queue = cloudStream.getQueue();
    res.json({ success: true, added, queue });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/admin/cloud-stream/queue/:index
// Remove a track from the managed queue by index.
// ─────────────────────────────────────────────────────────
router.delete('/queue/:index', controlLimiter, (req, res, next) => {
  try {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) {
      return next(new ValidationError('index must be a non-negative integer'));
    }
    logAction(req, 'queue/remove', `index ${index}`);
    const result = cloudStream.removeFromQueue(index);
    if (!result.ok) return res.status(400).json({ error: true, message: result.message });
    const queue = cloudStream.getQueue();
    res.json({ success: true, ...result, queue });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// PUT  /api/admin/cloud-stream/queue/reorder
// Move a track from one index to another.
// Body: { from: 2, to: 0 }
// ─────────────────────────────────────────────────────────
router.put('/queue/reorder', controlLimiter, (req, res, next) => {
  try {
    const { from, to } = req.body;
    if (typeof from !== 'number' || typeof to !== 'number' || from < 0 || to < 0) {
      return next(new ValidationError('from and to must be non-negative integers'));
    }
    logAction(req, 'queue/reorder', `${from} → ${to}`);
    const result = cloudStream.reorderQueue(Math.floor(from), Math.floor(to));
    if (!result.ok) return res.status(400).json({ error: true, message: result.message });
    const queue = cloudStream.getQueue();
    res.json({ success: true, queue });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/admin/cloud-stream/queue
// Clear the entire managed queue (reverts to scanned playlist).
// ─────────────────────────────────────────────────────────
router.delete('/queue', controlLimiter, (req, res) => {
  logAction(req, 'queue/clear');
  cloudStream.clearQueue();
  res.json({ success: true, message: 'Queue cleared' });
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/cloud-stream/media/upload
// Upload a media file to Supabase Storage (stream-media bucket).
// Returns storagePath + signed URL.
// ─────────────────────────────────────────────────────────
const streamMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    const allowed = new Set([
      'audio/mpeg','audio/mp3','audio/wav','audio/ogg','audio/flac','audio/aac','audio/x-m4a','audio/mp4','audio/opus','audio/webm',
      'video/mp4','video/webm','video/ogg','video/quicktime',
    ]);
    if (!allowed.has(file.mimetype)) {
      return cb(new ValidationError(`Unsupported media type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

router.post('/media/upload', controlLimiter, streamMediaUpload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: true, message: 'No file uploaded' });
  try {
    logAction(req, 'media/upload', req.file.originalname);
    const storagePath = storageSvc.uploadFilePath('stream-media', req.user.id, req.file.originalname);
    const result = await storageSvc.uploadBuffer({
      bucket:      'stream-media',
      storagePath,
      buffer:      req.file.buffer,
      mimetype:    req.file.mimetype,
    });
    const signedUrl = result.signedUrl || await storageSvc.getSignedUrl('stream-media', storagePath);
    res.status(201).json({
      success: true,
      storagePath,
      signedUrl,
      name: req.file.originalname,
      size: req.file.size,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// GET /api/admin/cloud-stream/media/library
// List all files in the stream-media bucket.
// ─────────────────────────────────────────────────────────
router.get('/media/library', async (req, res, next) => {
  try {
    const files = await storageSvc.listFiles('stream-media');
    res.json({ success: true, files });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// GET /api/admin/cloud-stream/media/:storagePath*/url
// Refresh a signed URL for a stream-media file.
// ─────────────────────────────────────────────────────────
router.get('/media/url', async (req, res, next) => {
  try {
    const storagePath = req.query.path;
    if (!storagePath) return res.status(400).json({ error: true, message: 'path query param required' });
    const signedUrl = await storageSvc.getSignedUrl('stream-media', storagePath);
    res.json({ success: true, signedUrl });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// PUT  /api/admin/cloud-stream/settings
// Update shuffle and/or repeat.
// Body: { shuffle?: boolean, repeat?: boolean }
// ─────────────────────────────────────────────────────────
router.put('/settings', controlLimiter, (req, res, next) => {
  try {
    const updates = {};

    if (req.body.shuffle !== undefined) {
      if (typeof req.body.shuffle !== 'boolean') {
        return next(new ValidationError('shuffle must be a boolean'));
      }
      cloudStream.setShuffle(req.body.shuffle);
      updates.shuffle = req.body.shuffle;
    }

    if (req.body.repeat !== undefined) {
      if (typeof req.body.repeat !== 'boolean') {
        return next(new ValidationError('repeat must be a boolean'));
      }
      cloudStream.setRepeat(req.body.repeat);
      updates.repeat = req.body.repeat;
    }

    if (!Object.keys(updates).length) {
      return next(new ValidationError('Provide at least one setting: shuffle or repeat'));
    }

    logAction(req, 'settings', JSON.stringify(updates));
    const status = cloudStream.getStatus();
    res.json({ success: true, updates, status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
