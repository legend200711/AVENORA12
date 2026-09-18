/**
 * Social / Follow Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getDb, FieldValue } = require('../../config/firestore');
const { createNotification } = require('../../services/notification/notificationService');
const { AppError } = require('../middleware/errorHandler');

// POST /social/follow/:userId
router.post('/follow/:userId', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user.id) return next(new AppError('You cannot follow yourself', 422, 'SELF_FOLLOW'));
    if (!targetId || targetId.length < 5) return next(new AppError('Invalid user ID', 422, 'INVALID_ID'));

    const db  = getDb();
    const key = `${req.user.id}_${targetId}`;
    const existing = await db.collection('followRelationships').doc(key).get();
    if (existing.exists) return res.json({ success: true, following: true, message: 'Already following' });

    await db.collection('followRelationships').doc(key).set({
      follower: req.user.id, following: targetId, createdAt: new Date().toISOString(),
    });
    try {
      await Promise.all([
        db.collection('users').doc(req.user.id).update({ 'stats.followingCount': FieldValue.increment(1) }),
        db.collection('users').doc(targetId).update({ 'stats.followersCount': FieldValue.increment(1) }),
      ]);
    } catch (_) {}
    try {
      await createNotification({ recipient: targetId, sender: req.user.id, type: 'follow', message: `${req.user.username} started following you` });
    } catch (_) {}

    res.status(201).json({ success: true, following: true });
  } catch (err) { next(err); }
});

// DELETE /social/follow/:userId
router.delete('/follow/:userId', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user.id) return next(new AppError('You cannot unfollow yourself', 422, 'SELF_UNFOLLOW'));
    const db  = getDb();
    const key = `${req.user.id}_${targetId}`;
    const doc = await db.collection('followRelationships').doc(key).get();
    if (doc.exists) {
      await db.collection('followRelationships').doc(key).delete();
      try {
        await Promise.all([
          db.collection('users').doc(req.user.id).update({ 'stats.followingCount': FieldValue.increment(-1) }),
          db.collection('users').doc(targetId).update({ 'stats.followersCount': FieldValue.increment(-1) }),
        ]);
      } catch (_) {}
    }
    res.json({ success: true, following: false });
  } catch (err) { next(err); }
});

// GET /social/followers/:userId
router.get('/followers/:userId', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const snap  = await getDb().collection('followRelationships')
      .where('following', '==', req.params.userId)
      .orderBy('createdAt', 'desc').limit(limit).get();
    const users = snap.docs.map(d => ({ id: d.data().follower, uid: d.data().follower }));
    res.json({ success: true, users });
  } catch (err) { next(err); }
});

// GET /social/following/:userId
router.get('/following/:userId', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const snap  = await getDb().collection('followRelationships')
      .where('follower', '==', req.params.userId)
      .orderBy('createdAt', 'desc').limit(limit).get();
    const users = snap.docs.map(d => ({ id: d.data().following, uid: d.data().following }));
    res.json({ success: true, users });
  } catch (err) { next(err); }
});

// GET /social/follow/status/:userId
router.get('/follow/status/:userId', authenticate, async (req, res, next) => {
  try {
    const key   = `${req.user.id}_${req.params.userId}`;
    const doc   = await getDb().collection('followRelationships').doc(key).get();
    res.json({ success: true, following: doc.exists });
  } catch (err) { next(err); }
});

module.exports = router;
