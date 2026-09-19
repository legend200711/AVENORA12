/**
 * AVENORA Live — Session API Routes (Firestore edition)
 *
 * Collection: streams/{streamId}
 *
 * All write/control endpoints require authenticate (JWT).
 * Public read endpoints use optionalAuth.
 */

'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { authenticate, optionalAuth, requireFounder } = require('../middleware/auth');
const { NotFoundError, ForbiddenError, ValidationError, AppError } = require('../middleware/errorHandler');
const { getDb, newId, now, FieldValue } = require('../../config/firestore');
const liveSvc = require('../../services/stream/liveSessionService');
const { getChannel } = require('../../services/stream/channelEngine');
const logger = require('../../utils/logger');

// ─── Rate limiters ────────────────────────────────────────

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: true, message: 'Too many live sessions created. Try again later.', code: 'RATE_LIMIT_EXCEEDED' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: true, message: 'Heartbeat rate limit exceeded.', code: 'RATE_LIMIT_EXCEEDED' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const controlLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: true, message: 'Too many control requests. Slow down.', code: 'RATE_LIMIT_EXCEEDED' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ─── Helpers ─────────────────────────────────────────────

function isOwnerOrAdmin(stream, user) {
  return stream.streamer === user.id || user.role === 'admin' || user.role === 'founder';
}

function safeStream(stream) {
  const s = { ...stream };
  delete s.liveSession;
  return s;
}

async function _getStream(id) {
  const db  = getDb();
  const doc = await db.collection('streams').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// ─── GET /api/live ────────────────────────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category, status = 'live', limit = 20, page = 1 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const safeSkip  = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;

    const db = getDb();
    let q = db.collection('streams')
      .where('status', '==', status)
      .where('isBanned', '==', false)
      .orderBy('viewerCount', 'desc')
      .orderBy('startedAt', 'desc');

    if (category) q = q.where('category', '==', category);

    const snap    = await q.offset(safeSkip).limit(safeLimit).get();
    const streams = snap.docs.map(d => safeStream({ id: d.id, ...d.data() }));
    res.json({ success: true, streams });
  } catch (err) { next(err); }
});

// ─── GET /api/live/my/sessions ────────────────────────────
router.get('/my/sessions', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('streams')
      .where('streamer', '==', req.user.id)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const streams = snap.docs.map(d => safeStream({ id: d.id, ...d.data() }));
    res.json({ success: true, streams });
  } catch (err) { next(err); }
});

// ─── GET /api/live/health-check ───────────────────────────
router.get('/health-check', authenticate, requireFounder, async (req, res, next) => {
  try {
    const result = await liveSvc.checkMediaMTXHealth();
    res.json({ success: true, mediaMTX: result });
  } catch (err) { next(err); }
});

// ─── POST /api/live ───────────────────────────────────────
router.post('/', authenticate, createLimiter, async (req, res, next) => {
  try {
    const { title, description, category, tags } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) return next(new ValidationError('Stream title is required'));
    if (title.trim().length > 200) return next(new ValidationError('Stream title must be 200 characters or fewer'));
    if (description && description.length > 2000) return next(new ValidationError('Description must be 2000 characters or fewer'));

    const db = getDb();

    // Check for existing active live session
    const existing = await db.collection('streams').where('streamer', '==', req.user.id).where('status', '==', 'live').limit(1).get();
    if (!existing.empty) {
      return next(new AppError('You already have an active live session. End it before starting a new one.', 409, 'ALREADY_LIVE'));
    }

    // Clean up stale offline sessions
    const staleSnap = await db.collection('streams')
      .where('streamer', '==', req.user.id)
      .where('status', '==', 'offline')
      .get();
    const staleDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const batch = db.batch();
    staleSnap.docs.forEach(d => {
      const createdAt = d.data().createdAt?.toDate?.() || new Date(d.data().createdAt || 0);
      if (createdAt < staleDate) {
        batch.update(d.ref, { status: 'ended', endedAt: now() });
      }
    });
    await batch.commit();

    const id = newId();
    const ts = now();
    const streamData = {
      streamer:    req.user.id,
      title:       title.trim().slice(0, 200),
      description: description?.trim().slice(0, 2000) || null,
      category:    category?.slice(0, 100) || null,
      tags:        Array.isArray(tags) ? tags.slice(0, 10).map(t => String(t).slice(0, 50)) : [],
      status:      'offline',
      isBanned:    false,
      viewerCount: 0,
      peakViewerCount: 0,
      startedAt:   null,
      endedAt:     null,
      hlsUrl:      null,
      mediaMTXPath: null,
      thumbnailUrl: null,
      createdAt:   ts,
      updatedAt:   ts,
    };
    await db.collection('streams').doc(id).set(streamData);

    const stream  = { id, ...streamData };
    const playback = liveSvc.buildPlaybackInfo(stream, true);
    logger.info(`[Live] Session created: ${id} by ${req.user.username}`);
    res.status(201).json({ success: true, stream: safeStream(stream), playback });
  } catch (err) { next(err); }
});

// ─── GET /api/live/:id ────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const stream = await _getStream(req.params.id);
    if (!stream || stream.isBanned) return next(new NotFoundError('Stream'));
    const playback = liveSvc.buildPlaybackInfo(stream, false);
    res.json({ success: true, stream: safeStream(stream), playback });
  } catch (err) { next(err); }
});

// ─── PATCH /api/live/:id ──────────────────────────────────
router.patch('/:id', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await _getStream(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());
    if (stream.status === 'ended') return next(new AppError('Cannot update an ended stream', 400, 'STREAM_ENDED'));

    const allowed = ['title', 'description', 'category', 'thumbnailUrl'];
    const updates = { updatedAt: now() };
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        const val = String(req.body[field] || '').trim();
        if (field === 'title' && val.length === 0) return next(new ValidationError('title cannot be empty'));
        updates[field] = val.slice(0, field === 'description' ? 2000 : 200);
      }
    }
    if (Object.keys(updates).length === 1) return next(new ValidationError('No valid fields to update'));

    const db = getDb();
    await db.collection('streams').doc(req.params.id).update(updates);
    logger.info(`[Live] Stream ${req.params.id} updated by ${req.user.username}`);
    res.json({ success: true, stream: safeStream({ ...stream, ...updates }) });
  } catch (err) { next(err); }
});

// ─── POST /api/live/:id/start-publishing ─────────────────
router.post('/:id/start-publishing', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await _getStream(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());
    if (stream.status === 'ended') return next(new AppError('Stream has ended. Create a new session.', 409, 'STREAM_ENDED'));
    if (stream.status === 'live') {
      const playback = liveSvc.buildPlaybackInfo(stream, true);
      return res.json({ success: true, stream: safeStream(stream), playback, alreadyLive: true });
    }

    const sessionPath = liveSvc.streamPath(req.params.id);
    const ts = now();
    const updates = {
      status:        'live',
      startedAt:     ts,
      mediaMTXPath:  sessionPath,
      hlsUrl:        liveSvc.buildHlsUrl(sessionPath),
      liveSession: {
        startedAt:     ts,
        lastHeartbeat: ts,
        publisherIp:   req.ip,
        userAgent:     req.headers['user-agent']?.slice(0, 300) || null,
      },
      updatedAt: ts,
    };

    const db = getDb();
    await db.collection('streams').doc(req.params.id).update(updates);
    liveSvc.recordPublisherHeartbeat(req.params.id);

    const updated  = { ...stream, ...updates };
    const playback = liveSvc.buildPlaybackInfo(updated, true);
    logger.info(`[Live] Publishing started: ${req.params.id} (path: ${sessionPath}) by ${req.user.username}`);
    res.json({ success: true, stream: safeStream(updated), playback });
  } catch (err) { next(err); }
});

// ─── POST /api/live/:id/stop-publishing ──────────────────
router.post('/:id/stop-publishing', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await _getStream(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());
    if (stream.status === 'ended') return res.json({ success: true, message: 'Stream already ended', stream: safeStream(stream) });

    const db = getDb();
    const ts = now();
    await db.collection('streams').doc(req.params.id).update({ status: 'ended', endedAt: ts, updatedAt: ts });
    liveSvc.clearPublisherState(req.params.id);
    await liveSvc.kickPublisher(req.params.id);
    logger.info(`[Live] Publishing stopped: ${req.params.id} by ${req.user.username}`);
    res.json({ success: true, message: 'Stream ended', stream: safeStream({ ...stream, status: 'ended' }) });
  } catch (err) { next(err); }
});

// ─── POST /api/live/:id/health ────────────────────────────
router.post('/:id/health', authenticate, heartbeatLimiter, async (req, res, next) => {
  try {
    const stream = await _getStream(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());
    if (stream.status !== 'live') return next(new AppError('Stream is not live', 400, 'NOT_LIVE'));

    const { bitrate, fps, resolution, errors } = req.body;
    const metrics = {
      bitrate:    typeof bitrate === 'number'    ? bitrate    : undefined,
      fps:        typeof fps     === 'number'    ? fps        : undefined,
      resolution: typeof resolution === 'string' ? resolution.slice(0, 20) : undefined,
      errors:     typeof errors  === 'number'    ? errors     : undefined,
    };
    const health = liveSvc.recordPublisherHeartbeat(req.params.id, metrics);

    getDb().collection('streams').doc(req.params.id).update({ 'liveSession.lastHeartbeat': now() })
      .catch(e => logger.warn('[Live] heartbeat DB update failed:', e.message));

    // Also forward heartbeat to the 24-hour channel engine (non-fatal)
    try { getChannel().recordLiveHeartbeat(req.params.id); } catch (_) {}

    res.json({ success: true, health });
  } catch (err) { next(err); }
});

// ─── POST /api/live/:id/error ─────────────────────────────
router.post('/:id/error', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const stream = await _getStream(req.params.id);
    if (!stream) return next(new NotFoundError('Stream'));
    if (!isOwnerOrAdmin(stream, req.user)) return next(new ForbiddenError());

    const code    = String(req.body.code    || 'UNKNOWN').slice(0, 50);
    const message = String(req.body.message || '').slice(0, 500);
    const phase   = String(req.body.phase   || '').slice(0, 50);

    logger.warn(`[Live] Stream error: ${req.params.id} code=${code} phase=${phase} — ${message} (user: ${req.user.username})`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GET /api/live/:id/playback ───────────────────────────
router.get('/:id/playback', optionalAuth, async (req, res, next) => {
  try {
    const stream = await _getStream(req.params.id);
    if (!stream || stream.isBanned) return next(new NotFoundError('Stream'));

    const playback = liveSvc.buildPlaybackInfo(stream, false);
    let publisherActive = false;
    if (stream.status === 'live') {
      const ps = await liveSvc.checkPublisherStatus(req.params.id);
      publisherActive = ps.publishing;
    }

    res.json({
      success: true,
      playback,
      publisherActive,
      stream: {
        id:           stream.id,
        title:        stream.title,
        description:  stream.description,
        category:     stream.category,
        status:       stream.status,
        viewerCount:  stream.viewerCount,
        startedAt:    stream.startedAt,
        streamer:     stream.streamer,
        thumbnailUrl: stream.thumbnailUrl,
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/live/:id/viewers ────────────────────────────
router.get('/:id/viewers', optionalAuth, async (req, res, next) => {
  try {
    const db  = getDb();
    const doc = await db.collection('streams').doc(req.params.id).select('status', 'viewerCount', 'peakViewerCount').get();
    if (!doc.exists) return next(new NotFoundError('Stream'));
    const s = doc.data();
    res.json({
      success: true,
      streamId:        req.params.id,
      viewerCount:     s.viewerCount     || 0,
      peakViewerCount: s.peakViewerCount || 0,
      live:            s.status === 'live',
    });
  } catch (err) { next(err); }
});

module.exports = router;
