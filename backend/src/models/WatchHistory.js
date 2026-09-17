/**
 * WatchHistory Model - Avenora Video
 * Stores last-watched position per user per video.
 * No unnecessary personal information.
 */
const mongoose = require('mongoose');

const watchHistorySchema = new mongoose.Schema({
  // user stores a Firebase UID (string) — not a MongoDB ObjectId
  user:     { type: String, required: true },
  video:    { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
  position: { type: Number, default: 0 },   // seconds
  watchedAt: { type: Date, default: Date.now },
}, { timestamps: false });

// One record per user+video — upsert pattern
watchHistorySchema.index({ user: 1, video: 1 }, { unique: true });
watchHistorySchema.index({ user: 1, watchedAt: -1 });

module.exports = mongoose.model('WatchHistory', watchHistorySchema);
