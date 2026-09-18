/**
 * Chat Routes — Firestore-backed
 * Message history for public rooms (real-time via Socket.io, persistence in Firestore).
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { NotFoundError } = require('../middleware/errorHandler');
const { getDb, FieldValue } = require('../../config/firestore');
const logger  = require('../../utils/logger');

const PUBLIC_ROOMS = [
  { id: 'general', name: 'General',      description: 'Main community chat',  type: 'public' },
  { id: 'music',   name: 'Music Talk',   description: 'Music discussion',     type: 'public' },
  { id: 'gaming',  name: 'Gaming Lounge',description: 'Games & Arcade',       type: 'public' },
  { id: 'streams', name: 'Streams Hub',  description: 'Live stream talk',     type: 'public' },
  { id: 'chill',   name: 'Chill Zone',   description: 'Relax and chat',       type: 'public' },
];
const VALID_ROOM_IDS = new Set(PUBLIC_ROOMS.map(r => r.id));

// GET /api/chat/rooms
router.get('/rooms', (req, res) => res.json({ success: true, rooms: PUBLIC_ROOMS }));

// GET /api/chat/rooms/:roomId/history
router.get('/rooms/:roomId/history', optionalAuth, async (req, res, next) => {
  try {
    const { roomId } = req.params;
    if (!VALID_ROOM_IDS.has(roomId)) return res.status(404).json({ error: true, message: 'Room not found' });

    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const snap  = await getDb().collection('chatMessages')
      .where('roomId', '==', roomId)
      .where('roomType', '==', 'public')
      .where('isDeleted', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const messages = snap.docs.reverse().map(d => {
      const m = d.data();
      return {
        id:       d.id,
        roomId:   m.roomId,
        author:   { id: m.author || null, username: m.authorUsername || 'Guest' },
        content:  m.content,
        timestamp:m.createdAt,
        isSystem: m.isSystem || false,
      };
    });
    res.json({ success: true, messages });
  } catch (err) { next(err); }
});

// POST /api/chat/messages/:id/report
router.post('/messages/:id/report', authenticate, async (req, res, next) => {
  try {
    const { reason = 'other' } = req.body;
    const db  = getDb();
    const ref = db.collection('reports').doc();
    await ref.set({
      id: ref.id, reporter: req.user.id, targetType: 'message', targetId: req.params.id,
      reason, details: '', status: 'pending', reviewedBy: null, reviewNote: null, reviewedAt: null,
      createdAt: new Date().toISOString(),
    });
    // Flag the message
    try { await db.collection('chatMessages').doc(req.params.id).update({ reportedBy: FieldValue.arrayUnion(req.user.id) }); } catch (_) {}
    res.json({ success: true, message: 'Message reported' });
  } catch (err) { next(err); }
});

// DELETE /api/chat/messages/:id
router.delete('/messages/:id', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('chatMessages').doc(req.params.id).get();
    if (!snap.exists || snap.data().isDeleted) return next(new NotFoundError('Message'));
    const isOwner = snap.data().author === req.user.id;
    const isMod   = ['moderator','founder','admin'].includes(req.user.role);
    if (!isOwner && !isMod) return res.status(403).json({ error: true, message: 'Forbidden' });
    await db.collection('chatMessages').doc(snap.id).update({ isDeleted: true });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/chat/users/:userId/block
router.post('/users/:userId/block', authenticate, async (req, res, next) => {
  try {
    await getDb().collection('users').doc(req.user.id).update({
      'chat.blockedUsers': FieldValue.arrayUnion(req.params.userId),
    });
    res.json({ success: true, blocked: true });
  } catch (err) { next(err); }
});

// POST /api/chat/users/:userId/unblock
router.post('/users/:userId/unblock', authenticate, async (req, res, next) => {
  try {
    await getDb().collection('users').doc(req.user.id).update({
      'chat.blockedUsers': FieldValue.arrayRemove(req.params.userId),
    });
    res.json({ success: true, blocked: false });
  } catch (err) { next(err); }
});

// GET /api/chat/blocks
router.get('/blocks', authenticate, async (req, res, next) => {
  try {
    const snap = await getDb().collection('users').doc(req.user.id).get();
    const blocked = snap.exists ? (snap.data().chat?.blockedUsers || []) : [];
    res.json({ success: true, blocked });
  } catch (err) { next(err); }
});

module.exports = router;
