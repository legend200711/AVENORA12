/**
 * Channel Model - Avenora Video
 * A channel is a content container linked to an owner (User).
 */
const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  // owner stores a Firebase UID (string). Not an ObjectId — Firebase users
  // do not have MongoDB User documents.
  owner:       { type: String, required: true, unique: true },
  name:        { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 2000 },
  avatarUrl:   { type: String },
  bannerUrl:   { type: String },
  subscribers: [{ type: String }], // Firebase UID strings
  isSuspended: { type: Boolean, default: false },
  suspendReason: { type: String },
}, { timestamps: true });

// Note: owner field already has unique:true which creates an index — no explicit index needed
channelSchema.virtual('subscriberCount').get(function () {
  return this.subscribers.length;
});
channelSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Channel', channelSchema);
