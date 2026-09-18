/**
 * Reports Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, requireModerator } = require('../middleware/auth');
const { getDb, FieldValue } = require('../../config/firestore');
const { AppError } = require('../middleware/errorHandler');

const VALID_REASONS = ['spam','harassment','hate_speech','misinformation','nsfw','violence','other'];
const VALID_TYPES   = ['post','comment','user','message','dm_message','video'];

// POST /api/reports
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { targetType, targetId, reason, details } = req.body;
    if (!VALID_TYPES.includes(targetType)) return next(new AppError('Invalid target type', 422));
    if (!VALID_REASONS.includes(reason))   return next(new AppError('Invalid reason', 422));
    if (!targetId)                         return next(new AppError('Target ID required', 422));

    const db = getDb();
    // Prevent duplicate reports
    const existSnap = await db.collection('reports')
      .where('reporter', '==', req.user.id)
      .where('targetId', '==', targetId)
      .where('targetType', '==', targetType)
      .where('status', '==', 'pending')
      .limit(1).get();
    if (!existSnap.empty) return res.json({ success: true, message: 'Already reported', duplicate: true });

    const ref  = db.collection('reports').doc();
    const report = {
      id: ref.id, reporter: req.user.id, targetType, targetId, reason,
      details: details?.slice(0, 500) || '', status: 'pending',
      reviewedBy: null, reviewNote: null, reviewedAt: null,
      createdAt: new Date().toISOString(),
    };
    await ref.set(report);

    // Flag post if target is a post (non-critical)
    if (targetType === 'post') {
      try { await db.collection('posts').doc(targetId).update({ isFlagged: true, reportCount: FieldValue.increment(1) }); } catch (_) {}
    }
    res.status(201).json({ success: true, report: { id: ref.id } });
  } catch (err) { next(err); }
});

// GET /api/reports
router.get('/', authenticate, requireModerator, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const limit  = Math.min(100, parseInt(req.query.limit) || 30);
    const db     = getDb();
    const snap   = await db.collection('reports').where('status', '==', status).orderBy('createdAt', 'desc').limit(limit).get();
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, reports, total: reports.length });
  } catch (err) { next(err); }
});

// PUT /api/reports/:id
router.put('/:id', authenticate, requireModerator, async (req, res, next) => {
  try {
    const { status, reviewNote } = req.body;
    const validStatuses = ['reviewed','actioned','dismissed'];
    if (!validStatuses.includes(status)) return next(new AppError('Invalid status', 422));

    const db  = getDb();
    const ref = db.collection('reports').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return next(new AppError('Report not found', 404));

    await ref.update({
      status, reviewNote: reviewNote?.slice(0, 500) || null,
      reviewedBy: req.user.id, reviewedAt: new Date().toISOString(),
    });
    const updated = await ref.get();
    res.json({ success: true, report: { id: updated.id, ...updated.data() } });
  } catch (err) { next(err); }
});

module.exports = router;
