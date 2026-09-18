/**
 * AVENORA VIDEO — Videos API Routes (expanded)
 * Covers: list, get, like, comments, watch-later, history,
 *         upload, channels, report, moderation
 */

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');

const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { NotFoundError, ForbiddenError, ValidationError } = require('../middleware/errorHandler');
const Video        = require('../../models/Video');
const VideoComment = require('../../models/VideoComment');
const WatchHistory = require('../../models/WatchHistory');
const Channel      = require('../../models/Channel');
const Report       = require('../../models/Report');
const storageSvc   = require('../../services/storage/supabaseStorage');

// ─── Multer — memory storage; files uploaded to Supabase Storage ─────────────
const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4','video/webm','video/ogg','video/quicktime','video/x-msvideo',
]);
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg','image/png','image/webp',
]);
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_THUMB_BYTES = 5 * 1024 * 1024;         // 5 MB

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter(req, file, cb) {
    if (file.fieldname === 'video' && !ALLOWED_VIDEO_MIME.has(file.mimetype)) {
      return cb(new ValidationError('Unsupported video format. Use MP4, WebM, MOV, or AVI.'));
    }
    if (file.fieldname === 'thumbnail' && !ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new ValidationError('Thumbnail must be JPG, PNG, or WebP.'));
    }
    if (file.fieldname === 'thumbnail' && file.size > MAX_THUMB_BYTES) {
      return cb(new ValidationError('Thumbnail must be under 5 MB.'));
    }
    cb(null, true);
  },
}).fields([
  { name: 'video',     maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

// ─── GET /api/videos ─────────────────────────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const {
      category, page = 1, limit = 20, sort = 'new',
      q, tag,
    } = req.query;

    const query = {
      isDeleted: false,
      isPublished: true,
      processingStatus: 'ready',
      visibility: 'public',
    };

    if (category) query.category = category;
    if (tag)      query.tags = tag;
    if (q) {
      query.$or = [
        { title:       { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags:        { $regex: q, $options: 'i' } },
      ];
    }

    const sortMap = {
      new:      { createdAt: -1 },
      trending: { views: -1 },
      top:      { 'likes.length': -1 },
    };
    const sortBy = sortMap[sort] || sortMap.new;

    const limitN = Math.min(50, parseInt(limit) || 20);
    const skip   = (Math.max(1, parseInt(page)) - 1) * limitN;

    const [videos, total] = await Promise.all([
      Video.find(query)
        .sort(sortBy)
        .skip(skip)
        .limit(limitN)
        .lean(),
      Video.countDocuments(query),
    ]);

    // Normalize uploader field for frontend compatibility.
    // uploader is stored as a Firebase UID string with display info in uploaderInfo.
    const serialized = videos.map(v => ({
      ...v,
      videoUrl: v.hlsUrl || v.originalFileUrl || null,
      uploader: v.uploaderInfo
        ? { _id: v.uploader, username: v.uploaderInfo.username, profile: { displayName: v.uploaderInfo.displayName, avatarUrl: v.uploaderInfo.avatarUrl } }
        : { _id: v.uploader, username: v.uploader },
    }));

    res.json({ success: true, videos: serialized, total, page: parseInt(page), limit: limitN });
  } catch (err) { next(err); }
});

// ─── POST /api/videos/upload ─────────────────────────────────
router.post('/upload', authenticate, (req, res, next) => {
  videoUpload(req, res, async (err) => {
    if (err) return next(err instanceof multer.MulterError
      ? new ValidationError(err.message)
      : err);

    try {
      const { title, description, category, visibility } = req.body;
      if (!title?.trim()) throw new ValidationError('Title is required.');

      const videoFile = req.files?.video?.[0];
      if (!videoFile) throw new ValidationError('Video file is required.');

      const uid = req.user.id;

      // Upload video to Supabase Storage (videos bucket — private)
      const videoPath = storageSvc.uploadFilePath('videos', uid, videoFile.originalname);
      const videoResult = await storageSvc.uploadBuffer({
        bucket:   'videos',
        storagePath: videoPath,
        buffer:   videoFile.buffer,
        mimetype: videoFile.mimetype,
      });
      const fileUrl = videoResult.signedUrl || videoResult.publicUrl;

      // Upload thumbnail to Supabase Storage (thumbnails bucket — public)
      let thumbnailUrl = null;
      let thumbnailPath = null;
      const thumbFile = req.files?.thumbnail?.[0];
      if (thumbFile) {
        thumbnailPath = storageSvc.uploadFilePath('thumbnails', uid, thumbFile.originalname);
        const thumbResult = await storageSvc.uploadBuffer({
          bucket:      'thumbnails',
          storagePath: thumbnailPath,
          buffer:      thumbFile.buffer,
          mimetype:    thumbFile.mimetype,
        });
        thumbnailUrl = thumbResult.publicUrl || thumbResult.signedUrl;
      }

      // Create or find channel for this uploader
      let channel = await Channel.findOne({ owner: req.user.id });
      if (!channel) {
        channel = await Channel.create({
          owner:       req.user.id,
          name:        req.user.profile?.displayName || req.user.username,
          description: '',
        });
      }

      const video = await Video.create({
        title:           title.trim().slice(0, 200),
        description:     (description || '').trim().slice(0, 5000),
        uploader:        req.user.id,
        uploaderInfo: {
          uid:         req.user.id,
          username:    req.user.username || req.user.id,
          displayName: req.user.username || req.user.id,
          avatarUrl:   null,
        },
        channelId:       channel._id,
        originalFileUrl: fileUrl,
        storagePath:     videoPath,
        thumbnailUrl,
        thumbnailStoragePath: thumbnailPath,
        fileSize:        videoFile.size,
        category:        ['movies','shows','music','short','gaming','education','comedy','other'].includes(category) ? category : 'other',
        visibility:      ['public','unlisted','private'].includes(visibility) ? visibility : 'public',
        isPublished:     true,
        processingStatus: 'ready',
        hlsUrl:          fileUrl,
      });

      const videoObj = video.toObject({ virtuals: true });
      videoObj.uploader = { _id: req.user.id, username: req.user.username || req.user.id, profile: { displayName: req.user.username || req.user.id, avatarUrl: null } };

      res.status(201).json({ success: true, video: videoObj });
    } catch (err) { next(err); }
  });
});

// POST /api/videos/save-meta
// Saves metadata for a video that was already uploaded directly to Supabase Storage
// from the browser. No file buffers are sent here — only JSON metadata + URLs.
router.post('/save-meta', authenticate, async (req, res, next) => {
  try {
    const {
      title, description, category, visibility,
      videoUrl, thumbnailUrl, storagePath, fileSize, mimeType,
      originalFilename,
    } = req.body;

    if (!title?.trim()) {
      return res.status(422).json({ error: true, message: 'Title is required.' });
    }
    if (!videoUrl || !storagePath) {
      return res.status(422).json({ error: true, message: 'videoUrl and storagePath are required.' });
    }

    const uid = req.user.id;

    // Guard against duplicate records for the same storagePath (idempotent save-meta).
    // If a record already exists for this path (e.g. the first save-meta call succeeded
    // but the browser lost the response), return the existing record instead of a 409.
    const existing = await Video.findOne({ storagePath, uploader: uid, isDeleted: false }).lean();
    if (existing) {
      const existingObj = {
        ...existing,
        videoUrl: existing.hlsUrl || existing.originalFileUrl || videoUrl,
        uploader: {
          _id:      uid,
          username: req.user.username || uid,
          profile:  { displayName: req.user.username || uid, avatarUrl: null },
        },
      };
      return res.status(200).json({ success: true, video: existingObj });
    }

    // Create or find the uploader's channel
    let channel = await Channel.findOne({ owner: uid });
    if (!channel) {
      channel = await Channel.create({
        owner:       uid,
        name:        req.user.profile?.displayName || req.user.username,
        description: '',
      });
    }

    const VALID_MIME_PREFIXES = ['video/'];
    const safeMime = (mimeType && VALID_MIME_PREFIXES.some(p => String(mimeType).startsWith(p)))
      ? String(mimeType)
      : 'video/mp4';

    const video = await Video.create({
      title:            title.trim().slice(0, 200),
      description:      (description || '').trim().slice(0, 5000),
      uploader:         uid,
      uploaderInfo: {
        uid:         uid,
        username:    req.user.username || uid,
        displayName: req.user.username || uid,
        avatarUrl:   null,
      },
      channelId:        channel._id,
      originalFileUrl:  videoUrl,
      storagePath,
      thumbnailUrl:     thumbnailUrl || null,
      fileSize:         Number(fileSize)  || 0,
      mimeType:         safeMime,
      category:         ['movies','shows','music','short','gaming','education','comedy','other'].includes(category) ? category : 'other',
      visibility:       ['public','unlisted','private'].includes(visibility) ? visibility : 'public',
      isPublished:      true,
      processingStatus: 'ready',
      hlsUrl:           videoUrl,
    });

    // Build a consistent uploader object for the response (uploader is a UID string, not a User doc)
    const videoObj = video.toObject({ virtuals: true });
    videoObj.uploader = {
      _id:      uid,
      username: req.user.username || uid,
      profile:  { displayName: req.user.username || uid, avatarUrl: null },
    };
    // Ensure videoUrl is present for frontend compatibility
    videoObj.videoUrl = videoObj.hlsUrl || videoObj.originalFileUrl || videoUrl;
    res.status(201).json({ success: true, video: videoObj });
  } catch (err) { next(err); }
});

// GET /api/videos/:id/url — return the playback URL for a video.
// For public buckets (videos is public) just return the public URL.
// Only generates a signed URL when the storagePath is in a private bucket.
router.get('/:id/url', optionalAuth, async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const videoId = req.params.id;

    // Only attempt MongoDB lookup for valid ObjectIds (24-char hex)
    if (!mongoose.Types.ObjectId.isValid(videoId) || videoId.length !== 24) {
      return res.status(404).json({
        success: false,
        code: 'VIDEO_NOT_FOUND',
        message: 'Video not found — this ID is not a MongoDB ObjectId.',
      });
    }

    const video = await Video.findById(videoId).lean();
    if (!video || video.isDeleted) {
      return res.status(404).json({
        success: false,
        code: 'VIDEO_NOT_FOUND',
        message: 'Video not found.',
      });
    }

    // Access control for private videos
    if (video.visibility === 'private') {
      if (!req.user || (String(req.user.id) !== String(video.uploader) && !['founder','admin'].includes(req.user?.role))) {
        return res.status(403).json({
          success: false,
          code: 'ACCESS_DENIED',
          message: 'This video is private.',
        });
      }
    }

    const videoIdStr = String(video._id);

    // Return existing URL if no storagePath recorded (legacy videos)
    if (!video.storagePath) {
      const existingUrl = video.originalFileUrl || video.hlsUrl || null;
      if (!existingUrl) {
        return res.status(409).json({
          success: false,
          code: 'STORAGE_OBJECT_MISSING',
          message: 'No storage path or URL recorded for this video.',
        });
      }
      return res.json({
        success: true,
        videoId: videoIdStr,
        url: existingUrl,
        playbackUrl: existingUrl,
        expiresAt: null,
      });
    }

    // Videos bucket is public — return the permanent public URL directly
    try {
      const publicUrl = storageSvc.getPublicUrl('videos', video.storagePath);
      if (publicUrl) {
        return res.json({
          success: true,
          videoId: videoIdStr,
          url: publicUrl,
          playbackUrl: publicUrl,
          expiresAt: null,
        });
      }
    } catch (_) {}

    // Fallback: generate a signed URL (for private-bucket videos)
    try {
      const expirySecs = 3600; // 1 hour
      const signedUrl  = await storageSvc.getSignedUrl('videos', video.storagePath, expirySecs);
      return res.json({
        success: true,
        videoId: videoIdStr,
        url: signedUrl,
        playbackUrl: signedUrl,
        expiresAt: new Date(Date.now() + expirySecs * 1000).toISOString(),
      });
    } catch (signErr) {
      // Storage object may be missing
      const fallbackUrl = video.originalFileUrl || video.hlsUrl || null;
      if (fallbackUrl) {
        return res.json({
          success: true,
          videoId: videoIdStr,
          url: fallbackUrl,
          playbackUrl: fallbackUrl,
          expiresAt: null,
        });
      }
      return res.status(409).json({
        success: false,
        code: 'PLAYBACK_URL_FAILED',
        message: `Could not generate playback URL: ${signErr.message}`,
      });
    }
  } catch (err) { next(err); }
});

// ─── GET /api/videos/channels ────────────────────────────────
router.get('/channels', optionalAuth, async (req, res, next) => {
  try {
    const { limit = 24, page = 1 } = req.query;
    const limitN = Math.min(50, parseInt(limit) || 24);
    const skip   = (Math.max(1, parseInt(page)) - 1) * limitN;

    const [channels, total] = await Promise.all([
      Channel.find({ isSuspended: false })
        .skip(skip)
        .limit(limitN)
        .populate('owner', 'username profile.displayName profile.avatarUrl')
        .lean(),
      Channel.countDocuments({ isSuspended: false }),
    ]);

    // Attach video counts
    const channelIds = channels.map(c => c._id);
    const counts     = await Video.aggregate([
      { $match: { channelId: { $in: channelIds }, isDeleted: false, isPublished: true, processingStatus: 'ready' } },
      { $group: { _id: '$channelId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map(c => [String(c._id), c.count]));

    const enriched = channels.map(c => ({
      ...c,
      name:            c.name || c.owner?.profile?.displayName || c.owner?.username,
      videoCount:      countMap[String(c._id)] || 0,
      subscriberCount: c.subscribers?.length || 0,
    }));

    res.json({ success: true, channels: enriched, total });
  } catch (err) { next(err); }
});

// ─── GET /api/videos/me/watchlater ─── MUST be before /:id ──
router.get('/me/watchlater', authenticate, async (req, res, next) => {
  try {
    const videosRaw = await Video.find({
      watchLaterBy: req.user.id,
      isDeleted: false,
      processingStatus: 'ready',
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const videos = videosRaw.map(v => ({
      ...v,
      videoUrl: v.hlsUrl || v.originalFileUrl || null,
      uploader: v.uploaderInfo
        ? { _id: v.uploader, username: v.uploaderInfo.username, profile: { displayName: v.uploaderInfo.displayName, avatarUrl: v.uploaderInfo.avatarUrl } }
        : { _id: v.uploader, username: v.uploader },
    }));

    res.json({ success: true, videos });
  } catch (err) { next(err); }
});

// ─── GET /api/videos/me/history ─── MUST be before /:id ─────
router.get('/me/history', authenticate, async (req, res, next) => {
  try {
    const history = await WatchHistory.find({ user: req.user.id })
      .sort({ watchedAt: -1 })
      .limit(100)
      .populate({
        path: 'video',
        select: 'title thumbnailUrl duration views uploader createdAt',
        populate: { path: 'uploader', select: 'username profile.displayName' },
      })
      .lean();

    const valid = history.filter(h => h.video && !h.video.isDeleted);
    res.json({ success: true, history: valid });
  } catch (err) { next(err); }
});

// ─── DELETE /api/videos/history/:videoId ─────────────────────
router.delete('/history/:videoId', authenticate, async (req, res, next) => {
  try {
    await WatchHistory.deleteOne({ user: req.user.id, video: req.params.videoId });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GET /api/videos/channel/:id ─────────────────────────────
router.get('/channel/:id', optionalAuth, async (req, res, next) => {
  try {
    const channel = await Channel.findById(req.params.id)
      .populate('owner', 'username profile.displayName profile.avatarUrl')
      .lean();
    if (!channel || channel.isSuspended) return next(new NotFoundError('Channel'));

    const videosRaw = await Video.find({
      channelId:        channel._id,
      isDeleted:        false,
      isPublished:      true,
      processingStatus: 'ready',
      visibility:       'public',
    })
      .sort({ createdAt: -1 })
      .limit(48)
      .lean();

    const videos = videosRaw.map(v => ({
      ...v,
      videoUrl: v.hlsUrl || v.originalFileUrl || null,
      uploader: v.uploaderInfo
        ? { _id: v.uploader, username: v.uploaderInfo.username, profile: { displayName: v.uploaderInfo.displayName, avatarUrl: v.uploaderInfo.avatarUrl } }
        : { _id: v.uploader, username: v.uploader },
    }));

    res.json({
      success: true,
      channel: {
        ...channel,
        name:            channel.name || channel.owner?.profile?.displayName || channel.owner?.username,
        subscriberCount: channel.subscribers?.length || 0,
        videoCount:      videos.length,
      },
      videos,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/videos/:id ─────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const videoId  = req.params.id;

    // Reject non-ObjectId IDs with a clean 404 (not a Mongoose CastError 500)
    if (!mongoose.Types.ObjectId.isValid(videoId) || videoId.length !== 24) {
      return res.status(404).json({
        error: true,
        code: 'VIDEO_NOT_FOUND',
        message: 'Video not found.',
      });
    }

    const video = await Video.findById(videoId).lean();
    if (!video || video.isDeleted) return next(new NotFoundError('Video'));

    // Access control (uploader is a Firebase UID string)
    if (video.visibility === 'private') {
      if (!req.user || (String(req.user.id) !== String(video.uploader) && !['founder','admin'].includes(req.user?.role))) {
        return next(new ForbiddenError('This video is private.'));
      }
    }

    // Increment views (non-blocking)
    Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).exec().catch(() => {});

    // Restore watch position if authenticated
    let lastPosition = 0;
    if (req.user) {
      const hist = await WatchHistory.findOne({ user: req.user.id, video: req.params.id }).lean();
      if (hist) lastPosition = hist.position;
    }

    // Normalize uploader shape and add videoUrl virtual
    const videoObj = {
      ...video,
      videoUrl: video.hlsUrl || video.originalFileUrl || null,
      uploader: video.uploaderInfo
        ? { _id: video.uploader, username: video.uploaderInfo.username, profile: { displayName: video.uploaderInfo.displayName, avatarUrl: video.uploaderInfo.avatarUrl } }
        : { _id: video.uploader, username: video.uploader },
    };

    res.json({ success: true, video: videoObj, lastPosition });
  } catch (err) { next(err); }
});

// ─── POST /api/videos/:id/like ───────────────────────────────
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.isDeleted) return next(new NotFoundError('Video'));

    const liked = video.likes.map(String).includes(String(req.user.id));
    if (liked) video.likes.pull(req.user.id);
    else       video.likes.push(req.user.id);
    await video.save();

    res.json({ success: true, liked: !liked, likeCount: video.likes.length });
  } catch (err) { next(err); }
});

// ─── POST /api/videos/:id/watchlater ─────────────────────────
router.post('/:id/watchlater', authenticate, async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.isDeleted) return next(new NotFoundError('Video'));

    const saved = video.watchLaterBy.map(String).includes(String(req.user.id));
    if (saved) video.watchLaterBy.pull(req.user.id);
    else       video.watchLaterBy.push(req.user.id);
    await video.save();

    res.json({ success: true, saved: !saved });
  } catch (err) { next(err); }
});

// ─── POST /api/videos/:id/history ────────────────────────────
router.post('/:id/history', authenticate, async (req, res, next) => {
  try {
    const { position = 0 } = req.body;
    await WatchHistory.findOneAndUpdate(
      { user: req.user.id, video: req.params.id },
      { position: Math.max(0, parseInt(position) || 0), watchedAt: new Date() },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GET /api/videos/:id/comments ────────────────────────────
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const video = await Video.findById(req.params.id);
    if (!video || video.isDeleted) return next(new NotFoundError('Video'));

    const comments = await VideoComment.find({
      video: req.params.id,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .skip((Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 50))
      .limit(Math.min(100, parseInt(limit) || 50))
      .lean();

    // author is a Firebase UID string — no populate available
    res.json({ success: true, comments });
  } catch (err) { next(err); }
});

// ─── POST /api/videos/:id/comments ───────────────────────────
router.post('/:id/comments', authenticate, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim() || content.length > 2000) {
      throw new ValidationError('Comment must be 1–2000 characters.');
    }

    const video = await Video.findById(req.params.id);
    if (!video || video.isDeleted) return next(new NotFoundError('Video'));

    const comment = await VideoComment.create({
      video:   req.params.id,
      author:  req.user.id,
      content: content.trim(),
    });

    // Return comment with author info embedded (author is a UID string)
    const commentObj = comment.toObject();
    commentObj.authorInfo = { uid: req.user.id, username: req.user.username || req.user.id };
    res.status(201).json({ success: true, comment: commentObj });
  } catch (err) { next(err); }
});

// ─── DELETE /api/videos/:id/comments/:commentId ──────────────
router.delete('/:id/comments/:commentId', authenticate, async (req, res, next) => {
  try {
    const comment = await VideoComment.findById(req.params.commentId);
    if (!comment || comment.isDeleted) return next(new NotFoundError('Comment'));

    const isOwner = String(comment.author) === String(req.user.id);
    const isMod   = ['founder','admin','moderator'].includes(req.user.role);
    if (!isOwner && !isMod) throw new ForbiddenError('You cannot delete this comment.');

    comment.isDeleted = true;
    await comment.save();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /api/videos/:id/report ─────────────────────────────
router.post('/:id/report', authenticate, async (req, res, next) => {
  try {
    const { reason, details } = req.body;
    if (!reason) throw new ValidationError('Reason is required.');

    const video = await Video.findById(req.params.id);
    if (!video || video.isDeleted) return next(new NotFoundError('Video'));

    // Map frontend reason values to the enum — 'inappropriate' → 'other' fallback
    const VALID_REASONS = new Set(['spam','harassment','hate_speech','misinformation','nsfw','violence','other']);
    const safeReason = VALID_REASONS.has(reason) ? reason : 'other';

    await Report.create({
      reporter:   req.user.id,
      targetType: 'video',
      targetId:   String(req.params.id),
      reason:     safeReason,
      details: details?.slice(0, 500) || '',
    });

    video.reportCount = (video.reportCount || 0) + 1;
    if (video.reportCount >= 5) video.isFlagged = true;
    await video.save();

    res.json({ success: true, message: 'Report submitted.' });
  } catch (err) { next(err); }
});

// ─── Moderation (Founder/Admin only) ─────────────────────────

// DELETE /api/videos/library/:supabaseId — delete a Supabase music_library row server-side
// This keeps the Supabase service-role key backend-only (never in frontend JS).
// Requires authentication + founder/admin authorization.
router.delete('/library/:supabaseId', authenticate, requireRole('founder'), async (req, res, next) => {
  try {
    const supabaseId = req.params.supabaseId;
    // Basic UUID format validation (prevent path traversal / injection)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supabaseId)) {
      return res.status(422).json({ error: true, message: 'Invalid video ID format.' });
    }

    // Use the Supabase service-role client (server-side only)
    const supabase = storageSvc.getClient();

    // Fetch the row first to get storagePath for storage cleanup
    const { data: rows, error: fetchErr } = await supabase
      .from('music_library')
      .select('id, uid, storage_path, mime_type')
      .eq('id', supabaseId)
      .limit(1);

    if (fetchErr) {
      return res.status(500).json({ error: true, message: `Database error: ${fetchErr.message}` });
    }
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: true, code: 'VIDEO_NOT_FOUND', message: 'Video not found.' });
    }

    const row = rows[0];

    // Verify ownership or admin
    const isOwner = row.uid === req.user.id;
    const isMod   = ['founder','admin'].includes(req.user.role);
    if (!isOwner && !isMod) {
      return res.status(403).json({ error: true, message: 'Insufficient permissions.' });
    }

    // Delete the database record
    const { error: deleteErr } = await supabase
      .from('music_library')
      .delete()
      .eq('id', supabaseId);

    if (deleteErr) {
      return res.status(500).json({ error: true, message: `Delete failed: ${deleteErr.message}` });
    }

    // Remove from Supabase Storage (best-effort — do not fail if file already gone)
    if (row.storage_path) {
      const bucket = String(row.mime_type || '').startsWith('video/') ? 'videos' : 'music';
      try {
        await storageSvc.deleteFile(bucket, row.storage_path);
      } catch (storageErr) {
        const logger = require('../../utils/logger');
        logger.warn(`[VideoDelete] Storage removal skipped for ${row.storage_path}: ${storageErr.message}`);
      }
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/videos/:id  — remove video (soft-delete)
// Note: Supabase music_library videos use UUID IDs. The frontend detects these and
// should use DELETE /api/videos/library/:id for those. This route handles MongoDB ObjectId videos only.
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const videoId  = req.params.id;

    // Reject non-ObjectId IDs immediately — do not let Mongoose throw a CastError
    if (!mongoose.Types.ObjectId.isValid(videoId) || videoId.length !== 24) {
      return res.status(404).json({
        error: true,
        code: 'VIDEO_NOT_FOUND',
        message: 'Video not found.',
      });
    }

    const video = await Video.findById(videoId);
    if (!video || video.isDeleted) return next(new NotFoundError('Video'));

    const isOwner = String(video.uploader) === String(req.user.id);
    const isMod   = ['founder','admin'].includes(req.user.role);
    if (!isOwner && !isMod) throw new ForbiddenError('Insufficient permissions.');

    // Soft-delete the database record
    video.isDeleted = true;
    await video.save();

    // Remove from Supabase Storage (best-effort — do not fail the delete if storage is missing)
    if (video.storagePath) {
      try {
        await storageSvc.deleteFile('videos', video.storagePath);
      } catch (storageErr) {
        const logger = require('../../utils/logger');
        logger.warn(`[VideoDelete] Storage removal skipped for ${video.storagePath}: ${storageErr.message}`);
      }
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/videos/:id/restore  — restore soft-deleted video (moderator)
router.put('/:id/restore', authenticate, requireRole('moderator'), async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return next(new NotFoundError('Video'));
    video.isDeleted = false;
    video.isFlagged = false;
    await video.save();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/videos/:id/feature — mark as featured
router.put('/:id/feature', authenticate, requireRole('founder'), async (req, res, next) => {
  try {
    const { featured = true } = req.body;
    await Video.findByIdAndUpdate(req.params.id, { isFeatured: !!featured });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /api/videos/channel/:id/subscribe ──────────────
router.post('/channel/:id/subscribe', authenticate, async (req, res, next) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel || channel.isSuspended) return next(new NotFoundError('Channel'));

    const uid     = String(req.user.id);
    const already = channel.subscribers.some(s => String(s) === uid);

    if (already) {
      channel.subscribers = channel.subscribers.filter(s => String(s) !== uid);
    } else {
      channel.subscribers.push(uid);
    }
    await channel.save();

    res.json({ success: true, subscribed: !already, subscriberCount: channel.subscribers.length });
  } catch (err) { next(err); }
});

// Channel suspend (moderator)
router.put('/channel/:id/suspend', authenticate, requireRole('moderator'), async (req, res, next) => {
  try {
    const { reason } = req.body;
    await Channel.findByIdAndUpdate(req.params.id, { isSuspended: true, suspendReason: reason || '' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/channel/:id/unsuspend', authenticate, requireRole('moderator'), async (req, res, next) => {
  try {
    await Channel.findByIdAndUpdate(req.params.id, { isSuspended: false, suspendReason: '' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
