/**
 * AVENORA Live Session Service
 *
 * Manages browser-based live stream sessions that publish via WHIP to MediaMTX
 * and deliver via HLS to viewers.
 *
 * This service does NOT interact with OBS, Streamlabs, RTMP encoders, or any
 * third-party streaming platform. All publishing is done from the browser via
 * WebRTC/WHIP. All delivery is HLS from MediaMTX.
 *
 * MediaMTX must be deployed separately. See docs/mediamtx.yml for configuration.
 */

const logger = require('../../utils/logger');

// ─── Configuration (set via .env) ──────────────────────────
const CFG = {
  mediaMTXBaseUrl: process.env.MEDIAMTX_BASE_URL || '',
  mediaMTXApiUrl:  process.env.MEDIAMTX_API_URL  || '',
  mediaMTXWhipUrl: process.env.MEDIAMTX_WHIP_URL || '',
  mediaMTXHlsUrl:  process.env.MEDIAMTX_HLS_URL  || '',
  sessionTimeoutSecs: parseInt(process.env.LIVE_SESSION_TIMEOUT_SECONDS || '3600', 10),
  livePublicBaseUrl: process.env.LIVE_PUBLIC_BASE_URL || '',
};

// ─── In-memory health/publisher state ──────────────────────
// Maps streamId (Mongo ObjectId string) → publisher heartbeat info.
// In a multi-process deployment this should move to Redis.
const publisherState = new Map();

/**
 * Returns true if the MediaMTX API is reachable.
 * Does NOT throw — caller must handle the returned object.
 */
async function checkMediaMTXHealth() {
  if (!CFG.mediaMTXApiUrl) {
    return { available: false, message: 'MEDIAMTX_API_URL is not configured.' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${CFG.mediaMTXApiUrl}/v3/config/global/get`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timeout));

    if (res.ok) {
      return { available: true };
    }
    return { available: false, message: `MediaMTX responded with HTTP ${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { available: false, message: 'MediaMTX health check timed out after 5 s.' };
    }
    return { available: false, message: `MediaMTX unreachable: ${err.message}` };
  }
}

/**
 * Build the WHIP publishing URL for a given stream path.
 * e.g. "live/abc123" → "https://media.example.com/abc123/whip"
 * Returns null if MEDIAMTX_WHIP_URL is not configured.
 */
function buildWhipUrl(streamPath) {
  if (!CFG.mediaMTXWhipUrl) return null;
  const base = CFG.mediaMTXWhipUrl.replace(/\/$/, '');
  return `${base}/${encodeURIComponent(streamPath)}/whip`;
}

/**
 * Build the HLS playback URL for a given stream path.
 * Returns null if MEDIAMTX_HLS_URL is not configured.
 */
function buildHlsUrl(streamPath) {
  if (!CFG.mediaMTXHlsUrl) return null;
  const base = CFG.mediaMTXHlsUrl.replace(/\/$/, '');
  return `${base}/${encodeURIComponent(streamPath)}/index.m3u8`;
}

/**
 * Derive a stable, URL-safe stream path from a Mongo stream _id.
 * Path format: "live-<streamId>"
 */
function streamPath(streamId) {
  return `live-${streamId}`;
}

/**
 * Check whether a stream is actively publishing via the MediaMTX API.
 * Returns { publishing: boolean, readers: number } or throws.
 */
async function checkPublisherStatus(streamId) {
  if (!CFG.mediaMTXApiUrl) return { publishing: false, readers: 0 };

  const path = streamPath(streamId);
  try {
    const res = await fetch(`${CFG.mediaMTXApiUrl}/v3/paths/get/${encodeURIComponent(path)}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return { publishing: false, readers: 0 };
    if (!res.ok) return { publishing: false, readers: 0 };

    const body = await res.json();
    const hasSource = !!(body.source);
    const readers = (body.readers || []).length;
    return { publishing: hasSource, readers };
  } catch {
    return { publishing: false, readers: 0 };
  }
}

/**
 * Ask MediaMTX to remove a path (force-end a stream).
 * Non-fatal — logs on error but does not throw.
 */
async function kickPublisher(streamId) {
  if (!CFG.mediaMTXApiUrl) return;

  const path = streamPath(streamId);
  try {
    await fetch(`${CFG.mediaMTXApiUrl}/v3/kick/publisher/${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    logger.info(`[LiveSession] Kicked publisher for path: ${path}`);
  } catch (err) {
    logger.warn(`[LiveSession] Could not kick publisher for ${path}: ${err.message}`);
  }
}

/**
 * Record a publisher heartbeat (called from the /health endpoint).
 * Returns the updated heartbeat entry.
 */
function recordPublisherHeartbeat(streamId, metrics = {}) {
  const existing = publisherState.get(streamId) || {};
  const entry = {
    ...existing,
    lastHeartbeat: Date.now(),
    bitrate: metrics.bitrate ?? existing.bitrate ?? 0,
    fps: metrics.fps ?? existing.fps ?? 0,
    resolution: metrics.resolution ?? existing.resolution,
    errors: metrics.errors ?? existing.errors ?? 0,
  };
  publisherState.set(streamId, entry);
  return entry;
}

/**
 * Clear the in-memory heartbeat state for a stream.
 */
function clearPublisherState(streamId) {
  publisherState.delete(streamId);
}

/**
 * Get the current in-memory publisher health for a stream, if any.
 */
function getPublisherHealth(streamId) {
  return publisherState.get(streamId) || null;
}

/**
 * Returns a safe playback info object (no secrets) for a given stream document.
 * whipUrl is only included when the stream is transitioning to live (start-publishing endpoint).
 * It is NEVER returned by the public viewer endpoint.
 */
function buildPlaybackInfo(stream, includeWhip = false) {
  // Firestore documents use `id` as the document ID field; MongoDB used `_id`.
  // Support both shapes to avoid TypeErrors.
  const streamId = stream.id || (stream._id && stream._id.toString()) || '';
  const path = streamPath(streamId);
  const info = {
    streamId,
    status:   stream.status,
    hlsUrl:   buildHlsUrl(path),
    mediaMTXConfigured: !!CFG.mediaMTXHlsUrl,
  };

  if (includeWhip) {
    info.whipUrl  = buildWhipUrl(path);
    info.streamPath = path;
    info.mediaMTXWhipConfigured = !!CFG.mediaMTXWhipUrl;
  }

  return info;
}

/**
 * Check whether the session has timed out without a heartbeat.
 * Only relevant when stream.status === 'live'.
 */
function isSessionTimedOut(streamId) {
  const entry = publisherState.get(streamId);
  if (!entry) return false; // no heartbeat yet — not timed out, just not started
  return Date.now() - entry.lastHeartbeat > CFG.sessionTimeoutSecs * 1000;
}

module.exports = {
  CFG,
  checkMediaMTXHealth,
  buildWhipUrl,
  buildHlsUrl,
  streamPath,
  checkPublisherStatus,
  kickPublisher,
  recordPublisherHeartbeat,
  clearPublisherState,
  getPublisherHealth,
  buildPlaybackInfo,
  isSessionTimedOut,
};
