/**
 * Playlist Model — Avenora Music Hub
 * User-created collections. Tracks are embedded by reference only.
 */

const mongoose = require('mongoose');

const playlistSchema = new mongoose.Schema({
  name:        { type: String, required: true, maxlength: 200, trim: true },
  description: { type: String, maxlength: 1000, trim: true },
  owner:       { type: String, required: true },   // Firebase UID
  coverUrl:    { type: String },
  tracks:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Track' }],
  visibility:  {
    type: String,
    enum: ['public', 'private'],
    default: 'private',
  },
  isDeleted:   { type: Boolean, default: false },
}, {
  timestamps: true,
});

playlistSchema.index({ owner: 1, createdAt: -1 });

const Playlist = mongoose.model('Playlist', playlistSchema);
module.exports = Playlist;
