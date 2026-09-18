/**
 * Inbox Route — Avenora Chat (Firestore edition)
 *
 * GET /api/inbox        — aggregated inbox (DMs + room notifications)
 * GET /api/inbox/unread — total unread count
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { getDb } = require('../../config/firestore');
const logger = require('../../utils/logger');

router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();

    // 1. DM conversations
    const convosSnap = await db.collection('conversations')
      .where('participantIds', 'array-contains', req.user.id)
      .where('isDeleted', '==', false)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const conversations = convosSnap.docs.map(d => {
      const convo = { id: d.id, ...d.data() };
      const me    = (convo.participants || []).find(p => p.userId === req.user.id);
      const other = (convo.participants || []).find(p => p.userId !== req.user.id);
      return {
        id:           convo.id,
        type:         convo.type || 'dm',
        otherUser:    other ? { id: other.userId, username: other.username, avatarUrl: other.avatarUrl || null } : null,
        groupName:    convo.groupName    || null,
        groupIconUrl: convo.groupIconUrl || null,
        lastMessage:  convo.lastMessage  || null,
        unreadCount:  me?.unreadCount    || 0,
        updatedAt:    convo.updatedAt,
      };
    });

    // 2. Room notifications (invites, join-request updates) — unread only
    const roomNotifSnap = await db.collection('notifications')
      .where('recipient', '==', req.user.id)
      .where('type', 'in', ['room_invite', 'room_join_request', 'room_join_approved', 'room_join_rejected'])
      .where('isRead', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();

    const roomNotifications = roomNotifSnap.docs.map(d => {
      const n = { id: d.id, ...d.data() };
      return {
        id:        n.id,
        type:      n.type,
        room:      n.roomId ? { id: n.roomId, name: n.roomName || null } : null,
        sender:    n.senderUsername ? { username: n.senderUsername } : null,
        message:   n.message,
        createdAt: n.createdAt,
      };
    });

    // 3. My rooms with pending join requests (owner/mod view)
    const myRoomsSnap = await db.collection('rooms')
      .where('isDeleted', '==', false)
      .where('isArchived', '==', false)
      .limit(100)
      .get();

    const pendingJoinRequests = [];
    for (const d of myRoomsSnap.docs) {
      const room   = { id: d.id, ...d.data() };
      const myEntry = (room.members || []).find(m => m.userId === req.user.id);
      if (!['owner', 'moderator'].includes(myEntry?.role)) continue;
      const pending = (room.joinRequests || []).filter(jr => jr.status === 'pending');
      if (pending.length) {
        pendingJoinRequests.push({ roomId: room.id, roomName: room.name, pendingCount: pending.length });
      }
    }

    const totalUnread = conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);

    res.json({ success: true, conversations, roomNotifications, pendingJoinRequests, totalUnread });
  } catch (err) {
    logger.error('[inbox] error:', err.message);
    res.status(500).json({ error: true, message: 'Could not load inbox.' });
  }
});

router.get('/unread', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('conversations')
      .where('participantIds', 'array-contains', req.user.id)
      .where('isDeleted', '==', false)
      .get();

    let dmUnread = 0;
    snap.docs.forEach(d => {
      const me = (d.data().participants || []).find(p => p.userId === req.user.id);
      dmUnread += me?.unreadCount || 0;
    });

    const notifSnap = await db.collection('notifications')
      .where('recipient', '==', req.user.id)
      .where('type', 'in', ['room_invite', 'room_join_approved', 'room_join_rejected'])
      .where('isRead', '==', false)
      .get();

    res.json({ success: true, unread: dmUnread + notifSnap.size });
  } catch (err) {
    logger.error('[inbox] unread error:', err.message);
    res.json({ success: true, unread: 0 });
  }
});

module.exports = router;
