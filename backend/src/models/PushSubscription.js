/**
 * PushSubscription Model — Web Push VAPID
 * Stores browser Web Push subscriptions for a user.
 * One user may have multiple subscriptions (different devices/browsers).
 */

const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  // Firebase UID or MongoDB ObjectId string — whichever is used for auth
  userId: { type: String, required: true, index: true },

  // The full subscription object from PushManager.subscribe()
  endpoint: { type: String, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth:   { type: String, required: true },
  },

  // UA string for debugging
  userAgent: { type: String, maxlength: 400 },
}, {
  timestamps: true,
});

// One subscription per endpoint per user (endpoint is globally unique per browser profile)
pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
module.exports = PushSubscription;
