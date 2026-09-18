/**
 * User Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getDb, FieldValue } = require('../../config/firestore');
const { NotFoundError, AppError } = require('../middleware/errorHandler');
const logger  = require('../../utils/logger');

// PUT /api/users/profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { displayName, bio, location, website, avatarUrl, bannerUrl } = req.body;
    const update = {};
    if (displayName !== undefined) update['profile.displayName'] = String(displayName).slice(0, 60);
    if (bio        !== undefined) update['profile.bio']         = String(bio).slice(0, 500);
    if (location   !== undefined) update['profile.location']    = String(location).slice(0, 100);
    if (website    !== undefined) update['profile.website']     = String(website).slice(0, 200);
    if (avatarUrl  !== undefined) update['profile.avatarUrl']   = avatarUrl;
    if (bannerUrl  !== undefined) update['profile.bannerUrl']   = bannerUrl;
    update.updatedAt = new Date().toISOString();

    await getDb().collection('users').doc(req.user.id).update(update);
    const snap = await getDb().collection('users').doc(req.user.id).get();
    const { passwordHash, passwordReset, ...safe } = snap.data();
    res.json({ success: true, user: { id: snap.id, ...safe } });
  } catch (err) { next(err); }
});

// GET /api/users/:username
router.get('/:username', optionalAuth, async (req, res, next) => {
  try {
    const snap = await getDb().collection('users')
      .where('username', '==', req.params.username).limit(1).get();
    if (snap.empty) return next(new NotFoundError('User'));

    const { passwordHash, passwordReset, ...profile } = snap.docs[0].data();
    const userId = snap.docs[0].id;

    let isFollowing = false;
    let isOwnProfile = false;
    if (req.user) {
      isOwnProfile = req.user.id === userId;
      if (!isOwnProfile) {
        const fSnap = await getDb().collection('followRelationships')
          .where('follower', '==', req.user.id).where('following', '==', userId).limit(1).get();
        isFollowing = !fSnap.empty;
      }
    }
    res.json({ success: true, user: { id: userId, ...profile, isFollowing, isOwnProfile } });
  } catch (err) { next(err); }
});

// GET /api/users/:username/posts
router.get('/:username/posts', optionalAuth, async (req, res, next) => {
  try {
    const userSnap = await getDb().collection('users')
      .where('username', '==', req.params.username).limit(1).get();
    if (userSnap.empty) return next(new NotFoundError('User'));
    const userId = userSnap.docs[0].id;

    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);

    // Firestore: orderBy + limit (no skip — use cursor pagination for production scale)
    const snap = await getDb().collection('posts')
      .where('author', '==', userId)
      .where('isDeleted', '==', false)
      .where('visibility', '==', 'public')
      .orderBy('createdAt', 'desc')
      .limit(limit * page)  // crude offset for now
      .get();

    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const posts = all.slice((page - 1) * limit, page * limit);
    const currentUserId = req.user?.id;

    const enriched = posts.map(p => ({
      ...p,
      likedByMe:    currentUserId ? (p.likes || []).includes(currentUserId) : false,
      likeCount:    (p.likes || []).length,
      commentCount: (p.comments || []).filter(c => !c.isDeleted).length,
      repostCount:  (p.reposts || []).length,
    }));
    res.json({ success: true, posts: enriched, page, limit });
  } catch (err) { next(err); }
});

// DELETE /api/users/me/account
router.delete('/me/account', authenticate, async (req, res, next) => {
  try {
    const uid = req.user.id;
    const db  = getDb();
    logger.info(`[Auth] Account deletion requested for ${uid}`);

    // Soft-delete posts
    const postsSnap = await db.collection('posts').where('author', '==', uid).where('isDeleted', '==', false).get();
    const batch1 = db.batch();
    postsSnap.docs.forEach(d => batch1.update(d.ref, { isDeleted: true, deletedAt: new Date().toISOString(), content: '[deleted]', mediaUrls: [] }));
    if (postsSnap.docs.length) await batch1.commit();

    // Delete follow relationships
    const [fol, fing] = await Promise.all([
      db.collection('followRelationships').where('follower', '==', uid).get(),
      db.collection('followRelationships').where('following', '==', uid).get(),
    ]);
    const batch2 = db.batch();
    [...fol.docs, ...fing.docs].forEach(d => batch2.delete(d.ref));
    if (fol.docs.length + fing.docs.length) await batch2.commit();

    // Delete notifications
    const [nRec, nSnd] = await Promise.all([
      db.collection('notifications').where('recipient', '==', uid).get(),
      db.collection('notifications').where('sender', '==', uid).get(),
    ]);
    const batch3 = db.batch();
    [...nRec.docs, ...nSnd.docs].forEach(d => batch3.delete(d.ref));
    if (nRec.docs.length + nSnd.docs.length) await batch3.commit();

    // Anonymise user record
    const ts = Date.now();
    await db.collection('users').doc(uid).update({
      'status.isActive': false,
      username: `deleted_${ts}`,
      email: `deleted_${ts}@deleted.avenora.app`,
      'profile.displayName': 'Deleted User',
      'profile.bio': '',
      'profile.avatarUrl': null,
      'profile.bannerUrl': null,
      updatedAt: new Date().toISOString(),
    });

    logger.info(`[Auth] Account deletion completed for ${uid}`);
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) { next(err); }
});

// POST /api/users/:id/follow
router.post('/:id/follow', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    if (!targetId || targetId.length < 5) return next(new AppError('Invalid user ID', 422, 'INVALID_ID'));
    if (targetId === req.user.id) return next(new AppError('You cannot follow yourself', 422, 'SELF_FOLLOW'));

    const db  = getDb();
    const key = `${req.user.id}_${targetId}`;
    const existing = await db.collection('followRelationships').doc(key).get();
    if (existing.exists) return res.json({ success: true, following: true, message: 'Already following' });

    await db.collection('followRelationships').doc(key).set({
      follower: req.user.id, following: targetId, createdAt: new Date().toISOString(),
    });
    // Increment counters (non-critical)
    try {
      await Promise.all([
        db.collection('users').doc(req.user.id).update({ 'stats.followingCount': FieldValue.increment(1) }),
        db.collection('users').doc(targetId).update({ 'stats.followersCount': FieldValue.increment(1) }),
      ]);
    } catch (_) {}

    res.status(201).json({ success: true, following: true, followingId: targetId });
  } catch (err) { next(err); }
});

module.exports = router;
