/**
 * DirectMessage Model — Avenora DMs
 * Individual messages within a Conversation.
 */

const mongoose = require('mongoose');

const directMessageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },
  sender: {
    type: String,         // Firebase UID
    required: true,
  },
  senderUsername: { type: String }, // Denormalized

  content: { type: String, required: true, maxlength: 4000 },

  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectMessage' },

  // Per-recipient delivery/read state
  readBy: [{
    userId:  { type: String },   // Firebase UID
    readAt:  { type: Date },
    _id: false,
  }],

  isDeleted:   { type: Boolean, default: false },
  deletedBy:   { type: String },   // Firebase UID
}, { timestamps: true });

directMessageSchema.index({ conversationId: 1, createdAt: -1 });

const DirectMessage = mongoose.model('DirectMessage', directMessageSchema);
module.exports = DirectMessage;
