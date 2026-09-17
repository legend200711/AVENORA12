/**
 * Stream Model - AVENORA Live (browser-based WHIP/HLS)
 *
 * Removed: muxLiveStreamId, cloudflareStreamLiveId (Mux/Cloudflare Stream dependencies)
 * Removed: streamKey / rtmpUrl (OBS/RTMP encoder fields — not used in browser-based publishing)
 * Added:   liveSession sub-document tracking browser publishing session state
 * Added:   mediaMTXPath for the MediaMTX stream path
 */

const mongoose = require('mongoose');

const streamSchema = new mongoose.Schema({
  streamer: { type: String, required: true },   // Firebase UID
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, maxlength: 2000 },
  category: { type: String, maxlength: 100 },
  tags: [{ type: String }],
  thumbnailUrl: { type: String },

  // ─── Stream lifecycle status ─────────────────────────────
  // 'offline'    : session created, not yet publishing
  // 'live'       : publisher connected and MediaMTX confirms active source
  // 'ended'      : stream ended by the broadcaster
  status: {
    type: String,
    enum: ['offline', 'live', 'ended'],
    default: 'offline',
  },
  startedAt:       { type: Date },
  endedAt:         { type: Date },
  viewerCount:     { type: Number, default: 0 },
  peakViewerCount: { type: Number, default: 0 },
  totalViews:      { type: Number, default: 0 },

  // ─── MediaMTX / WHIP delivery ────────────────────────────
  // mediaMTXPath: the path segment used in MediaMTX (e.g. "live-<id>")
  // hlsUrl:       public HLS playlist URL constructed from MEDIAMTX_HLS_URL + mediaMTXPath
  // Both are derived at session-start from env config — never hardcoded.
  mediaMTXPath: { type: String },
  hlsUrl:       { type: String },

  // ─── Live session state ───────────────────────────────────
  // Tracks the current browser publishing session lifecycle.
  // This is server-side state only; the browser never receives the full sub-document.
  liveSession: {
    // Session token issued to the publisher. Used to authorize stop/health calls.
    // select:false → never returned to frontend by default.
    token:          { type: String, select: false },
    startedAt:      { type: Date },
    lastHeartbeat:  { type: Date },
    publisherIp:    { type: String, select: false },
    userAgent:      { type: String },
  },

  // ─── Replay / archive ────────────────────────────────────
  replay: {
    available: { type: Boolean, default: false },
    videoId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
    hlsUrl:    { type: String },
  },

  // ─── Moderation ─────────────────────────────────────────
  isBanned:  { type: Boolean, default: false },
  banReason: { type: String },

  // ─── Schedule (future feature) ──────────────────────────
  scheduledFor: { type: Date },
  isScheduled:  { type: Boolean, default: false },
}, {
  timestamps: true,
});

streamSchema.index({ streamer: 1 });
streamSchema.index({ status: 1 });
streamSchema.index({ category: 1, status: 1 });

const Stream = mongoose.model('Stream', streamSchema);
module.exports = Stream;
