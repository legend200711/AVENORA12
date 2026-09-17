/**
 * MusicFavorite Model — Avenora Music Hub
 * Persists per-user track favorites when the backend is connected.
 */

const mongoose = require('mongoose');

const musicFavoriteSchema = new mongoose.Schema({
  user:  { type: String, required: true },   // Firebase UID
  track: { type: mongoose.Schema.Types.ObjectId, ref: 'Track', required: true },
}, {
  timestamps: true,
});

musicFavoriteSchema.index({ user: 1, track: 1 }, { unique: true });
musicFavoriteSchema.index({ user: 1, createdAt: -1 });

const MusicFavorite = mongoose.model('MusicFavorite', musicFavoriteSchema);
module.exports = MusicFavorite;
