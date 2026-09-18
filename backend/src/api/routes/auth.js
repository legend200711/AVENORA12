/**
 * Auth Routes
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { register, login, refreshAccessToken, logout } = require('../../services/auth/authService');
const { authenticate } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const { ValidationError } = require('../middleware/errorHandler');
const logger = require('../../utils/logger');

// ─── Email helper (Resend) ───────────────────────────────────────────────────
// Returns { ok: true } on success, { ok: false, error } on failure.
// Does NOT throw — callers should degrade gracefully.
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('[Auth] RESEND_API_KEY not set — cannot send password reset email');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'AVENORA <noreply@avenora.app>',
        to:      [toEmail],
        subject: 'Reset your AVENORA password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#090807">Reset your password</h2>
            <p>You requested a password reset for your AVENORA account.</p>
            <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
            <a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#b8954b;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">
              Reset Password
            </a>
            <p style="font-size:0.85em;color:#666">
              If you didn't request this, you can safely ignore this email.<br>
              This link expires in 1 hour and can only be used once.
            </p>
            <p style="font-size:0.8em;color:#999">AVENORA — A place where everyone belongs.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logger.warn('[Auth] Resend email failed:', body.message || res.status);
      return { ok: false, error: body.message || `HTTP ${res.status}` };
    }

    logger.info(`[Auth] Password reset email sent to ${toEmail}`);
    return { ok: true };
  } catch (err) {
    logger.warn('[Auth] Resend email error:', err.message);
    return { ok: false, error: err.message };
  }
}

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
// 1. Generate a secure random token
// 2. Hash it and store in User.passwordReset (never send the hash to the client)
// 3. Send an email with the raw token via Resend
// Always returns success to prevent email enumeration.
router.post('/forgot-password', authRateLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(422).json({ error: true, message: 'Email required' });

    const User = require('../../models/User');
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+passwordReset.tokenHash +passwordReset.expiresAt');

    // Always return the same response — do not reveal whether email is registered
    if (!user) {
      return res.json({ success: true, message: 'If that email is registered, a reset link will be sent.' });
    }

    // Generate a cryptographically random 32-byte token
    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Store hash + expiry — never store the raw token
    user.passwordReset = { tokenHash, expiresAt, usedAt: undefined };
    await user.save();

    // Build the reset URL pointing at the production frontend
    const frontendBase = (process.env.FRONTEND_URL || 'https://legend200711.github.io').replace(/\/$/, '');
    const resetUrl = `${frontendBase}/AVENORA1/index.html#reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    // Send email (non-blocking — we still return success if email fails)
    const emailResult = await sendPasswordResetEmail(user.email, resetUrl);

    const response = { success: true, message: 'If that email is registered, a reset link will be sent.' };

    // Dev mode only: return token in response for testing without an email provider
    if (process.env.NODE_ENV !== 'production') {
      response._dev = {
        resetToken: rawToken,
        resetUrl,
        emailSent: emailResult.ok,
        emailError: emailResult.ok ? undefined : emailResult.error,
        note: 'Token returned in non-production mode only. In production only the email is sent.',
      };
    } else if (!emailResult.ok) {
      // Production + email failed → log the error so operator can investigate
      logger.error('[Auth] Forgot-password email delivery failed:', emailResult.error);
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
// 1. Look up the user by email
// 2. Hash the provided token and compare with the stored hash
// 3. Check expiry and that the token hasn't been used already
// 4. Update the password and mark the token as used
router.post('/reset-password', authRateLimiter, async (req, res, next) => {
  try {
    const { token, email, password } = req.body;
    if (!token || !email || !password) {
      return res.status(422).json({ error: true, message: 'token, email, and new password are required' });
    }
    if (password.length < 8) {
      return res.status(422).json({ error: true, message: 'Password must be at least 8 characters' });
    }

    const User = require('../../models/User');
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+passwordHash +passwordReset.tokenHash +passwordReset.expiresAt +passwordReset.usedAt');

    // Generic error — do not reveal whether the email exists
    const INVALID = () => res.status(400).json({ error: true, message: 'This reset link is invalid or has expired. Please request a new one.' });

    if (!user) return INVALID();

    const pr = user.passwordReset;
    if (!pr || !pr.tokenHash || !pr.expiresAt) return INVALID();

    // Check expiry
    if (new Date() > pr.expiresAt) return INVALID();

    // Check already used
    if (pr.usedAt) return INVALID();

    // Constant-time hash comparison
    const incomingHash = crypto.createHash('sha256').update(token).digest('hex');
    const storedHash   = pr.tokenHash;
    if (incomingHash.length !== storedHash.length) return INVALID();
    const match = crypto.timingSafeEqual(Buffer.from(incomingHash), Buffer.from(storedHash));
    if (!match) return INVALID();

    // Valid — update password and invalidate token
    user.passwordHash = await User.hashPassword(password);
    user.passwordReset.usedAt = new Date();
    user.passwordReset.tokenHash = undefined;
    await user.save();

    logger.info(`[Auth] Password reset completed for ${user.email}`);
    res.json({ success: true, message: 'Password reset successfully. Please sign in with your new password.' });
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
