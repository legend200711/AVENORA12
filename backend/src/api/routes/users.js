/**
 * User Routes - Avenora
 */

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const User = require('../../models/User');
const Post = require('../../models/Post');
const Follow = require('../../models/Follow');
const { NotFoundError, AppError } = require('../middleware/errorHandler');
const logger = require('../../utils/logger');

// PUT /api/users/profile - Update own profile
// Note: express route matching — this must come BEFORE /:username
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const { displayName, bio, location, website, avatarUrl, bannerUrl } = req.body;
    const update = {};

    if (displayName !== undefined) update['profile.displayName'] = displayName?.slice(0, 60) || '';
    if (bio !== undefined) update['profile.bio'] = bio?.slice(0, 500) || '';
    if (location !== undefined) update['profile.location'] = location?.slice(0, 100) || '';
    if (website !== undefined) update['profile.website'] = website?.slice(0, 200) || '';
    if (avatarUrl !== undefined) update['profile.avatarUrl'] = avatarUrl;
    if (bannerUrl !== undefined) update['profile.bannerUrl'] = bannerUrl;

    // For Firebase users (non-ObjectId uid) find by email instead
    let user;
    if (mongoose.Types.ObjectId.isValid(req.user.id)) {
      user = await User.findByIdAndUpdate(req.user.id, update, { new: true });
    } else if (req.user.email) {
      user = await User.findOneAndUpdate({ email: req.user.email.toLowerCase() }, update, { new: true });
    }
    if (!user) return res.status(404).json({ error: true, message: 'User not found in database. Profile updates require a MongoDB account.' });
    res.json({ success: true, user: user.toPublicProfile() });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:username - Get user profile
router.get('/:username', optionalAuth, async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return next(new NotFoundError('User'));

    const profile = user.toPublicProfile();

    // Check if current user follows this user
    let isFollowing = false;
    let isOwnProfile = false;
    if (req.user) {
      isOwnProfile = req.user.id === user._id.toString();
      if (!isOwnProfile) {
        isFollowing = !!(await Follow.exists({ follower: req.user.id, following: user._id }));
      }
    }

    res.json({ success: true, user: { ...profile, isFollowing, isOwnProfile } });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:username/posts - Get a user's public posts
router.get('/:username/posts', optionalAuth, async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return next(new NotFoundError('User'));

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    // author is stored as a Firebase UID string; match by username-looked-up user._id (MongoDB _id)
    // but since author field is now a String (Firebase UID), we need to query by username's uid
    // Firebase UID is not stored in MongoDB User — match by MongoDB _id string representation
    const posts = await Post.find({ author: user._id.toString(), isDeleted: false, visibility: 'public' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

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

// DELETE /api/users/me/account — self-deletion with full data cleanup
//
// For MongoDB-registered users: soft-deletes the User record (anonymises PII),
// soft-deletes all their posts, removes follow relationships, cleans up
// notifications, and attempts to remove Supabase Storage media.
//
// For Firebase-only users: the Firebase Auth account must be deleted via the
// Firebase SDK (done in the frontend). This route handles all MongoDB-side
// cleanup for data authored by that Firebase UID.
router.delete('/me/account', authenticate, async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const Video = require('../../models/Video');
    const Notification = require('../../models/Notification');
    const Track = require('../../models/Track');
    const userId = req.user.id;
    const isMongoId = mongoose.Types.ObjectId.isValid(userId) && userId.length === 24;

    logger.info(`[Auth] Account deletion requested for user ${userId} (mongoId=${isMongoId})`);

    // ── 1. Soft-delete all posts authored by this user ───────────────────────
    try {
      await Post.updateMany(
        { author: userId, isDeleted: false },
        { $set: { isDeleted: true, deletedAt: new Date(), content: '[deleted]', mediaUrls: [] } }
      );
    } catch (e) {
      logger.warn(`[Auth] Post cleanup failed for ${userId}: ${e.message}`);
    }

    // ── 2. Remove all follow relationships for this user ─────────────────────
    try {
      await Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] });
    } catch (e) {
      logger.warn(`[Auth] Follow cleanup failed for ${userId}: ${e.message}`);
    }

    // ── 3. Remove all notifications sent to or by this user ──────────────────
    try {
      await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });
    } catch (e) {
      logger.warn(`[Auth] Notification cleanup failed for ${userId}: ${e.message}`);
    }

    // ── 4. Soft-delete videos uploaded by this user ───────────────────────────
    let videoStoragePaths = [];
    try {
      const videos = await Video.find({ uploader: userId, isDeleted: false })
        .select('storagePath').lean();
      videoStoragePaths = videos.map(v => v.storagePath).filter(Boolean);
      await Video.updateMany(
        { uploader: userId, isDeleted: false },
        { $set: { isDeleted: true, deletedAt: new Date() } }
      );
    } catch (e) {
      logger.warn(`[Auth] Video cleanup failed for ${userId}: ${e.message}`);
    }

    // ── 5. Soft-delete music tracks uploaded by this user ─────────────────────
    let trackStoragePaths = [];
    try {
      const tracks = await Track.find({ uploader: userId })
        .select('storagePath').lean();
      trackStoragePaths = tracks.map(t => t.storagePath).filter(Boolean);
      await Track.updateMany({ uploader: userId }, { $set: { isDeleted: true, deletedAt: new Date() } });
    } catch (e) {
      logger.warn(`[Auth] Track cleanup failed for ${userId}: ${e.message}`);
    }

    // ── 6. Attempt to remove Supabase Storage media (best-effort) ─────────────
    try {
      const storageService = require('../../services/storage/supabaseStorage');
      const allPaths = [...videoStoragePaths, ...trackStoragePaths];
      // Also try to delete avatar
      allPaths.push(`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.webp`);
      for (const sp of allPaths) {
        if (sp) {
          const bucket = sp.includes('/avatar') ? 'avatars'
            : videoStoragePaths.includes(sp) ? 'videos'
            : trackStoragePaths.includes(sp) ? 'music' : null;
          if (bucket) {
            await storageService.deleteFile(bucket, sp).catch(() => {});
          }
        }
      }
    } catch (e) {
      logger.warn(`[Auth] Storage media cleanup failed for ${userId}: ${e.message}`);
    }

    // ── 7. MongoDB-user-specific: anonymise and invalidate the User record ────
    if (isMongoId) {
      const ts = Date.now();
      await User.findByIdAndUpdate(userId, {
        'status.isActive': false,
        'status.isSuspended': false,
        username: `deleted_${ts}`,
        email: `deleted_${ts}@deleted.legenduniverse.com`,
        'profile.displayName': 'Deleted User',
        'profile.bio': '',
        'profile.avatarUrl': null,
        'profile.bannerUrl': null,
        $set: { refreshTokens: [] },
      });
    }

    logger.info(`[Auth] Account deletion completed for user ${userId}`);
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/follow - Legacy follow route (delegates to social router)
// Kept for backward compatibility with existing frontend API calls
router.post('/:id/follow', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    if (!targetId || typeof targetId !== 'string' || targetId.length < 5) {
      return next(new AppError('Invalid user ID', 422, 'INVALID_ID'));
    }
    if (targetId === req.user.id) {
      return next(new AppError('You cannot follow yourself', 422, 'SELF_FOLLOW'));
    }

    const existing = await Follow.findOne({ follower: req.user.id, following: targetId });
    if (existing) {
      return res.json({ success: true, following: true, message: 'Already following' });
    }

    await Follow.create({ follower: req.user.id, following: targetId });

    // Update stats for MongoDB-backed users only (non-critical)
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

    res.status(201).json({ success: true, following: true, followingId: targetId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
