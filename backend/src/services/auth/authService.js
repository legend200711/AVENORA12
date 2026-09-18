/**
 * Authentication Service — Firestore-backed
 * Handles legacy email/password sign-up, login, token issuance.
 * Firebase Auth (client SDK) is the primary authentication path;
 * this service supports legacy JWT flows for compatibility.
 */

'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb, FieldValue, now } = require('../../config/firestore');
const logger = require('../../utils/logger');
const { AppError, UnauthorizedError } = require('../../api/middleware/errorHandler');

const JWT_SECRET          = process.env.JWT_SECRET;
const JWT_EXPIRES_IN      = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET;
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

// ─── Token helpers ───────────────────────────────────────────

function generateAccessToken(user) {
  if (!JWT_SECRET) throw new AppError('JWT_SECRET not configured', 500, 'CONFIG_ERROR');
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, issuer: 'legend-universe' }
  );
}

function generateRefreshToken(user) {
  if (!JWT_REFRESH_SECRET) throw new AppError('JWT_REFRESH_SECRET not configured', 500, 'CONFIG_ERROR');
  const token  = crypto.randomBytes(64).toString('hex');
  const signed = jwt.sign(
    { sub: user.id, tokenId: token },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN, issuer: 'legend-universe' }
  );
  return { signed, raw: token };
}

// ─── Auth operations ─────────────────────────────────────────

async function register({ username, email, password }) {
  const db = getDb();
  const normalizedEmail = email.toLowerCase();

  // Check username uniqueness
  const usernameSnap = await db.collection('users')
    .where('username', '==', username).limit(1).get();
  if (!usernameSnap.empty) throw new AppError('Username already taken', 409, 'USERNAME_TAKEN');

  // Check email uniqueness
  const emailSnap = await db.collection('users')
    .where('email', '==', normalizedEmail).limit(1).get();
  if (!emailSnap.empty) throw new AppError('Email already registered', 409, 'EMAIL_TAKEN');

  const passwordHash = await bcrypt.hash(password, 12);
  const authorizedFounderEmail = (process.env.FOUNDER_EMAIL || '').trim().toLowerCase();
  const role = (authorizedFounderEmail && normalizedEmail === authorizedFounderEmail) ? 'founder' : 'user';

  const id   = db.collection('users').doc().id;
  const user = {
    id,
    username,
    email: normalizedEmail,
    passwordHash,
    role,
    profile:     { displayName: username, bio: '', avatarUrl: null, bannerUrl: null, location: '', website: '' },
    stats:       { followersCount: 0, followingCount: 0, postsCount: 0 },
    status:      { isOnline: true, lastSeen: new Date().toISOString(), isActive: true, isSuspended: false },
    preferences: {},
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };

  await db.collection('users').doc(id).set(user);
  if (role === 'founder') logger.info(`Founder registered: ${username} (${id})`);
  else logger.info(`New user registered: ${username} (${id})`);

  const accessToken = generateAccessToken(user);
  const { signed: refreshToken } = generateRefreshToken(user);
  return { user: _publicProfile(user), accessToken, refreshToken };
}

async function login({ email, password }) {
  const db = getDb();
  const snap = await db.collection('users')
    .where('email', '==', email.toLowerCase()).limit(1).get();
  if (snap.empty) throw new UnauthorizedError('Invalid email or password');

  const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
  if (!user.passwordHash) throw new UnauthorizedError('Invalid email or password');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new UnauthorizedError('Invalid email or password');

  if (user.status?.isSuspended) {
    const until = user.status.suspendedUntil ? ` until ${user.status.suspendedUntil}` : '';
    throw new AppError(
      `Account suspended${until}. Reason: ${user.status.suspendedReason || 'Policy violation'}`,
      403, 'ACCOUNT_SUSPENDED'
    );
  }
  if (user.status && user.status.isActive === false) {
    throw new AppError('Account is deactivated', 403, 'ACCOUNT_DEACTIVATED');
  }

  await db.collection('users').doc(user.id).update({
    'status.isOnline': true,
    'status.lastSeen': new Date().toISOString(),
  });

  const accessToken = generateAccessToken(user);
  const { signed: refreshToken } = generateRefreshToken(user);
  logger.info(`User logged in: ${user.username}`);
  return { user: _publicProfile(user), accessToken, refreshToken };
}

async function refreshAccessToken(refreshToken) {
  if (!JWT_REFRESH_SECRET) throw new AppError('Not configured', 500);
  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  const snap = await getDb().collection('users').doc(payload.sub).get();
  if (!snap.exists) throw new UnauthorizedError('User not found');
  const user = { id: snap.id, ...snap.data() };
  if (user.status?.isActive === false) throw new UnauthorizedError('Account deactivated');
  return { accessToken: generateAccessToken(user) };
}

async function logout(userId) {
  await getDb().collection('users').doc(userId).update({
    'status.isOnline': false,
    'status.lastSeen': new Date().toISOString(),
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function _publicProfile(user) {
  // eslint-disable-next-line no-unused-vars
  const { passwordHash, passwordReset, refreshTokens, ...safe } = user;
  return safe;
}

module.exports = { register, login, refreshAccessToken, logout, generateAccessToken };
