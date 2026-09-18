/**
 * Post Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getDb, FieldValue } = require('../../config/firestore');
const { createNotification } = require('../../services/notification/notificationService');
const { NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
const { body, validationResult } = require('express-validator');

// GET /api/posts
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const db    = getDb();

    let q = db.collection('posts').where('isDeleted', '==', false).where('visibility', '==', 'public');
    if (req.query.author) q = q.where('author', '==', req.query.author);
    q = q.orderBy('createdAt', 'desc').limit(limit * page);

    const snap    = await q.get();
    const all     = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const posts   = all.slice((page - 1) * limit, page * limit);
    const uid     = req.user?.id;

    const enriched = posts.map(p => ({
      ...p,
      likedByMe:    uid ? (p.likes || []).includes(uid) : false,
      likeCount:    (p.likes || []).length,
      commentCount: (p.comments || []).filter(c => !c.isDeleted).length,
      repostCount:  (p.reposts || []).length,
    }));
    res.json({ success: true, posts: enriched, page, limit });
  } catch (err) { next(err); }
});

// POST /api/posts
router.post('/', authenticate, [body('content').optional().isLength({ max: 10000 })], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ error: true, message: errors.array()[0].msg });

    const { content, mediaUrls, tags } = req.body;
    if (!content?.trim() && (!mediaUrls?.length)) return res.status(422).json({ error: true, message: 'Post must have content or media' });

    const db  = getDb();
    const ref = db.collection('posts').doc();
    const post = {
      id:        ref.id,
      author:    req.user.id,
      content:   content?.slice(0, 10000) || '',
      mediaUrls: (mediaUrls || []).slice(0, 10),
      tags:      (tags || []).slice(0, 20),
      likes:     [],
      reposts:   [],
      comments:  [],
      type:      'post',
      visibility:'public',
      isDeleted: false,
      isEdited:  false,
      isFlagged: false,
      reportCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await ref.set(post);
    // Increment post count (non-critical)
    try { await db.collection('users').doc(req.user.id).update({ 'stats.postsCount': FieldValue.increment(1) }); } catch (_) {}

    res.status(201).json({ success: true, post });
  } catch (err) { next(err); }
});

// POST /api/posts/:id/repost
router.post('/:id/repost', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('posts').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Post'));
    const original = { id: snap.id, ...snap.data() };

    const reposts = original.reposts || [];
    if (reposts.includes(req.user.id)) {
      await db.collection('posts').doc(snap.id).update({ reposts: FieldValue.arrayRemove(req.user.id) });
      return res.json({ success: true, reposted: false, repostCount: reposts.length - 1 });
    }

    await db.collection('posts').doc(snap.id).update({ reposts: FieldValue.arrayUnion(req.user.id) });
    const repostRef = db.collection('posts').doc();
    await repostRef.set({
      id: repostRef.id, author: req.user.id, type: 'repost', originalPost: snap.id,
      content: req.body.comment?.slice(0, 10000) || '', likes: [], reposts: [], comments: [],
      visibility: 'public', isDeleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    if (original.author !== req.user.id) {
      await createNotification({ recipient: original.author, sender: req.user.id, type: 'repost', postId: snap.id, message: `${req.user.username} reposted your post` });
    }
    res.status(201).json({ success: true, reposted: true, repostCount: reposts.length + 1 });
  } catch (err) { next(err); }
});

// PUT /api/posts/:id
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('posts').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Post'));
    if (snap.data().author !== req.user.id) return next(new ForbiddenError());
    await db.collection('posts').doc(snap.id).update({ content: req.body.content?.slice(0, 10000), isEdited: true, editedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const updated = await db.collection('posts').doc(snap.id).get();
    res.json({ success: true, post: { id: updated.id, ...updated.data() } });
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('posts').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Post'));
    const post = snap.data();
    const isOwner = post.author === req.user.id;
    const isMod   = ['moderator','founder','admin'].includes(req.user.role);
    if (!isOwner && !isMod) return next(new ForbiddenError());
    await db.collection('posts').doc(snap.id).update({ isDeleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    if (isOwner) { try { await db.collection('users').doc(req.user.id).update({ 'stats.postsCount': FieldValue.increment(-1) }); } catch (_) {} }
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) { next(err); }
});

// POST /api/posts/:id/like
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('posts').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Post'));
    const post  = snap.data();
    const uid   = req.user.id;
    const liked = (post.likes || []).includes(uid);
    if (liked) {
      await db.collection('posts').doc(snap.id).update({ likes: FieldValue.arrayRemove(uid) });
    } else {
      await db.collection('posts').doc(snap.id).update({ likes: FieldValue.arrayUnion(uid) });
      if (post.author !== uid) {
        await createNotification({ recipient: post.author, sender: uid, type: 'like', postId: snap.id, message: `${req.user.username} liked your post` });
      }
    }
    const likeCount = liked ? (post.likes || []).length - 1 : (post.likes || []).length + 1;
    res.json({ success: true, liked: !liked, likeCount });
  } catch (err) { next(err); }
});

// POST /api/posts/:id/comment
router.post('/:id/comment', authenticate, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(422).json({ error: true, message: 'Comment cannot be empty' });
    const db   = getDb();
    const snap = await db.collection('posts').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Post'));
    const post = snap.data();
    const commentId = db.collection('_').doc().id;
    const comment   = { _id: commentId, author: req.user.id, content: content.slice(0, 2000).trim(), isDeleted: false, createdAt: new Date().toISOString() };
    await db.collection('posts').doc(snap.id).update({ comments: FieldValue.arrayUnion(comment) });
    if (post.author !== req.user.id) {
      await createNotification({ recipient: post.author, sender: req.user.id, type: 'comment', postId: snap.id, message: `${req.user.username} commented on your post` });
    }
    res.status(201).json({ success: true, commentId });
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/comment/:commentId
router.delete('/:id/comment/:commentId', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('posts').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Post'));
    const post    = snap.data();
    const comment = (post.comments || []).find(c => c._id === req.params.commentId);
    if (!comment || comment.isDeleted) return next(new NotFoundError('Comment'));

    const isCommentOwner = comment.author === req.user.id;
    const isPostOwner    = post.author === req.user.id;
    const isMod          = ['moderator','founder','admin'].includes(req.user.role);
    if (!isCommentOwner && !isPostOwner && !isMod) return next(new ForbiddenError());

    const updatedComments = (post.comments || []).map(c =>
      c._id === req.params.commentId ? { ...c, isDeleted: true } : c
    );
    await db.collection('posts').doc(snap.id).update({ comments: updatedComments });
    res.json({ success: true, message: 'Comment deleted' });
  } catch (err) { next(err); }
});

// GET /api/posts/:id/comments
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const snap = await getDb().collection('posts').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Post'));
    const comments = (snap.data().comments || []).filter(c => !c.isDeleted).map(c => ({
      ...c, isOwn: req.user ? c.author === req.user.id : false,
    }));
    res.json({ success: true, comments });
  } catch (err) { next(err); }
});

module.exports = router;
