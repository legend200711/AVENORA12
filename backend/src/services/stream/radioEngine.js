/**
 * AVENORA RADIO ENGINE
 *
 * Persistent server-side radio station.
 *
 * KEY DIFFERENCES from cloudRadioEngine:
 *   - A single authoritative station (radioStations/avenoraRadio) instead of
 *     per-user broadcast sessions.
 *   - NO expiry / 24-hour countdown — the station runs until an admin pauses it.
 *   - The engine manages one singleton RadioStation instance.
 *   - On server restart the station automatically recovers from Firestore.
 *   - Listeners subscribe to stationNowPlaying/avenoraRadio via Firestore
 *     onSnapshot. They calculate elapsed time from trackStartedAt and play
 *     the audio URL directly — no media server required.
 *
 * Firestore documents:
 *   radioStations/avenoraRadio          — authoritative station state
 *   stationNowPlaying/avenoraRadio      — current track + queue (updated every heartbeat)
 *
 * Design:
 *   Server controls: current track, queue, track advance, repeat/shuffle.
 *   Listener browsers: subscribe via Firestore, play audio URL, seek to elapsed offset.
 *   Admin browser:    sends skip/pause/resume/add commands via API only.
 */

'use strict';

const logger = require('../../utils/logger');

// ─── Constants ────────────────────────────────────────────
const STATION_ID              = 'avenoraRadio';
const HEARTBEAT_INTERVAL_MS   = 10_000;   // publish Now Playing every 10s
const DEFAULT_TRACK_DURATION_MS = 240_000; // fallback if duration unknown (4 min)
const MAX_CONSECUTIVE_ERRORS  = 5;
const ERROR_PAUSE_MS          = 30_000;

// ─── Firebase Admin SDK ───────────────────────────────────
let _db = null;
function _getDb() {
  if (_db) return _db;
  try {
    const { getDb } = require('../../config/firestore');
    _db = getDb();
    return _db;
  } catch {
    return null;
  }
}

// ─── Station singleton ────────────────────────────────────
let _station = null;

// ─── RadioStation class ───────────────────────────────────

class RadioStation {
  constructor(opts = {}) {
    this.stationId   = STATION_ID;
    this.stationName = opts.stationName || 'AVENORA RADIO';
    this.description = opts.description || '24 HOURS • 7 DAYS • ALWAYS PLAYING';

    // Playlist — array of track objects
    this.playlist    = opts.playlist || [];
    this.shuffle     = !!opts.shuffle;
    this.repeat      = opts.repeat !== false;    // default true

    // Playback state
    this.currentIndex     = opts.currentIndex || 0;
    this.trackStartedAt   = opts.trackStartedAt || 0; // Date.now() when track started
    this.consecutiveErrors = 0;
    this.isRunning        = false;
    this.status           = 'stopped';   // stopped | playing | paused | error

    // Internal timers
    this._heartbeatTimer = null;
    this._advanceTimer   = null;
  }

  // ── Public controls ───────────────────────────────────────

  start() {
    if (this.isRunning) return;
    if (!this.playlist.length) {
      this.status = 'error';
      this._publishError('Station has no tracks');
      return;
    }
    if (this.shuffle && this.currentIndex === 0) this._shufflePlaylist();

    this.isRunning = true;
    this.status    = 'playing';

    // If recovering mid-track, trackStartedAt is already set. Otherwise begin fresh.
    if (!this.trackStartedAt) this.trackStartedAt = Date.now();

    logger.info(`[Radio] Station started — ${this.playlist.length} tracks, repeat=${this.repeat}, shuffle=${this.shuffle}`);

    this._scheduleAdvance();
    this._startHeartbeat();
    this._publishNowPlaying();
    this._persistState();
  }

  pause() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.status    = 'paused';
    clearTimeout(this._advanceTimer);
    clearInterval(this._heartbeatTimer);
    this._advanceTimer   = null;
    this._heartbeatTimer = null;
    this._publishNowPlaying();
    this._persistState();
    logger.info('[Radio] Station paused');
  }

  resume() {
    if (this.isRunning || this.status === 'playing') return;
    if (!this.playlist.length) return;

    // Recalculate remaining time for current track
    const track = this._currentTrack();
    if (!track) return;

    const durationMs = this._trackDurationMs(track);
    const elapsed    = Date.now() - this.trackStartedAt;

    // If track already finished during pause, advance first
    if (elapsed >= durationMs) {
      this.isRunning = true;
      this.status    = 'playing';
      this._advanceTrack();
      return;
    }

    this.isRunning = true;
    this.status    = 'playing';
    logger.info('[Radio] Station resumed');
    this._scheduleAdvance();
    this._startHeartbeat();
    this._publishNowPlaying();
    this._persistState();
  }

  skip() {
    if (!this.isRunning) return;
    clearTimeout(this._advanceTimer);
    this._advanceTrack();
  }

  /** Replace the full playlist. If station is playing, keep playing from index 0. */
  setPlaylist(tracks, opts = {}) {
    this.playlist = [...tracks];
    if (opts.shuffle !== undefined) this.shuffle = !!opts.shuffle;
    if (opts.repeat  !== undefined) this.repeat  = opts.repeat !== false;
    if (this.shuffle) this._shufflePlaylist();
    this.currentIndex   = 0;
    this.trackStartedAt = Date.now();
    if (this.isRunning) {
      clearTimeout(this._advanceTimer);
      clearInterval(this._heartbeatTimer);
      this._advanceTimer   = null;
      this._heartbeatTimer = null;
      this._scheduleAdvance();
      this._startHeartbeat();
      this._publishNowPlaying();
    }
    this._persistState();
    logger.info(`[Radio] Playlist updated — ${this.playlist.length} tracks`);
  }

  /** Add a track to the end of the playlist. */
  addTrack(track) {
    this.playlist.push(track);
    this._publishNowPlaying();
    this._persistState();
  }

  /** Remove a track by id. Adjust currentIndex if needed. */
  removeTrack(trackId) {
    const idx = this.playlist.findIndex(t => t.id === trackId);
    if (idx === -1) return false;

    const wasCurrentlyPlaying = (idx === this.currentIndex);
    this.playlist.splice(idx, 1);

    if (this.playlist.length === 0) {
      this.pause();
      return true;
    }

    if (idx < this.currentIndex) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    } else if (wasCurrentlyPlaying) {
      // Skip to next (mod so we wrap)
      this.currentIndex = this.currentIndex % this.playlist.length;
      this.trackStartedAt = Date.now();
      if (this.isRunning) {
        clearTimeout(this._advanceTimer);
        this._scheduleAdvance();
      }
    }

    this._publishNowPlaying();
    this._persistState();
    return true;
  }

  /** Move a track from one index to another. */
  reorderTrack(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.playlist.length) return false;
    if (toIdx   < 0 || toIdx   >= this.playlist.length) return false;
    const [track] = this.playlist.splice(fromIdx, 1);
    this.playlist.splice(toIdx, 0, track);
    this._publishNowPlaying();
    this._persistState();
    return true;
  }

  /** Return the current status snapshot for the API. */
  getStatus() {
    const track   = this._currentTrack();
    const elapsed = track && this.trackStartedAt
      ? Math.max(0, Math.floor((Date.now() - this.trackStartedAt) / 1000))
      : 0;
    const duration = track ? (track.duration || DEFAULT_TRACK_DURATION_MS / 1000) : 0;
    const remaining = track ? Math.max(0, duration - elapsed) : 0;

    const upcoming = [];
    if (this.playlist.length > 1) {
      for (let i = 1; i <= 5; i++) {
        const t = this.playlist[(this.currentIndex + i) % this.playlist.length];
        if (t) upcoming.push({ id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl || null });
      }
    }

    return {
      stationId:    this.stationId,
      stationName:  this.stationName,
      description:  this.description,
      status:       this.status,
      running:      this.isRunning,
      currentTrack: track ? {
        id:          track.id,
        title:       track.title,
        artist:      track.artist,
        album:       track.album || '',
        coverUrl:    track.coverUrl || null,
        url:         track.url,
        duration,
        elapsed,
        remaining,
      } : null,
      upcoming,
      currentIndex:  this.currentIndex,
      playlistLength: this.playlist.length,
      trackStartedAt: this.trackStartedAt,
      serverTime:     Date.now(),
      shuffle:        this.shuffle,
      repeat:         this.repeat,
    };
  }

  // ── Private helpers ──────────────────────────────────────

  _currentTrack() {
    if (!this.playlist.length) return null;
    return this.playlist[this.currentIndex] || null;
  }

  _trackDurationMs(track) {
    if (track && track.duration > 0) return track.duration * 1000;
    return DEFAULT_TRACK_DURATION_MS;
  }

  _scheduleAdvance() {
    clearTimeout(this._advanceTimer);
    const track = this._currentTrack();
    if (!track) return;

    const durationMs = this._trackDurationMs(track);
    const elapsed    = this.trackStartedAt ? Date.now() - this.trackStartedAt : 0;
    const remaining  = Math.max(0, durationMs - elapsed);

    logger.info(`[Radio] "${track.title || '?'}" — ${Math.round(remaining / 1000)}s remaining`);
    this._advanceTimer = setTimeout(() => this._advanceTrack(), remaining);
  }

  _advanceTrack() {
    if (!this.isRunning) return;
    if (!this.playlist.length) {
      this.status = 'error';
      this._publishError('Playlist is empty');
      return;
    }

    const total     = this.playlist.length;
    const wasIndex  = this.currentIndex;
    const nextIndex = (wasIndex + 1) % total;

    // If we've looped and repeat is off → stop
    if (nextIndex === 0 && !this.repeat && wasIndex === total - 1) {
      logger.info('[Radio] Playlist complete, repeat=false — pausing');
      this.pause();
      return;
    }

    this.currentIndex      = nextIndex;
    this.trackStartedAt    = Date.now();
    this.consecutiveErrors = 0;

    const track = this._currentTrack();
    if (!track || !track.url) {
      this.consecutiveErrors++;
      logger.warn(`[Radio] Track at index ${nextIndex} has no URL — skipping`);
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error(`[Radio] ${MAX_CONSECUTIVE_ERRORS} consecutive missing URLs — pausing ${ERROR_PAUSE_MS / 1000}s`);
        this._advanceTimer = setTimeout(() => {
          this.consecutiveErrors = 0;
          this._advanceTrack();
        }, ERROR_PAUSE_MS);
        return;
      }
      setTimeout(() => this._advanceTrack(), 500);
      return;
    }

    logger.info(`[Radio] → "${track.title}" (index ${nextIndex}/${total})`);
    this._publishNowPlaying();
    this._scheduleAdvance();
    this._persistState();
  }

  _startHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      if (!this.isRunning) return;
      this._publishNowPlaying();
    }, HEARTBEAT_INTERVAL_MS);
  }

  async _publishNowPlaying() {
    const db = _getDb();
    if (!db) return;

    const track = this._currentTrack();
    const elapsed = track && this.trackStartedAt
      ? Math.max(0, Math.floor((Date.now() - this.trackStartedAt) / 1000))
      : 0;

    // Build upcoming queue (next 10 tracks)
    const upcoming = [];
    if (this.playlist.length > 1) {
      for (let i = 1; i <= 10; i++) {
        const t = this.playlist[(this.currentIndex + i) % this.playlist.length];
        if (t) upcoming.push({ id: t.id || '', title: t.title || '', artist: t.artist || '', coverUrl: t.coverUrl || null, duration: t.duration || 0 });
      }
    }

    // Recently played (last 10 before current)
    const recent = [];
    for (let i = 1; i <= 10; i++) {
      const idx = ((this.currentIndex - i) + this.playlist.length) % this.playlist.length;
      if (idx !== this.currentIndex) {
        const t = this.playlist[idx];
        if (t) recent.push({ id: t.id || '', title: t.title || '', artist: t.artist || '', coverUrl: t.coverUrl || null });
      }
    }

    const nowPlayingDoc = {
      stationId:        this.stationId,
      stationName:      this.stationName,
      status:           this.status,
      currentTrackId:   track?.id        || '',
      currentTitle:     track?.title     || '',
      currentArtist:    track?.artist    || '',
      currentAlbum:     track?.album     || '',
      currentCoverUrl:  track?.coverUrl  || null,
      currentUrl:       track?.url       || '',
      currentDuration:  track?.duration  || 0,
      currentElapsed:   elapsed,
      trackStartedAt:   this.trackStartedAt || 0,
      currentIndex:     this.currentIndex,
      playlistLength:   this.playlist.length,
      upcoming,
      recentlyPlayed:   recent,
      serverTime:       Date.now(),
      updatedAt:        Date.now(),
    };

    try {
      await db.collection('stationNowPlaying').doc(this.stationId).set(nowPlayingDoc, { merge: true });
    } catch (err) {
      logger.warn(`[Radio] NowPlaying write failed: ${err.message}`);
    }
  }

  async _persistState() {
    const db = _getDb();
    if (!db) return;
    try {
      await db.collection('radioStations').doc(this.stationId).set({
        stationName:   this.stationName,
        description:   this.description,
        active:        this.isRunning,
        status:        this.status,
        currentIndex:  this.currentIndex,
        trackStartedAt: this.trackStartedAt || 0,
        playlist:      this.playlist.map(t => ({
          id:          t.id || '',
          title:       t.title || '',
          artist:      t.artist || '',
          album:       t.album || '',
          genre:       t.genre || '',
          coverUrl:    t.coverUrl || null,
          url:         t.url || '',
          duration:    t.duration || 0,
          storagePath: t.storagePath || '',
          uploadedBy:  t.uploadedBy || '',
        })),
        shuffle:       this.shuffle,
        repeat:        this.repeat,
        updatedAt:     Date.now(),
      }, { merge: true });
    } catch (err) {
      logger.warn(`[Radio] State persist failed: ${err.message}`);
    }
  }

  async _publishError(msg) {
    logger.error(`[Radio] Error: ${msg}`);
    const db = _getDb();
    if (!db) return;
    try {
      await db.collection('radioStations').doc(this.stationId).set({
        status: 'error', lastError: msg, updatedAt: Date.now(),
      }, { merge: true });
    } catch {}
  }

  _shufflePlaylist() {
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    }
  }

  destroy() {
    clearTimeout(this._advanceTimer);
    clearInterval(this._heartbeatTimer);
    this._advanceTimer   = null;
    this._heartbeatTimer = null;
    this.isRunning = false;
    this.status    = 'stopped';
  }
}

// ─── Public API ───────────────────────────────────────────

/** Get or create the singleton station instance. */
function getStation() {
  return _station;
}

/**
 * Recover station from Firestore on server start.
 * Non-fatal — server still starts if Firestore is unavailable.
 */
async function recoverStation() {
  const db = _getDb();
  if (!db) {
    logger.warn('[Radio] Recovery skipped — Firestore not available');
    return;
  }

  try {
    const snap = await db.collection('radioStations').doc(STATION_ID).get();
    if (!snap.exists) {
      logger.info('[Radio] No station document found — station is idle until admin creates one');
      return;
    }

    const data = snap.data();
    if (!data.active && data.status !== 'playing') {
      logger.info(`[Radio] Station exists but was not playing (status=${data.status}) — not auto-resuming`);
      // Still create the instance so status queries work
      _station = new RadioStation({
        stationName:   data.stationName,
        description:   data.description,
        playlist:      data.playlist || [],
        shuffle:       data.shuffle,
        repeat:        data.repeat,
        currentIndex:  data.currentIndex || 0,
        trackStartedAt: 0,
      });
      return;
    }

    const playlist = data.playlist || [];
    if (!playlist.length) {
      logger.info('[Radio] Station has no tracks — starting idle');
      _station = new RadioStation({ stationName: data.stationName, description: data.description });
      return;
    }

    let currentIndex   = typeof data.currentIndex === 'number' ? data.currentIndex : 0;
    let trackStartedAt = typeof data.trackStartedAt === 'number' ? data.trackStartedAt : Date.now();

    // Clamp index
    currentIndex = Math.max(0, Math.min(currentIndex, playlist.length - 1));

    // Calculate how much of the current track has already elapsed.
    // Advance past tracks that have already finished.
    const now = Date.now();
    let elapsedMs = now - trackStartedAt;

    while (elapsedMs > 0) {
      const t = playlist[currentIndex];
      const dMs = (t && t.duration > 0) ? t.duration * 1000 : DEFAULT_TRACK_DURATION_MS;
      if (elapsedMs < dMs) break; // still in this track
      elapsedMs -= dMs;
      currentIndex = (currentIndex + 1) % playlist.length;
      if (!data.repeat && currentIndex === 0) {
        // Playlist finished, station would have stopped
        logger.info('[Radio] Recovery: playlist ended (repeat=false) — not resuming');
        _station = new RadioStation({ stationName: data.stationName, description: data.description, playlist, shuffle: data.shuffle, repeat: data.repeat });
        return;
      }
    }

    // trackStartedAt for the recovered track = now - elapsedMs within this track
    trackStartedAt = now - elapsedMs;

    _station = new RadioStation({
      stationName:   data.stationName || 'AVENORA RADIO',
      description:   data.description || '24 HOURS • 7 DAYS • ALWAYS PLAYING',
      playlist,
      shuffle:       data.shuffle === true,
      repeat:        data.repeat !== false,
      currentIndex,
      trackStartedAt,
    });

    // Manually start (skip shuffle since we're restoring a specific position)
    _station.isRunning     = true;
    _station.status        = 'playing';
    _station._scheduleAdvance();
    _station._startHeartbeat();
    await _station._publishNowPlaying();
    await _station._persistState();

    const cur = _station._currentTrack();
    logger.info(`[Radio] Recovered — "${cur?.title || '?'}" at index ${currentIndex}/${playlist.length}`);

  } catch (err) {
    logger.error(`[Radio] Recovery failed: ${err.message}`);
  }
}

/**
 * Initialize the station from admin (called by API route).
 * Creates or replaces the singleton.
 */
function initStation(opts) {
  if (_station) _station.destroy();
  _station = new RadioStation(opts);
  return _station;
}

/**
 * Ensure a station instance exists (creates idle one if needed).
 */
function ensureStation() {
  if (!_station) {
    _station = new RadioStation();
  }
  return _station;
}

// ─── Graceful shutdown ────────────────────────────────────
process.on('SIGTERM', () => {
  if (_station) { _station.pause(); _station.destroy(); }
  logger.info('[Radio] SIGTERM — station stopped');
});
process.on('SIGINT', () => {
  if (_station) { _station.pause(); _station.destroy(); }
  logger.info('[Radio] SIGINT — station stopped');
});

module.exports = {
  STATION_ID,
  getStation,
  ensureStation,
  initStation,
  recoverStation,
};
