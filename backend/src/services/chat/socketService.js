/**
 * Socket.io service — Avenora real-time features (Firestore edition)
 *
 * - Public chat (rooms + public messages)
 * - Private room chat
 * - Direct messages (real-time delivery)
 * - Live stream viewer counts
 * - Online presence
 * - Notifications
 */

'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');
const { getDb, newId, now } = require('../../config/firestore');

let io = null;

// In-memory presence store (replace with Redis for multi-instance)
const onlineUsers = new Map(); // userId -> Set<socketId>
const roomUsers   = new Map(); // roomId -> Set<userId>

function initializeSocketServer(httpServer) {
  const _socketOriginFn = (origin, callback) => {
    if (!origin) return callback(null, true);
    const envUrls = [
      process.env.FRONTEND_URL,
      process.env.FRONTEND_URL_2,
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ].filter(Boolean).map(u => u.replace(/\/$/, ''));
    if (envUrls.includes(origin)) return callback(null, true);
    if (/^https:\/\/[^.]+\.github\.io$/.test(origin)) return callback(null, true);
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return callback(null, true);
    logger.warn(`[Socket.io] Blocked origin: ${origin}`);
    return callback(new Error(`Socket.io: origin '${origin}' not allowed`));
  };

  io = new Server(httpServer, {
    cors: { origin: _socketOriginFn, credentials: true },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // ─── Auth middleware ───────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) { socket.user = null; return next(); }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: payload.sub, username: payload.username, role: payload.role };
      next();
    } catch {
      socket.user = null;
      next(); // allow read-only
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    logger.debug(`Socket connected: ${socket.id} (user: ${user?.username || 'guest'})`);

    // ─── Presence ────────────────────────────────────────────────
    if (user) {
      if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
      onlineUsers.get(user.id).add(socket.id);
      socket.join(`user:${user.id}`);
      io.emit('user:online', { userId: user.id, username: user.username });
    }

    // ─── Public chat room management ─────────────────────────────
    socket.on('chat:join', ({ roomId }) => {
      if (!roomId) return;
      socket.join(`room:${roomId}`);
      if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Set());
      if (user) roomUsers.get(roomId).add(user.id);
      socket.to(`room:${roomId}`).emit('chat:user_joined', {
        roomId,
        user: user ? { id: user.id, username: user.username } : null,
        onlineCount: roomUsers.get(roomId)?.size || 0,
      });
    });

    socket.on('chat:leave', ({ roomId }) => {
      socket.leave(`room:${roomId}`);
      if (user && roomUsers.has(roomId)) roomUsers.get(roomId).delete(user.id);
    });

    // ─── Public chat messages ─────────────────────────────────────
    socket.on('chat:message', async ({ roomId, content, replyToId }) => {
      if (!user) return socket.emit('chat:error', { message: 'Login required to send messages' });
      if (!roomId || !content?.trim()) return;
      if (content.length > 4000) return socket.emit('chat:error', { message: 'Message too long (max 4000 chars)' });

      const suspended = await _isSuspended(user.id);
      if (suspended) return socket.emit('chat:error', { message: 'Your account is restricted.' });

      const safeContent = escapeHtml(content.trim());
      const saved = await _persistPublicMessage({ roomId, author: user, content: safeContent, replyToId });

      const message = {
        id:        saved?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        roomId,
        author:    { id: user.id, username: user.username },
        content:   safeContent,
        replyToId: replyToId || null,
        timestamp: new Date().toISOString(),
      };
      io.to(`room:${roomId}`).emit('chat:message', message);
    });

    // ─── Private room messages ────────────────────────────────────
    socket.on('room:join', async ({ roomId }) => {
      if (!user || !roomId) return;
      const allowed = await _checkRoomMembership(user.id, roomId);
      if (!allowed) return socket.emit('chat:error', { message: 'You do not have access to this room.' });
      socket.join(`proom:${roomId}`);
    });

    socket.on('room:leave', ({ roomId }) => {
      if (roomId) socket.leave(`proom:${roomId}`);
    });

    socket.on('room:message', async ({ roomId, content, replyToId }) => {
      if (!user) return socket.emit('chat:error', { message: 'Login required to send messages' });
      if (!roomId || !content?.trim()) return;
      if (content.length > 4000) return socket.emit('chat:error', { message: 'Message too long.' });

      const allowed = await _checkRoomMembership(user.id, roomId);
      if (!allowed) return socket.emit('chat:error', { message: 'You do not have access to this room.' });

      const muted = await _isRoomMuted(user.id, roomId);
      if (muted) return socket.emit('chat:error', { message: 'You are muted in this room.' });

      const suspended = await _isSuspended(user.id);
      if (suspended) return socket.emit('chat:error', { message: 'Your account is restricted.' });

      const safeContent = escapeHtml(content.trim());
      const saved = await _persistRoomMessage({ roomId, author: user, content: safeContent, replyToId });

      const message = {
        id:        saved?.id || `${Date.now()}`,
        roomId,
        roomType:  'private',
        author:    { id: user.id, username: user.username },
        content:   safeContent,
        replyToId: replyToId || null,
        timestamp: new Date().toISOString(),
      };
      io.to(`proom:${roomId}`).emit('room:message', message);
    });

    // ─── Typing indicators ────────────────────────────────────────
    socket.on('chat:typing', ({ roomId, isTyping }) => {
      if (!user || !roomId) return;
      socket.to(`room:${roomId}`).emit('chat:typing', { roomId, user: { id: user.id, username: user.username }, isTyping });
    });

    socket.on('room:typing', ({ roomId, isTyping }) => {
      if (!user || !roomId) return;
      socket.to(`proom:${roomId}`).emit('room:typing', { roomId, user: { id: user.id, username: user.username }, isTyping });
    });

    socket.on('dm:typing', ({ conversationId, isTyping }) => {
      if (!user || !conversationId) return;
      socket.to(`convo:${conversationId}`).emit('dm:typing', { conversationId, user: { id: user.id, username: user.username }, isTyping });
    });

    socket.on('dm:join', async ({ conversationId }) => {
      if (!user || !conversationId) return;
      const ok = await _checkConvoParticipation(user.id, conversationId);
      if (!ok) return;
      socket.join(`convo:${conversationId}`);
    });

    socket.on('dm:leave', ({ conversationId }) => {
      if (conversationId) socket.leave(`convo:${conversationId}`);
    });

    // ─── Stream viewer tracking ───────────────────────────────────
    socket.on('stream:join', ({ streamId }) => {
      if (!streamId) return;
      socket.join(`stream:${streamId}`);
      const count = io.sockets.adapter.rooms.get(`stream:${streamId}`)?.size || 0;
      io.to(`stream:${streamId}`).emit('stream:viewer_count', { streamId, count });
    });

    socket.on('stream:leave', ({ streamId }) => {
      socket.leave(`stream:${streamId}`);
      const count = io.sockets.adapter.rooms.get(`stream:${streamId}`)?.size || 0;
      io.to(`stream:${streamId}`).emit('stream:viewer_count', { streamId, count });
    });

    // ─── Disconnect ───────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (user && onlineUsers.has(user.id)) {
        onlineUsers.get(user.id).delete(socket.id);
        if (onlineUsers.get(user.id).size === 0) {
          onlineUsers.delete(user.id);
          io.emit('user:offline', { userId: user.id });
        }
      }
    });
  });

  global.socketIo = io;
  logger.info('✅ Socket.io server initialized');
  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

function notifyUser(userId, event, data) {
  const socketIds = onlineUsers.get(userId.toString());
  if (!socketIds) return;
  socketIds.forEach(sid => io.to(sid).emit(event, data));
}

// ─── Internal helpers ─────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

async function _isSuspended(userId) {
  try {
    const db  = getDb();
    const doc = await db.collection('users').doc(userId).get();
    if (!doc.exists) return false;
    const status = doc.data().status || {};
    if (!status.isSuspended) return false;
    if (status.suspendedUntil && new Date(status.suspendedUntil) < new Date()) return false;
    return true;
  } catch { return false; }
}

async function _checkRoomMembership(userId, roomId) {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(roomId).get();
    if (!doc.exists || doc.data().isDeleted) return false;
    const room = doc.data();
    if ((room.bans || []).some(b => b.userId === userId)) return false;
    return (room.members || []).some(m => m.userId === userId);
  } catch { return false; }
}

async function _isRoomMuted(userId, roomId) {
  try {
    const db  = getDb();
    const doc = await db.collection('rooms').doc(roomId).get();
    if (!doc.exists) return false;
    const member = (doc.data().members || []).find(m => m.userId === userId);
    if (!member?.mutedUntil) return false;
    return new Date(member.mutedUntil) > new Date();
  } catch { return false; }
}

async function _checkConvoParticipation(userId, conversationId) {
  try {
    const db  = getDb();
    const doc = await db.collection('conversations').doc(conversationId).get();
    if (!doc.exists || doc.data().isDeleted) return false;
    return (doc.data().participantIds || []).includes(userId);
  } catch { return false; }
}

async function _persistPublicMessage(message) {
  try {
    const db = getDb();
    const id = newId();
    await db.collection('chatMessages').doc(id).set({
      roomId:        message.roomId,
      roomType:      'public',
      authorId:      message.author?.id || null,
      authorUsername: message.author?.username || 'Unknown',
      content:       message.content,
      replyToId:     message.replyToId || null,
      isDeleted:     false,
      isSystem:      false,
      createdAt:     now(),
    });
    return { id };
  } catch (err) {
    logger.warn('Public chat message persist failed:', err.message);
    return null;
  }
}

async function _persistRoomMessage(message) {
  try {
    const db = getDb();
    const id = newId();
    await db.collection('roomMessages').doc(id).set({
      roomId:         message.roomId,
      authorId:       message.author?.id || null,
      authorUsername: message.author?.username || 'Unknown',
      author: {
        id:       message.author?.id || null,
        username: message.author?.username || 'Unknown',
      },
      content:        message.content,
      replyToId:      message.replyToId || null,
      isDeleted:      false,
      isSystem:       false,
      createdAt:      now(),
    });
    return { id };
  } catch (err) {
    logger.warn('Room message persist failed:', err.message);
    return null;
  }
}

module.exports = { initializeSocketServer, getIO, notifyUser };
