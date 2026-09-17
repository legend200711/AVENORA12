/**
 * ChatMessage Model — Avenora Chat
 * Persists real-time chat messages for room history.
 */

const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  // 'public' = public room; 'private' = PrivateRoom (roomId is PrivateRoom ObjectId string)
  roomType: { type: String, enum: ['public', 'private'], default: 'public' },
  author: { type: String },                       // Firebase UID (denormalized below)
  authorUsername: { type: String }, // Denormalized for quick display
  authorAvatarUrl: { type: String }, // Denormalized for quick display
  content: { type: String, required: true, maxlength: 4000 },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },
  replyPreview: { type: String, maxlength: 100 }, // Snippet of quoted message
  reportedBy: [{ type: String }],                 // Firebase UIDs
  isDeleted: { type: Boolean, default: false },
  isSystem: { type: Boolean, default: false }, // System/bot messages
}, { timestamps: true });

chatMessageSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
