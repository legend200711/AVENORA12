/**
 * Stories Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getDb, FieldValue } = require('../../config/firestore');
const { NotFoundError, ForbiddenError } = require('../middleware/errorHandler');

const STORY_DURATION_MS = 24 * 60 * 60 * 1000;

// GET /api/stories — followed users' stories
router.get('/', authenticate, async (req, res, next) => {
  try {
    const db  = getDb();
    const now = new Date().toISOString();

    const folSnap  = await db.collection('followRelationships').where('follower', '==', req.user.id).get();
    const followingIds = folSnap.docs.map(d => d.data().following);
    const authorIds    = [req.user.id, ...followingIds];

    // Firestore 'in' query supports up to 30 values; chunk if needed
    const chunks = [];
    for (let i = 0; i < authorIds.length; i += 30) chunks.push(authorIds.slice(i, i + 30));

    let stories = [];
    for (const chunk of chunks) {
      const snap = await db.collection('stories')
        .where('author', 'in', chunk)
        .where('expiresAt', '>', now)
        .where('isDeleted', '==', false)
        .orderBy('expiresAt')
        .orderBy('createdAt', 'desc')
        .get();
      stories.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    const withViewed = stories.map(s => ({
      ...s,
      viewedByMe: (s.viewers || []).includes(req.user.id),
      viewCount:  (s.viewers || []).length,
    }));
    res.json({ success: true, stories: withViewed });
  } catch (err) { next(err); }
});

// GET /api/stories/:userId
router.get('/:userId', optionalAuth, async (req, res, next) => {
  try {
    const now  = new Date().toISOString();
    const snap = await getDb().collection('stories')
      .where('author', '==', req.params.userId)
      .where('expiresAt', '>', now)
      .where('isDeleted', '==', false)
      .orderBy('expiresAt')
      .orderBy('createdAt', 'desc')
      .get();
    const uid      = req.user?.id;
    const stories  = snap.docs.map(d => {
      const s = { id: d.id, ...d.data() };
      return { ...s, viewedByMe: uid ? (s.viewers || []).includes(uid) : false, viewCount: (s.viewers || []).length };
    });
    res.json({ success: true, stories });
  } catch (err) { next(err); }
});

// POST /api/stories
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { mediaUrl, mediaType, caption } = req.body;
    if (!mediaUrl) return res.status(422).json({ error: true, message: 'Media URL required' });
    if (!['image','video'].includes(mediaType)) return res.status(422).json({ error: true, message: 'mediaType must be image or video' });

    const db   = getDb();
    const ref  = db.collection('stories').doc();
    const story = {
      id: ref.id, author: req.user.id, mediaUrl, mediaType,
      caption: caption?.slice(0, 500) || '',
      viewers: [], isDeleted: false,
      expiresAt:  new Date(Date.now() + STORY_DURATION_MS).toISOString(),
      createdAt:  new Date().toISOString(),
    };
    await ref.set(story);
    res.status(201).json({ success: true, story });
  } catch (err) { next(err); }
});

// POST /api/stories/:id/view
router.post('/:id/view', authenticate, async (req, res, next) => {
  try {
    const now  = new Date().toISOString();
    const snap = await getDb().collection('stories').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted || snap.data().expiresAt <= now) return next(new NotFoundError('Story'));
    await getDb().collection('stories').doc(snap.id).update({ viewers: FieldValue.arrayUnion(req.user.id) });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/stories/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const snap = await getDb().collection('stories').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Story'));
    if (snap.data().author !== req.user.id) return next(new ForbiddenError());
    await getDb().collection('stories').doc(snap.id).update({ isDeleted: true });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
