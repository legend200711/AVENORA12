/**
 * Conversation Model — Avenora Direct Messages
 * Represents a 1-to-1 or future group DM thread between participants.
 *
 * For one-to-one DMs, participants always has exactly 2 entries.
 * The conversation is identified by a deterministic ID derived from the
 * two user IDs (sorted) so "get or create" is idempotent.
 */

const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId:      { type: String, required: true },   // Firebase UID
  mutedUntil:  { type: Date },          // null = not muted
  isBlocked:   { type: Boolean, default: false },
  lastReadAt:  { type: Date },          // last time this participant read the thread
  unreadCount: { type: Number, default: 0 },
  hasLeft:     { type: Boolean, default: false }, // soft-leave (still shows history)
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['dm', 'group'],
    default: 'dm',
  },
  participants: [participantSchema],

  // Denormalized "last message" preview for inbox rendering
  lastMessage: {
    content:   { type: String },
    senderId:  { type: String },               // Firebase UID
    sentAt:    { type: Date },
  },

  // Group DM extras (unused for type === 'dm')
  groupName:   { type: String, maxlength: 80 },
  groupIconUrl:{ type: String },
  groupOwner:  { type: String },               // Firebase UID

  isDeleted:   { type: Boolean, default: false },
}, { timestamps: true });

// Compound index to enforce one conversation per user-pair and fast inbox queries
conversationSchema.index({ 'participants.userId': 1, updatedAt: -1 });

/**
 * Returns a deterministic conversation ID string for a DM between two users.
 * Used to prevent duplicate conversations.
 */
conversationSchema.statics.dmKey = function (userIdA, userIdB) {
  return [userIdA.toString(), userIdB.toString()].sort().join('_');
};

/**
 * Get-or-create a 1-to-1 DM conversation between two users.
 */
conversationSchema.statics.getOrCreateDM = async function (userIdA, userIdB) {
  // Find existing conversation where both participants are present
  const existing = await this.findOne({
    type: 'dm',
    isDeleted: false,
    'participants.userId': { $all: [userIdA, userIdB] },
  });
  if (existing) return { conversation: existing, created: false };

  const conversation = await this.create({
    type: 'dm',
    participants: [
      { userId: userIdA },
      { userId: userIdB },
    ],
  });
  return { conversation, created: true };
};

const Conversation = mongoose.model('Conversation', conversationSchema);
module.exports = Conversation;
