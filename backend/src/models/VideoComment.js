/**
 * VideoComment Model - Avenora Video
 */
const mongoose = require('mongoose');

const videoCommentSchema = new mongoose.Schema({
  video:   { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
  // author stores a Firebase UID (string) — not a MongoDB ObjectId
  author:  { type: String, required: true },
  content: { type: String, required: true, maxlength: 2000 },
  isDeleted:   { type: Boolean, default: false },
  reportCount: { type: Number,  default: 0 },
  isFlagged:   { type: Boolean, default: false },
}, { timestamps: true });

videoCommentSchema.index({ video: 1, createdAt: -1 });
videoCommentSchema.index({ author: 1 });

module.exports = mongoose.model('VideoComment', videoCommentSchema);
