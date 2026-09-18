/**
 * Notification Service — Firestore-backed
 */
'use strict';

const { getDb } = require('../../config/firestore');
const logger = require('../../utils/logger');

async function createNotification({ recipient, sender, type, postId, conversationId, roomId, message }) {
  if (!recipient || recipient === sender) return null;
  try {
    const db  = getDb();
    const ref = db.collection('notifications').doc();
    await ref.set({
      id:             ref.id,
      recipient,
      sender,
      type,
      postId:         postId || null,
      conversationId: conversationId || null,
      roomId:         roomId || null,
      message:        message || buildMessage(type),
      isRead:         false,
      createdAt:      new Date().toISOString(),
    });
    return ref.id;
  } catch (err) {
    logger.warn('[Notification] create failed:', err.message);
    return null;
  }
}

function buildMessage(type) {
  const map = {
    follow:   'Someone followed you',
    like:     'Someone liked your post',
    comment:  'Someone commented on your post',
    repost:   'Someone reposted your post',
    dm:       'You have a new message',
    room_invite: 'You were invited to a room',
  };
  return map[type] || 'You have a new notification';
}

module.exports = { createNotification };
