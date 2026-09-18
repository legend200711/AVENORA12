/**
 * 24-Hour Cloud Stream — Backend Service
 *
 * Streams a managed media queue via ffmpeg to RTMP targets.
 * Media files are resolved from:
 *   1. Supabase Storage (stream-media bucket) — preferred in production
 *   2. Local disk (CLOUD_STREAM_MEDIA_DIR) — fallback / dev mode
 *
 * REQUIREMENTS:
 *   - ffmpeg installed on the server (https://ffmpeg.org)
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (for cloud media)
 *   - RTMP ingest URL(s) for output platforms (optional — simulates if absent)
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

// ─── Configuration ────────────────────────────────────────
const CONFIG = {
  mediaDir: process.env.CLOUD_STREAM_MEDIA_DIR || './media',
  rtmpTargets: (process.env.CLOUD_STREAM_RTMP_TARGETS || '').split(',').filter(Boolean),
  shuffle: process.env.CLOUD_STREAM_SHUFFLE !== 'false',
  repeat: process.env.CLOUD_STREAM_REPEAT !== 'false',
  maxConsecutiveErrors: 5,
  restartDelayMs: 3000,
};

// ─── Supported audio/video extensions ────────────────────
const SUPPORTED_EXTENSIONS = ['.mp4', '.webm', '.mp3', '.wav', '.flac', '.aac', '.ogg', '.mkv', '.mov'];

// ─── State ────────────────────────────────────────────────
// Each queue item: { name, filePath?, storagePath?, signedUrl? }
let playlist = [];          // Full scanned file list from disk
let queue = [];             // Admin-managed ordered queue (overrides playlist when non-empty)
let currentIndex = 0;       // Index into the active list
let consecutiveErrors = 0;
let currentProcess = null;
let _cancelCurrentTrack = null; // cancel function returned by streamTrack (sim or ffmpeg)
let isRunning = false;
let isPaused = false;
let currentTrack = null;    // name of currently streaming track
let lastActivity = null;    // ISO timestamp of last successful track start
const errorLog = [];        // Rolling error log (last 100)

// ─── Infrastructure check ─────────────────────────────────
function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return { available: true };
  } catch {
    return { available: false, message: 'ffmpeg not found. Install from https://ffmpeg.org/download.html' };
  }
}

// ─── Playlist management — local disk ─────────────────────
function buildPlaylist() {
  const dir = CONFIG.mediaDir;
  if (!fs.existsSync(dir)) {
    logger.warn(`[CloudStream] Media dir not found: ${dir}`);
    return [];
  }

  const files = fs.readdirSync(dir)
    .filter(f => SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => ({ name: f, filePath: path.join(dir, f) }));

  logger.info(`[CloudStream] Found ${files.length} media files on disk`);
  return files;
}

/** Returns the active list — admin queue takes precedence over scanned playlist */
function getActiveList() {
  return queue.length ? queue : playlist;
}

function getNextTrack() {
  const list = getActiveList();
  if (!list.length) return null;

  // When shuffle is on, the list was already shuffled once at start() (for the
  // scanned playlist) — just advance sequentially through the shuffled order.
  // Using Math.random() per-track can repeat the same track many times in a row
  // and does not guarantee all tracks are played before repeating.
  const track = list[currentIndex % list.length];
  currentIndex++;

  // If we've looped around AND shuffle is on, re-shuffle for the next pass
  if (CONFIG.shuffle && currentIndex > 0 && currentIndex % list.length === 0) {
    list.sort(() => Math.random() - 0.5);
    currentIndex = 0;
  }

  return track;
}

/**
 * Resolve the ffmpeg input path/URL for a track item.
 * Priority: local filePath → signedUrl (Supabase)
 * If the item has a storagePath but no fresh signedUrl, we refresh it.
 */
async function resolveTrackInput(item) {
  if (item.filePath) {
    // Local disk file — verify existence
    if (!fs.existsSync(item.filePath)) return null;
    return item.filePath;
  }
  if (item.signedUrl) return item.signedUrl;
  if (item.storagePath) {
    try {
      const storageSvc = require('../storage/supabaseStorage');
      const url = await storageSvc.getSignedUrl('stream-media', item.storagePath, 3600);
      item.signedUrl = url; // cache for this session
      return url;
    } catch (err) {
      logger.warn(`[CloudStream] Could not get signed URL for ${item.storagePath}: ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─── ffmpeg stream ────────────────────────────────────────
function streamTrack(input, trackName, onComplete, onError) {
  if (!CONFIG.rtmpTargets.length) {
    logger.warn('[CloudStream] No RTMP targets configured (CLOUD_STREAM_RTMP_TARGETS). Simulating playback.');
    const duration = 10000 + Math.random() * 20000; // 10–30s for simulation
    let _completed = false;
    const timer = setTimeout(() => {
      if (_completed) return;
      _completed = true;
      logger.info(`[CloudStream] Simulated track complete: ${trackName}`);
      onComplete();
    }, duration);
    const cancel = () => { _completed = true; clearTimeout(timer); };
    _cancelCurrentTrack = cancel;
    return cancel;
  }

  const rtmpOutput = CONFIG.rtmpTargets[0];

  const ffmpegArgs = [
    '-re',
    '-i', input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-maxrate', '3000k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '50',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    rtmpOutput,
  ];

  logger.info(`[CloudStream] Streaming: ${trackName} → ${rtmpOutput}`);

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  currentProcess = proc;
  _cancelCurrentTrack = () => { if (proc && !proc.killed) proc.kill('SIGTERM'); };

  proc.stderr.on('data', (data) => {
    const line = data.toString();
    if (line.includes('Error') || line.includes('error')) {
      logger.warn(`[CloudStream ffmpeg] ${line.trim()}`);
    }
  });

  proc.on('close', (code) => {
    currentProcess = null;
    if (code === 0 || code === null) {
      onComplete();
    } else {
      onError(new Error(`ffmpeg exited with code ${code}`));
    }
  });

  proc.on('error', (err) => {
    currentProcess = null;
    if (err.code === 'ENOENT') {
      onError(new Error('ffmpeg not found. Install ffmpeg: https://ffmpeg.org/download.html'));
    } else {
      onError(err);
    }
  });

  return () => {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  };
}

// ─── Stream loop ──────────────────────────────────────────
async function playNext() {
  if (!isRunning || isPaused) return;

  const item = getNextTrack();
  if (!item) {
    logger.warn('[CloudStream] No tracks available. Rebuilding playlist in 30s...');
    setTimeout(() => {
      playlist = buildPlaylist();
      if (!getActiveList().length) {
        logger.error('[CloudStream] Still no media. Add files to: ' + CONFIG.mediaDir + ' or upload via the admin dashboard.');
        setTimeout(playNext, 30000);
      } else {
        playNext();
      }
    }, 30000);
    return;
  }

  const trackName = item.name || path.basename(item.filePath || item.storagePath || 'unknown');

  // Resolve the actual input (local file or signed URL)
  let input;
  try {
    input = await resolveTrackInput(item);
  } catch (err) {
    input = null;
  }

  if (!input) {
    logger.warn(`[CloudStream] Could not resolve media input for "${trackName}", skipping.`);
    consecutiveErrors++;
    if (consecutiveErrors < CONFIG.maxConsecutiveErrors) {
      setTimeout(playNext, 500);
    } else {
      logger.error(`[CloudStream] ${CONFIG.maxConsecutiveErrors} consecutive errors. Pausing 60s before retry.`);
      setTimeout(() => { consecutiveErrors = 0; playNext(); }, 60000);
    }
    return;
  }

  currentTrack = trackName;
  lastActivity = new Date().toISOString();

  streamTrack(
    input,
    trackName,
    () => {
      consecutiveErrors = 0;
      if (!CONFIG.repeat && currentIndex >= getActiveList().length) {
        logger.info('[CloudStream] Playlist complete. Repeat is off — stopping.');
        isRunning = false;
        currentTrack = null;
        return;
      }
      setTimeout(playNext, 500);
    },
    (err) => {
      consecutiveErrors++;
      const errorEntry = { track: trackName, error: err.message, time: new Date().toISOString() };
      errorLog.push(errorEntry);
      if (errorLog.length > 100) errorLog.shift();

      logger.error(`[CloudStream] Error playing "${trackName}": ${err.message}`);

      if (consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
        logger.error(`[CloudStream] ${CONFIG.maxConsecutiveErrors} consecutive errors. Pausing 60s before retry.`);
        setTimeout(() => {
          consecutiveErrors = 0;
          playNext();
        }, 60000);
        return;
      }

      logger.info('[CloudStream] Skipping failed track and continuing...');
      setTimeout(playNext, CONFIG.restartDelayMs);
    }
  );
}

// ─── Public API ───────────────────────────────────────────

function start() {
  if (isRunning) {
    logger.warn('[CloudStream] Already running');
    return { ok: false, message: 'Already running' };
  }

  isPaused = false;
  isRunning = true;
  currentIndex = 0;
  playlist = buildPlaylist();

  if (!getActiveList().length) {
    logger.error('[CloudStream] No media files found in: ' + CONFIG.mediaDir);
    isRunning = false;
    return { ok: false, message: 'No media files found in: ' + CONFIG.mediaDir };
  }

  if (CONFIG.shuffle && !queue.length) {
    playlist.sort(() => Math.random() - 0.5);
  }

  logger.info(`[CloudStream] Starting with ${getActiveList().length} tracks`);
  if (CONFIG.rtmpTargets.length) {
    logger.info(`[CloudStream] RTMP targets: ${CONFIG.rtmpTargets.join(', ')}`);
  } else {
    logger.warn('[CloudStream] No RTMP targets. Set CLOUD_STREAM_RTMP_TARGETS=rtmp://... to broadcast.');
  }

  playNext();
  return { ok: true };
}

function stop() {
  isRunning = false;
  isPaused = false;
  currentTrack = null;
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
  }
  if (_cancelCurrentTrack) {
    const cancel = _cancelCurrentTrack;
    _cancelCurrentTrack = null;
    try { cancel(); } catch {}
  }
  logger.info('[CloudStream] Stopped');
  return { ok: true };
}

function pause() {
  if (!isRunning) return { ok: false, message: 'Stream is not running' };
  if (isPaused) return { ok: false, message: 'Already paused' };

  isPaused = true;
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
  }
  logger.info('[CloudStream] Paused');
  return { ok: true };
}

function resume() {
  if (!isRunning) return { ok: false, message: 'Stream is not running' };
  if (!isPaused) return { ok: false, message: 'Stream is not paused' };

  isPaused = false;
  logger.info('[CloudStream] Resumed');
  playNext();
  return { ok: true };
}

function skip() {
  if (!isRunning) return { ok: false, message: 'Stream is not running' };
  // For ffmpeg processes
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
  }
  // For simulation-mode timers (no RTMP targets)
  if (_cancelCurrentTrack) {
    const cancel = _cancelCurrentTrack;
    _cancelCurrentTrack = null;
    cancel();
    // Advance to next track after a short delay
    setTimeout(playNext, 100);
  }
  return { ok: true };
}

function getStatus() {
  const list = getActiveList();
  const _nextItem = list.length ? list[currentIndex % list.length] : null;
  const nextTrack = _nextItem
    ? (_nextItem.name || path.basename(_nextItem.filePath || _nextItem.storagePath || 'unknown'))
    : null;

  let state;
  if (!isRunning) state = 'stopped';
  else if (isPaused) state = 'paused';
  else if (consecutiveErrors >= CONFIG.maxConsecutiveErrors) state = 'reconnecting';
  else if (!list.length) state = 'no_media';
  else state = 'running';

  return {
    state,                         // stopped | running | paused | reconnecting | no_media
    running: isRunning,
    paused: isPaused,
    currentTrack,
    nextTrack,
    queueSize: list.length,
    managedQueueSize: queue.length,
    playlistSize: playlist.length,
    currentIndex: currentIndex % Math.max(1, list.length),
    consecutiveErrors,
    shuffle: CONFIG.shuffle,
    repeat: CONFIG.repeat,
    rtmpConfigured: CONFIG.rtmpTargets.length > 0,
    rtmpTargetCount: CONFIG.rtmpTargets.length,
    mediaDir: CONFIG.mediaDir,
    recentErrors: errorLog.slice(-10),
    lastActivity,
    ffmpeg: checkFfmpeg(),
  };
}

function getQueue() {
  const list = getActiveList();
  return list.map((item, i) => ({
    index: i,
    name: item.name || path.basename(item.filePath || item.storagePath || 'unknown'),
    storagePath: item.storagePath || null,
    active: i === (currentIndex % Math.max(1, list.length)) && isRunning && !isPaused,
  }));
}

/**
 * Add items to the admin-managed queue.
 * Accepts two forms:
 *   - { name, storagePath }  — Supabase Storage item
 *   - "filename.mp3"         — local disk filename (legacy)
 */
function addToQueue(items) {
  const added = [];
  for (const item of items) {
    if (typeof item === 'string') {
      // Legacy: local filename
      const resolved = path.isAbsolute(item) ? item : path.join(CONFIG.mediaDir, item);
      if (!fs.existsSync(resolved)) {
        logger.warn(`[CloudStream] addToQueue: file not found: ${resolved}`);
        continue;
      }
      if (!SUPPORTED_EXTENSIONS.includes(path.extname(resolved).toLowerCase())) {
        logger.warn(`[CloudStream] addToQueue: unsupported extension: ${resolved}`);
        continue;
      }
      queue.push({ name: path.basename(resolved), filePath: resolved });
      added.push(path.basename(resolved));
    } else if (item && item.storagePath) {
      // Supabase Storage item
      queue.push({ name: item.name || item.storagePath.split('/').pop(), storagePath: item.storagePath, signedUrl: item.signedUrl || null });
      added.push(item.name || item.storagePath.split('/').pop());
    }
  }
  logger.info(`[CloudStream] Queue updated — ${queue.length} items`);
  return added;
}

function removeFromQueue(index) {
  if (index < 0 || index >= queue.length) return { ok: false, message: 'Index out of range' };
  const removed = queue.splice(index, 1)[0];
  if (currentIndex > index) currentIndex--;
  const removedName = removed.name || path.basename(removed.filePath || removed.storagePath || 'unknown');
  logger.info(`[CloudStream] Removed from queue: ${removedName}`);
  return { ok: true, removed: removedName };
}

function reorderQueue(fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) {
    return { ok: false, message: 'Index out of range' };
  }
  const [item] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, item);
  logger.info(`[CloudStream] Queue reordered: ${path.basename(item)} moved to position ${toIndex}`);
  return { ok: true };
}

function clearQueue() {
  queue = [];
  currentIndex = 0;
  logger.info('[CloudStream] Queue cleared');
  return { ok: true };
}

function setShuffle(enabled) {
  CONFIG.shuffle = !!enabled;
  logger.info(`[CloudStream] Shuffle: ${CONFIG.shuffle}`);
  return { ok: true, shuffle: CONFIG.shuffle };
}

function setRepeat(enabled) {
  CONFIG.repeat = !!enabled;
  logger.info(`[CloudStream] Repeat: ${CONFIG.repeat}`);
  return { ok: true, repeat: CONFIG.repeat };
}

/** Scan the media dir and refresh the playlist */
function refreshPlaylist() {
  playlist = buildPlaylist();
  logger.info(`[CloudStream] Playlist refreshed — ${playlist.length} files`);
  return { ok: true, playlistSize: playlist.length };
}

/** List all media files on disk (legacy — use /api/admin/cloud-stream/media/library for Supabase) */
function listMediaFiles() {
  const dir = CONFIG.mediaDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
}

/**
 * Add Supabase Storage items directly to the queue.
 * Called by the admin dashboard after uploading to stream-media bucket.
 *
 * @param {Array<{name: string, storagePath: string, signedUrl?: string}>} items
 */
function addSupabaseItemsToQueue(items) {
  return addToQueue(items);
}

// ─── Run if called directly ───────────────────────────────
if (require.main === module) {
  logger.info('=== AVENORA — 24-Hour Cloud Stream Service ===');
  logger.info('Configure: CLOUD_STREAM_MEDIA_DIR, CLOUD_STREAM_RTMP_TARGETS');
  start();

  process.on('SIGTERM', () => { stop(); process.exit(0); });
  process.on('SIGINT',  () => { stop(); process.exit(0); });
}

module.exports = {
  start,
  stop,
  pause,
  resume,
  skip,
  getStatus,
  getQueue,
  addToQueue,
  addSupabaseItemsToQueue,
  removeFromQueue,
  reorderQueue,
  clearQueue,
  setShuffle,
  setRepeat,
  refreshPlaylist,
  listMediaFiles,
  checkFfmpeg,
};
