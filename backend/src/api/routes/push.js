/**
 * Push Notifications Routes — Web Push (VAPID)
 *
 * Mount: /api/push
 *
 * Endpoints:
 *   GET  /vapid-public-key            — Returns the VAPID public key for PushManager.subscribe()
 *   POST /subscribe                   — Save a new browser push subscription
 *   DELETE /subscribe                 — Remove a push subscription (unsubscribe)
 *   POST /send (founder/admin only)   — Send a push notification to all subscribers or a specific user
 *
 * VAPID keys are kept server-side only (VAPID_PRIVATE_KEY never leaves the backend).
 * The public key is safe to expose; it is sent to the browser for PushManager.subscribe().
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireFounder } = require('../middleware/auth');
const PushSubscription = require('../../models/PushSubscription');
const logger = require('../../utils/logger');

// ─── Lazy-init web-push ───────────────────────────────────────────────────────
let _webPush = null;
let _webPushConfigured = false;

function getWebPush() {
  if (_webPush && _webPushConfigured) return _webPush;

  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || `mailto:${process.env.FOUNDER_EMAIL || 'admin@avenora.app'}`;

  if (!vapidPublic || !vapidPrivate) {
    return null; // not configured — routes will return 503
  }

  if (!_webPush) {
    _webPush = require('web-push');
  }

  if (!_webPushConfigured) {
    _webPush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    _webPushConfigured = true;
    logger.info('[Push] web-push VAPID details configured');
  }

  return _webPush;
}

// ─── GET /api/push/vapid-public-key ──────────────────────────────────────────
// Returns the VAPID public key so the browser can call PushManager.subscribe().
// No auth required — the public key is not secret.
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return res.status(503).json({
      error: true,
      message: 'Web Push is not configured on this server.',
      code: 'PUSH_NOT_CONFIGURED',
    });
  }
  res.json({ success: true, vapidPublicKey: key });
});

// ─── POST /api/push/subscribe ─────────────────────────────────────────────────
// Save a browser push subscription for the authenticated user.
// Body: { subscription: { endpoint, keys: { p256dh, auth } } }
router.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const wp = getWebPush();
    if (!wp) {
      return res.status(503).json({
        error: true,
        message: 'Web Push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the server environment.',
        code: 'PUSH_NOT_CONFIGURED',
      });
    }

    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(422).json({ error: true, message: 'Invalid subscription object. Expected { endpoint, keys: { p256dh, auth } }' });
    }

    // Upsert — same user + same endpoint → update (device may refresh its subscription)
    await PushSubscription.findOneAndUpdate(
      { userId: req.user.id, endpoint: subscription.endpoint },
      {
        userId:    req.user.id,
        endpoint:  subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth:   subscription.keys.auth,
        },
        userAgent: req.headers['user-agent']?.slice(0, 400),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info(`[Push] Subscription saved for user ${req.user.id}`);
    res.status(201).json({ success: true, message: 'Push subscription saved.' });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/push/subscribe ───────────────────────────────────────────────
// Remove a push subscription for the authenticated user.
// Body: { endpoint: '...' }
router.delete('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(422).json({ error: true, message: 'endpoint required' });

    await PushSubscription.deleteOne({ userId: req.user.id, endpoint });

    logger.info(`[Push] Subscription removed for user ${req.user.id}`);
    res.json({ success: true, message: 'Push subscription removed.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/push/send ──────────────────────────────────────────────────────
// Send a push notification. Founder/admin only.
// Body: { title, body, url?, userId? }
//   If userId is provided, only send to that user's subscriptions.
//   Otherwise, broadcast to all subscriptions (use sparingly).
router.post('/send', authenticate, requireFounder, async (req, res, next) => {
  try {
    const wp = getWebPush();
    if (!wp) {
      return res.status(503).json({
        error: true,
        message: 'Web Push is not configured.',
        code: 'PUSH_NOT_CONFIGURED',
      });
    }

    const { title, body, url, userId: targetUserId, icon } = req.body;
    if (!title || !body) {
      return res.status(422).json({ error: true, message: 'title and body required' });
    }

    const payload = JSON.stringify({
      title:  String(title).slice(0, 200),
      body:   String(body).slice(0, 500),
      url:    url  ? String(url).slice(0, 500) : undefined,
      icon:   icon ? String(icon).slice(0, 500) : undefined,
    });

    const query = targetUserId ? { userId: targetUserId } : {};
    const subscriptions = await PushSubscription.find(query).lean();

    if (!subscriptions.length) {
      return res.json({ success: true, sent: 0, message: 'No subscriptions found.' });
    }

    let sent = 0;
    let failed = 0;
    const expired = [];

    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload
        );
        sent++;
      } catch (err) {
        // 410 Gone / 404 = subscription expired — remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
          expired.push(sub._id);
        } else {
          logger.warn(`[Push] Send failed for sub ${sub._id}: ${err.message}`);
        }
        failed++;
      }
    }));

    // Clean up expired subscriptions
    if (expired.length) {
      await PushSubscription.deleteMany({ _id: { $in: expired } });
      logger.info(`[Push] Cleaned ${expired.length} expired subscriptions`);
    }

    logger.info(`[Push] Notification sent: ${sent} succeeded, ${failed} failed`);
    res.json({ success: true, sent, failed, expiredCleaned: expired.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
