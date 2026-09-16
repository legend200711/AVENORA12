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
  originalFileUrl: { type: String, select: false }, // Internal, not exposed
  hlsUrl: { type: String }, // HLS stream URL (MediaMTX/WHIP → HLS)
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

const Video = mongoose.model('Video', videoSchema);
module.exports = Video;
