/**
 * Follow Model - Avenora
 * Tracks follower/following relationships between users.
 */

const mongoose = require('mongoose');

const followSchema = new mongoose.Schema({
  // Firebase UIDs stored as strings — not MongoDB ObjectIds
  follower:  { type: String, required: true },
  following: { type: String, required: true },
}, {
  timestamps: true,
});

// Unique: a user can only follow another user once
followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ following: 1 });
followSchema.index({ follower: 1 });

const Follow = mongoose.model('Follow', followSchema);
module.exports = Follow;
