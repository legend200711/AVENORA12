/**
 * AVENORA — Cloud Radio API Routes
 *
 * Real server-side cloud radio control endpoints.
 *
 * Mount point: /api/cloud-radio
 *
 * Authentication: Firebase ID token (Bearer) — any authenticated user may
 * start their own broadcast; only the broadcast owner (uid match) may stop /
 * skip their own session. Founders/admins may manage any session.
 *
 * Key difference from /api/admin/cloud-stream:
 *   - /api/admin/cloud-stream uses the legacy ffmpeg→RTMP engine (founder-only)
 *   - /api/cloud-radio uses the CloudRadioEngine which runs server-side,
 *     publishes Now Playing to Firestore, and lets browser clients play
 *     Supabase-hosted audio directly. No RTMP or ffmpeg required.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');

const { authenticate }                = require('../middleware/auth');
const { ValidationError, ForbiddenError, NotFoundError } = require('../middleware/errorHandler');
const engine  = require('../../services/stream/cloudRadioEngine');
const logger  = require('../../utils/logger');

// ─── Rate limiters ────────────────────────────────────────
const controlLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many cloud radio requests. Please slow down.' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const startLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many broadcasts started. Wait before starting another.' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ─── Auth guard ────────────────────────────────────────────
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────

function isOwnerOrAdmin(sessionStatus, user) {
  if (!sessionStatus) return false;
  return (
    sessionStatus.uid === user.id ||
    sessionStatus.uid === user.uid ||
    user.role === 'admin' ||
    user.role === 'founder'
  );
}

// ─────────────────────────────────────────────────────────
// POST /api/cloud-radio/start
//
// Start a real server-side cloud radio session.
//
// Body:
//   streamId        {string}   — Firestore cloudStreams document ID
//   uid             {string}   — creator's Firebase UID (must match req.user)
//   queue           {Array}    — [{id, title, artist, url, duration, storagePath}]
//   shuffle         {boolean}  — optional, default false
//   repeat          {boolean}  — optional, default true
//   durationMinutes {number}   — optional, default 1440
// ─────────────────────────────────────────────────────────
router.post('/start', startLimiter, (req, res, next) => {
  try {
    const { streamId, uid, queue, shuffle, repeat, durationMinutes } = req.body;

    if (!streamId || typeof streamId !== 'string' || streamId.length > 200) {
      return next(new ValidationError('streamId is required (string ≤ 200 chars)'));
    }
    if (!uid || typeof uid !== 'string') {
      return next(new ValidationError('uid is required'));
    }
    // Only allow starting a session for the authenticated user (or admin/founder)
    if (uid !== req.user.id && uid !== req.user.uid && req.user.role !== 'admin' && req.user.role !== 'founder') {
      return next(new ForbiddenError('You can only start a broadcast for your own account'));
    }
    if (!Array.isArray(queue) || queue.length === 0) {
      return next(new ValidationError('queue must be a non-empty array of tracks'));
    }
    if (queue.length > 500) {
      return next(new ValidationError('queue may contain at most 500 tracks'));
    }

    // Sanitise each track — only keep safe scalar fields
    const safeQueue = queue.map((t, i) => {
      if (!t || typeof t !== 'object') throw new ValidationError(`queue[${i}] must be an object`);
      const url = typeof t.url === 'string' ? t.url.trim() : '';
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        // Skip tracks with no valid URL — engine handles empty-url tracks gracefully
      }
      return {
        id:          String(t.id    || '').slice(0, 200),
        title:       String(t.title || 'Untitled').slice(0, 200),
        artist:      String(t.artist || '').slice(0, 200),
        url:         url,
        duration:    typeof t.duration === 'number' ? Math.max(0, Math.floor(t.duration)) : 0,
        storagePath: typeof t.storagePath === 'string' ? t.storagePath.slice(0, 500) : '',
      };
    });

    const result = engine.startSession({
      streamId,
      uid: req.user.id || req.user.uid,
      queue:           safeQueue,
      shuffle:         shuffle === true,
      repeat:          repeat !== false,
      durationMinutes: typeof durationMinutes === 'number' ? Math.min(Math.max(durationMinutes, 1), 1440) : 1440,
    });

    if (!result.ok) {
      return res.status(400).json({ error: true, message: result.message });
    }

    logger.info(`[CloudRadio] Started session ${streamId} for user ${req.user.id} (${result.trackCount} tracks)`);
    const status = engine.getSessionStatus(streamId);
    res.status(201).json({ success: true, message: 'Cloud radio started', status });

  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/cloud-radio/stop
// Body: { streamId }
// ─────────────────────────────────────────────────────────
router.post('/stop', controlLimiter, (req, res, next) => {
  try {
    const { streamId } = req.body;
    if (!streamId) return next(new ValidationError('streamId is required'));

    const existing = engine.getSessionStatus(streamId);
    if (!existing) return next(new NotFoundError('CloudRadio session'));
    if (!isOwnerOrAdmin(existing, req.user)) return next(new ForbiddenError());

    const result = engine.stopSession(streamId);
    if (!result.ok) return res.status(400).json({ error: true, message: result.message });

    logger.info(`[CloudRadio] Stopped session ${streamId} by user ${req.user.id}`);
    res.json({ success: true, message: 'Cloud radio stopped' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/cloud-radio/skip
// Body: { streamId }
// ─────────────────────────────────────────────────────────
router.post('/skip', controlLimiter, (req, res, next) => {
  try {
    const { streamId } = req.body;
    if (!streamId) return next(new ValidationError('streamId is required'));

    const existing = engine.getSessionStatus(streamId);
    if (!existing) return next(new NotFoundError('CloudRadio session'));
    if (!isOwnerOrAdmin(existing, req.user)) return next(new ForbiddenError());

    const result = engine.skipTrack(streamId);
    if (!result.ok) return res.status(400).json({ error: true, message: result.message });

    logger.info(`[CloudRadio] Skipped track in session ${streamId} by user ${req.user.id}`);
    const status = engine.getSessionStatus(streamId);
    res.json({ success: true, message: 'Track skipped', status });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/cloud-radio/status/:streamId
// ─────────────────────────────────────────────────────────
router.get('/status/:streamId', (req, res, next) => {
  try {
    const { streamId } = req.params;
    if (!streamId) return next(new ValidationError('streamId is required'));

    const status = engine.getSessionStatus(streamId);
    if (!status) {
      // Session not running on this server — could be stopped or never started
      return res.json({ success: true, status: null, running: false });
    }
    res.json({ success: true, status });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/cloud-radio/sessions
// List all active session IDs (founder/admin only).
// ─────────────────────────────────────────────────────────
router.get('/sessions', (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'founder') {
    return res.status(403).json({ error: true, message: 'Founder/admin only' });
  }
  res.json({ success: true, sessions: engine.listSessions() });
});

module.exports = router;
