/**
 * Post Routes - Avenora Feed
 */

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth, requireModerator } = require('../middleware/auth');
const Post = require('../../models/Post');
const User = require('../../models/User');
const { createNotification } = require('../../services/notification/notificationService');
const { NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
const { body, validationResult } = require('express-validator');

// ─── Feed ────────────────────────────────────────────────────

// GET /api/posts - Public feed (most recent, paginated)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    // Optional: filter by author
    const filter = { isDeleted: false, visibility: 'public' };
    if (req.query.author) filter.author = req.query.author;

    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Attach likedByMe flag if user is authenticated
    const currentUserId = req.user?.id;
    const enriched = posts.map(p => ({
      ...p,
      likedByMe: currentUserId ? p.likes.some(id => id.toString() === currentUserId) : false,
      likeCount: p.likes.length,
      commentCount: (p.comments || []).filter(c => !c.isDeleted).length,
      repostCount: (p.reposts || []).length,
    }));

    res.json({ success: true, posts: enriched, page, limit });
  } catch (err) {
    next(err);
  }
});

// ─── Create ──────────────────────────────────────────────────

// POST /api/posts - Create post
router.post('/',
  authenticate,
  [body('content').optional().isLength({ max: 10000 })],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ error: true, message: errors.array()[0].msg });
      }

      const { content, mediaUrls, tags } = req.body;
      if (!content?.trim() && (!mediaUrls || !mediaUrls.length)) {
        return res.status(422).json({ error: true, message: 'Post must have content or media' });
      }

      const post = await Post.create({
        author: req.user.id,
        content: content?.slice(0, 10000),
        mediaUrls: (mediaUrls || []).slice(0, 10),
        tags: (tags || []).slice(0, 20),
      });

      // Update post count (non-critical for Firebase-only users)
      try {
        const mongoose = require('mongoose');
        if (mongoose.Types.ObjectId.isValid(req.user.id)) {
          await User.findByIdAndUpdate(req.user.id, { $inc: { 'stats.postsCount': 1 } });
        }
      } catch (_) { /* non-critical */ }

      res.status(201).json({ success: true, post: post.toObject() });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/posts/:id/repost - Repost
router.post('/:id/repost', authenticate, async (req, res, next) => {
  try {
    const original = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!original) return next(new NotFoundError('Post'));

    // Check if already reposted by this user
    if (original.reposts.includes(req.user.id)) {
      // Undo repost
      original.reposts.pull(req.user.id);
      await original.save();
      return res.json({ success: true, reposted: false, repostCount: original.reposts.length });
    }

    // Add to original's repost list
    original.reposts.push(req.user.id);
    await original.save();

    // Create a repost entry in user's feed
    const repost = await Post.create({
      author: req.user.id,
      type: 'repost',
      originalPost: original._id,
      content: req.body.comment?.slice(0, 10000) || '',
      visibility: 'public',
    });

    // Notify original author
    if (original.author.toString() !== req.user.id) {
      await createNotification({
        recipient: original.author,
        sender: req.user.id,
        type: 'repost',
        post: original._id,
        message: `${req.user.username} reposted your post`,
      });
    }

    res.status(201).json({ success: true, reposted: true, repostCount: original.reposts.length });
  } catch (err) {
    next(err);
  }
});

// ─── Edit / Delete ───────────────────────────────────────────

// PUT /api/posts/:id - Edit post (owner only, server-enforced)
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post || post.isDeleted) return next(new NotFoundError('Post'));

    // Server-side ownership check
    if (post.author.toString() !== req.user.id) return next(new ForbiddenError());

    post.content = req.body.content?.slice(0, 10000);
    post.isEdited = true;
    post.editedAt = new Date();
    await post.save();

    res.json({ success: true, post: post.toObject() });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:id - Delete post (owner or moderator, server-enforced)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post || post.isDeleted) return next(new NotFoundError('Post'));

    const isOwner = post.author.toString() === req.user.id;
    const isMod = ['moderator', 'founder', 'admin'].includes(req.user.role);
    if (!isOwner && !isMod) return next(new ForbiddenError());

    post.isDeleted = true;
    post.deletedAt = new Date();
    await post.save();

    // Decrement user's post count (non-critical for Firebase-only users)
    if (isOwner) {
      try {
        const mongoose = require('mongoose');
        if (mongoose.Types.ObjectId.isValid(req.user.id)) {
          await User.findByIdAndUpdate(req.user.id, { $inc: { 'stats.postsCount': -1 } });
        }
      } catch (_) { /* non-critical */ }
    }

    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    next(err);
  }
});

// ─── Likes ───────────────────────────────────────────────────

// POST /api/posts/:id/like - Toggle like (server prevents duplicates)
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return next(new NotFoundError('Post'));

    const userId = req.user.id;
    const liked = post.likes.some(id => id.toString() === userId);

    if (liked) {
      post.likes.pull(userId);
    } else {
      post.likes.push(userId);
      // Notify post author on new like
      if (post.author.toString() !== userId) {
        await createNotification({
          recipient: post.author,
          sender: userId,
          type: 'like',
          post: post._id,
          message: `${req.user.username} liked your post`,
        });
      }
    }
    await post.save();

    res.json({ success: true, liked: !liked, likeCount: post.likes.length });
  } catch (err) {
    next(err);
  }
});

// ─── Comments ────────────────────────────────────────────────

// POST /api/posts/:id/comment - Add comment
router.post('/:id/comment', authenticate, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(422).json({ error: true, message: 'Comment cannot be empty' });
    }

    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return next(new NotFoundError('Post'));

    const comment = {
      author: req.user.id,
      content: content.slice(0, 2000).trim(),
    };
    post.comments.push(comment);
    await post.save();

    // Get the newly added comment with its ID
    const newComment = post.comments[post.comments.length - 1];

    // Notify post author
    if (post.author.toString() !== req.user.id) {
      await createNotification({
        recipient: post.author,
        sender: req.user.id,
        type: 'comment',
        post: post._id,
        message: `${req.user.username} commented on your post`,
      });
    }

    res.status(201).json({ success: true, commentId: newComment._id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:id/comment/:commentId - Delete comment (owner or moderator)
router.delete('/:id/comment/:commentId', authenticate, async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return next(new NotFoundError('Post'));

    const comment = post.comments.id(req.params.commentId);
    if (!comment || comment.isDeleted) return next(new NotFoundError('Comment'));

    const isCommentOwner = comment.author.toString() === req.user.id;
    const isPostOwner = post.author.toString() === req.user.id;
    const isMod = ['moderator', 'founder', 'admin'].includes(req.user.role);

    if (!isCommentOwner && !isPostOwner && !isMod) return next(new ForbiddenError());

    comment.isDeleted = true;
    await post.save();

    res.json({ success: true, message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/:id/comments - Get comments for a post
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false }).lean();

    if (!post) return next(new NotFoundError('Post'));

    const comments = (post.comments || [])
      .filter(c => !c.isDeleted)
      .map(c => ({
        ...c,
        isOwn: req.user ? c.author?._id?.toString() === req.user.id : false,
      }));

    res.json({ success: true, comments });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
