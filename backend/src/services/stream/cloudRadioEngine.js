/**
 * AVENORA — Cloud Radio Engine
 *
 * Real server-side 24-hour cloud radio.
 *
 * Design:
 *   - The engine runs entirely in Node.js, no ffmpeg or RTMP required.
 *   - Audio files live in Supabase Storage (public `music` bucket) with
 *     permanent public URLs — no signed URLs needed.
 *   - The engine tracks elapsed playback time server-side using Date.now().
 *   - Every HEARTBEAT_INTERVAL_MS it publishes the current "Now Playing"
 *     state — including the public audio URL and the elapsed offset — to
 *     Firestore `studioCloudStreamMusic/{streamId}`.
 *   - Browser clients subscribe via onSnapshot, load the audio URL, seek to
 *     the elapsed offset, and play. This produces synchronized playback for
 *     all listeners without any media server.
 *   - When track duration expires (or skip is called) the engine advances
 *     the queue and immediately publishes the new state.
 *   - The engine writes `cloudStreams/{streamId}` workerStatus updates so the
 *     dashboard shows real status.
 *   - Tracks whose duration is 0 (not yet known) are advanced after
 *     DEFAULT_TRACK_DURATION_MS.
 *
 * Phone-independence:
 *   The engine runs inside the AVENORA backend Node.js process. As long as
 *   the backend server is running the broadcast continues regardless of
 *   whether the creator's browser is open.
 *
 * Multiple simultaneous broadcasts:
 *   Each broadcast has its own session keyed by streamId.  Sessions are
 *   independent and do not share state.
 *
 * Firestore writes:
 *   - studioCloudStreamMusic/{streamId}  — Now Playing state (every heartbeat)
 *   - cloudStreams/{streamId}            — workerStatus + lastHeartbeat
 *
 * Requires:
 *   - FIREBASE_PROJECT_ID in .env (uses Firestore REST API — no Admin SDK)
 *   - FIREBASE_WEB_API_KEY in .env (for token verification only — not used here)
 *   - Google Application Default Credentials OR a service-account key for
 *     Firestore REST writes.  If neither is configured the engine falls back
 *     to in-memory-only mode (Now Playing is NOT published to Firestore but
 *     the engine still advances tracks and exposes status via HTTP).
 */

'use strict';

const https  = require('https');
const logger = require('../../utils/logger');

// ─── Firebase Admin SDK — preferred for server-side Firestore writes ─────────
// Lazy-loaded so the engine still works even if firebase-admin is not installed
// (though it is in this project). The Admin SDK is used for:
//   1. Startup recovery — reading active cloudStreams documents
//   2. Now Playing writes — more reliable than REST + anonymous token
//
// Falls back to the existing REST-based path if Admin SDK is unavailable.
let _adminDb = null;
function _getAdminDb() {
  if (_adminDb) return _adminDb;
  try {
    const { getDb } = require('../../config/firestore');
    _adminDb = getDb();
    return _adminDb;
  } catch (_e) {
    return null;
  }
}

// ─── Constants ────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS    = 10_000;   // publish Now Playing every 10 s
const DEFAULT_TRACK_DURATION_MS = 240_000; // fallback if duration unknown (4 min)
const MAX_CONSECUTIVE_ERRORS    = 5;
const ERROR_PAUSE_MS            = 30_000;

// ─── Active broadcast sessions ────────────────────────────
// Map<streamId, Session>
const _sessions = new Map();

// ─── Firestore REST helper ────────────────────────────────
// We use the Firestore REST API so we don't need the Admin SDK or a
// service-account key file.  Writes are authenticated with the Firebase
// Web API key (public) via a server-side Firebase Auth anonymous sign-in,
// OR with a service-account access token if GOOGLE_APPLICATION_CREDENTIALS
// is set.  If neither works we degrade gracefully.

let _firestoreToken = null;          // cached bearer token
let _firestoreTokenExpiry = 0;       // unix ms when the token expires
let _firestoreAvailable = null;      // null = unknown, true/false after first attempt

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'avenora-6e147';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/**
 * Obtain a bearer token for Firestore REST writes.
 *
 * Strategy (tried in order):
 *   1. Google Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS
 *      or GCE metadata service) — used in production on GCP / Cloud Run / etc.
 *   2. Firebase anonymous sign-in using FIREBASE_WEB_API_KEY — works anywhere
 *      but the anonymous user has limited Firestore write access (depends on
 *      your Firestore rules — the rules in this project allow any authenticated
 *      user to write studioCloudStreamMusic).
 *   3. No-auth fallback — writes are skipped (engine still works locally).
 */
async function _getFirestoreToken() {
  // Return cached token if still valid (with 60 s buffer)
  if (_firestoreToken && Date.now() < _firestoreTokenExpiry - 60_000) {
    return _firestoreToken;
  }

  // Strategy 1: Google ADC via metadata server (GCE / Cloud Run / App Engine)
  try {
    const token = await _fetchGCEToken();
    if (token) {
      _firestoreToken   = token.access_token;
      _firestoreTokenExpiry = Date.now() + (token.expires_in || 3600) * 1000;
      _firestoreAvailable = true;
      return _firestoreToken;
    }
  } catch (_) {}

  // Strategy 2: Firebase anonymous sign-in
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (apiKey) {
    try {
      const resp = await _httpPost(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
        { returnSecureToken: true }
      );
      if (resp && resp.idToken) {
        _firestoreToken      = resp.idToken;
        // Firebase ID tokens expire after 1 hour
        _firestoreTokenExpiry = Date.now() + 55 * 60_000;
        _firestoreAvailable  = true;
        return _firestoreToken;
      }
    } catch (err) {
      logger.warn('[CloudRadio] Firebase anon sign-in failed: ' + err.message);
    }
  }

  _firestoreAvailable = false;
  return null;
}

function _fetchGCEToken() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
      (res) => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function _httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(options, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve(null); }
      });
    });
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('HTTP POST timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Write a Firestore document.
 * Prefers Admin SDK (reliable server-to-server auth) and falls back to REST.
 */
async function _firestorePatch(path, fields) {
  // ── Primary: Firebase Admin SDK ────────────────────────────────────────
  const db = _getAdminDb();
  if (db) {
    try {
      // path is like "studioCloudStreamMusic/streamId" or "cloudStreams/streamId"
      const parts = path.split('/');
      if (parts.length === 2) {
        const ref = db.collection(parts[0]).doc(parts[1]);
        // merge=true so we never wipe fields not included in `fields`
        await ref.set(fields, { merge: true });
        return;
      }
    } catch (adminErr) {
      logger.warn(`[CloudRadio] Admin SDK write failed (${path}): ${adminErr.message} — falling back to REST`);
      // fall through to REST
    }
  }

  // ── Fallback: REST API with bearer token ────────────────────────────────
  const token = await _getFirestoreToken();
  if (!token) return; // degraded mode — skip Firestore writes

  const body = JSON.stringify({ fields: _toFirestoreFields(fields) });
  const url  = `${FIRESTORE_BASE}/${path}`;

  return new Promise((resolve) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'PATCH',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization':  `Bearer ${token}`,
      },
    };
    const req = https.request(options, res => {
      res.resume(); // drain
      resolve();
    });
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

/** Convert a plain JS object to Firestore REST field format. */
function _toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out[k] = { nullValue: null };
    } else if (typeof v === 'boolean') {
      out[k] = { booleanValue: v };
    } else if (typeof v === 'number') {
      out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    } else if (typeof v === 'string') {
      out[k] = { stringValue: v };
    } else if (Array.isArray(v)) {
      out[k] = { arrayValue: { values: v.map(item => {
        const sub = _toFirestoreFields({ _: item });
        return sub._;
      }) } };
    } else if (typeof v === 'object') {
      out[k] = { mapValue: { fields: _toFirestoreFields(v) } };
    }
  }
  return out;
}

// ─── Session class ────────────────────────────────────────

class CloudRadioSession {
  /**
   * @param {object} opts
   * @param {string}   opts.streamId        — Firestore cloudStreams document ID
   * @param {string}   opts.uid             — owner's Firebase UID
   * @param {Array}    opts.queue           — [{id,title,artist,url,duration}, ...]
   * @param {boolean}  opts.shuffle
   * @param {boolean}  opts.repeat
   * @param {number}   opts.durationMinutes — max broadcast length
   */
  constructor(opts) {
    this.streamId        = opts.streamId;
    this.uid             = opts.uid;
    this.queue           = [...(opts.queue || [])];
    this.shuffle         = !!opts.shuffle;
    this.repeat          = opts.repeat !== false;
    this.durationMinutes = opts.durationMinutes || 1440;

    // Playback state
    this.queueIndex        = 0;
    this.trackStartedAt    = 0;   // Date.now() when current track started
    this.consecutiveErrors = 0;
    this.errorLog          = [];
    this.isRunning         = false;
    this.status            = 'starting'; // starting | running | error | stopped
    this.startedAt         = Date.now();
    this.expiresAt         = Date.now() + this.durationMinutes * 60_000;

    // Internal handles
    this._heartbeatTimer = null;
    this._advanceTimer   = null;
  }

  /** Start the session. */
  start() {
    if (this.isRunning) return;
    if (!this.queue.length) {
      this.status = 'error';
      this._publishError('No tracks in queue');
      return;
    }

    if (this.shuffle) this._shuffleQueue();

    this.isRunning     = true;
    this.status        = 'running';
    this.queueIndex    = 0;
    this.trackStartedAt = Date.now();

    logger.info(`[CloudRadio] Session ${this.streamId} started — ${this.queue.length} tracks, repeat=${this.repeat}`);

    this._scheduleAdvance();
    this._startHeartbeat();
    this._publishNowPlaying();
    this._publishWorkerStatus('running');
  }

  /** Stop the session. */
  stop() {
    this.isRunning = false;
    this.status    = 'stopped';
    clearTimeout(this._advanceTimer);
    clearInterval(this._heartbeatTimer);
    this._advanceTimer   = null;
    this._heartbeatTimer = null;
    this._publishWorkerStatus('stopped');
    this._publishStoppedState();
    logger.info(`[CloudRadio] Session ${this.streamId} stopped`);
  }

  /** Skip to the next track immediately. */
  skip() {
    if (!this.isRunning) return;
    clearTimeout(this._advanceTimer);
    this._advanceTrack();
  }

  /** Return a status snapshot for the HTTP API. */
  getStatus() {
    const track = this.queue[this.queueIndex] || null;
    const elapsed = track ? Math.floor((Date.now() - this.trackStartedAt) / 1000) : 0;
    const remaining = track
      ? Math.max(0, (track.duration || DEFAULT_TRACK_DURATION_MS / 1000) - elapsed)
      : 0;
    return {
      status:        this.status,
      running:       this.isRunning,
      streamId:      this.streamId,
      currentTrack:  track ? { ...track, elapsed, remaining } : null,
      nextTrack:     this.queue[(this.queueIndex + 1) % Math.max(1, this.queue.length)] || null,
      queueIndex:    this.queueIndex,
      queueLength:   this.queue.length,
      shuffle:       this.shuffle,
      repeat:        this.repeat,
      startedAt:     this.startedAt,
      expiresAt:     this.expiresAt,
      recentErrors:  this.errorLog.slice(-5),
    };
  }

  // ── Private ─────────────────────────────────────────────

  _currentTrack() {
    return this.queue[this.queueIndex] || null;
  }

  _nextTrack() {
    const nextIdx = (this.queueIndex + 1) % Math.max(1, this.queue.length);
    return this.queue[nextIdx] || null;
  }

  _trackDurationMs(track) {
    if (track && track.duration && track.duration > 0) {
      return track.duration * 1000;
    }
    return DEFAULT_TRACK_DURATION_MS;
  }

  _scheduleAdvance() {
    clearTimeout(this._advanceTimer);
    const track = this._currentTrack();
    const ms    = this._trackDurationMs(track);
    logger.info(`[CloudRadio] ${this.streamId} — track "${track?.title || '?'}" scheduled for ${Math.round(ms/1000)}s`);
    this._advanceTimer = setTimeout(() => this._advanceTrack(), ms);
  }

  _advanceTrack() {
    if (!this.isRunning) return;

    const wasIndex = this.queueIndex;
    const total    = this.queue.length;

    if (total === 0) {
      this.status = 'error';
      this._publishError('Queue is empty');
      return;
    }

    const nextIndex = (wasIndex + 1) % total;

    // If we've looped back and repeat is off → stop
    if (nextIndex === 0 && !this.repeat && wasIndex === total - 1) {
      logger.info(`[CloudRadio] ${this.streamId} — playlist complete, repeat=false, stopping`);
      this.stop();
      return;
    }

    // Check expiry
    if (Date.now() >= this.expiresAt) {
      logger.info(`[CloudRadio] ${this.streamId} — broadcast expired`);
      this.stop();
      return;
    }

    this.queueIndex    = nextIndex;
    this.trackStartedAt = Date.now();
    this.consecutiveErrors = 0;

    const track = this._currentTrack();
    if (!track || !track.url) {
      this.consecutiveErrors++;
      logger.warn(`[CloudRadio] ${this.streamId} — track at index ${nextIndex} has no URL, skipping`);
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error(`[CloudRadio] ${this.streamId} — ${MAX_CONSECUTIVE_ERRORS} consecutive missing URLs, pausing ${ERROR_PAUSE_MS/1000}s`);
        this._advanceTimer = setTimeout(() => {
          this.consecutiveErrors = 0;
          this._advanceTrack();
        }, ERROR_PAUSE_MS);
        return;
      }
      // Skip immediately to next
      setTimeout(() => this._advanceTrack(), 500);
      return;
    }

    logger.info(`[CloudRadio] ${this.streamId} — advancing to "${track.title}" (index ${nextIndex})`);
    this._publishNowPlaying();
    this._scheduleAdvance();
  }

  _startHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      if (!this.isRunning) return;
      // Check expiry every heartbeat
      if (Date.now() >= this.expiresAt) {
        logger.info(`[CloudRadio] ${this.streamId} — broadcast expired (heartbeat check)`);
        this.stop();
        return;
      }
      this._publishNowPlaying();
    }, HEARTBEAT_INTERVAL_MS);
  }

  async _publishNowPlaying() {
    const track   = this._currentTrack();
    const next    = this._nextTrack();
    const elapsed = track ? Math.floor((Date.now() - this.trackStartedAt) / 1000) : 0;

    if (!track) return;

    const nowPlayingDoc = {
      cloudStreamId:    this.streamId,
      uid:              this.uid,
      // Full queue — browser clients use this for display
      queue:            this.queue.map(t => ({
        id:       t.id       || '',
        title:    t.title    || '',
        artist:   t.artist   || '',
        url:      t.url      || '',
        duration: t.duration || 0,
        storagePath: t.storagePath || '',
      })),
      currentTrackId:   track.id       || '',
      currentTitle:     track.title    || '',
      currentArtist:    track.artist   || '',
      currentTrackUrl:  track.url      || '',
      currentDuration:  track.duration || 0,
      currentElapsed:   elapsed,         // seconds elapsed — clients seek to this
      trackStartedAt:   this.trackStartedAt,  // epoch ms — clients compute elapsed
      queueIndex:       this.queueIndex,
      nextTrackId:      next?.id       || '',
      nextTitle:        next?.title    || '',
      nextArtist:       next?.artist   || '',
      status:           'playing',
      serverTime:       Date.now(),      // clients use this to correct clock skew
    };

    try {
      await _firestorePatch(`studioCloudStreamMusic/${this.streamId}`, nowPlayingDoc);
    } catch (err) {
      logger.warn(`[CloudRadio] ${this.streamId} — Firestore NowPlaying write failed: ${err.message}`);
    }
  }

  async _publishWorkerStatus(workerStatus) {
    try {
      await _firestorePatch(`cloudStreams/${this.streamId}`, {
        workerStatus,
        lastHeartbeat: Date.now(),
      });
    } catch (_) {}
  }

  async _publishStoppedState() {
    try {
      await _firestorePatch(`studioCloudStreamMusic/${this.streamId}`, {
        status:  'stopped',
        cloudStreamId: this.streamId,
      });
    } catch (_) {}
  }

  async _publishError(msg) {
    logger.error(`[CloudRadio] ${this.streamId} error: ${msg}`);
    try {
      await _firestorePatch(`cloudStreams/${this.streamId}`, {
        workerStatus: 'error',
        lastError:    msg,
        lastHeartbeat: Date.now(),
      });
    } catch (_) {}
  }

  _shuffleQueue() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }
}

// ─── Public API ───────────────────────────────────────────

/**
 * Start a cloud radio broadcast session.
 *
 * @param {object} opts
 * @param {string}   opts.streamId
 * @param {string}   opts.uid
 * @param {Array}    opts.queue         — [{id,title,artist,url,duration}, ...]
 * @param {boolean}  [opts.shuffle]
 * @param {boolean}  [opts.repeat]
 * @param {number}   [opts.durationMinutes]
 * @returns {{ ok: boolean, message?: string }}
 */
function startSession(opts) {
  logger.info(`[CLOUD RADIO] startSession — streamId=${opts.streamId} uid=${opts.uid} queueLength=${Array.isArray(opts.queue) ? opts.queue.length : 0}`);

  if (!opts.streamId) return { ok: false, message: 'streamId is required' };
  if (!opts.uid)      return { ok: false, message: 'uid is required' };
  if (!Array.isArray(opts.queue) || !opts.queue.length) {
    return { ok: false, message: 'queue must be a non-empty array of tracks' };
  }

  const validTracks = opts.queue.filter(t => t.url);
  logger.info(`[CLOUD RADIO] startSession — ${validTracks.length}/${opts.queue.length} tracks have a valid URL`);

  if (!validTracks.length) {
    logger.error(`[CLOUD RADIO] startSession aborted — no tracks have a valid audio URL (streamId=${opts.streamId})`);
    return { ok: false, message: 'No tracks have a valid audio URL. Upload music in Creator Studio first.' };
  }

  // Log the first few track URLs (not secrets) for diagnosability
  validTracks.slice(0, 4).forEach((t, i) => {
    const safeUrl = t.url ? t.url.replace(/\?.*$/, '?[params]') : '(none)';
    logger.info(`[CLOUD RADIO] Track ${i + 1}: "${t.title || 'Untitled'}" — URL: ${safeUrl}`);
  });

  // Stop existing session for this stream (idempotent restart)
  if (_sessions.has(opts.streamId)) {
    logger.info(`[CLOUD RADIO] Stopping existing session for ${opts.streamId} before restart`);
    _sessions.get(opts.streamId).stop();
    _sessions.delete(opts.streamId);
  }

  const session = new CloudRadioSession({
    streamId:        opts.streamId,
    uid:             opts.uid,
    queue:           validTracks,
    shuffle:         opts.shuffle,
    repeat:          opts.repeat,
    durationMinutes: opts.durationMinutes,
  });

  _sessions.set(opts.streamId, session);
  session.start();

  const firstTrack = session._currentTrack();
  logger.info(`[CLOUD RADIO] Session started — streamId=${opts.streamId} firstTrack="${firstTrack?.title || '?'}" trackCount=${validTracks.length} repeat=${!!opts.repeat}`);

  return { ok: true, streamId: opts.streamId, trackCount: validTracks.length };
}

/**
 * Stop a broadcast session.
 * @param {string} streamId
 */
function stopSession(streamId) {
  const session = _sessions.get(streamId);
  if (!session) return { ok: false, message: 'Session not found' };
  session.stop();
  _sessions.delete(streamId);
  return { ok: true };
}

/**
 * Skip the current track.
 * @param {string} streamId
 */
function skipTrack(streamId) {
  const session = _sessions.get(streamId);
  if (!session) return { ok: false, message: 'Session not found' };
  if (!session.isRunning) return { ok: false, message: 'Session is not running' };
  session.skip();
  return { ok: true };
}

/**
 * Get session status.
 * @param {string} streamId
 */
function getSessionStatus(streamId) {
  const session = _sessions.get(streamId);
  if (!session) return null;
  return session.getStatus();
}

/**
 * List all active session IDs.
 */
function listSessions() {
  return [..._sessions.keys()];
}

/**
 * Stop all sessions and return the count (used on SIGTERM).
 */
function stopAll() {
  let count = 0;
  for (const session of _sessions.values()) {
    session.stop();
    count++;
  }
  _sessions.clear();
  return count;
}

// ─── Startup recovery ─────────────────────────────────────
/**
 * On backend start/restart, read Firestore for active cloudStreams records and
 * reconstruct in-memory sessions so 24-hour broadcasts continue automatically.
 *
 * Strategy:
 *   1. Read all cloudStreams docs where status == 'active'.
 *   2. For each, load the corresponding studioCloudStreamMusic doc to get the
 *      current queue, track index, and trackStartedAt.
 *   3. Reconstruct a CloudRadioSession starting at the correct track.
 *   4. Publish the current Now Playing immediately.
 *
 * Non-fatal: if Firestore is unavailable, recovery is skipped and the server
 * still starts normally. Active streams will resume from Song 1 when the next
 * client calls /api/cloud-radio/start, or the operator can use the dashboard.
 */
async function recoverActiveSessions() {
  const db = _getAdminDb();
  if (!db) {
    logger.warn('[CloudRadio] Recovery skipped — Firebase Admin SDK not available');
    return;
  }

  let docs;
  try {
    const snap = await db.collection('cloudStreams')
      .where('status', 'in', ['active', 'recovering'])
      .get();
    docs = snap.docs;
  } catch (err) {
    logger.warn('[CloudRadio] Recovery: could not read cloudStreams: ' + err.message);
    return;
  }

  if (!docs || docs.length === 0) {
    logger.info('[CloudRadio] Recovery: no active streams found — nothing to resume');
    return;
  }

  logger.info(`[CloudRadio] Recovery: found ${docs.length} active stream(s) — resuming…`);

  for (const d of docs) {
    const streamId = d.id;
    const data     = d.data();

    // Skip if already running (edge case: recovery called more than once)
    if (_sessions.has(streamId)) {
      logger.info(`[CloudRadio] Recovery: ${streamId} already running — skipping`);
      continue;
    }

    try {
      // Mark as recovering in Firestore so the dashboard shows correct status
      await db.collection('cloudStreams').doc(streamId).update({
        status:       'recovering',
        workerStatus: 'recovering',
        lastHeartbeat: Date.now(),
      }).catch(() => {});

      // Load the current Now Playing doc to determine queue and position
      let nowPlaying = null;
      try {
        const npSnap = await db.collection('studioCloudStreamMusic').doc(streamId).get();
        if (npSnap.exists) nowPlaying = npSnap.data();
      } catch (_) {}

      let queue      = [];
      let queueIndex = 0;
      let trackStartedAt = Date.now();

      if (nowPlaying && Array.isArray(nowPlaying.queue) && nowPlaying.queue.length > 0) {
        queue          = nowPlaying.queue;
        queueIndex     = typeof nowPlaying.queueIndex === 'number' ? nowPlaying.queueIndex : 0;
        trackStartedAt = typeof nowPlaying.trackStartedAt === 'number' && nowPlaying.trackStartedAt > 0
          ? nowPlaying.trackStartedAt
          : Date.now();
      } else if (data.musicQueue && Array.isArray(data.musicQueue) && data.musicQueue.length > 0) {
        // Fallback: queue stored on the cloudStreams doc itself
        queue = data.musicQueue;
      } else {
        logger.warn(`[CloudRadio] Recovery: ${streamId} has no queue — cannot resume. Mark stopped.`);
        await db.collection('cloudStreams').doc(streamId).update({ status: 'stopped', workerStatus: 'stopped' }).catch(() => {});
        continue;
      }

      // Clamp queueIndex to valid range
      queueIndex = Math.max(0, Math.min(queueIndex, queue.length - 1));

      // Calculate how much time has already elapsed on the current track so we
      // resume from the correct position when the server rebuilds its scheduler.
      const elapsedMs = Date.now() - trackStartedAt;
      const track     = queue[queueIndex];
      const durationMs = track && track.duration > 0
        ? track.duration * 1000
        : DEFAULT_TRACK_DURATION_MS;

      // Compute remaining duration — if the track already finished, advance index.
      let advanceExtra = 0;
      let remainingMs  = durationMs - elapsedMs;
      while (remainingMs <= 0 && advanceExtra < queue.length) {
        advanceExtra++;
        queueIndex = (queueIndex + advanceExtra) % queue.length;
        remainingMs = DEFAULT_TRACK_DURATION_MS; // assume next track needs full slot
      }

      // Reconstruct the session at the correct queue position
      const session = new CloudRadioSession({
        streamId,
        uid:             data.uid || '',
        queue,
        shuffle:         data.shuffle === true,
        repeat:          data.repeat !== false,
        durationMinutes: data.durationMinutes || 1440,
      });

      // Override the queue index and track timing so the advance timer fires
      // at the right moment rather than playing from the start of the current track.
      session.queueIndex     = queueIndex;
      session.trackStartedAt = trackStartedAt + advanceExtra * DEFAULT_TRACK_DURATION_MS;

      // Restore expiry from Firestore (or recompute from durationMinutes)
      if (data.expiresAt && typeof data.expiresAt === 'number' && data.expiresAt > Date.now()) {
        session.expiresAt = data.expiresAt;
      } else if (data.expiresAt && data.expiresAt.toMillis) {
        session.expiresAt = data.expiresAt.toMillis();
      }

      _sessions.set(streamId, session);

      // Manually start the heartbeat and advance timer (skipping shuffle/reset)
      session.isRunning  = true;
      session.status     = 'running';
      session._scheduleAdvance();
      session._startHeartbeat();

      // Publish recovered Now Playing immediately
      await session._publishNowPlaying();
      await session._publishWorkerStatus('running');

      // Mark active again in cloudStreams
      await db.collection('cloudStreams').doc(streamId).update({
        status:       'active',
        workerStatus: 'running',
        lastHeartbeat: Date.now(),
      }).catch(() => {});

      logger.info(`[CloudRadio] Recovery: resumed ${streamId} at track "${track?.title || '?'}" (index ${queueIndex})`);

    } catch (err) {
      logger.error(`[CloudRadio] Recovery: failed to resume ${streamId}: ${err.message}`);
      // Mark as failed so the dashboard reflects reality
      db.collection('cloudStreams').doc(streamId).update({
        status:       'failed',
        workerStatus: 'error',
        lastError:    err.message,
      }).catch(() => {});
    }
  }

  logger.info(`[CloudRadio] Recovery complete — ${_sessions.size} session(s) now running`);
}

// ─── Graceful shutdown ────────────────────────────────────
process.on('SIGTERM', () => { const n = stopAll(); logger.info(`[CloudRadio] SIGTERM — stopped ${n} sessions`); });
process.on('SIGINT',  () => { const n = stopAll(); logger.info(`[CloudRadio] SIGINT — stopped ${n} sessions`); });

module.exports = {
  startSession,
  stopSession,
  skipTrack,
  getSessionStatus,
  listSessions,
  stopAll,
  recoverActiveSessions,
};
