/**
 * Push Notifications Routes — Web Push (VAPID) — Firestore edition
 *
 * Collection: pushSubscriptions/{userId_endpointHash}
 *
 * GET  /api/push/vapid-public-key   — Returns the VAPID public key
 * POST /api/push/subscribe          — Save a browser push subscription
 * DELETE /api/push/subscribe        — Remove a push subscription
 * POST /api/push/send               — Send push (founder/admin only)
 */

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticate, requireFounder } = require('../middleware/auth');
const { getDb, now } = require('../../config/firestore');
const logger = require('../../utils/logger');

// ─── Lazy-init web-push ───────────────────────────────────────────────────────
let _webPush = null;
let _webPushConfigured = false;

function getWebPush() {
  if (_webPush && _webPushConfigured) return _webPush;
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || `mailto:${process.env.FOUNDER_EMAIL || 'admin@avenora.app'}`;
  if (!vapidPublic || !vapidPrivate) return null;
  if (!_webPush) _webPush = require('web-push');
  if (!_webPushConfigured) {
    _webPush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    _webPushConfigured = true;
    logger.info('[Push] web-push VAPID details configured');
  }
  return _webPush;
}

function _subDocId(userId, endpoint) {
  const hash = crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
  return `${userId}_${hash}`;
}

// ─── GET /api/push/vapid-public-key ──────────────────────────────────────────
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: true, message: 'Web Push is not configured on this server.', code: 'PUSH_NOT_CONFIGURED' });
  res.json({ success: true, vapidPublicKey: key });
});

// ─── POST /api/push/subscribe ─────────────────────────────────────────────────
router.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const wp = getWebPush();
    if (!wp) return res.status(503).json({ error: true, message: 'Web Push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.', code: 'PUSH_NOT_CONFIGURED' });

    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(422).json({ error: true, message: 'Invalid subscription object.' });
    }

    const db  = getDb();
    const id  = _subDocId(req.user.id, subscription.endpoint);
    await db.collection('pushSubscriptions').doc(id).set({
      userId:    req.user.id,
      endpoint:  subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth:   subscription.keys.auth,
      },
      userAgent:  req.headers['user-agent']?.slice(0, 400) || null,
      updatedAt:  now(),
    }, { merge: true });

    logger.info(`[Push] Subscription saved for user ${req.user.id}`);
    res.status(201).json({ success: true, message: 'Push subscription saved.' });
  } catch (err) { next(err); }
});

// ─── DELETE /api/push/subscribe ───────────────────────────────────────────────
router.delete('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(422).json({ error: true, message: 'endpoint required' });

    const db = getDb();
    const id = _subDocId(req.user.id, endpoint);
    await db.collection('pushSubscriptions').doc(id).delete();

    logger.info(`[Push] Subscription removed for user ${req.user.id}`);
    res.json({ success: true, message: 'Push subscription removed.' });
  } catch (err) { next(err); }
});

// ─── POST /api/push/send ──────────────────────────────────────────────────────
router.post('/send', authenticate, requireFounder, async (req, res, next) => {
  try {
    const wp = getWebPush();
    if (!wp) return res.status(503).json({ error: true, message: 'Web Push is not configured.', code: 'PUSH_NOT_CONFIGURED' });

    const { title, body, url, userId: targetUserId, icon } = req.body;
    if (!title || !body) return res.status(422).json({ error: true, message: 'title and body required' });

    const payload = JSON.stringify({
      title: String(title).slice(0, 200),
      body:  String(body).slice(0, 500),
      url:   url  ? String(url).slice(0, 500)  : undefined,
      icon:  icon ? String(icon).slice(0, 500) : undefined,
    });

    const db = getDb();
    let q = db.collection('pushSubscriptions');
    if (targetUserId) q = q.where('userId', '==', targetUserId);
    const snap = await q.limit(1000).get();
    const subscriptions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!subscriptions.length) return res.json({ success: true, sent: 0, message: 'No subscriptions found.' });

    let sent = 0, failed = 0;
    const expired = [];

    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await wp.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) expired.push(sub.id);
        else logger.warn(`[Push] Send failed for sub ${sub.id}: ${err.message}`);
        failed++;
      }
    }));

    // Clean up expired
    if (expired.length) {
      const batch = db.batch();
      expired.forEach(id => batch.delete(db.collection('pushSubscriptions').doc(id)));
      await batch.commit();
      logger.info(`[Push] Cleaned ${expired.length} expired subscriptions`);
    }

    logger.info(`[Push] Notification sent: ${sent} succeeded, ${failed} failed`);
    res.json({ success: true, sent, failed, expiredCleaned: expired.length });
  } catch (err) { next(err); }
});

module.exports = router;
