/**
 * Artist Model — Avenora Music Hub
 */

const mongoose = require('mongoose');

const artistSchema = new mongoose.Schema({
  name:       { type: String, required: true, maxlength: 200, trim: true },
  slug:       { type: String, lowercase: true, trim: true },
  biography:  { type: String, maxlength: 5000, trim: true },
  avatarUrl:  { type: String },
  bannerUrl:  { type: String },
  genres:     [{ type: String, maxlength: 80 }],
  createdBy:  { type: String },   // Firebase UID
  isVerified: { type: Boolean, default: false },
  isDeleted:  { type: Boolean, default: false },

  // External links
  spotifyUrl:   { type: String },
  appleMusicUrl:{ type: String },
  youtubeMusicUrl:{ type: String },
  amazonMusicUrl: { type: String },
}, {
  timestamps: true,
});

artistSchema.index({ name: 'text', biography: 'text' });
artistSchema.index({ slug: 1 }, { unique: true, sparse: true });

const Artist = mongoose.model('Artist', artistSchema);
module.exports = Artist;
