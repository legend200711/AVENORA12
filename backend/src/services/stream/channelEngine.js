/**
 * AVENORA — 24-Hour Always-On Channel Engine
 *
 * This is the authoritative server-side scheduler for the AVENORA 24-hour channel.
 * It maintains a persistent channel state in Firestore and drives automatic transitions
 * between programming items of any type (MUSIC, VIDEO, IMAGE, SLIDESHOW, AUDIO, LIVE_CAMERA,
 * PRE_RECORDED_SHOW).
 *
 * Key design rules:
 *   - The channel is ALWAYS ON. It never shuts down automatically.
 *   - All channel state is owned by the server. Clients are viewers only.
 *   - Live camera requires an active WHIP heartbeat. If it drops, fallback triggers.
 *   - Fallback programming plays when no scheduled item is active.
 *   - On server restart, channel state is recovered from Firestore.
 *   - Track advancement uses a single server timer — no race conditions from multiple clients.
 *
 * Firestore collections:
 *   channel/{channelId}                 — channel config and current state
 *   channel/{channelId}/programming     — scheduled programming items
 *   channel/{channelId}/fallback        — fallback queue items
 *   channelNowPlaying/{channelId}       — live now-playing doc (clients subscribe to this)
 *
 * Channel state machine:
 *   OFFLINE → ONLINE → PLAYING | LIVE | FALLBACK | TRANSITIONING → ONLINE
 */

'use strict';

const logger = require('../../utils/logger');

// ─── Constants ──────────────────────────────────────────────────────────────
const CHANNEL_ID              = 'avenora';   // singleton channel
const HEARTBEAT_INTERVAL_MS   = 8_000;       // publish state every 8s
const LIVE_HEARTBEAT_TIMEOUT  = 30_000;      // 30s without heartbeat → live ends
const DEFAULT_ITEM_DURATION   = 240_000;     // 4 min default for unknown durations

// Programming item types
const TYPES = {
  LIVE_CAMERA:       'LIVE_CAMERA',
  MUSIC:             'MUSIC',
  AUDIO:             'AUDIO',
  VIDEO:             'VIDEO',
  IMAGE:             'IMAGE',
  SLIDESHOW:         'SLIDESHOW',
  PRE_RECORDED_SHOW: 'PRE_RECORDED_SHOW',
};

// Channel statuses (written to Firestore so clients can react)
const STATUS = {
  OFFLINE:       'OFFLINE',
  ONLINE:        'ONLINE',
  PLAYING:       'PLAYING',
  LIVE:          'LIVE',
  FALLBACK:      'FALLBACK',
  TRANSITIONING: 'TRANSITIONING',
};

// ─── Firestore access ──────────────────────────────────────────────────────
let _db = null;
function _getDb() {
  if (_db) return _db;
  try {
    const { getDb } = require('../../config/firestore');
    _db = getDb();
    return _db;
  } catch (e) {
    logger.warn('[ChannelEngine] Firestore not available: ' + e.message);
    return null;
  }
}

// ─── Engine state ─────────────────────────────────────────────────────────
let _channel = null;   // the single ChannelEngine instance

// ═══════════════════════════════════════════════════════════════════════════
// ChannelEngine class — manages the always-on channel
// ═══════════════════════════════════════════════════════════════════════════
class ChannelEngine {
  constructor() {
    this.channelId        = CHANNEL_ID;
    this.status           = STATUS.OFFLINE;
    this.isRunning        = false;

    // Current programming item
    this.currentItem      = null;     // { id, type, title, mediaUrl, duration, ... }
    this.itemStartedAt    = 0;        // Date.now() when current item started
    this.itemTimer        = null;     // setTimeout handle for item advancement

    // Guard: prevent concurrent _advance() calls (e.g. from timer + skip)
    this._advancing       = false;

    // Queues (loaded from Firestore)
    this.programQueue     = [];       // scheduled items
    this.fallbackQueue    = [];       // fallback items
    this.fallbackIndex    = 0;        // current position in fallback queue

    // Live camera state
    this.liveSession      = null;     // { streamId, startedAt, lastHeartbeat }
    this.liveCheckTimer   = null;

    // Heartbeat
    this.heartbeatTimer   = null;

    // History
    this.history          = [];       // last 20 items
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Start the channel engine. Safe to call multiple times. */
  start() {
    if (this.isRunning) return { ok: true, message: 'Already running' };
    this.isRunning = true;
    this.status    = STATUS.ONLINE;
    logger.info('[ChannelEngine] Starting AVENORA 24-hour channel…');
    this._startHeartbeat();
    this._advance();
    return { ok: true };
  }

  /** Stop the channel (admin action — channel goes offline). */
  stop() {
    this.isRunning = false;
    this.status    = STATUS.OFFLINE;
    clearTimeout(this.itemTimer);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.liveCheckTimer);
    this.itemTimer = null;
    this.heartbeatTimer = null;
    this.liveCheckTimer = null;
    this._publishState();
    logger.info('[ChannelEngine] Channel stopped');
    return { ok: true };
  }

  /** Force-advance to the next item. */
  skip() {
    if (!this.isRunning) return { ok: false, message: 'Channel not running' };
    clearTimeout(this.itemTimer);
    this._advance();
    return { ok: true };
  }

  /** Load programming and fallback from Firestore. */
  async loadProgramming() {
    const db = _getDb();
    if (!db) return;
    try {
      // Load programming queue
      const snap = await db.collection('channel').doc(this.channelId)
        .collection('programming')
        .orderBy('sortOrder', 'asc')
        .limit(200)
        .get();
      this.programQueue = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      logger.info(`[ChannelEngine] Loaded ${this.programQueue.length} programming items`);

      // Load fallback queue
      const fbSnap = await db.collection('channel').doc(this.channelId)
        .collection('fallback')
        .orderBy('sortOrder', 'asc')
        .limit(200)
        .get();
      this.fallbackQueue = fbSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      logger.info(`[ChannelEngine] Loaded ${this.fallbackQueue.length} fallback items`);
    } catch (e) {
      logger.warn('[ChannelEngine] loadProgramming failed: ' + e.message);
    }
  }

  /** Called by live.js heartbeat endpoint when camera is active. */
  recordLiveHeartbeat(streamId) {
    if (this.liveSession && this.liveSession.streamId === streamId) {
      this.liveSession.lastHeartbeat = Date.now();
    }
  }

  /** Notify the engine that a LIVE_CAMERA session has started. */
  startLive(streamId, streamTitle, hlsUrl = null) {
    logger.info(`[ChannelEngine] Live camera started — streamId=${streamId} hlsUrl=${hlsUrl}`);
    this.liveSession = { streamId, startedAt: Date.now(), lastHeartbeat: Date.now(), title: streamTitle, hlsUrl };
    this.status      = STATUS.LIVE;
    this.currentItem = {
      id:       streamId,
      type:     TYPES.LIVE_CAMERA,
      title:    streamTitle || 'Live Camera',
      streamId,
      live:     true,
      mediaUrl: hlsUrl,
    };
    this.itemStartedAt = Date.now();
    clearTimeout(this.itemTimer);
    this._startLiveCheck();
    this._publishState();
    return { ok: true };
  }

  /** Called when a live session is intentionally ended by the creator. */
  endLive(streamId) {
    if (!this.liveSession || this.liveSession.streamId !== streamId) {
      return { ok: false, message: 'No matching live session' };
    }
    logger.info(`[ChannelEngine] Live camera ended by creator — streamId=${streamId}`);
    this._onLiveEnded('creator_ended');
    return { ok: true };
  }

  /** Get current channel status snapshot. */
  getStatus() {
    const elapsed   = this.currentItem ? Math.floor((Date.now() - this.itemStartedAt) / 1000) : 0;
    const dur       = this.currentItem?.duration || 0;
    const remaining = dur > 0 ? Math.max(0, dur - elapsed) : 0;
    const nextItem  = this._getNextItem();
    return {
      channelId:    this.channelId,
      status:       this.status,
      running:      this.isRunning,
      currentItem:  this.currentItem ? { ...this.currentItem, elapsed, remaining } : null,
      nextItem,
      itemStartedAt: this.itemStartedAt,
      queueLength:  this.programQueue.length,
      fallbackLength: this.fallbackQueue.length,
      liveSession:  this.liveSession ? {
        streamId:     this.liveSession.streamId,
        startedAt:    this.liveSession.startedAt,
        lastHeartbeat: this.liveSession.lastHeartbeat,
        active: Date.now() - this.liveSession.lastHeartbeat < LIVE_HEARTBEAT_TIMEOUT,
      } : null,
      history: this.history.slice(-10),
    };
  }

  /** Add a programming item to the queue. */
  async addProgramItem(item) {
    const db = _getDb();
    if (!db) return { ok: false, message: 'Firestore unavailable' };
    try {
      const docRef = await db.collection('channel').doc(this.channelId)
        .collection('programming').add({
          ...item,
          sortOrder: item.sortOrder ?? (this.programQueue.length + 1) * 10,
          createdAt: Date.now(),
        });
      await this.loadProgramming();
      return { ok: true, id: docRef.id };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  /** Remove a programming item. */
  async removeProgramItem(itemId) {
    const db = _getDb();
    if (!db) return { ok: false, message: 'Firestore unavailable' };
    try {
      await db.collection('channel').doc(this.channelId)
        .collection('programming').doc(itemId).delete();
      await this.loadProgramming();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  /** Add a fallback item. */
  async addFallbackItem(item) {
    const db = _getDb();
    if (!db) return { ok: false, message: 'Firestore unavailable' };
    try {
      const docRef = await db.collection('channel').doc(this.channelId)
        .collection('fallback').add({
          ...item,
          sortOrder: item.sortOrder ?? (this.fallbackQueue.length + 1) * 10,
          createdAt: Date.now(),
        });
      await this.loadProgramming();
      return { ok: true, id: docRef.id };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  /** Replace the entire programming queue. */
  async setProgramming(items) {
    const db = _getDb();
    if (!db) return { ok: false, message: 'Firestore unavailable' };
    try {
      // Delete existing
      const snap = await db.collection('channel').doc(this.channelId)
        .collection('programming').get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      // Add new
      const batch2 = db.batch();
      items.forEach((item, i) => {
        const ref = db.collection('channel').doc(this.channelId)
          .collection('programming').doc();
        batch2.set(ref, { ...item, sortOrder: (i + 1) * 10, createdAt: Date.now() });
      });
      await batch2.commit();
      await this.loadProgramming();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  /** Set the entire fallback queue. */
  async setFallback(items) {
    const db = _getDb();
    if (!db) return { ok: false, message: 'Firestore unavailable' };
    try {
      const snap = await db.collection('channel').doc(this.channelId)
        .collection('fallback').get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      const batch2 = db.batch();
      items.forEach((item, i) => {
        const ref = db.collection('channel').doc(this.channelId)
          .collection('fallback').doc();
        batch2.set(ref, { ...item, sortOrder: (i + 1) * 10, createdAt: Date.now() });
      });
      await batch2.commit();
      await this.loadProgramming();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  // ── Private: live camera watchdog ─────────────────────────────────────────

  _startLiveCheck() {
    clearInterval(this.liveCheckTimer);
    this.liveCheckTimer = setInterval(() => {
      if (!this.liveSession) return;
      const age = Date.now() - this.liveSession.lastHeartbeat;
      if (age > LIVE_HEARTBEAT_TIMEOUT) {
        logger.warn(`[ChannelEngine] Live heartbeat expired (${Math.round(age/1000)}s) — auto-switching to fallback`);
        this._onLiveEnded('heartbeat_timeout');
      }
    }, 5_000);
  }

  _onLiveEnded(reason) {
    logger.info(`[ChannelEngine] Live ended (${reason}) — transitioning to next program`);
    this.liveSession = null;
    clearInterval(this.liveCheckTimer);
    this.liveCheckTimer = null;
    // Push live item to history
    if (this.currentItem) this._pushHistory(this.currentItem);
    this.status = STATUS.TRANSITIONING;
    this._publishState();
    // Small delay for transition, then advance
    setTimeout(() => this._advance(), 1_500);
  }

  // ── Private: scheduling ──────────────────────────────────────────────────

  /**
   * Advance to the next programming item.
   * Priority:
   *   1. Scheduled programming queue (items not yet played, in order)
   *   2. Fallback queue (loops)
   *   3. If both empty: ONLINE status, waiting
   */
  _advance() {
    if (!this.isRunning) return;
    // Guard: if a previous _advance() is still in the microtask queue, drop this call.
    // This prevents a second timer firing before the first has cleared itself.
    if (this._advancing) {
      logger.debug('[ChannelEngine] _advance() reentrance blocked');
      return;
    }
    this._advancing = true;

    clearTimeout(this.itemTimer);
    this.itemTimer = null;

    // Push current item to history
    if (this.currentItem && this.currentItem.type !== TYPES.LIVE_CAMERA) {
      this._pushHistory(this.currentItem);
    }

    // Find next item from program queue
    const next = this._getNextProgramItem();

    if (next) {
      this._playItem(next, 'program');
    } else if (this.fallbackQueue.length > 0) {
      const fb = this._getFallbackItem();
      this._playItem(fb, 'fallback');
    } else {
      // No content — stay online, schedule a re-check in 30 s in case new content is added
      this.currentItem   = null;
      this.itemStartedAt = 0;
      this.status        = STATUS.ONLINE;
      logger.info('[ChannelEngine] No programming or fallback — channel online, waiting for content');
      this._publishState();
      // Re-check every 30 s so the channel auto-starts when content is added
      clearTimeout(this.itemTimer);
      this.itemTimer = setTimeout(() => this._advance(), 30_000);
    }

    this._advancing = false;
  }

  _getNextProgramItem() {
    if (!this.programQueue.length) return null;
    // Find first item not yet played in this pass
    const now = Date.now();
    for (const item of this.programQueue) {
      if (!item._playedAt) {
        // Mark it as played so we don't play it again in the same pass
        item._playedAt = now;
        return item;
      }
    }
    // All played — reset and loop
    this.programQueue.forEach(i => { i._playedAt = 0; });
    const first = this.programQueue[0];
    if (first) first._playedAt = now;
    return first || null;
  }

  _getFallbackItem() {
    if (!this.fallbackQueue.length) return null;
    const item = this.fallbackQueue[this.fallbackIndex % this.fallbackQueue.length];
    this.fallbackIndex++;
    return item;
  }

  _getNextItem() {
    // Peek — do not consume
    if (this.programQueue.length > 0) {
      const next = this.programQueue.find(i => !i._playedAt);
      if (next) return next;
      return this.programQueue[0] || null;
    }
    if (this.fallbackQueue.length > 0) {
      return this.fallbackQueue[this.fallbackIndex % this.fallbackQueue.length] || null;
    }
    return null;
  }

  _playItem(item, source) {
    if (!item) return;

    logger.info(`[ChannelEngine] Playing item type=${item.type} title="${item.title}" source=${source}`);

    this.currentItem   = item;
    this.itemStartedAt = Date.now();
    this.status        = item.type === TYPES.LIVE_CAMERA ? STATUS.LIVE
                       : source === 'fallback' ? STATUS.FALLBACK
                       : STATUS.PLAYING;

    // Duration-based advance timer — always schedule for non-live items.
    // clearTimeout first to ensure only ONE timer is active at a time.
    clearTimeout(this.itemTimer);
    this.itemTimer = null;

    const durationMs = this._itemDurationMs(item);
    if (item.type !== TYPES.LIVE_CAMERA) {
      logger.info(`[ChannelEngine] Item "${item.title}" scheduled for ${Math.round(durationMs/1000)}s`);
      this.itemTimer = setTimeout(() => this._advance(), durationMs);
    }

    this._publishState();
  }

  _itemDurationMs(item) {
    if (!item) return 0;
    // For LIVE_CAMERA — duration is unknown (ends on heartbeat timeout)
    if (item.type === TYPES.LIVE_CAMERA) return 0;
    // Explicit duration in seconds
    if (item.duration && item.duration > 0) return item.duration * 1000;
    // Slideshows: images × perImageSecs
    if (item.type === TYPES.SLIDESHOW && item.images && item.perImageSecs) {
      return item.images.length * item.perImageSecs * 1000;
    }
    return DEFAULT_ITEM_DURATION;
  }

  // ── Private: heartbeat ──────────────────────────────────────────────────

  _startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.isRunning) return;
      this._publishState();
    }, HEARTBEAT_INTERVAL_MS);
  }

  // ── Private: Firestore ───────────────────────────────────────────────────

  async _publishState() {
    const db = _getDb();
    if (!db) return;

    const item      = this.currentItem;
    const elapsed   = item ? Math.floor((Date.now() - this.itemStartedAt) / 1000) : 0;
    const dur       = item?.duration || 0;
    const remaining = dur > 0 ? Math.max(0, dur - elapsed) : 0;
    const nextItem  = this._getNextItem();

    // For LIVE_CAMERA items, surface the HLS URL from the liveSession so viewers
    // can actually play the stream. The hlsUrl is stored on the stream doc in Firestore
    // but we pass it through startLive() which already knows it.
    let effectiveMediaUrl = item?.mediaUrl || item?.mediaUrls?.[0] || null;
    if (this.status === STATUS.LIVE && this.liveSession?.hlsUrl) {
      effectiveMediaUrl = this.liveSession.hlsUrl;
    }

    const doc = {
      channelId:      this.channelId,
      status:         this.status,
      running:        this.isRunning,
      // Current item (safe fields only)
      programType:    item?.type    || null,
      programTitle:   item?.title   || null,
      mediaUrl:       effectiveMediaUrl,
      mediaId:        item?.id      || null,
      artist:         item?.artist  || null,
      coverArt:       item?.coverArt || null,
      images:         item?.images  || null,
      perImageSecs:   item?.perImageSecs || null,
      // Tracks array for MUSIC/AUDIO items — sent to viewer so the client
      // can advance through individual tracks without a separate server tick.
      tracks:         (item?.tracks && item.tracks.length > 0) ? item.tracks : null,
      shuffle:        item?.shuffle || false,
      repeat:         item?.repeat  !== false,
      live:           this.status === STATUS.LIVE,
      streamId:       this.liveSession?.streamId || null,
      hlsUrl:         this.liveSession?.hlsUrl || null,
      startedAt:      this.itemStartedAt,
      elapsed,
      remaining,
      duration:       dur,
      serverTime:     Date.now(),
      // Next item
      nextType:       nextItem?.type  || null,
      nextTitle:      nextItem?.title || null,
      nextMediaUrl:   nextItem?.mediaUrl || null,
      // History
      recentlyPlayed: this.history.slice(-5),
      // Source-type fields — required for YouTube and storage player routing.
      // Never expose null as 'youtube' — only pass youtubeId when it's actually set.
      sourceType:     item?.sourceType  || 'direct',
      sourceUrl:      item?.sourceUrl   || effectiveMediaUrl || null,
      youtubeId:      item?.youtubeId   || null,
    };

    try {
      await db.collection('channelNowPlaying').doc(this.channelId).set(doc, { merge: false });
    } catch (e) {
      logger.warn('[ChannelEngine] publishState failed: ' + e.message);
    }
  }

  // ── Private: history ─────────────────────────────────────────────────────

  _pushHistory(item) {
    if (!item) return;
    this.history.push({
      id:         item.id,
      type:       item.type,
      title:      item.title,
      artist:     item.artist || null,
      coverArt:   item.coverArt || null,
      playedAt:   Date.now(),
      duration:   item.duration || 0,
    });
    // Keep last 20
    if (this.history.length > 20) this.history.shift();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton accessor
// ═══════════════════════════════════════════════════════════════════════════

function getChannel() {
  if (!_channel) _channel = new ChannelEngine();
  return _channel;
}

/**
 * Initialize and start the channel engine on server startup.
 * Loads programming from Firestore, restores channel state, begins scheduling.
 */
async function initChannel() {
  const ch = getChannel();

  const db = _getDb();
  if (!db) {
    logger.warn('[ChannelEngine] Firestore not available — starting channel without persistence');
    ch.start();
    return ch;
  }

  // Load channel config
  try {
    const snap = await db.collection('channel').doc(ch.channelId).get();
    if (!snap.exists) {
      // First run — create the channel document
      await db.collection('channel').doc(ch.channelId).set({
        channelId:   ch.channelId,
        name:        'AVENORA 24-HOUR CHANNEL',
        description: 'The always-on AVENORA channel',
        status:      STATUS.OFFLINE,
        createdAt:   Date.now(),
      });
      logger.info('[ChannelEngine] Created channel document in Firestore');
    }
  } catch (e) {
    logger.warn('[ChannelEngine] Could not read/create channel doc: ' + e.message);
  }

  // Load programming
  await ch.loadProgramming();

  // Restore state from Firestore (check channelNowPlaying for last known state)
  try {
    const np = await db.collection('channelNowPlaying').doc(ch.channelId).get();
    if (np.exists) {
      const d = np.data();
      if (d.running && d.status !== STATUS.OFFLINE) {
        logger.info(`[ChannelEngine] Recovering running channel — last status: ${d.status}`);
        // Restore will pick up from the correct position
        ch.isRunning   = true;
        ch.status      = d.status === STATUS.LIVE ? STATUS.TRANSITIONING : d.status; // can't restore live safely
        ch.itemStartedAt = d.startedAt || Date.now();
        // Find the current item in programming
        if (d.mediaId) {
          const item = ch.programQueue.find(i => i.id === d.mediaId) || ch.fallbackQueue.find(i => i.id === d.mediaId);
          if (item) {
            const elapsed   = Math.floor((Date.now() - ch.itemStartedAt) / 1000);
            const itemDur   = item.duration || 0;
            const remaining = itemDur > 0 ? Math.max(0, itemDur - elapsed) : 0;
            if (remaining > 5) {
              ch.currentItem = item;
              logger.info(`[ChannelEngine] Restored item "${item.title}", ${remaining}s remaining`);
              ch._startHeartbeat();
              // Schedule advance for remaining duration
              clearTimeout(ch.itemTimer);
              ch.itemTimer = setTimeout(() => ch._advance(), remaining * 1000);
              await ch._publishState();
              return ch;
            }
          }
        }
      }
    }
  } catch (e) {
    logger.warn('[ChannelEngine] Recovery state read failed: ' + e.message);
  }

  // Fresh start
  ch.start();
  return ch;
}

// Graceful shutdown
process.on('SIGTERM', () => {
  if (_channel) _channel.stop();
  logger.info('[ChannelEngine] SIGTERM — channel stopped');
});
process.on('SIGINT', () => {
  if (_channel) _channel.stop();
  logger.info('[ChannelEngine] SIGINT — channel stopped');
});

module.exports = {
  getChannel,
  initChannel,
  TYPES,
  STATUS,
  CHANNEL_ID,
};
