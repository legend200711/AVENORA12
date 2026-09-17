/**
 * Follow Routes - Avenora
 * POST   /api/social/follow/:userId     - Follow a user
 * DELETE /api/social/follow/:userId     - Unfollow a user
 * GET    /api/social/followers/:userId  - List followers
 * GET    /api/social/following/:userId  - List following
 * GET    /api/social/follow/status/:userId - Check if current user follows target
 */

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const Follow = require('../../models/Follow');
const User = require('../../models/User');
const { createNotification } = require('../../services/notification/notificationService');
const { NotFoundError, ForbiddenError, AppError } = require('../middleware/errorHandler');

// POST /follow/:userId - Follow
router.post('/follow/:userId', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId;

    if (targetId === req.user.id) {
      return next(new AppError('You cannot follow yourself', 422, 'SELF_FOLLOW'));
    }

    // Note: Firebase users may not have a MongoDB User record.
    // We accept any valid Firebase UID as a target; the Follow record is the source of truth.
    if (!targetId || typeof targetId !== 'string' || targetId.length < 5) {
      return next(new AppError('Invalid user ID', 422, 'INVALID_ID'));
    }

    // Upsert — idempotent
    const existing = await Follow.findOne({ follower: req.user.id, following: targetId });
    if (existing) {
      return res.json({ success: true, following: true, message: 'Already following' });
    }

    await Follow.create({ follower: req.user.id, following: targetId });

    // Update denormalized counters for MongoDB User records (non-critical — Firebase users may not have one)
    try {
      const mongoose = require('mongoose');
      const isMongoId = (id) => mongoose.Types.ObjectId.isValid(id) && id.length === 24;
      await Promise.all([
        isMongoId(req.user.id)
          ? User.findByIdAndUpdate(req.user.id, { $inc: { 'stats.followingCount': 1 } })
          : User.findOneAndUpdate({ email: req.user.email }, { $inc: { 'stats.followingCount': 1 } }),
        isMongoId(targetId)
          ? User.findByIdAndUpdate(targetId, { $inc: { 'stats.followersCount': 1 } })
          : Promise.resolve(),
      ]);
    } catch (_) { /* non-critical */ }

    // Notify the followed user (non-critical)
    try {
      await createNotification({
        recipient: targetId,
        sender: req.user.id,
        type: 'follow',
        message: `${req.user.username} started following you`,
      });
    } catch (_) { /* non-critical */ }

    res.status(201).json({ success: true, following: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /follow/:userId - Unfollow
router.delete('/follow/:userId', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId;

    if (targetId === req.user.id) {
      return next(new AppError('You cannot unfollow yourself', 422, 'SELF_UNFOLLOW'));
    }

    const result = await Follow.findOneAndDelete({ follower: req.user.id, following: targetId });

    if (result) {
      // Update counters for MongoDB User records (non-critical)
      try {
        const mongoose = require('mongoose');
        const isMongoId = (id) => mongoose.Types.ObjectId.isValid(id) && id.length === 24;
        await Promise.all([
          isMongoId(req.user.id)
            ? User.findByIdAndUpdate(req.user.id, { $inc: { 'stats.followingCount': -1 } })
            : User.findOneAndUpdate({ email: req.user.email }, { $inc: { 'stats.followingCount': -1 } }),
          isMongoId(targetId)
            ? User.findByIdAndUpdate(targetId, { $inc: { 'stats.followersCount': -1 } })
            : Promise.resolve(),
        ]);
      } catch (_) { /* non-critical */ }
    }

    res.json({ success: true, following: false });
  } catch (err) {
    next(err);
  }
});

// GET /followers/:userId - List followers of a user
router.get('/followers/:userId', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const skip = (page - 1) * limit;

    // follower/following are Firebase UIDs (strings) — no populate available
    const follows = await Follow.find({ following: req.params.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const users = follows.map(f => ({ id: f.follower, uid: f.follower }));
    res.json({ success: true, users, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /following/:userId - List who a user follows
router.get('/following/:userId', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const skip = (page - 1) * limit;

    const follows = await Follow.find({ follower: req.params.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const users = follows.map(f => ({ id: f.following, uid: f.following }));
    res.json({ success: true, users, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /follow/status/:userId - Is current user following target?
router.get('/follow/status/:userId', authenticate, async (req, res, next) => {
  try {
    const exists = await Follow.exists({ follower: req.user.id, following: req.params.userId });
    res.json({ success: true, following: !!exists });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
