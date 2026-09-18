/**
 * Private Room Routes — Avenora Chat (Firestore edition)
 *
 * Collections:
 *   rooms/{roomId}
 *   roomMessages/{msgId}
 *   notifications/{notifId}
 *   users/{userId}
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getDb, newId, now, FieldValue } = require('../../config/firestore');
const logger = require('../../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────

function forbidden(res, msg = 'You do not have access to this room.') {
  return res.status(403).json({ error: true, message: msg });
}
function notFound(res) {
  return res.status(404).json({ error: true, message: 'Room not found.' });
}

function _getRole(room, userId) {
  if (!userId) return null;
  const m = (room.members || []).find(m => m.userId === userId);
  return m ? m.role : null;
}
function _isMember(room, userId) { return !!_getRole(room, userId); }
function _isBanned(room, userId) { return (room.bans || []).some(b => b.userId === userId); }

function serializeRoom(room, userId) {
  const role  = _getRole(room, userId);
  const isMod = ['owner', 'moderator'].includes(role);
  return {
    id:          room.id,
    name:        room.name,
    description: room.description || null,
    iconUrl:     room.iconUrl     || null,
    visibility:  room.visibility,
    owner:       room.owner,
    memberCount: (room.members || []).length,
    myRole:      role || null,
    isMember:    !!role,
    isArchived:  room.isArchived || false,
    createdAt:   room.createdAt,
    ...(isMod ? {
      members:      room.members,
      joinRequests: (room.joinRequests || []).filter(r => r.status === 'pending'),
      bans:         room.bans || [],
    } : {}),
  };
}

function _serializeMessage(m) {
  return {
    id:       m.id,
    roomId:   m.roomId,
    roomType: m.roomType || 'private',
    author:   m.author || { id: null, username: m.authorUsername || 'Unknown' },
    content:  m.content,
    replyTo:  m.replyTo || null,
    timestamp: m.createdAt,
    isSystem: m.isSystem || false,
  };
}

async function _notifyRoomOwner(db, room, requesterId, type) {
  const message = type === 'room_join_request'
    ? `Someone requested to join "${room.name}"`
    : `New activity in "${room.name}"`;
  const id = newId();
  await db.collection('notifications').doc(id).set({
    recipient: room.owner, sender: requesterId,
    type, roomId: room.id, message,
    isRead: false, createdAt: now(),
  });
  const io = global.socketIo;
  if (io) io.to(`user:${room.owner}`).emit('notification:new', { type, roomId: room.id, roomName: room.name });
}

// ─── Create room ─────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, iconUrl, visibility = 'private' } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: true, message: 'Room name is required.' });

    const db = getDb();
    const id = newId();
    const ts = now();
    const room = {
      name: name.trim().slice(0, 80),
      description: description?.trim().slice(0, 500) || null,
      iconUrl: iconUrl || null,
      visibility,
      owner: req.user.id,
      members: [{ userId: req.user.id, role: 'owner' }],
      joinRequests: [],
      bans: [],
      isArchived: false,
      isDeleted: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.collection('rooms').doc(id).set(room);
    res.status(201).json({ success: true, room: serializeRoom({ id, ...room }, req.user.id) });
  } catch (err) {
    logger.error('[rooms] create error:', err.message);
    res.status(500).json({ error: true, message: 'Could not create room.' });
  }
});

// ─── My rooms ────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const db   = getDb();
    const snap = await db.collection('rooms')
      .where('isDeleted', '==', false)
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get();

    const rooms = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => (r.members || []).some(m => m.userId === req.user.id))
      .map(r => ({
        id: r.id, name: r.name, description: r.description,
        iconUrl: r.iconUrl, visibility: r.visibility,
        memberCount: (r.members || []).length,
        myRole: _getRole(r, req.user.id),
        isArchived: r.isArchived || false,
      }));

    res.json({ success: true, rooms });
  } catch (err) {
    logger.error('[rooms] list error:', err.message);
    res.status(500).json({ error: true, message: 'Could not load rooms.' });
  }
});

// ─── Discover public rooms ────────────────────────────────────────
router.get('/discover', optionalAuth, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(30, parseInt(req.query.limit) || 20);
    const q_str = (req.query.q || '').toLowerCase();

    const db   = getDb();
    const snap = await db.collection('rooms')
      .where('visibility', '==', 'public')
      .where('isDeleted', '==', false)
      .where('isArchived', '==', false)
      .orderBy('updatedAt', 'desc')
      .limit(200)
      .get();

    let rooms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (q_str) rooms = rooms.filter(r => (r.name || '').toLowerCase().includes(q_str));
    const total = rooms.length;
    const paged = rooms.slice((page - 1) * limit, page * limit).map(r => ({
      id: r.id, name: r.name, description: r.description,
      iconUrl: r.iconUrl, memberCount: (r.members || []).length,
    }));

    res.json({ success: true, rooms: paged, total, page });
  } catch (err) {
    logger.error('[rooms] discover error:', err.message);
    res.status(500).json({ error: true, message: 'Could not load rooms.' });
  }
});

// ─── Get room detail ─────────────────────────────────────────────
router.get('/:roomId', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    if (room.isDeleted) return notFound(res);
    if (room.visibility !== 'public' && !_isMember(room, req.user.id)) return forbidden(res);
    res.json({ success: true, room: serializeRoom(room, req.user.id) });
  } catch (err) {
    logger.error('[rooms] get error:', err.message);
    res.status(500).json({ error: true, message: 'Could not load room.' });
  }
});

// ─── Update room ─────────────────────────────────────────────────
router.patch('/:roomId', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    if (room.isDeleted) return notFound(res);
    const role = _getRole(room, req.user.id);
    if (!['owner', 'moderator'].includes(role)) return forbidden(res, 'Moderator or owner required.');

    const updates = { updatedAt: now() };
    const { name, description, iconUrl, visibility } = req.body;
    if (name !== undefined)        updates.name        = name.trim().slice(0, 80);
    if (description !== undefined) updates.description = description.trim().slice(0, 500);
    if (iconUrl !== undefined)     updates.iconUrl     = iconUrl;
    if (visibility !== undefined && role === 'owner') updates.visibility = visibility;

    await db.collection('rooms').doc(req.params.roomId).update(updates);
    res.json({ success: true, room: serializeRoom({ ...room, ...updates }, req.user.id) });
  } catch (err) {
    logger.error('[rooms] update error:', err.message);
    res.status(500).json({ error: true, message: 'Could not update room.' });
  }
});

// ─── Archive / delete room ───────────────────────────────────────
router.delete('/:roomId', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    if (room.isDeleted) return notFound(res);
    if (_getRole(room, req.user.id) !== 'owner' && !['founder', 'admin'].includes(req.user.role)) {
      return forbidden(res, 'Only the room owner can delete this room.');
    }
    const action = req.query.action || 'archive';
    if (action === 'delete') {
      await db.collection('rooms').doc(req.params.roomId).update({ isDeleted: true, updatedAt: now() });
    } else {
      await db.collection('rooms').doc(req.params.roomId).update({ isArchived: true, updatedAt: now() });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] delete error:', err.message);
    res.status(500).json({ error: true, message: 'Could not remove room.' });
  }
});

// ─── Join room ───────────────────────────────────────────────────
router.post('/:roomId/join', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    if (room.isDeleted || room.isArchived) return notFound(res);
    if (_isBanned(room, req.user.id)) return forbidden(res, 'You are not permitted to join this room.');
    if (_isMember(room, req.user.id)) return res.json({ success: true, message: 'Already a member.' });

    if (room.visibility === 'public') {
      await db.collection('rooms').doc(req.params.roomId).update({
        members:   FieldValue.arrayUnion({ userId: req.user.id, role: 'member' }),
        updatedAt: now(),
      });
      return res.json({ success: true, joined: true });
    }
    if (room.visibility === 'invite_only') return forbidden(res, 'This room is invite-only.');

    // Private — create join request
    const existing = (room.joinRequests || []).find(r => r.userId === req.user.id && r.status === 'pending');
    if (existing) return res.json({ success: true, requested: true });

    await db.collection('rooms').doc(req.params.roomId).update({
      joinRequests: FieldValue.arrayUnion({ userId: req.user.id, status: 'pending', createdAt: new Date().toISOString() }),
      updatedAt: now(),
    });
    await _notifyRoomOwner(db, room, req.user.id, 'room_join_request').catch(() => {});
    res.json({ success: true, requested: true });
  } catch (err) {
    logger.error('[rooms] join error:', err.message);
    res.status(500).json({ error: true, message: 'Could not join room.' });
  }
});

// ─── Invite a user ───────────────────────────────────────────────
router.post('/:roomId/invite', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    if (room.isDeleted) return notFound(res);
    const role = _getRole(room, req.user.id);
    if (!['owner', 'moderator'].includes(role)) return forbidden(res, 'Moderator or owner required.');

    const { username } = req.body;
    const userSnap = await db.collection('users').where('username', '==', username).limit(1).get();
    if (userSnap.empty) return res.status(404).json({ error: true, message: 'User not found.' });
    const target = { id: userSnap.docs[0].id, ...userSnap.docs[0].data() };

    if (_isMember(room, target.id)) return res.json({ success: true, message: 'Already a member.' });
    if (_isBanned(room, target.id)) return res.status(400).json({ error: true, message: 'User is banned from this room.' });

    await db.collection('rooms').doc(req.params.roomId).update({
      members:   FieldValue.arrayUnion({ userId: target.id, role: 'member' }),
      updatedAt: now(),
    });

    const nid = newId();
    await db.collection('notifications').doc(nid).set({
      recipient: target.id, sender: req.user.id, type: 'room_invite',
      roomId: room.id, message: `You were invited to join "${room.name}"`,
      isRead: false, createdAt: now(),
    }).catch(() => {});

    const io = global.socketIo;
    if (io) io.to(`user:${target.id}`).emit('notification:new', { type: 'room_invite', roomId: room.id, roomName: room.name });

    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] invite error:', err.message);
    res.status(500).json({ error: true, message: 'Could not invite user.' });
  }
});

// ─── Approve / reject join request ───────────────────────────────
router.post('/:roomId/join-requests/:uid/approve', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const ref = db.collection('rooms').doc(req.params.roomId);
    const doc = await ref.get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    const role = _getRole(room, req.user.id);
    if (!['owner', 'moderator'].includes(role)) return forbidden(res, 'Moderator or owner required.');

    const jr = (room.joinRequests || []).find(r => r.userId === req.params.uid && r.status === 'pending');
    if (!jr) return res.status(404).json({ error: true, message: 'No pending join request found.' });

    const newRequests = (room.joinRequests || []).map(r =>
      r.userId === req.params.uid && r.status === 'pending' ? { ...r, status: 'approved' } : r
    );
    const updates = { joinRequests: newRequests, updatedAt: now() };
    if (!_isMember(room, jr.userId)) {
      updates.members = FieldValue.arrayUnion({ userId: jr.userId, role: 'member' });
    }
    await ref.update(updates);

    const nid = newId();
    await db.collection('notifications').doc(nid).set({
      recipient: jr.userId, sender: req.user.id, type: 'room_join_approved',
      roomId: room.id, message: `Your request to join "${room.name}" was approved.`,
      isRead: false, createdAt: now(),
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] approve error:', err.message);
    res.status(500).json({ error: true, message: 'Could not approve request.' });
  }
});

router.post('/:roomId/join-requests/:uid/reject', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const ref = db.collection('rooms').doc(req.params.roomId);
    const doc = await ref.get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    const role = _getRole(room, req.user.id);
    if (!['owner', 'moderator'].includes(role)) return forbidden(res, 'Moderator or owner required.');

    const jr = (room.joinRequests || []).find(r => r.userId === req.params.uid && r.status === 'pending');
    if (!jr) return res.status(404).json({ error: true, message: 'No pending join request found.' });

    const newRequests = (room.joinRequests || []).map(r =>
      r.userId === req.params.uid && r.status === 'pending' ? { ...r, status: 'rejected' } : r
    );
    await ref.update({ joinRequests: newRequests, updatedAt: now() });

    const nid = newId();
    await db.collection('notifications').doc(nid).set({
      recipient: jr.userId, sender: req.user.id, type: 'room_join_rejected',
      roomId: room.id, message: `Your request to join "${room.name}" was not approved.`,
      isRead: false, createdAt: now(),
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] reject error:', err.message);
    res.status(500).json({ error: true, message: 'Could not reject request.' });
  }
});

// ─── Remove member ───────────────────────────────────────────────
router.delete('/:roomId/members/:uid', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    const isSelf = req.user.id === req.params.uid;
    const role   = _getRole(room, req.user.id);
    if (!isSelf && !['owner', 'moderator'].includes(role)) return forbidden(res);
    if (!isSelf && _getRole(room, req.params.uid) === 'owner') return forbidden(res, 'Cannot remove the room owner.');

    const newMembers = (room.members || []).filter(m => m.userId !== req.params.uid);
    await db.collection('rooms').doc(req.params.roomId).update({ members: newMembers, updatedAt: now() });
    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] remove member error:', err.message);
    res.status(500).json({ error: true, message: 'Could not remove member.' });
  }
});

// ─── Ban / unban ─────────────────────────────────────────────────
router.post('/:roomId/ban/:uid', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    const role = _getRole(room, req.user.id);
    if (!['owner', 'moderator'].includes(role)) return forbidden(res);
    if (_getRole(room, req.params.uid) === 'owner') return forbidden(res, 'Cannot ban the owner.');

    const newMembers = (room.members || []).filter(m => m.userId !== req.params.uid);
    const bans       = room.bans || [];
    if (!_isBanned(room, req.params.uid)) {
      bans.push({ userId: req.params.uid, reason: req.body.reason || null, bannedBy: req.user.id });
    }
    await db.collection('rooms').doc(req.params.roomId).update({ members: newMembers, bans, updatedAt: now() });
    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] ban error:', err.message);
    res.status(500).json({ error: true, message: 'Could not ban user.' });
  }
});

router.delete('/:roomId/ban/:uid', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    if (_getRole(room, req.user.id) !== 'owner' && !['founder', 'admin'].includes(req.user.role)) {
      return forbidden(res, 'Only the room owner can unban users.');
    }
    const bans = (room.bans || []).filter(b => b.userId !== req.params.uid);
    await db.collection('rooms').doc(req.params.roomId).update({ bans, updatedAt: now() });
    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] unban error:', err.message);
    res.status(500).json({ error: true, message: 'Could not unban user.' });
  }
});

// ─── Mute member ─────────────────────────────────────────────────
router.post('/:roomId/mute/:uid', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    const role = _getRole(room, req.user.id);
    if (!['owner', 'moderator'].includes(role)) return forbidden(res);

    const minutes    = parseInt(req.body.minutes) || 60;
    const mutedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const newMembers = (room.members || []).map(m =>
      m.userId === req.params.uid ? { ...m, mutedUntil } : m
    );
    await db.collection('rooms').doc(req.params.roomId).update({ members: newMembers, updatedAt: now() });
    res.json({ success: true });
  } catch (err) {
    logger.error('[rooms] mute error:', err.message);
    res.status(500).json({ error: true, message: 'Could not mute member.' });
  }
});

// ─── Room message history ─────────────────────────────────────────
router.get('/:roomId/history', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(req.params.roomId).get();
    if (!doc.exists) return notFound(res);
    const room = { id: doc.id, ...doc.data() };
    if (!_isMember(room, req.user.id)) return forbidden(res);

    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const before = req.query.before;

    let q = db.collection('roomMessages')
      .where('roomId', '==', req.params.roomId)
      .where('isDeleted', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (before) {
      const { Timestamp } = require('../../config/firestore');
      q = q.where('createdAt', '<', new Date(before));
    }

    const snap     = await q.get();
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    res.json({ success: true, messages: messages.map(_serializeMessage) });
  } catch (err) {
    logger.error('[rooms] history error:', err.message);
    res.status(500).json({ error: true, message: 'Could not load messages.' });
  }
});

module.exports = router;
