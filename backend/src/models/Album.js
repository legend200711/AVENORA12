/**
 * Album Model — Avenora Music Hub
 */

const mongoose = require('mongoose');

const albumSchema = new mongoose.Schema({
  title:       { type: String, required: true, maxlength: 300, trim: true },
  artist:      { type: mongoose.Schema.Types.ObjectId, ref: 'Artist' },
  artistName:  { type: String, maxlength: 200, trim: true },
  uploader:    { type: String, required: true },   // Firebase UID
  coverUrl:    { type: String },
  releaseDate: { type: Date },
  genre:       { type: String, maxlength: 80, trim: true },
  description: { type: String, maxlength: 3000, trim: true },
  totalTracks: { type: Number, default: 0 },
  visibility:  {
    type: String,
    enum: ['public', 'unlisted', 'private'],
    default: 'public',
  },
  isPublished: { type: Boolean, default: false },
  isDeleted:   { type: Boolean, default: false },
}, {
  timestamps: true,
});

albumSchema.index({ uploader: 1, createdAt: -1 });
albumSchema.index({ title: 'text', artistName: 'text' });

const Album = mongoose.model('Album', albumSchema);
module.exports = Album;
