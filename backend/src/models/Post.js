/**
 * Post Model - Avenora Feed
 */

const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  author: { type: String, required: true },   // Firebase UID
  content: { type: String, required: true, maxlength: 2000 },
  likes: [{ type: String }],                  // Firebase UIDs
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

const postSchema = new mongoose.Schema({
  author: { type: String, required: true },   // Firebase UID
  content: { type: String, maxlength: 10000 },
  mediaUrls: [{ type: String }], // Array of image/video URLs
  mediaType: { type: String, enum: ['none', 'image', 'video', 'audio'], default: 'none' },
  type: { type: String, enum: ['post', 'repost', 'reply'], default: 'post' },
  originalPost: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // For reposts
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // For replies
  likes: [{ type: String }],                  // Firebase UIDs
  reposts: [{ type: String }],                // Firebase UIDs
  comments: [commentSchema],
  tags: [{ type: String, maxlength: 50 }],
  isEdited: { type: Boolean, default: false },
  editedAt: { type: Date },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  visibility: { type: String, enum: ['public', 'followers', 'private'], default: 'public' },
  reportCount: { type: Number, default: 0 },
  isFlagged: { type: Boolean, default: false },
}, {
  timestamps: true,
});

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ tags: 1 });
postSchema.index({ isDeleted: 1 });

const Post = mongoose.model('Post', postSchema);
module.exports = Post;
