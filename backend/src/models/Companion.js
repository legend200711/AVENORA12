/**
 * AVENORA - Companion Model
 * Stores the Avenora Companion Easter egg state per authenticated user.
 * One companion per user. Owner-enforced on all API routes.
 */

const mongoose = require('mongoose');

const dailyTaskSchema = new mongoose.Schema({
  key: { type: String, required: true }, // stable task identifier
  label: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  completedToday: { type: Boolean, default: false },
  lastCompleted: { type: Date },
}, { _id: false });

const companionSchema = new mongoose.Schema({
  userId: {
    type: String,             // Firebase UID
    required: true,
    unique: true,             // one companion per user
    index: true,
  },

  // ── Discovery ──────────────────────────────────────────────
  discovered: { type: Boolean, default: false },
  discoveredAt: { type: Date },

  // ── Identity ───────────────────────────────────────────────
  name: { type: String, maxlength: 32, default: '' },
  appearance: {
    type: String,
    enum: ['scarab', 'anubis', 'ibis', 'cat', 'falcon'],
    default: 'scarab',
  },
  personality: {
    type: String,
    enum: ['calm', 'curious', 'cheerful', 'wise', 'playful'],
    default: 'calm',
  },

  // ── Care stats (0–100) ─────────────────────────────────────
  care: {
    hunger:    { type: Number, min: 0, max: 100, default: 80 },
    water:     { type: Number, min: 0, max: 100, default: 80 },
    happiness: { type: Number, min: 0, max: 100, default: 80 },
    energy:    { type: Number, min: 0, max: 100, default: 80 },
    lastFed:     { type: Date },
    lastWatered: { type: Date },
    lastPlayed:  { type: Date },
  },

  // ── Daily tasks ────────────────────────────────────────────
  // Stored as a fixed array; keys are stable, labels are human-friendly.
  dailyTasks: {
    type: [dailyTaskSchema],
    default: () => [
      { key: 'water',    label: 'Drink a glass of water' },
      { key: 'break',    label: 'Take a short break' },
      { key: 'stretch',  label: 'Stretch for a few minutes' },
      { key: 'song',     label: 'Listen to a favorite song' },
      { key: 'thought',  label: 'Write one positive thought' },
      { key: 'kind',     label: 'Send a kind message to someone' },
      { key: 'offline',  label: 'Spend a few minutes away from the screen' },
      { key: 'goal',     label: 'Work toward a personal goal' },
    ],
  },
  tasksResetAt: { type: Date }, // date tasks were last reset

  // ── Mini-game progress ─────────────────────────────────────
  miniGame: {
    highScore: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
  },

  // ── Cosmetic unlocks ───────────────────────────────────────
  unlockedAppearances: {
    type: [String],
    default: ['scarab'],
  },

  // ── Widget preferences ─────────────────────────────────────
  widgetVisible: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },

}, {
  timestamps: true,
});

// Reset completedToday when a new day begins.
// Called by the GET /me route before returning data.
companionSchema.methods.maybeResetDailyTasks = function () {
  const now = new Date();
  const lastReset = this.tasksResetAt;
  const isNewDay = !lastReset ||
    lastReset.toDateString() !== now.toDateString();

  if (isNewDay) {
    this.dailyTasks.forEach(t => { t.completedToday = false; });
    this.tasksResetAt = now;
    return true; // caller should save
  }
  return false;
};

const Companion = mongoose.model('Companion', companionSchema);
module.exports = Companion;
