/**
 * Admin Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, requireFounder, requireFounderEmail } = require('../middleware/auth');
const { getDb } = require('../../config/firestore');
const { getDatabaseStatus } = require('../../config/database');
const logger  = require('../../utils/logger');

router.use(authenticate, requireFounder, requireFounderEmail);

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const db = getDb();
    const [userSnap, postSnap, videoSnap, streamSnap] = await Promise.all([
      db.collection('users').where('status.isActive', '==', true).count().get(),
      db.collection('posts').where('isDeleted', '==', false).count().get(),
      db.collection('videos').where('isDeleted', '==', false).count().get(),
      db.collection('streams').where('status', '==', 'live').count().get(),
    ]);
    res.json({ success: true, stats: {
      users:       userSnap.data().count,
      posts:       postSnap.data().count,
      videos:      videoSnap.data().count,
      liveStreams:  streamSnap.data().count,
      dbStatus:    getDatabaseStatus(),
      timestamp:   new Date().toISOString(),
    }});
  } catch (err) { next(err); }
});

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const db     = getDb();
    let q        = db.collection('users').orderBy('createdAt', 'desc').limit(limit);
    const snap   = await q.get();
    const users  = snap.docs.map(d => {
      const { passwordHash, passwordReset, ...safe } = d.data();
      return { id: d.id, ...safe };
    });
    // Client-side search filter (Firestore doesn't support text search natively)
    const search = req.query.search?.toLowerCase();
    const filtered = search
      ? users.filter(u => u.username?.toLowerCase().includes(search) || u.email?.toLowerCase().includes(search))
      : users;
    res.json({ success: true, users: filtered, total: filtered.length });
  } catch (err) { next(err); }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    const validRoles = ['user','moderator','founder','admin'];
    if (!validRoles.includes(role)) return res.status(422).json({ error: true, message: 'Invalid role' });
    if (req.params.id === req.user.id) return res.status(403).json({ error: true, message: 'You cannot change your own role' });
    if (['founder','admin'].includes(role)) {
      const authorizedEmail = (process.env.FOUNDER_EMAIL || '').trim().toLowerCase();
      if (!authorizedEmail || req.user.email?.toLowerCase() !== authorizedEmail) {
        return res.status(403).json({ error: true, message: 'Only the authorized founder may grant elevated roles' });
      }
    }
    await getDb().collection('users').doc(req.params.id).update({ role, updatedAt: new Date().toISOString() });
    logger.info(`Admin ${req.user.username} changed user ${req.params.id} role to ${role}`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/admin/users/:id/suspend
router.put('/users/:id/suspend', async (req, res, next) => {
  try {
    const { reason, until } = req.body;
    await getDb().collection('users').doc(req.params.id).update({
      'status.isSuspended': true,
      'status.suspendedReason': reason || 'Policy violation',
      'status.suspendedUntil': until || null,
      updatedAt: new Date().toISOString(),
    });
    logger.info(`Admin ${req.user.username} suspended user ${req.params.id}`);
    res.json({ success: true, message: 'User suspended' });
  } catch (err) { next(err); }
});

// PUT /api/admin/users/:id/unsuspend
router.put('/users/:id/unsuspend', async (req, res, next) => {
  try {
    await getDb().collection('users').doc(req.params.id).update({
      'status.isSuspended': false, 'status.suspendedReason': null, 'status.suspendedUntil': null,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, message: 'User unsuspended' });
  } catch (err) { next(err); }
});

// GET /api/admin/posts/flagged
router.get('/posts/flagged', async (req, res, next) => {
  try {
    const snap  = await getDb().collection('posts').where('isFlagged', '==', true).where('isDeleted', '==', false).orderBy('createdAt', 'desc').limit(100).get();
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, posts });
  } catch (err) { next(err); }
});

// GET /api/admin/reports
router.get('/reports', async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const limit  = Math.min(100, parseInt(req.query.limit) || 30);
    const snap   = await getDb().collection('reports').where('status', '==', status).orderBy('createdAt', 'desc').limit(limit).get();
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, reports, total: reports.length });
  } catch (err) { next(err); }
});

// DELETE /api/admin/posts/:id
router.delete('/posts/:id', async (req, res, next) => {
  try {
    await getDb().collection('posts').doc(req.params.id).update({ isDeleted: true, deletedAt: new Date().toISOString() });
    logger.info(`Admin ${req.user.username} deleted post ${req.params.id}`);
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) { next(err); }
});

// GET /api/admin/system
router.get('/system', (req, res) => {
  res.json({ success: true, system: {
    nodeVersion:  process.version,
    platform:     process.platform,
    uptime:       process.uptime(),
    memoryUsage:  process.memoryUsage(),
    database:     getDatabaseStatus(),
    environment:  process.env.NODE_ENV,
  }});
});

module.exports = router;
