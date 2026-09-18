/**
 * Notifications Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { getDb, FieldValue } = require('../../config/firestore');

// GET /api/notifications
router.get('/', authenticate, async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const db    = getDb();

    const [nSnap, unreadSnap] = await Promise.all([
      db.collection('notifications')
        .where('recipient', '==', req.user.id)
        .orderBy('createdAt', 'desc')
        .limit(limit * page)
        .get(),
      db.collection('notifications')
        .where('recipient', '==', req.user.id)
        .where('isRead', '==', false)
        .get(),
    ]);

    const all   = nSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const notifications = all.slice((page - 1) * limit, page * limit);
    res.json({ success: true, notifications, unreadCount: unreadSnap.size, page, limit });
  } catch (err) { next(err); }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('notifications').doc(req.params.id).get();
    if (snap.exists && snap.data().recipient === req.user.id) {
      await db.collection('notifications').doc(req.params.id).update({ isRead: true });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('notifications')
      .where('recipient', '==', req.user.id).where('isRead', '==', false).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { isRead: true }));
    if (snap.docs.length) await batch.commit();
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
