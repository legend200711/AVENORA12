/**
 * User Model
 * Supports: regular user, moderator, founder/admin roles
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9_]+$/,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  passwordHash: {
    type: String,
    required: true,
    select: false, // Never returned in queries by default
  },
  role: {
    type: String,
    enum: ['user', 'moderator', 'founder', 'admin'],
    default: 'user',
  },
  profile: {
    displayName: { type: String, maxlength: 60 },
    bio: { type: String, maxlength: 500 },
    avatarUrl: { type: String },
    bannerUrl: { type: String },
    location: { type: String, maxlength: 100 },
    website: { type: String, maxlength: 200 },
  },
  stats: {
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    postsCount: { type: Number, default: 0 },
  },
  status: {
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date },
    isActive: { type: Boolean, default: true },
    isSuspended: { type: Boolean, default: false },
    suspendedReason: { type: String },
    suspendedUntil: { type: Date },
    isEmailVerified: { type: Boolean, default: false },
  },
  preferences: {
    // ── Appearance ───────────────────────────────────────
    theme: { type: String, enum: ['dark', 'darker', 'amoled'], default: 'dark' },
    accentColor: { type: String, enum: ['gold', 'emerald', 'violet', 'bronze', 'crimson'], default: 'gold' },
    textSize: { type: String, enum: ['small', 'normal', 'large', 'xlarge'], default: 'normal' },
    gothicIntensity: { type: String, enum: ['subtle', 'standard', 'intense'], default: 'standard' },
    highContrast: { type: Boolean, default: false },
    reducedMotion: { type: Boolean, default: false },
    soundEnabled: { type: Boolean, default: true },
    autoplay: { type: Boolean, default: true },
    captions: { type: Boolean, default: false },

    // ── Notifications ────────────────────────────────────
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      level: { type: String, enum: ['all', 'important', 'none'], default: 'all' },
      likes: { type: Boolean, default: true },
      comments: { type: Boolean, default: true },
      follows: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      groupMessages: { type: Boolean, default: true },
      chatInvites: { type: Boolean, default: true },
      friendRequests: { type: Boolean, default: true },
      liveVideo: { type: Boolean, default: true },
      systemAnnouncements: { type: Boolean, default: true },
    },

    // ── Home-page card layout ────────────────────────────
    homeCards: {
      // Ordered array of card IDs the user wants visible
      visibleCards: { type: [String], default: () => ['cloudstream','live','social','dj','music','gallery'] },
      // Full ordered list (includes hidden) for restore-defaults logic
      cardOrder: { type: [String], default: () => ['cloudstream','live','social','dj','music','gallery'] },
    },

    // ── Personalization ──────────────────────────────────
    startSection: { type: String, default: '' },       // '' = default hub
    continueWatching: { type: Boolean, default: true },
    continueListening: { type: Boolean, default: true },
    recentlyVisited: { type: Boolean, default: true },
    savedItems: { type: Boolean, default: true },
    mutedTopics: { type: [String], default: () => [] },
  },
  refreshTokens: [{ type: String, select: false }], // Hashed refresh tokens
  chat: {
    blockedUsers: [{ type: String }],   // Firebase UIDs
    mutedUsers:   [{ type: String }],   // Firebase UIDs
  },
}, {
  timestamps: true,
});

// ─── Indexes ────────────────────────────────────────────────
// Note: username and email are already indexed via { unique: true } in the schema definition
// Adding them again would cause Mongoose duplicate-index warnings.
userSchema.index({ 'status.isOnline': 1 });
userSchema.index({ createdAt: -1 });

// ─── Virtual fields ──────────────────────────────────────────
userSchema.virtual('isFounderOrAdmin').get(function () {
  return this.role === 'founder' || this.role === 'admin';
});

// ─── Instance methods ────────────────────────────────────────
userSchema.methods.comparePassword = async function (plaintext) {
  return bcrypt.compare(plaintext, this.passwordHash);
};

userSchema.methods.isSuspendedNow = function () {
  if (!this.status.isSuspended) return false;
  if (this.status.suspendedUntil && this.status.suspendedUntil < new Date()) {
    return false; // Suspension expired
  }
  return true;
};

// Safe public representation (no private fields)
userSchema.methods.toPublicProfile = function () {
  return {
    id: this._id,
    username: this.username,
    role: this.role,
    profile: this.profile,
    stats: this.stats,
    status: {
      isOnline: this.status.isOnline,
      lastSeen: this.status.lastSeen,
    },
    createdAt: this.createdAt,
  };
};

// ─── Static methods ──────────────────────────────────────────
userSchema.statics.hashPassword = async function (plaintext) {
  const SALT_ROUNDS = 12;
  return bcrypt.hash(plaintext, SALT_ROUNDS);
};

const User = mongoose.model('User', userSchema);
module.exports = User;
