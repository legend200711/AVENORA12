/**
 * Video Model - Avenora Video
 */

const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, maxlength: 5000 },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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

  // Engagement
  views: { type: Number, default: 0 },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  watchLaterBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Status
  isPublished: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'public' },
  reportCount: { type: Number, default: 0 },
  isFlagged: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },

  // External integrations (legacy — kept for schema compatibility)
  muxAssetId: { type: String },
  muxPlaybackId: { type: String },
}, {
  timestamps: true,
});

videoSchema.index({ uploader: 1, createdAt: -1 });
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
