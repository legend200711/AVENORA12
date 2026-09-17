/**
 * Admin Routes - Founder Control Center
 * ALL routes here require founder/admin role.
 * Authorization is enforced server-side — frontend role checks are UI-only.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireFounder, requireFounderEmail } = require('../middleware/auth');
const User = require('../../models/User');
const Post = require('../../models/Post');
const Video = require('../../models/Video');
const Stream = require('../../models/Stream');
const Report = require('../../models/Report');
const { getDatabaseStatus } = require('../../config/database');
const logger = require('../../utils/logger');

// All admin routes: must be authenticated, hold founder role,
// AND be the authorized founder account verified server-side.
router.use(authenticate, requireFounder, requireFounderEmail);

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const [userCount, postCount, videoCount, activeStreams] = await Promise.all([
      User.countDocuments({ 'status.isActive': true }),
      Post.countDocuments({ isDeleted: false }),
      Video.countDocuments({ isDeleted: false }),
      Stream.countDocuments({ status: 'live' }),
    ]);

    res.json({
      success: true,
      stats: {
        users: userCount,
        posts: postCount,
        videos: videoCount,
        liveStreams: activeStreams,
        dbStatus: getDatabaseStatus(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const search = req.query.search;

    const query = search
      ? { $or: [{ username: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }] }
      : {};

    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);

    res.json({ success: true, users, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// Helper: find a MongoDB User record regardless of whether `id` is a MongoDB ObjectId
// or a Firebase UID (non-ObjectId string).
async function _findMongoUser(id) {
  const mongoose = require('mongoose');
  if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
    return User.findById(id);
  }
  // Firebase UID: match by firebaseUid field if it exists, otherwise no record
  return User.findOne({ firebaseUid: id });
}

async function _updateMongoUser(id, update, opts) {
  const mongoose = require('mongoose');
  if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
    return User.findByIdAndUpdate(id, update, opts);
  }
  return User.findOneAndUpdate({ firebaseUid: id }, update, opts);
}

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    const validRoles = ['user', 'moderator', 'founder', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(422).json({ error: true, message: 'Invalid role' });
    }

    // Prevent any account from changing its own role
    if (req.params.id === req.user.id) {
      return res.status(403).json({ error: true, message: 'You cannot change your own role' });
    }

    // Granting founder or admin role is exclusively reserved for the authorized founder.
    // requireFounderEmail (applied to all routes above) already ensures only the founder
    // can reach this endpoint, so this is a belt-and-suspenders log/guard.
    if (['founder', 'admin'].includes(role)) {
      const authorizedEmail = (process.env.FOUNDER_EMAIL || '').trim().toLowerCase();
      const callerEmail = (req.user.email || '').trim().toLowerCase();
      if (!authorizedEmail || callerEmail !== authorizedEmail) {
        logger.warn(`Blocked attempt to grant ${role} by ${req.user.username} (${req.user.email})`);
        return res.status(403).json({ error: true, message: 'Only the authorized founder may grant elevated roles' });
      }
    }

    const user = await _updateMongoUser(req.params.id, { role }, { new: true });
    if (!user) return res.status(404).json({ error: true, message: 'User not found' });
    logger.info(`Admin ${req.user.username} changed user ${user.username} role to ${role}`);
    res.json({ success: true, user: user.toPublicProfile() });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/suspend
router.put('/users/:id/suspend', async (req, res, next) => {
  try {
    const { reason, until } = req.body;
    const user = await _updateMongoUser(req.params.id, {
      'status.isSuspended': true,
      'status.suspendedReason': reason || 'Policy violation',
      'status.suspendedUntil': until ? new Date(until) : null,
    }, { new: true });
    if (!user) return res.status(404).json({ error: true, message: 'User not found' });
    logger.info(`Admin ${req.user.username} suspended user ${user.username}`);
    res.json({ success: true, message: 'User suspended' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/unsuspend
router.put('/users/:id/unsuspend', async (req, res, next) => {
  try {
    const user = await _updateMongoUser(req.params.id, {
      'status.isSuspended': false,
      'status.suspendedReason': null,
      'status.suspendedUntil': null,
    }, { new: true });
    if (!user) return res.status(404).json({ error: true, message: 'User not found' });
    res.json({ success: true, message: 'User unsuspended' });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/posts/flagged
router.get('/posts/flagged', async (req, res, next) => {
  try {
    const posts = await Post.find({ isFlagged: true, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, posts });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/reports - All reports (moderators can review via /api/reports, founders see here)
router.get('/reports', async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      Report.find({ status })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Report.countDocuments({ status }),
    ]);

    res.json({ success: true, reports, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/posts/:id
router.delete('/posts/:id', async (req, res, next) => {
  try {
    const post = await Post.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() });
    if (!post) return res.status(404).json({ error: true, message: 'Post not found' });
    logger.info(`Admin ${req.user.username} deleted post ${req.params.id}`);
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/system
router.get('/system', (req, res) => {
  res.json({
    success: true,
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      database: getDatabaseStatus(),
      environment: process.env.NODE_ENV,
    },
  });
});

module.exports = router;
