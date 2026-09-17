/**
 * PrivateRoom Model — Avenora Chat
 * Represents a private or invite-only chat room.
 *
 * Visibility:
 *   'public'      — listed globally, anyone may join
 *   'private'     — listed but requires invite
 *   'invite_only' — not listed; only visible to invited members
 */

const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  userId:    { type: String, required: true },   // Firebase UID
  role:      { type: String, enum: ['owner', 'moderator', 'member'], default: 'member' },
  joinedAt:  { type: Date, default: Date.now },
  mutedUntil:{ type: Date },   // null = not muted
}, { _id: false });

const banSchema = new mongoose.Schema({
  userId:   { type: String, required: true },    // Firebase UID
  reason:   { type: String, maxlength: 300 },
  bannedAt: { type: Date, default: Date.now },
  bannedBy: { type: String },                    // Firebase UID
}, { _id: false });

const joinRequestSchema = new mongoose.Schema({
  userId:      { type: String, required: true }, // Firebase UID
  requestedAt: { type: Date, default: Date.now },
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
}, { _id: false });

const privateRoomSchema = new mongoose.Schema({
  name:        { type: String, required: true, maxlength: 80, trim: true },
  description: { type: String, maxlength: 500 },
  iconUrl:     { type: String },               // room picture / icon

  visibility: {
    type: String,
    enum: ['public', 'private', 'invite_only'],
    default: 'private',
  },

  owner:       { type: String, required: true }, // Firebase UID
  members:     [memberSchema],
  bans:        [banSchema],
  joinRequests:[joinRequestSchema],

  isArchived:  { type: Boolean, default: false },
  isDeleted:   { type: Boolean, default: false },
}, { timestamps: true });

// Fast membership checks
privateRoomSchema.index({ owner: 1 });
privateRoomSchema.index({ 'members.userId': 1 });
privateRoomSchema.index({ visibility: 1, isArchived: 1, isDeleted: 1 });

/** Returns true if userId is a member (any role) */
privateRoomSchema.methods.isMember = function (userId) {
  const id = userId.toString();
  return this.members.some(m => m.userId.toString() === id);
};

/** Returns the member entry or null */
privateRoomSchema.methods.getMember = function (userId) {
  const id = userId.toString();
  return this.members.find(m => m.userId.toString() === id) || null;
};

/** Returns true if userId is banned */
privateRoomSchema.methods.isBanned = function (userId) {
  const id = userId.toString();
  return this.bans.some(b => b.userId.toString() === id);
};

/** Returns the role of a member, or null */
privateRoomSchema.methods.getRole = function (userId) {
  const m = this.getMember(userId);
  return m ? m.role : null;
};

const PrivateRoom = mongoose.model('PrivateRoom', privateRoomSchema);
module.exports = PrivateRoom;
