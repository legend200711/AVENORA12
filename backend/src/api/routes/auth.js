/**
 * Auth Routes — Firestore-backed
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { body, validationResult } = require('express-validator');
const { register, login, refreshAccessToken, logout } = require('../../services/auth/authService');
const { authenticate } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const { ValidationError } = require('../middleware/errorHandler');
const { getDb } = require('../../config/firestore');
const logger   = require('../../utils/logger');

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { logger.warn('[Auth] RESEND_API_KEY not set'); return { ok: false }; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AVENORA <noreply@avenora.app>',
        to: [toEmail],
        subject: 'Reset your AVENORA password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2>Reset your password</h2>
          <p>Click below to reset your AVENORA password. Expires in <strong>1 hour</strong>.</p>
          <a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#b8954b;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Reset Password</a>
          <p style="font-size:0.85em;color:#666">If you didn't request this, ignore this email.</p>
        </div>`,
      }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); return { ok: false, error: b.message }; }
    logger.info(`[Auth] Reset email sent to ${toEmail}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return next(new ValidationError('Validation failed', errors.array()));
  next();
}

// POST /api/auth/register
router.post('/register', authRateLimiter,
  [
    body('username').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username must be 3-30 chars, letters/numbers/underscores only'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await register(req.body);
      res.status(201).json({ success: true, ...result });
    } catch (err) { next(err); }
  }
);

// POST /api/auth/login
router.post('/login', authRateLimiter,
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await login(req.body);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }
);

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: true, message: 'Refresh token required' });
    const result = await refreshAccessToken(refreshToken);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authRateLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(422).json({ error: true, message: 'Email required' });

    const db = getDb();
    const snap = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
    // Always return success — don't reveal whether email exists
    if (snap.empty) return res.json({ success: true, message: 'If that email is registered, a reset link will be sent.' });

    const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await db.collection('users').doc(user.id).update({
      'passwordReset.tokenHash':  tokenHash,
      'passwordReset.expiresAt':  expiresAt,
      'passwordReset.usedAt':     null,
    });

    const frontendBase = (process.env.FRONTEND_URL || 'https://legend200711.github.io').replace(/\/$/, '');
    const resetUrl = `${frontendBase}/AVENORA1/index.html#reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;
    const emailResult = await sendPasswordResetEmail(user.email, resetUrl);

    const response = { success: true, message: 'If that email is registered, a reset link will be sent.' };
    if (process.env.NODE_ENV !== 'production') {
      response._dev = { resetToken: rawToken, resetUrl, emailSent: emailResult.ok };
    }
    res.json(response);
  } catch (err) { next(err); }
});

// POST /api/auth/reset-password
router.post('/reset-password', authRateLimiter, async (req, res, next) => {
  try {
    const { token, email, password } = req.body;
    if (!token || !email || !password) return res.status(422).json({ error: true, message: 'token, email, and password are required' });
    if (password.length < 8) return res.status(422).json({ error: true, message: 'Password must be at least 8 characters' });

    const INVALID = () => res.status(400).json({ error: true, message: 'This reset link is invalid or has expired.' });
    const db = getDb();
    const snap = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
    if (snap.empty) return INVALID();

    const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
    const pr = user.passwordReset;
    if (!pr?.tokenHash || !pr?.expiresAt) return INVALID();
    if (new Date() > new Date(pr.expiresAt)) return INVALID();
    if (pr.usedAt) return INVALID();

    const incomingHash = crypto.createHash('sha256').update(token).digest('hex');
    if (incomingHash !== pr.tokenHash) return INVALID();

    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 12);
    await db.collection('users').doc(user.id).update({
      passwordHash,
      'passwordReset.usedAt': new Date().toISOString(),
      'passwordReset.tokenHash': null,
    });

    logger.info(`[Auth] Password reset for ${user.email}`);
    res.json({ success: true, message: 'Password reset successfully.' });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await logout(req.user.id);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const snap = await db.collection('users').doc(req.user.id).get();
    if (!snap.exists) {
      return res.json({ success: true, user: {
        id: req.user.id, uid: req.user.uid,
        username: req.user.username, role: req.user.role || 'user',
        email: req.user.email, profile: {}, stats: {}, status: {},
      }});
    }
    const data = snap.data();
    // eslint-disable-next-line no-unused-vars
    const { passwordHash, passwordReset, ...safe } = data;
    res.json({ success: true, user: { id: snap.id, ...safe } });
  } catch (err) { next(err); }
});

module.exports = router;
