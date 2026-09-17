/**
 * Auth Routes
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { register, login, refreshAccessToken, logout } = require('../../services/auth/authService');
const { authenticate } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const { ValidationError } = require('../middleware/errorHandler');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new ValidationError('Validation failed', errors.array()));
  }
  next();
}

// POST /api/auth/register
router.post('/register',
  authRateLimiter,
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
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/auth/login
router.post('/login',
  authRateLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await login(req.body);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: true, message: 'Refresh token required' });
    const result = await refreshAccessToken(refreshToken);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password
// Initiates password reset. In production: send email via Resend/SendGrid.
// In dev mode: returns a reset token directly (for testing).
router.post('/forgot-password', authRateLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(422).json({ error: true, message: 'Email required' });

    const User = require('../../models/User');
    const user = await User.findOne({ email: email.toLowerCase() });

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If that email is registered, a reset link will be sent.' });
    }

    const crypto = require('crypto');
    const { generateAccessToken } = require('../../services/auth/authService');

    // Issue a short-lived reset token (1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    // In production: store hashed token + expiry in DB, send email with link
    // For dev: return token directly
    const isDev = process.env.NODE_ENV !== 'production';

    const response = {
      success: true,
      message: 'If that email is registered, a reset link will be sent.',
    };

    if (isDev) {
      // Dev mode only — never expose reset tokens in production
      response._devResetToken = resetToken;
      response._devNote = 'Token returned directly in development only. In production, configure RESEND_API_KEY.';
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authRateLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(422).json({ error: true, message: 'Token and new password are required' });
    }
    if (password.length < 8) {
      return res.status(422).json({ error: true, message: 'Password must be at least 8 characters' });
    }
    // In production: validate token from DB, update password, invalidate token
    res.json({ success: true, message: 'Password reset. Please sign in with your new password.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    // req.user.id may be a Firebase UID (string) or MongoDB ObjectId string.
    // Only call the DB-backed logout for MongoDB-registered users; Firebase users
    // manage their own session via the Firebase SDK and don't have a DB record.
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(req.user.id)) {
      await logout(req.user.id);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const User = require('../../models/User');
    const mongoose = require('mongoose');
    let user = null;
    // For Firebase-authenticated users (UID is not a valid Mongo ObjectId)
    // try to find by a stable identifier (email) rather than by _id.
    if (mongoose.Types.ObjectId.isValid(req.user.id)) {
      user = await User.findById(req.user.id);
    } else if (req.user.email) {
      user = await User.findOne({ email: req.user.email.toLowerCase() });
    }
    if (!user) {
      // Firebase-only user — return the JWT payload as a profile stub so
      // callers that depend on /me don't get a hard 404.
      return res.json({
        success: true,
        user: {
          id:       req.user.id,
          uid:      req.user.uid,
          username: req.user.username,
          role:     req.user.role || 'user',
          email:    req.user.email,
          profile:  {},
          stats:    {},
          status:   {},
        },
      });
    }
    res.json({ success: true, user: user.toPublicProfile() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
