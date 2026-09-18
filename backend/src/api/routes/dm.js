/**
 * Direct Message Routes — Avenora Chat (Firestore edition)
 *
 * Collections:
 *   conversations/{conversationId}
 *   directMessages/{msgId}
 *   notifications/{notifId}
 *   users/{userId}
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { getDb, newId, now, FieldValue } = require('../../config/firestore');
const logger = require('../../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────

function _serializeConvo(convo, myId) {
  const other = (convo.participants || []).find(p => p.userId !== myId);
  const me    = (convo.participants || []).find(p => p.userId === myId);
  return {
    id:           convo.id,
    type:         convo.type || 'dm',
    otherUser:    other ? { id: other.userId, username: other.username, avatarUrl: other.avatarUrl || null } : null,
    groupName:    convo.groupName    || null,
    groupIconUrl: convo.groupIconUrl || null,
    lastMessage:  convo.lastMessage  || null,
    unreadCount:  me?.unreadCount    || 0,
    isMuted:      me?.mutedUntil ? new Date(me.mutedUntil) > new Date() : false,
    isBlocked:    me?.isBlocked      || false,
    updatedAt:    convo.updatedAt,
  };
}

function _serializeMsg(m) {
  return {
    id:             m.id,
    conversationId: m.conversationId,
    sender:         { id: m.sender, username: m.senderUsername, avatarUrl: m.senderAvatarUrl || null },
    content:        m.content,
    replyTo:        m.replyTo || null,
    readBy:         m.readBy  || [],
    createdAt:      m.createdAt,
    isDeleted:      m.isDeleted || false,
  };
}

function _assertParticipant(convo, userId, res) {
  const p = (convo.participants || []).find(p => p.userId === userId);
  if (!p) {
    res.status(403).json({ error: true, message: 'This conversation is unavailable.' });
    return null;
  }
  return p;
}

// ─── List my conversations ────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const db   = getDb();
    const snap = await db.collection('conversations')
      .where('participantIds', 'array-contains', req.user.id)
      .where('isDeleted', '==', false)
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get();
    const convos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, conversations: convos.map(c => _serializeConvo(c, req.user.id)) });
  } catch (err) {
    logger.error('[dm] list error:', err.message);
    res.status(500).json({ error: true, message: 'Could not load conversations.' });
  }
});

// ─── Get or create DM ────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const { username, userId: targetId } = req.body;
    let target = null;

    if (username) {
      const snap = await db.collection('users').where('username', '==', username).limit(1).get();
      if (!snap.empty) target = { id: snap.docs[0].id, ...snap.docs[0].data() };
    } else if (targetId) {
      const doc = await db.collection('users').doc(targetId).get();
      if (doc.exists) target = { id: doc.id, ...doc.data() };
    }

    if (!target) return res.status(404).json({ error: true, message: 'User not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: true, message: 'You cannot message yourself.' });

    // Deterministic conversation ID (sorted to ensure idempotency)
    const ids = [req.user.id, target.id].sort();
    const convoId = `dm_${ids[0]}_${ids[1]}`;

    const ref  = db.collection('conversations').doc(convoId);
    const snap = await ref.get();

    if (!snap.exists) {
      const ts = now();
      await ref.set({
        type: 'dm',
        participantIds: ids,
        participants: [
          { userId: req.user.id,  username: req.user.username,   avatarUrl: req.user.avatarUrl  || null, unreadCount: 0 },
          { userId: target.id,    username: target.username,      avatarUrl: target.profile?.avatarUrl || null, unreadCount: 0 },
        ],
        lastMessage:  null,
        isDeleted:    false,
        createdAt:    ts,
        updatedAt:    ts,
      });
    }

    const doc  = await ref.get();
    const convo = { id: doc.id, ...doc.data() };
    res.json({ success: true, conversation: _serializeConvo(convo, req.user.id) });
  } catch (err) {
    logger.error('[dm] getOrCreate error:', err.message);
    res.status(500).json({ error: true, message: 'Could not open conversation.' });
  }
});

// ─── Conversation detail ─────────────────────────────────────────
router.get('/:conversationId', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('conversations').doc(req.params.conversationId).get();
    if (!doc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: doc.id, ...doc.data() };
    if (convo.isDeleted) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    if (!_assertParticipant(convo, req.user.id, res)) return;
    res.json({ success: true, conversation: _serializeConvo(convo, req.user.id) });
  } catch (err) {
    logger.error('[dm] detail error:', err.message);
    res.status(500).json({ error: true, message: 'This conversation is unavailable.' });
  }
});

// ─── Message history ─────────────────────────────────────────────
router.get('/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection('conversations').doc(req.params.conversationId).get();
    if (!doc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: doc.id, ...doc.data() };
    if (!_assertParticipant(convo, req.user.id, res)) return;

    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    let q = db.collection('directMessages')
      .where('conversationId', '==', req.params.conversationId)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (req.query.before) q = q.where('createdAt', '<', new Date(req.query.before));

    const snap     = await q.get();
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    res.json({ success: true, messages: messages.map(_serializeMsg) });
  } catch (err) {
    logger.error('[dm] history error:', err.message);
    res.status(500).json({ error: true, message: 'Could not load messages.' });
  }
});

// ─── Send message ─────────────────────────────────────────────────
router.post('/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const ref = db.collection('conversations').doc(req.params.conversationId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: doc.id, ...doc.data() };

    const me = _assertParticipant(convo, req.user.id, res);
    if (!me) return;

    const other = (convo.participants || []).find(p => p.userId !== req.user.id);
    if (other?.isBlocked) return res.status(403).json({ error: true, message: 'Your message could not be sent.' });

    const { content, replyToId } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: true, message: 'Message content is required.' });

    const msgId = newId();
    const ts    = now();
    const msgData = {
      conversationId:  convo.id,
      sender:          req.user.id,
      senderUsername:  req.user.username,
      senderAvatarUrl: req.user.avatarUrl || null,
      content:         content.trim().slice(0, 4000),
      replyTo:         replyToId ? { id: replyToId } : null,
      readBy:          [{ userId: req.user.id, readAt: new Date().toISOString() }],
      isDeleted:       false,
      createdAt:       ts,
    };
    await db.collection('directMessages').doc(msgId).set(msgData);

    // Update conversation
    const newParticipants = (convo.participants || []).map(p => ({
      ...p,
      unreadCount: p.userId !== req.user.id ? (p.unreadCount || 0) + 1 : p.unreadCount || 0,
    }));
    await ref.update({
      lastMessage:  { content: content.slice(0, 100), senderId: req.user.id, sentAt: new Date().toISOString() },
      participants: newParticipants,
      updatedAt:    ts,
    });

    const serialized = _serializeMsg({ id: msgId, ...msgData });

    // Real-time delivery
    const io = global.socketIo;
    if (io) {
      (convo.participants || []).forEach(p => io.to(`user:${p.userId}`).emit('dm:message', serialized));
    }

    // Notification
    if (other && !other.mutedUntil) {
      const nid = newId();
      await db.collection('notifications').doc(nid).set({
        recipient: other.userId, sender: req.user.id, type: 'dm',
        conversationId: convo.id,
        message: `${req.user.username} sent you a message`,
        isRead: false, createdAt: ts,
      }).catch(() => {});
    }

    res.status(201).json({ success: true, message: serialized });
  } catch (err) {
    logger.error('[dm] send error:', err.message);
    res.status(500).json({ error: true, message: 'Your message could not be sent.' });
  }
});

// ─── Delete own message ──────────────────────────────────────────
router.delete('/:conversationId/messages/:msgId', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const cDoc = await db.collection('conversations').doc(req.params.conversationId).get();
    if (!cDoc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: cDoc.id, ...cDoc.data() };
    if (!_assertParticipant(convo, req.user.id, res)) return;

    const mRef = db.collection('directMessages').doc(req.params.msgId);
    const mDoc = await mRef.get();
    if (!mDoc.exists) return res.status(404).json({ error: true, message: 'Message not found.' });
    const msg = mDoc.data();
    if (msg.sender !== req.user.id) return res.status(403).json({ error: true, message: 'You can only delete your own messages.' });

    await mRef.update({ isDeleted: true, deletedBy: req.user.id });

    const io = global.socketIo;
    if (io) {
      (convo.participants || []).forEach(p =>
        io.to(`user:${p.userId}`).emit('dm:message_deleted', { messageId: req.params.msgId, conversationId: convo.id })
      );
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('[dm] delete msg error:', err.message);
    res.status(500).json({ error: true, message: 'Could not delete message.' });
  }
});

// ─── Mark as read ─────────────────────────────────────────────────
router.post('/:conversationId/read', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const ref = db.collection('conversations').doc(req.params.conversationId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: doc.id, ...doc.data() };
    if (!_assertParticipant(convo, req.user.id, res)) return;

    const newParticipants = (convo.participants || []).map(p =>
      p.userId === req.user.id ? { ...p, unreadCount: 0, lastReadAt: new Date().toISOString() } : p
    );
    await ref.update({ participants: newParticipants });

    const io = global.socketIo;
    if (io) {
      (convo.participants || []).forEach(p => {
        if (p.userId !== req.user.id) {
          io.to(`user:${p.userId}`).emit('dm:read', { conversationId: convo.id, readBy: req.user.id });
        }
      });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('[dm] read error:', err.message);
    res.status(500).json({ error: true, message: 'Could not mark as read.' });
  }
});

// ─── Mute conversation ────────────────────────────────────────────
router.post('/:conversationId/mute', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const ref = db.collection('conversations').doc(req.params.conversationId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: doc.id, ...doc.data() };
    if (!_assertParticipant(convo, req.user.id, res)) return;

    const hours      = parseInt(req.body.hours) || 24;
    const mutedUntil = req.body.mute === false ? null : new Date(Date.now() + hours * 3600 * 1000).toISOString();
    const newParts   = (convo.participants || []).map(p =>
      p.userId === req.user.id ? { ...p, mutedUntil } : p
    );
    await ref.update({ participants: newParts });
    res.json({ success: true });
  } catch (err) {
    logger.error('[dm] mute error:', err.message);
    res.status(500).json({ error: true, message: 'Could not update mute settings.' });
  }
});

// ─── Block / Unblock ──────────────────────────────────────────────
router.post('/:conversationId/block', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const ref = db.collection('conversations').doc(req.params.conversationId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: doc.id, ...doc.data() };
    if (!_assertParticipant(convo, req.user.id, res)) return;
    const newParts = (convo.participants || []).map(p => p.userId === req.user.id ? { ...p, isBlocked: true } : p);
    await ref.update({ participants: newParts });
    res.json({ success: true });
  } catch (err) {
    logger.error('[dm] block error:', err.message);
    res.status(500).json({ error: true, message: 'Could not block user.' });
  }
});

router.post('/:conversationId/unblock', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const ref = db.collection('conversations').doc(req.params.conversationId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: true, message: 'This conversation is unavailable.' });
    const convo = { id: doc.id, ...doc.data() };
    if (!_assertParticipant(convo, req.user.id, res)) return;
    const newParts = (convo.participants || []).map(p => p.userId === req.user.id ? { ...p, isBlocked: false } : p);
    await ref.update({ participants: newParts });
    res.json({ success: true });
  } catch (err) {
    logger.error('[dm] unblock error:', err.message);
    res.status(500).json({ error: true, message: 'Could not unblock user.' });
  }
});

module.exports = router;
