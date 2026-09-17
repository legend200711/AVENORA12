/**
 * Video Model - Avenora Video
 */

const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, maxlength: 5000 },
  // uploader stores a Firebase UID (string) — NOT a MongoDB ObjectId.
  // Firebase-authenticated users do not have a MongoDB User document,
  // so we cannot use a ref/populate here. Store as a plain string and
  // embed display-name/avatar at write time (see /save-meta route).
  uploader: { type: String, required: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },

  // File references
  // Note: originalFileUrl is NOT marked select:false — it is the primary playback URL
  // for Supabase-hosted videos (the public CDN URL). Marking it select:false prevents
  // it from being returned in .lean() queries, which breaks video playback.
  originalFileUrl: { type: String },
  hlsUrl: { type: String }, // HLS stream URL (MediaMTX/WHIP → HLS) or same as originalFileUrl
  storagePath:     { type: String },   // Supabase Storage path (videos bucket)
  thumbnailUrl: { type: String },
  previewGifUrl: { type: String },

  // Processing status
  processingStatus: {
    type: String,
    enum: ['pending', 'processing', 'ready', 'failed'],
    default: 'pending',
  },
  processingError: { type: String },

  // Metadata
  duration: { type: Number }, // seconds
  resolution: { type: String }, // "1920x1080"
  fileSize: { type: Number }, // bytes

  // Categorization
  category: {
    type: String,
    enum: ['movies', 'shows', 'music', 'short', 'gaming', 'education', 'comedy', 'other'],
    default: 'other',
  },
  tags: [{ type: String, maxlength: 50 }],
  genre: { type: String, maxlength: 100 },

  // Engagement — UID arrays stored as strings (Firebase UIDs)
  views: { type: Number, default: 0 },
  likes: [{ type: String }],
  dislikes: [{ type: String }],
  watchLaterBy: [{ type: String }],

  // Status
  isPublished: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'public' },
  reportCount: { type: Number, default: 0 },
  isFlagged: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },

  // Embedded uploader snapshot — populated at write time from req.user
  // so the video list can display name/avatar without a separate join.
  uploaderInfo: {
    uid:         { type: String },
    username:    { type: String },
    displayName: { type: String },
    avatarUrl:   { type: String },
  },

  // External integrations (legacy — kept for schema compatibility)
  muxAssetId: { type: String },
  muxPlaybackId: { type: String },
}, {
  timestamps: true,
});

videoSchema.index({ uploader: 1, createdAt: -1 }); // uploader is now a string (Firebase UID)
videoSchema.index({ category: 1, createdAt: -1 });
videoSchema.index({ views: -1 });
videoSchema.index({ processingStatus: 1 });

// Virtual: expose a consistent `videoUrl` field for frontend compatibility.
// The Firestore path uses `videoUrl`; the MongoDB path uses `hlsUrl` / `originalFileUrl`.
// This virtual makes both paths return the same field name.
videoSchema.virtual('videoUrl').get(function () {
  return this.hlsUrl || this.originalFileUrl || null;
});

const Video = mongoose.model('Video', videoSchema);
module.exports = Video;
