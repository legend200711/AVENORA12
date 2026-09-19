/**
 * AVENORA — 24-Hour Always-On Channel API Routes
 *
 * Mount point: /api/channel
 *
 * Public endpoints (viewer):
 *   GET  /api/channel/now-playing     — current channel state (unauthenticated allowed)
 *   GET  /api/channel/programming     — upcoming programming
 *
 * Authenticated endpoints (creator/admin):
 *   POST /api/channel/live/start      — notify engine that live camera started
 *   POST /api/channel/live/stop       — notify engine that live camera ended
 *   POST /api/channel/live/heartbeat  — publisher heartbeat (prevents fallback trigger)
 *   POST /api/channel/skip            — skip to next item
 *
 * Admin-only endpoints (founder/admin role):
 *   GET  /api/channel/status          — detailed engine status
 *   POST /api/channel/start           — start the channel
 *   POST /api/channel/stop            — stop the channel
 *   POST /api/channel/programming     — replace programming queue
 *   POST /api/channel/programming/add — add one item
 *   DELETE /api/channel/programming/:id — remove one item
 *   POST /api/channel/fallback        — replace fallback queue
 *   POST /api/channel/fallback/add    — add one fallback item
 */

'use strict';

const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');

const { authenticate, optionalAuth, requireFounder, requireRole } = require('../middleware/auth');
const { ValidationError, ForbiddenError, NotFoundError } = require('../middleware/errorHandler');
const { getChannel, TYPES, STATUS } = require('../../services/stream/channelEngine');
const { getDb } = require('../../config/firestore');
const logger = require('../../utils/logger');

// ─── Rate limiters ────────────────────────────────────────────────────────

const controlLimiter = rateLimit({
  windowMs: 60_000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const heartbeatLimiter = rateLimit({
  windowMs: 60_000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ─── Helper: verify caller is channel admin ───────────────────────────────

function isChannelAdmin(user) {
  return user && (user.role === 'admin' || user.role === 'founder');
}

// ═════════════════════════════════════════════════════════════════════════
//  PUBLIC (viewer) endpoints
// ═════════════════════════════════════════════════════════════════════════

/**
 * GET /api/channel/now-playing
 * Returns the current channel state from Firestore.
 * Unauthenticated — any viewer can read this.
 */
router.get('/now-playing', optionalAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const snap = await db.collection('channelNowPlaying').doc('avenora').get();
    if (!snap.exists) {
      return res.json({ success: true, channel: null, status: STATUS.OFFLINE });
    }
    const data = snap.data();
    // Strip any server-internal fields before sending to viewer
    const safe = {
      channelId:     data.channelId,
      status:        data.status,
      running:       data.running,
      programType:   data.programType,
      programTitle:  data.programTitle,
      mediaUrl:      data.mediaUrl,
      mediaId:       data.mediaId,
      artist:        data.artist,
      coverArt:      data.coverArt,
      images:        data.images,
      perImageSecs:  data.perImageSecs,
      live:          data.live,
      streamId:      data.live ? data.streamId : null, // only expose streamId when live
      startedAt:     data.startedAt,
      elapsed:       data.elapsed,
      remaining:     data.remaining,
      duration:      data.duration,
      serverTime:    data.serverTime,
      nextType:      data.nextType,
      nextTitle:     data.nextTitle,
      recentlyPlayed: data.recentlyPlayed || [],
    };
    res.json({ success: true, channel: safe });
  } catch (err) { next(err); }
});

/**
 * GET /api/channel/programming
 * Returns upcoming programming items.
 */
router.get('/programming', optionalAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const snap = await db.collection('channel').doc('avenora')
      .collection('programming')
      .orderBy('sortOrder', 'asc')
      .limit(50)
      .get();
    const items = snap.docs.map(d => {
      const data = d.data();
      return {
        id:        d.id,
        type:      data.type,
        title:     data.title,
        artist:    data.artist || null,
        coverArt:  data.coverArt || null,
        duration:  data.duration || 0,
        sortOrder: data.sortOrder,
        // Never expose raw media URLs to unauthenticated viewers in programming list
        // (they'll get the URL from now-playing when it's time)
      };
    });
    res.json({ success: true, programming: items });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════════════
//  AUTHENTICATED — live camera control
// ═════════════════════════════════════════════════════════════════════════

/**
 * POST /api/channel/live/start
 * Notifies the channel engine that a live camera session has started.
 * Body: { streamId, title }
 */
router.post('/live/start', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const { streamId, title, hlsUrl } = req.body;
    if (!streamId) return next(new ValidationError('streamId is required'));

    // Verify the caller owns the stream or is admin
    const db = getDb();
    const streamDoc = await db.collection('streams').doc(streamId).get();
    if (!streamDoc.exists) return next(new NotFoundError('Stream'));
    const stream = streamDoc.data();
    if (stream.streamer !== req.user.id && !isChannelAdmin(req.user)) {
      return next(new ForbiddenError('Only the stream owner can start a live channel'));
    }

    // Use the stored HLS URL from the stream doc if not explicitly provided
    const resolvedHlsUrl = hlsUrl || stream.hlsUrl || null;

    const ch = getChannel();
    const result = ch.startLive(streamId, title || stream.title || 'Live', resolvedHlsUrl);
    logger.info(`[Channel] Live started — streamId=${streamId} by ${req.user.id}`);
    res.json({ success: true, message: 'Live camera channel active', status: ch.getStatus() });
  } catch (err) { next(err); }
});

/**
 * POST /api/channel/live/stop
 * Notifies the engine that the live camera has stopped.
 * Body: { streamId }
 */
router.post('/live/stop', authenticate, controlLimiter, async (req, res, next) => {
  try {
    const { streamId } = req.body;
    if (!streamId) return next(new ValidationError('streamId is required'));

    const db = getDb();
    const streamDoc = await db.collection('streams').doc(streamId).get();
    if (!streamDoc.exists) return next(new NotFoundError('Stream'));
    const stream = streamDoc.data();
    if (stream.streamer !== req.user.id && !isChannelAdmin(req.user)) {
      return next(new ForbiddenError());
    }

    const ch = getChannel();
    const result = ch.endLive(streamId);
    logger.info(`[Channel] Live stopped — streamId=${streamId} by ${req.user.id}`);
    res.json({ success: true, message: 'Live camera stopped, transitioning to next program', ...result });
  } catch (err) { next(err); }
});

/**
 * POST /api/channel/live/heartbeat
 * Publisher heartbeat — prevents the live watchdog from triggering.
 * Body: { streamId }
 */
router.post('/live/heartbeat', authenticate, heartbeatLimiter, async (req, res, next) => {
  try {
    const { streamId } = req.body;
    if (!streamId) return next(new ValidationError('streamId is required'));
    const ch = getChannel();
    ch.recordLiveHeartbeat(streamId);
    res.json({ success: true, heartbeat: Date.now() });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════════════
//  ADMIN — channel control
// ═════════════════════════════════════════════════════════════════════════

/**
 * GET /api/channel/status
 * Full engine status — admin/founder only.
 */
router.get('/status', authenticate, (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  const ch = getChannel();
  res.json({ success: true, status: ch.getStatus() });
});

/**
 * POST /api/channel/start
 */
router.post('/start', authenticate, controlLimiter, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  const ch = getChannel();
  await ch.loadProgramming();
  const result = ch.start();
  logger.info(`[Channel] Started by ${req.user.id}`);
  res.json({ success: true, ...result, status: ch.getStatus() });
});

/**
 * POST /api/channel/stop
 */
router.post('/stop', authenticate, controlLimiter, (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  const ch = getChannel();
  const result = ch.stop();
  logger.info(`[Channel] Stopped by ${req.user.id}`);
  res.json({ success: true, ...result });
});

/**
 * POST /api/channel/skip
 */
router.post('/skip', authenticate, controlLimiter, (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  const ch = getChannel();
  const result = ch.skip();
  res.json({ success: true, ...result, status: ch.getStatus() });
});

/**
 * POST /api/channel/programming
 * Replace the entire programming queue.
 * Body: { items: [{ type, title, mediaUrl, duration, ... }] }
 */
router.post('/programming', authenticate, controlLimiter, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return next(new ValidationError('items must be an array'));
    const safe = items.map((item, i) => _sanitizeProgramItem(item, i));
    const ch = getChannel();
    const result = await ch.setProgramming(safe);
    logger.info(`[Channel] Programming updated by ${req.user.id} — ${safe.length} items`);
    res.json({ success: true, ...result, count: safe.length });
  } catch (err) { next(err); }
});

/**
 * POST /api/channel/programming/add
 * Add a single item to the end of the programming queue.
 */
router.post('/programming/add', authenticate, controlLimiter, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const item = _sanitizeProgramItem(req.body, 0);
    const ch = getChannel();
    const result = await ch.addProgramItem(item);
    logger.info(`[Channel] Program item added by ${req.user.id}: "${item.title}"`);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/channel/programming/:id
 */
router.delete('/programming/:id', authenticate, controlLimiter, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const ch = getChannel();
    const result = await ch.removeProgramItem(req.params.id);
    logger.info(`[Channel] Program item ${req.params.id} removed by ${req.user.id}`);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/channel/programming/:id/move
 * Move a program item up or down in the queue.
 * Body: { direction: 'up' | 'down' }
 */
router.patch('/programming/:id/move', authenticate, controlLimiter, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const { direction } = req.body;
    if (direction !== 'up' && direction !== 'down') {
      return next(new ValidationError('direction must be "up" or "down"'));
    }
    const db = getDb();
    // Load current order
    const snap = await db.collection('channel').doc('avenora')
      .collection('programming')
      .orderBy('sortOrder', 'asc')
      .get();
    const items = snap.docs.map(d => ({ ref: d.ref, sortOrder: d.data().sortOrder, id: d.id }));
    const idx = items.findIndex(i => i.id === req.params.id);
    if (idx === -1) return next(new NotFoundError('Programming item'));
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) {
      return res.json({ success: true, message: 'Already at boundary' });
    }
    // Swap sort orders
    const batch = db.batch();
    batch.update(items[idx].ref,     { sortOrder: items[swapIdx].sortOrder });
    batch.update(items[swapIdx].ref, { sortOrder: items[idx].sortOrder });
    await batch.commit();
    // Reload engine queue
    await getChannel().loadProgramming();
    logger.info(`[Channel] Item ${req.params.id} moved ${direction} by ${req.user.id}`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/**
 * GET /api/channel/history
 * Recent broadcast history (last 20 items).
 */
router.get('/history', optionalAuth, async (req, res, next) => {
  try {
    const ch = getChannel();
    const st = ch.getStatus();
    res.json({ success: true, history: st.history || [] });
  } catch (err) { next(err); }
});

/**
 * GET /api/channel/viewer-count
 * Approximate current viewer count from engine state.
 */
router.get('/viewer-count', optionalAuth, (req, res) => {
  const ch = getChannel();
  // Viewer count is tracked in the now-playing doc; return from engine state
  res.json({ success: true, viewers: ch._viewerCount || 0 });
});

/**
 * POST /api/channel/fallback
 * Replace the entire fallback queue.
 */
router.post('/fallback', authenticate, controlLimiter, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return next(new ValidationError('items must be an array'));
    const safe = items.map((item, i) => _sanitizeProgramItem(item, i));
    const ch = getChannel();
    const result = await ch.setFallback(safe);
    logger.info(`[Channel] Fallback updated by ${req.user.id} — ${safe.length} items`);
    res.json({ success: true, ...result, count: safe.length });
  } catch (err) { next(err); }
});

/**
 * POST /api/channel/fallback/add
 */
router.post('/fallback/add', authenticate, controlLimiter, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const item = _sanitizeProgramItem(req.body, 0);
    const ch = getChannel();
    const result = await ch.addFallbackItem(item);
    logger.info(`[Channel] Fallback item added by ${req.user.id}: "${item.title}"`);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

/**
 * GET /api/channel/fallback
 * List fallback items.
 */
router.get('/fallback', authenticate, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const db = getDb();
    const snap = await db.collection('channel').doc('avenora')
      .collection('fallback')
      .orderBy('sortOrder', 'asc')
      .limit(200)
      .get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, fallback: items });
  } catch (err) { next(err); }
});

/**
 * GET /api/channel/programming/full
 * Full programming list with media URLs (admin only).
 */
router.get('/programming/full', authenticate, async (req, res, next) => {
  if (!isChannelAdmin(req.user)) return next(new ForbiddenError('Admin only'));
  try {
    const db = getDb();
    const snap = await db.collection('channel').doc('avenora')
      .collection('programming')
      .orderBy('sortOrder', 'asc')
      .limit(200)
      .get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, programming: items });
  } catch (err) { next(err); }
});

// ─── Input sanitizer ──────────────────────────────────────────────────────

function _sanitizeProgramItem(item, index) {
  if (!item || typeof item !== 'object') throw new ValidationError(`items[${index}] must be an object`);

  const VALID_TYPES = Object.values(TYPES);
  const type = String(item.type || '').toUpperCase();
  if (!VALID_TYPES.includes(type)) {
    throw new ValidationError(`items[${index}].type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  const title = String(item.title || '').slice(0, 200);
  if (!title) throw new ValidationError(`items[${index}].title is required`);

  const safe = {
    type,
    title,
    artist:      typeof item.artist      === 'string' ? item.artist.slice(0, 200)      : null,
    coverArt:    typeof item.coverArt    === 'string' ? item.coverArt.slice(0, 500)     : null,
    mediaUrl:    typeof item.mediaUrl    === 'string' ? item.mediaUrl.slice(0, 2000)    : null,
    mediaId:     typeof item.mediaId     === 'string' ? item.mediaId.slice(0, 200)      : null,
    duration:    typeof item.duration    === 'number' ? Math.max(0, Math.floor(item.duration)) : 0,
    sortOrder:   typeof item.sortOrder   === 'number' ? item.sortOrder : (index + 1) * 10,
    description: typeof item.description === 'string' ? item.description.slice(0, 500) : null,
  };

  // Slideshow-specific
  if (type === TYPES.SLIDESHOW || type === TYPES.IMAGE) {
    if (Array.isArray(item.images)) {
      safe.images = item.images.slice(0, 100).map(img => ({
        url:     String(img.url || '').slice(0, 2000),
        caption: String(img.caption || '').slice(0, 200),
      }));
    }
    if (typeof item.perImageSecs === 'number') {
      safe.perImageSecs = Math.min(Math.max(item.perImageSecs, 3), 300);
    }
  }

  // Music / Audio — may contain queue
  if (type === TYPES.MUSIC || type === TYPES.AUDIO) {
    if (Array.isArray(item.tracks)) {
      safe.tracks = item.tracks.slice(0, 500).map(t => ({
        id:          String(t.id || '').slice(0, 200),
        title:       String(t.title || '').slice(0, 200),
        artist:      String(t.artist || '').slice(0, 200),
        url:         String(t.url || '').slice(0, 2000),
        duration:    typeof t.duration === 'number' ? Math.max(0, Math.floor(t.duration)) : 0,
        storagePath: String(t.storagePath || '').slice(0, 500),
      }));
    }
    safe.shuffle = item.shuffle === true;
    safe.repeat  = item.repeat !== false;
  }

  return safe;
}

module.exports = router;
