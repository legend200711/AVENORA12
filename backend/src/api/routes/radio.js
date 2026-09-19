/**
 * AVENORA RADIO — API Routes
 *
 * Mount point: /api/radio
 *
 * Public (no auth):
 *   GET  /api/radio/status          — station status (current track, upcoming, etc.)
 *   POST /api/radio/listener/join   — register listener presence
 *   POST /api/radio/listener/ping   — heartbeat to stay in listener count
 *   POST /api/radio/listener/leave  — explicit leave
 *   GET  /api/radio/listeners       — current listener count
 *
 * Authenticated (admin/founder only):
 *   POST /api/radio/station/start   — start the station (with playlist)
 *   POST /api/radio/station/pause   — pause
 *   POST /api/radio/station/resume  — resume
 *   POST /api/radio/station/skip    — skip current track
 *   PUT  /api/radio/station/playlist — replace full playlist
 *   POST /api/radio/station/playlist/add     — add a track
 *   DELETE /api/radio/station/playlist/:trackId — remove track
 *   POST /api/radio/station/playlist/reorder — reorder tracks
 *   PUT  /api/radio/station/settings — update shuffle/repeat
 *   POST /api/radio/favorites       — toggle favorite (any logged-in user)
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { ValidationError, ForbiddenError } = require('../middleware/errorHandler');
const radioEngine = require('../../services/stream/radioEngine');
const logger     = require('../../utils/logger');

// ─── Rate limiters ────────────────────────────────────────
const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: req => req.ip,
});

const presenceLimiter = rateLimit({
  windowMs: 30_000,
  max: 10,
  standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: req => req.ip,
});

const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: req => req.user?.id || req.ip,
});

// ─── Listener presence store ─────────────────────────────
// In-memory: Map<listenerId, { uid, lastSeen }>
// Stale listeners (> 90s since last ping) are pruned automatically.
const _listeners    = new Map();
const LISTENER_TTL  = 90_000; // 90 s
const LISTENER_PRUNE_INTERVAL = 30_000;

setInterval(() => {
  const cutoff = Date.now() - LISTENER_TTL;
  for (const [id, l] of _listeners.entries()) {
    if (l.lastSeen < cutoff) _listeners.delete(id);
  }
}, LISTENER_PRUNE_INTERVAL);

function _listenerCount() { return _listeners.size; }

function _upsertListener(listenerId, uid) {
  _listeners.set(listenerId, { uid: uid || null, lastSeen: Date.now() });
}

function _removeListener(listenerId) {
  _listeners.delete(listenerId);
}

// ─── Auth guard for admin operations ─────────────────────
function requireAdmin(req, res, next) {
  if (!req.user) return next(new ForbiddenError('Authentication required'));
  if (req.user.role !== 'admin' && req.user.role !== 'founder') {
    return next(new ForbiddenError('Admin or founder role required'));
  }
  next();
}

// ─── Helper: sanitise track ───────────────────────────────
function sanitiseTrack(t, i = 0) {
  if (!t || typeof t !== 'object') throw new ValidationError(`Track[${i}] must be an object`);
  const url = typeof t.url === 'string' ? t.url.trim() : '';
  return {
    id:          String(t.id    || `track-${Date.now()}-${i}`).slice(0, 200),
    title:       String(t.title  || 'Untitled').slice(0, 200),
    artist:      String(t.artist || '').slice(0, 200),
    album:       String(t.album  || '').slice(0, 200),
    genre:       String(t.genre  || '').slice(0, 100),
    coverUrl:    typeof t.coverUrl === 'string' ? t.coverUrl.slice(0, 1000) : null,
    url,
    duration:    typeof t.duration === 'number' ? Math.max(0, Math.floor(t.duration)) : 0,
    storagePath: typeof t.storagePath === 'string' ? t.storagePath.slice(0, 500) : '',
    uploadedBy:  typeof t.uploadedBy === 'string' ? t.uploadedBy.slice(0, 200) : '',
  };
}

// ═════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═════════════════════════════════════════════════════════

// GET /api/radio/status
router.get('/status', publicLimiter, optionalAuth, (req, res) => {
  const station = radioEngine.getStation();
  if (!station) {
    return res.json({
      success: true,
      status: null,
      stationId: radioEngine.STATION_ID,
      running: false,
      listenerCount: _listenerCount(),
      message: 'Station not initialised',
    });
  }
  const status = station.getStatus();
  res.json({
    success:       true,
    listenerCount: _listenerCount(),
    ...status,
  });
});

// GET /api/radio/listeners
router.get('/listeners', publicLimiter, (req, res) => {
  res.json({ success: true, count: _listenerCount() });
});

// POST /api/radio/listener/join
router.post('/listener/join', presenceLimiter, optionalAuth, (req, res) => {
  const { listenerId } = req.body;
  if (!listenerId || typeof listenerId !== 'string') {
    return res.status(400).json({ error: true, message: 'listenerId required' });
  }
  const uid = req.user?.id || req.user?.uid || null;
  _upsertListener(listenerId.slice(0, 100), uid);
  res.json({ success: true, count: _listenerCount() });
});

// POST /api/radio/listener/ping
router.post('/listener/ping', presenceLimiter, optionalAuth, (req, res) => {
  const { listenerId } = req.body;
  if (!listenerId || typeof listenerId !== 'string') {
    return res.status(400).json({ error: true, message: 'listenerId required' });
  }
  const uid = req.user?.id || req.user?.uid || null;
  _upsertListener(listenerId.slice(0, 100), uid);
  res.json({ success: true, count: _listenerCount() });
});

// POST /api/radio/listener/leave
router.post('/listener/leave', presenceLimiter, optionalAuth, (req, res) => {
  const { listenerId } = req.body;
  if (listenerId) _removeListener(String(listenerId).slice(0, 100));
  res.json({ success: true, count: _listenerCount() });
});

// ═════════════════════════════════════════════════════════
// ADMIN ENDPOINTS  (require admin/founder role)
// ═════════════════════════════════════════════════════════

// POST /api/radio/station/start
// Body: { playlist: [...], stationName?, description?, shuffle?, repeat? }
router.post('/station/start', adminLimiter, authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { playlist, stationName, description, shuffle, repeat } = req.body;

    if (!Array.isArray(playlist) || playlist.length === 0) {
      return next(new ValidationError('playlist must be a non-empty array'));
    }
    if (playlist.length > 500) {
      return next(new ValidationError('playlist may contain at most 500 tracks'));
    }

    const safePlaylist = playlist.map((t, i) => sanitiseTrack(t, i));
    const validTracks  = safePlaylist.filter(t => t.url);

    if (!validTracks.length) {
      return res.status(400).json({ error: true, message: 'No tracks have a valid audio URL' });
    }

    const station = radioEngine.initStation({
      stationName:  stationName || 'AVENORA RADIO',
      description:  description || '24 HOURS • 7 DAYS • ALWAYS PLAYING',
      playlist:     validTracks,
      shuffle:      shuffle === true,
      repeat:       repeat !== false,
    });

    station.start();

    logger.info(`[Radio] Station started by admin ${req.user.id} — ${validTracks.length} tracks`);
    res.status(201).json({ success: true, message: 'Station started', status: station.getStatus() });
  } catch (err) {
    next(err);
  }
});

// POST /api/radio/station/pause
router.post('/station/pause', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const station = radioEngine.ensureStation();
    station.pause();
    logger.info(`[Radio] Station paused by admin ${req.user.id}`);
    res.json({ success: true, message: 'Station paused', status: station.getStatus() });
  } catch (err) { next(err); }
});

// POST /api/radio/station/resume
router.post('/station/resume', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const station = radioEngine.ensureStation();
    station.resume();
    logger.info(`[Radio] Station resumed by admin ${req.user.id}`);
    res.json({ success: true, message: 'Station resumed', status: station.getStatus() });
  } catch (err) { next(err); }
});

// POST /api/radio/station/skip
router.post('/station/skip', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const station = radioEngine.ensureStation();
    if (!station.isRunning) {
      return res.status(400).json({ error: true, message: 'Station is not playing' });
    }
    station.skip();
    logger.info(`[Radio] Track skipped by admin ${req.user.id}`);
    res.json({ success: true, message: 'Track skipped', status: station.getStatus() });
  } catch (err) { next(err); }
});

// PUT /api/radio/station/playlist — replace full playlist
router.put('/station/playlist', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const { playlist, shuffle, repeat } = req.body;
    if (!Array.isArray(playlist) || playlist.length === 0) {
      return next(new ValidationError('playlist must be a non-empty array'));
    }
    const safe = playlist.map((t, i) => sanitiseTrack(t, i)).filter(t => t.url);
    if (!safe.length) {
      return res.status(400).json({ error: true, message: 'No valid audio URLs in playlist' });
    }
    const station = radioEngine.ensureStation();
    station.setPlaylist(safe, { shuffle, repeat });
    res.json({ success: true, message: 'Playlist updated', status: station.getStatus() });
  } catch (err) { next(err); }
});

// POST /api/radio/station/playlist/add — add one track
router.post('/station/playlist/add', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const track = sanitiseTrack(req.body);
    if (!track.url) return res.status(400).json({ error: true, message: 'Track has no URL' });
    const station = radioEngine.ensureStation();
    station.addTrack(track);
    res.json({ success: true, message: 'Track added', status: station.getStatus() });
  } catch (err) { next(err); }
});

// DELETE /api/radio/station/playlist/:trackId
router.delete('/station/playlist/:trackId', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const { trackId } = req.params;
    if (!trackId) return next(new ValidationError('trackId required'));
    const station = radioEngine.ensureStation();
    const removed = station.removeTrack(trackId);
    if (!removed) return res.status(404).json({ error: true, message: 'Track not found in playlist' });
    res.json({ success: true, message: 'Track removed', status: station.getStatus() });
  } catch (err) { next(err); }
});

// POST /api/radio/station/playlist/reorder
// Body: { fromIndex: number, toIndex: number }
router.post('/station/playlist/reorder', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const { fromIndex, toIndex } = req.body;
    if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') {
      return next(new ValidationError('fromIndex and toIndex must be numbers'));
    }
    const station = radioEngine.ensureStation();
    const ok = station.reorderTrack(fromIndex, toIndex);
    if (!ok) return res.status(400).json({ error: true, message: 'Invalid indices' });
    res.json({ success: true, message: 'Playlist reordered', status: station.getStatus() });
  } catch (err) { next(err); }
});

// PUT /api/radio/station/settings
// Body: { stationName?, description?, shuffle?, repeat? }
router.put('/station/settings', adminLimiter, authenticate, requireAdmin, (req, res, next) => {
  try {
    const { stationName, description, shuffle, repeat } = req.body;
    const station = radioEngine.ensureStation();
    if (stationName) station.stationName = String(stationName).slice(0, 100);
    if (description) station.description = String(description).slice(0, 300);
    if (typeof shuffle === 'boolean') station.shuffle = shuffle;
    if (typeof repeat  === 'boolean') station.repeat  = repeat;
    station._persistState();
    res.json({ success: true, message: 'Settings updated', status: station.getStatus() });
  } catch (err) { next(err); }
});

// ─── Favorites (any logged-in user) ──────────────────────
// Stores/removes trackId in radioFavorites/{uid}/tracks/{trackId}
router.post('/favorites', authenticate, async (req, res, next) => {
  try {
    const { trackId, action } = req.body; // action: 'add' | 'remove'
    if (!trackId) return next(new ValidationError('trackId required'));

    let db;
    try { db = require('../../config/firestore').getDb(); } catch { db = null; }

    if (!db) return res.status(503).json({ error: true, message: 'Firestore unavailable' });

    const uid = req.user.id || req.user.uid;
    const ref = db.collection('radioFavorites').doc(uid).collection('tracks').doc(String(trackId));

    if (action === 'remove') {
      await ref.delete();
      return res.json({ success: true, favorited: false });
    }
    await ref.set({ trackId: String(trackId), addedAt: Date.now() });
    res.json({ success: true, favorited: true });
  } catch (err) { next(err); }
});

module.exports = router;
