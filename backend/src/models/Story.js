/**
 * Story Model - Avenora
 * 24-hour ephemeral stories. Expiry is timestamp-based, not CSS.
 */

const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  author: { type: String, required: true },      // Firebase UID
  mediaUrl: { type: String, required: true },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    required: true,
  },
  caption: { type: String, maxlength: 500 },
  viewers: [{ type: String }],                   // Firebase UIDs
  // expiresAt is set at creation to createdAt + 24h
  expiresAt: {
    type: Date,
    required: true,
    // TTL index defined below via schema.index() — do NOT add index:true here
  },
  isDeleted: { type: Boolean, default: false },
}, {
  timestamps: true,
});

storySchema.index({ author: 1, expiresAt: 1 });
// TTL index: MongoDB automatically deletes documents when expiresAt has passed
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save: set expiry to 24h from creation if not set
storySchema.pre('save', function (next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  next();
});

const Story = mongoose.model('Story', storySchema);
module.exports = Story;
