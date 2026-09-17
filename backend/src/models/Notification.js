/**
 * Notification Model - Avenora
 * Real notifications for follows, likes, comments, reposts.
 */

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Firebase UIDs stored as strings — not MongoDB ObjectIds
  recipient: { type: String, required: true },
  sender:    { type: String, required: true },
  type: {
    type: String,
    enum: [
      'follow', 'like', 'comment', 'repost', 'mention', 'report_resolved',
      'dm',                // New direct message
      'room_invite',       // Invited to a private room
      'room_join_request', // Someone requested to join your room
      'room_join_approved',// Join request approved
      'room_join_rejected',// Join request rejected
    ],
    required: true,
  },
  // Optional references
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  comment: { type: mongoose.Schema.Types.ObjectId },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  room: { type: mongoose.Schema.Types.ObjectId, ref: 'PrivateRoom' },
  message: { type: String, maxlength: 300 },
  isRead: { type: Boolean, default: false },
}, {
  timestamps: true,
});

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
