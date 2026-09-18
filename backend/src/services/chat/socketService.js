/**
 * Socket.io service for real-time features:
 * - Avenora Chat (public rooms + private rooms + DMs)
 * - Live stream viewer counts
 * - Online presence
 * - Notifications
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');

let io = null;

// In-memory presence store (replace with Redis in production for multi-instance)
const onlineUsers = new Map(); // userId -> Set<socketId>
const roomUsers = new Map();   // roomId -> Set<userId>

// Per-user block set cache — loaded from DB when socket authenticates
const userBlockedSets = new Map(); // userId -> Set<userId(string)>

function initializeSocketServer(httpServer) {
  // Mirror the same origin-matching logic as the HTTP CORS config in server.js.
  // Accept any github.io subdomain so all GitHub Pages previews work, plus
  // the configured FRONTEND_URL, FRONTEND_URL_2, and localhost for dev.
  const _socketOriginFn = (origin, callback) => {
    if (!origin) return callback(null, true); // curl / SSR / same-host
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
    cors: {
      origin: _socketOriginFn,
      credentials: true,
    },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // ─── Authentication middleware ───────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.user = null;
      return next();
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: payload.sub, username: payload.username, role: payload.role };
      next();
    } catch {
      socket.user = null;
      next(); // Allow read-only
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    logger.debug(`Socket connected: ${socket.id} (user: ${user?.username || 'guest'})`);

    // ─── Presence ───────────────────────────────────────────────
    if (user) {
      if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
      onlineUsers.get(user.id).add(socket.id);
      socket.join(`user:${user.id}`);
      io.emit('user:online', { userId: user.id, username: user.username });

      // Load block list into memory for quick enforcement
      _loadBlockSet(user.id).catch(() => {});
    }

    // ─── Public Chat room management ────────────────────────────
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

    // ─── Public Chat messages ────────────────────────────────────
    socket.on('chat:message', async ({ roomId, content, replyToId }) => {
      if (!user) return socket.emit('chat:error', { message: 'Login required to send messages' });
      if (!roomId || !content?.trim()) return;
      if (content.length > 4000) return socket.emit('chat:error', { message: 'Message too long (max 4000 chars)' });

      // Check if sender is suspended
      const suspended = await _isSuspended(user.id);
      if (suspended) return socket.emit('chat:error', { message: 'Your account is restricted.' });

      const safeContent = escapeHtml(content.trim());
      const messageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Persist first (with ID)
      const saved = await persistChatMessage({
        id: messageId, roomId, roomType: 'public',
        author: user, content: safeContent, replyToId,
      });

      const message = {
        id: saved?._id?.toString() || messageId,
        roomId,
        author: { id: user.id, username: user.username },
        content: safeContent,
        replyToId: replyToId || null,
        timestamp: new Date().toISOString(),
      };

      io.to(`room:${roomId}`).emit('chat:message', message);
    });

    // ─── Private Room messages ───────────────────────────────────
    socket.on('room:join', async ({ roomId }) => {
      if (!user || !roomId) return;

      // Backend membership check
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

      // Server-side membership + mute check
      const allowed = await _checkRoomMembership(user.id, roomId);
      if (!allowed) return socket.emit('chat:error', { message: 'You do not have access to this room.' });

      const muted = await _isRoomMuted(user.id, roomId);
      if (muted) return socket.emit('chat:error', { message: 'You are muted in this room.' });

      const suspended = await _isSuspended(user.id);
      if (suspended) return socket.emit('chat:error', { message: 'Your account is restricted.' });

      const safeContent = escapeHtml(content.trim());
      const saved = await persistChatMessage({
        roomId, roomType: 'private', author: user,
        content: safeContent, replyToId,
      });

      const message = {
        id: saved?._id?.toString() || `${Date.now()}`,
        roomId,
        roomType: 'private',
        author: { id: user.id, username: user.username },
        content: safeContent,
        replyToId: replyToId || null,
        timestamp: new Date().toISOString(),
      };

      io.to(`proom:${roomId}`).emit('room:message', message);
    });

    // ─── Direct Messages (real-time delivery) ───────────────────
    // The REST API handles message persistence; socket delivers real-time
    // This socket event is sent by the client AFTER a successful REST post,
    // just to trigger immediate delivery to the other party if online.
    // (The REST /api/dm/:id/messages route already emits via global io)

    // ─── Typing indicators ───────────────────────────────────────
    socket.on('chat:typing', ({ roomId, isTyping }) => {
      if (!user || !roomId) return;
      socket.to(`room:${roomId}`).emit('chat:typing', {
        roomId,
        user: { id: user.id, username: user.username },
        isTyping,
      });
    });

    socket.on('room:typing', ({ roomId, isTyping }) => {
      if (!user || !roomId) return;
      socket.to(`proom:${roomId}`).emit('room:typing', {
        roomId,
        user: { id: user.id, username: user.username },
        isTyping,
      });
    });

    socket.on('dm:typing', ({ conversationId, isTyping }) => {
      if (!user || !conversationId) return;
      // Only emit to the other participant's personal room
      socket.to(`convo:${conversationId}`).emit('dm:typing', {
        conversationId,
        user: { id: user.id, username: user.username },
        isTyping,
      });
    });

    // Allow sockets to subscribe to a conversation room for typing indicators
    socket.on('dm:join', async ({ conversationId }) => {
      if (!user || !conversationId) return;
      // Quick participation check
      const ok = await _checkConvoParticipation(user.id, conversationId);
      if (!ok) return;
      socket.join(`convo:${conversationId}`);
    });

    socket.on('dm:leave', ({ conversationId }) => {
      if (conversationId) socket.leave(`convo:${conversationId}`);
    });

    // ─── Stream viewer tracking ──────────────────────────────────
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

    // ─── Disconnect ──────────────────────────────────────────────
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

// Emit notification to a specific user (all their sockets)
function notifyUser(userId, event, data) {
  const socketIds = onlineUsers.get(userId.toString());
  if (!socketIds) return;
  socketIds.forEach((sid) => {
    io.to(sid).emit(event, data);
  });
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

async function _loadBlockSet(userId) {
  try {
    const User = require('../../models/User');
    const user = await User.findById(userId).select('chat.blockedUsers').lean();
    const set = new Set((user?.chat?.blockedUsers || []).map(id => id.toString()));
    userBlockedSets.set(userId, set);
  } catch {}
}

async function _isSuspended(userId) {
  try {
    const User = require('../../models/User');
    const user = await User.findById(userId).select('status').lean();
    if (!user?.status?.isSuspended) return false;
    if (user.status.suspendedUntil && user.status.suspendedUntil < new Date()) return false;
    return true;
  } catch { return false; }
}

async function _checkRoomMembership(userId, roomId) {
  try {
    const PrivateRoom = require('../../models/PrivateRoom');
    const room = await PrivateRoom.findOne({ _id: roomId, isDeleted: false }).lean();
    if (!room) return false;
    if (room.bans?.some(b => b.userId?.toString() === userId)) return false;
    return room.members?.some(m => m.userId?.toString() === userId) || false;
  } catch { return false; }
}

async function _isRoomMuted(userId, roomId) {
  try {
    const PrivateRoom = require('../../models/PrivateRoom');
    const room = await PrivateRoom.findOne({ _id: roomId }).lean();
    const member = room?.members?.find(m => m.userId?.toString() === userId);
    if (!member?.mutedUntil) return false;
    return new Date(member.mutedUntil) > new Date();
  } catch { return false; }
}

async function _checkConvoParticipation(userId, conversationId) {
  try {
    const Conversation = require('../../models/Conversation');
    const convo = await Conversation.findOne({ _id: conversationId, 'participants.userId': userId, isDeleted: false }).lean();
    return !!convo;
  } catch { return false; }
}

async function persistChatMessage(message) {
  try {
    const ChatMessage = require('../../models/ChatMessage');
    const doc = await ChatMessage.create({
      roomId:    message.roomId,
      roomType:  message.roomType || 'public',
      author:    message.author?.id || undefined,
      authorUsername: message.author?.username || 'Unknown',
      content:   message.content,
      replyTo:   message.replyToId || undefined,
    });
    return doc;
  } catch (err) {
    logger.warn('Chat message persist failed:', err.message);
    return null;
  }
}

module.exports = { initializeSocketServer, getIO, notifyUser };
