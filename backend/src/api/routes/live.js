/**
 * AVENORA Live — Session API Routes
 *
 * Handles browser-based live streaming via WHIP → MediaMTX → HLS.
 * No OBS, Streamlabs, RTMP encoder, or third-party streaming platform.
 *
 * Mount point: /api/live
 *
 * Authentication model:
 *   - All write/control endpoints require authenticate (JWT)
 *   - Public read endpoints use optionalAuth
 *   - Ownership checked per-request (streamer field matches req.user.id)
 *   - Founders/admins can manage any stream
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const { authenticate, optionalAuth, requireFounder } = require('../middleware/auth');
const { NotFoundError, ForbiddenError, ValidationError, AppError } = require('../middleware/errorHandler');
const Stream = require('../../models/Stream');
const liveSvc = require('../../services/stream/liveSessionService');
const logger = require('../../utils/logger');

// ─── Rate limiters ────────────────────────────────────────
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many live sessions created. Try again later.', code: 'RATE_LIMIT_EXCEEDED' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // up to 2 per second
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Heartbeat rate limit exceeded.', code: 'RATE_LIMIT_EXCEEDED' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const controlLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many control requests. Slow down.', code: 'RATE_LIMIT_EXCEEDED' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ─── Helpers ─────────────────────────────────────────────

function isOwnerOrAdmin(stream, user) {
  return (
    stream.streamer.toString() === user.id.toString() ||
    user.role === 'admin' ||
    user.role === 'founder'
  );
}

/**
 * Strips internal fields before sending stream to frontend.
 * Never sends: liveSession (token, ip), mediaMTXPath internal detail.
 */
function safeStream(stream) {
  const obj = stream.toObject ? stream.toObject() : { ...stream };
  delete obj.liveSession;
  return obj;
}

// ─────────────────────────────────────────────────────────
// GET /api/live
// List live streams (public).
// ─────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category, status = 'live', limit = 20, page = 1 } = req.query;

    const query = { status, isBanned: false };
    if (category) query.category = category;

    const safeLimit = Math.min(parseInt(limit, 10) || 20, 100);
    const safeSkip  = (Math.max(parseInt(page, 10) || 1, 1) - 1) * safeLimit;

    const streams = await Stream.find(query)
      .populate('streamer', 'username profile.displayName profile.avatarUrl')
      .sort({ viewerCount: -1, startedAt: -1 })
      .skip(safeSkip)
      .limit(safeLimit)
      .lean();

    res.json({ success: true, streams });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// GET /api/live/health-check
// Check whether MediaMTX is reachable (admin/founder only).
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// GET /api/live/my/sessions
// Get the current user's own streams (authenticated).
// MUST be before GET /:id to prevent 'my' being treated as an id.
// ─────────────────────────────────────────────────────────
router.get('/my/sessions', authenticate, async (req, res, next) => {
  try {
    const streams = await Stream.find({ streamer: req.user.id })
      .select('-liveSession')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json({ success: true, streams });
  } catch (err) { next(err); }
});

router.get('/health-check', authenticate, requireFounder, async (req, res, next) => {
  try {
    const result = await liveSvc.checkMediaMTXHealth();
    res.json({ success: true, mediaMTX: result });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// POST /api/live
// Create a new live session (does NOT start publishing yet).
// Returns safe stream info and the WHIP URL for the publisher.
// ─────────────────────────────────────────────────────────
router.post('/', authenticate, createLimiter, async (req, res, next) => {
  try {
    const { title, description, category, tags } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return next(new ValidationError('Stream title is required'));
    }
    if (title.trim().length > 200) {
      return next(new ValidationError('Stream title must be 200 characters or fewer'));
    }
    if (description && typeof description === 'string' && description.length > 2000) {
      return next(new ValidationError('Description must be 2000 characters or fewer'));
    }

    // Check if user already has an active live session
    const existing = await Stream.findOne({ streamer: req.user.id, status: 'live' });
    if (existing) {
      return next(new AppError(
        'You already have an active live session. End it before starting a new one.',
        409,
        'ALREADY_LIVE'
      ));
    }

    // Also end any stale offline sessions for this user (cleanup)
    await Stream.updateMany(
      { streamer: req.user.id, status: 'offline', createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      { $set: { status: 'ended', endedAt: new Date() } }
    );

    const stream = await Stream.create({
      streamer: req.user.id,
      title: title.trim().slice(0, 200),
      description: description?.trim().slice(0, 2000),
      category: category?.slice(0, 100),
      tags: Array.isArray(tags) ? tags.slice(0, 10).map(t => String(t).slice(0, 50)) : [],
    });

    const playback = liveSvc.buildPlaybackInfo(stream, true); // include WHIP for creator

    logger.info(`[Live] Session created: ${stream._id} by ${req.user.username}`);

    res.status(201).json({
      success: true,
      stream: safeStream(stream),
      playback,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// GET /api/live/:id
// Get a single stream (public, strips internal fields).
// ─────────────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id)
      .populate('streamer', 'username profile.displayName profile.avatarUrl');

    if (!stream || stream.isBanned) return next(new NotFoundError('Stream'));

    const playback = liveSvc.buildPlaybackInfo(stream, false); // no WHIP for viewers

    res.json({ success: true, stream: safeStream(stream), playback });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// PATCH /api/live/:id
// Update stream title / description / category (owner only).
// ─────────────────────────────────────────────────────────
router.patch('/:id', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());
    if (stream.status === 'ended') {
      return next(new AppError('Cannot update an ended stream', 400, 'STREAM_ENDED'));
    }

    const allowed = ['title', 'description', 'category', 'thumbnailUrl'];
    const updates = {};

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        const val = String(req.body[field] || '').trim();
        if (field === 'title' && val.length === 0) {
          return next(new ValidationError('title cannot be empty'));
        }
        updates[field] = val.slice(0, field === 'description' ? 2000 : 200);
      }
    }

    if (!Object.keys(updates).length) {
      return next(new ValidationError('No valid fields to update'));
    }

    Object.assign(stream, updates);
    await stream.save();

    logger.info(`[Live] Stream ${stream._id} updated by ${req.user.username}`);
    res.json({ success: true, stream: safeStream(stream) });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// POST /api/live/:id/start-publishing
// Called by the browser just before it attempts the WHIP connection.
// Transitions status to 'live' and returns the WHIP URL.
// Does NOT verify the WHIP connection is actually established —
// /health is used for ongoing confirmation.
// ─────────────────────────────────────────────────────────
router.post('/:id/start-publishing', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id).select('+liveSession.token');
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());

    if (stream.status === 'ended') {
      return next(new AppError('Stream has ended. Create a new session.', 409, 'STREAM_ENDED'));
    }
    if (stream.status === 'live') {
      // Idempotent: return existing WHIP URL if already live
      const playback = liveSvc.buildPlaybackInfo(stream, true);
      return res.json({ success: true, stream: safeStream(stream), playback, alreadyLive: true });
    }

    const sessionPath = liveSvc.streamPath(stream._id.toString());

    stream.status       = 'live';
    stream.startedAt    = new Date();
    stream.mediaMTXPath = sessionPath;
    stream.hlsUrl       = liveSvc.buildHlsUrl(sessionPath);

    stream.liveSession = {
      startedAt:     new Date(),
      lastHeartbeat: new Date(),
      publisherIp:   req.ip,
      userAgent:     req.headers['user-agent']?.slice(0, 300),
    };

    await stream.save();

    liveSvc.recordPublisherHeartbeat(stream._id.toString());

    const playback = liveSvc.buildPlaybackInfo(stream, true);

    logger.info(`[Live] Publishing started: ${stream._id} (path: ${sessionPath}) by ${req.user.username}`);

    res.json({ success: true, stream: safeStream(stream), playback });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// POST /api/live/:id/stop-publishing
// Called by the browser when the user clicks "Stop Live" or navigates away.
// Transitions status to 'ended' and kicks the MediaMTX publisher.
// ─────────────────────────────────────────────────────────
router.post('/:id/stop-publishing', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());

    if (stream.status === 'ended') {
      return res.json({ success: true, message: 'Stream already ended', stream: safeStream(stream) });
    }

    stream.status  = 'ended';
    stream.endedAt = new Date();
    await stream.save();

    liveSvc.clearPublisherState(stream._id.toString());

    // Tell MediaMTX to drop the publisher connection (non-fatal if server is unreachable)
    await liveSvc.kickPublisher(stream._id.toString());

    logger.info(`[Live] Publishing stopped: ${stream._id} by ${req.user.username}`);

    res.json({ success: true, message: 'Stream ended', stream: safeStream(stream) });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// POST /api/live/:id/health
// Browser heartbeat — sent every ~10 s while live.
// Updates last-seen timestamp and optional metrics.
// Body: { bitrate?: number, fps?: number, resolution?: string, errors?: number }
// ─────────────────────────────────────────────────────────
router.post('/:id/health', authenticate, heartbeatLimiter, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());

    if (stream.status !== 'live') {
      return next(new AppError('Stream is not live', 400, 'NOT_LIVE'));
    }

    const { bitrate, fps, resolution, errors } = req.body;
    const metrics = {
      bitrate:    typeof bitrate === 'number'    ? bitrate    : undefined,
      fps:        typeof fps     === 'number'    ? fps        : undefined,
      resolution: typeof resolution === 'string' ? resolution.slice(0, 20) : undefined,
      errors:     typeof errors  === 'number'    ? errors     : undefined,
    };

    const health = liveSvc.recordPublisherHeartbeat(stream._id.toString(), metrics);

    // Update liveSession.lastHeartbeat in DB (non-blocking write)
    Stream.findByIdAndUpdate(stream._id, { 'liveSession.lastHeartbeat': new Date() })
      .catch(e => logger.warn('[Live] heartbeat DB update failed:', e.message));

    res.json({ success: true, health });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// POST /api/live/:id/error
// Browser reports a WHIP or stream error for server-side logging.
// ─────────────────────────────────────────────────────────
router.post('/:id/error', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());

    const code    = String(req.body.code    || 'UNKNOWN').slice(0, 50);
    const message = String(req.body.message || '').slice(0, 500);
    const phase   = String(req.body.phase   || '').slice(0, 50);

    logger.warn(`[Live] Stream error reported: ${stream._id} code=${code} phase=${phase} — ${message} (user: ${req.user.username})`);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// GET /api/live/:id/playback
// Returns HLS playback URL and current stream status (public).
// ─────────────────────────────────────────────────────────
router.get('/:id/playback', optionalAuth, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id)
      .populate('streamer', 'username profile.displayName profile.avatarUrl');

    if (!stream || stream.isBanned) return next(new NotFoundError('Stream'));

    const playback = liveSvc.buildPlaybackInfo(stream, false);

    // Optionally cross-check MediaMTX for real-time publishing state
    let publisherActive = false;
    if (stream.status === 'live') {
      const ps = await liveSvc.checkPublisherStatus(stream._id.toString());
      publisherActive = ps.publishing;
    }

    res.json({
      success: true,
      playback,
      publisherActive,
      stream: {
        id:          stream._id,
        title:       stream.title,
        description: stream.description,
        category:    stream.category,
        status:      stream.status,
        viewerCount: stream.viewerCount,
        startedAt:   stream.startedAt,
        streamer:    stream.streamer,
        thumbnailUrl: stream.thumbnailUrl,
      },
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// GET /api/live/:id/viewers
// Current viewer count (public).
// ─────────────────────────────────────────────────────────
router.get('/:id/viewers', optionalAuth, async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id).select('status viewerCount peakViewerCount');
    if (!stream) return next(new NotFoundError('Stream'));

    res.json({
      success: true,
      streamId:       stream._id,
      viewerCount:    stream.viewerCount,
      peakViewerCount: stream.peakViewerCount,
      live:           stream.status === 'live',
    });
  } catch (err) { next(err); }
});

module.exports = router;
