/**
 * AVENORA - Main Backend Server
 * Entry point for the API + WebSocket server
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { connectDatabase } = require('./config/database');
const { initializeSocketServer } = require('./services/chat/socketService');
const logger = require('./utils/logger');

// Route imports
const authRoutes = require('./api/routes/auth');
const userRoutes = require('./api/routes/users');
const postRoutes = require('./api/routes/posts');
const videoRoutes = require('./api/routes/videos');
const streamRoutes = require('./api/routes/streams');
const musicRoutes = require('./api/routes/music');
const galleryRoutes = require('./api/routes/gallery');
const chatRoutes = require('./api/routes/chat');
const roomRoutes = require('./api/routes/rooms');
const dmRoutes   = require('./api/routes/dm');
const inboxRoutes = require('./api/routes/inbox');
const notificationRoutes = require('./api/routes/notifications');
const searchRoutes = require('./api/routes/search');
const adminRoutes = require('./api/routes/admin');
const adminThemeRoutes = require('./api/routes/adminThemes');
const uploadRoutes = require('./api/routes/upload');
const socialRoutes = require('./api/routes/social');
const reportsRoutes = require('./api/routes/reports');
const storiesRoutes = require('./api/routes/stories');
const companionRoutes = require('./api/routes/companion');
const preferencesRoutes = require('./api/routes/preferences');

const cloudStreamRoutes = require('./api/routes/cloudStream');
const cloudRadioRoutes  = require('./api/routes/cloudRadio');
const liveRoutes = require('./api/routes/live');
const pushRoutes = require('./api/routes/push');

// Middleware
const { globalRateLimiter } = require('./api/middleware/rateLimiter');
const { errorHandler } = require('./api/middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// ─── Security ───────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Configure per environment
}));

// Build allowed-origins list from environment variables.
// FRONTEND_URL  — primary deployed frontend (e.g. https://legend200711.github.io)
// FRONTEND_URL_2 — optional secondary origin (e.g. a custom domain)
// Always include localhost:3000 and localhost:5173 for local development.
const _buildAllowedOrigins = () => {
  const set = new Set([
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ]);
  const add = (v) => {
    if (v && v !== 'null' && v !== 'undefined') {
      // Strip trailing slash — origins do not include paths
      const clean = String(v).replace(/\/$/, '');
      if (clean) set.add(clean);
    }
  };
  add(process.env.FRONTEND_URL);
  add(process.env.FRONTEND_URL_2);
  return [...set];
};

const _allowedOrigins = _buildAllowedOrigins();
logger.info(`[CORS] Allowed origins: ${_allowedOrigins.join(', ')}`);

const _corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, mobile apps, SSR, same-host)
    if (!origin) return callback(null, true);
    if (_allowedOrigins.includes(origin)) return callback(null, true);
    // Accept any github.io subdomain (covers all GitHub Pages preview deployments
    // and the primary https://legend200711.github.io origin)
    if (/^https:\/\/[^.]+\.github\.io$/.test(origin)) return callback(null, true);
    // Accept any localhost port (useful for local frontend dev servers)
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    // Accept 127.0.0.1 on any port
    if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return callback(null, true);
    logger.warn(`[CORS] Blocked origin: ${origin}`);
    const corsErr = new Error(`CORS: origin '${origin}' not allowed`);
    corsErr.status = 403;
    callback(corsErr);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: [],
  // Explicit preflight: OPTIONS is handled before rate-limiting and auth middleware
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Apply CORS to all routes.
// OPTIONS preflight must be handled BEFORE rate limiting and auth middleware
// so that browsers can confirm the request is allowed without credentials.
app.use(cors(_corsOptions));
app.options('*', cors(_corsOptions)); // explicit OPTIONS handler for all routes

// ─── Request Parsing ────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
}

// ─── Rate Limiting ──────────────────────────────────────────
app.use('/api/', globalRateLimiter);

// ─── Static Uploads (dev only — use CDN in production) ──────
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, filePath) => {
    // Allow cross-origin audio/video for media players
    if (/\.(mp3|wav|ogg|flac|aac|mp4|webm|m4a)$/i.test(filePath)) {
      res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  },
}));

// ─── API Routes ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/streams', streamRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/themes', adminThemeRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/stories', storiesRoutes);
app.use('/api/companion', companionRoutes);
app.use('/api/preferences', preferencesRoutes);

app.use('/api/admin/cloud-stream', cloudStreamRoutes);
app.use('/api/cloud-radio', cloudRadioRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/push', pushRoutes);

// ─── Public: Published Theme Tokens (no auth required) ───────
// Returns only the CSS token values of the current live theme.
// Contains no PII, credentials, or internal data.
app.get('/api/themes/active', async (req, res) => {
  try {
    const { getDb } = require('./config/firestore');
    const db   = getDb();
    const snap = await db.collection('founderThemes')
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return res.json({ success: true, theme: null });
    const doc  = snap.docs[0].data();
    res.json({ success: true, theme: { name: doc.name, tokens: doc.tokens, publishedAt: doc.publishedAt } });
  } catch {
    res.json({ success: true, theme: null });
  }
});

// ─── Health Check ────────────────────────────────────────────
// Unauthenticated — no rate-limit, no auth middleware.
// Both paths are registered:
//   GET /health      — root-level ping for Render health checks and uptime monitors
//   GET /api/health  — used by the frontend HealthAPI (BASE_URL already ends in /api)
const _healthHandler = (req, res) => {
  res.json({
    ok: true,
    status: 'ok',
    service: 'avenora-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    // Safe diagnostics: presence checks only — no secret values returned
    config: {
      mongodbConfigured:     !!(process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('localhost')),
      firebaseProjectId:     process.env.FIREBASE_PROJECT_ID || null,
      firebaseApiKeyPresent: !!(process.env.FIREBASE_WEB_API_KEY),
      founderEmailConfigured: !!(process.env.FOUNDER_EMAIL),
      supabaseConfigured:    !!(process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('your-project')),
      frontendUrl:           process.env.FRONTEND_URL || null,
    },
  });
};
app.get('/health', _healthHandler);
app.get('/api/health', _healthHandler);

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// ─── Error Handler ───────────────────────────────────────────
app.use(errorHandler);

// ─── Startup ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

// ─── Supabase config validation ─────────────────────────────
// Run immediately on startup (before routes) so the developer gets
// a clear, actionable error in the console rather than a silent 503.
function _checkSupabaseConfig() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const placeholder = v => {
    if (!v) return true;
    const lc = String(v).toLowerCase();
    return lc.startsWith('replace_me') ||
      lc.startsWith('your_') ||
      lc.startsWith('your-') ||
      lc === 'https://your-project-id.supabase.co' ||
      lc.includes('your_project_id') ||
      lc.includes('your-project-id') ||
      lc === 'your-service-role-key-here' ||
      lc.includes('your_service_role') ||
      lc.includes('your-service-role');
  };

  if (placeholder(url) || placeholder(key)) {
    logger.warn('');
    logger.warn('══════════════════════════════════════════════════════════');
    logger.warn('⚠️  AVENORA STORAGE NOT CONFIGURED — uploads will fail');
    logger.warn('══════════════════════════════════════════════════════════');
    logger.warn('  SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are missing');
    logger.warn('  from backend/.env. All upload endpoints will return HTTP 503.');
    logger.warn('');
    logger.warn('  To fix:');
    logger.warn('    1. Go to https://supabase.com/dashboard');
    logger.warn('    2. Create a project (or open an existing one)');
    logger.warn('    3. Go to Project Settings → API');
    logger.warn('    4. Copy "Project URL" → SUPABASE_URL');
    logger.warn('    5. Copy "service_role" key → SUPABASE_SERVICE_ROLE_KEY');
    logger.warn('    6. Copy "anon public" key → SUPABASE_ANON_KEY');
    logger.warn('    7. Save backend/.env and restart the server');
    logger.warn('    8. See SUPABASE_SETUP.md for bucket policy instructions');
    logger.warn('');
    logger.warn('  Firebase auth (login/register) still works without Supabase.');
    logger.warn('══════════════════════════════════════════════════════════');
    logger.warn('');
  } else {
    logger.info('[Supabase] ✅ Supabase credentials detected in environment');
  }
}
_checkSupabaseConfig();

// ─── Required env-var check ───────────────────────────────────
(function _checkRequiredEnv() {
  const warn = (name, hint) => logger.warn(`⚠️  ${name} is not set. ${hint}`);

  if (!process.env.FIREBASE_PROJECT_ID) warn('FIREBASE_PROJECT_ID', 'Firebase ID token verification will fail.');
  if (!process.env.FIREBASE_WEB_API_KEY) warn('FIREBASE_WEB_API_KEY', 'Firebase ID token verification will fail.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('REPLACE_')) {
    logger.warn('⚠️  JWT_SECRET is not set to a real value. Legacy JWT auth will be insecure.');
  }
  if (!process.env.FOUNDER_EMAIL) warn('FOUNDER_EMAIL', 'Founder/admin access will not work.');
  if (process.env.NODE_ENV === 'production' && (!process.env.FRONTEND_URL || process.env.FRONTEND_URL.includes('your-'))) {
    logger.warn('⚠️  FRONTEND_URL is not set for production. CORS may block the frontend.');
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    logger.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_JSON is not set.');
    logger.warn('   Firestore Admin SDK will attempt Application Default Credentials (ADC).');
    logger.warn('   If running on Render, set FIREBASE_SERVICE_ACCOUNT_JSON in Render dashboard secrets.');
    logger.warn('   Firebase Console → Project Settings → Service Accounts → Generate new private key');
  } else {
    logger.info('[Firestore] ✅ Service account credentials detected');
  }
  if (!process.env.RESEND_API_KEY) {
    logger.warn('⚠️  RESEND_API_KEY is not set. Password reset emails will NOT be sent.');
  } else {
    logger.info('[Email] ✅ RESEND_API_KEY detected — password reset emails enabled');
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    logger.warn('⚠️  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set. Web Push notifications will not work.');
  } else {
    logger.info('[Push] ✅ VAPID keys detected — Web Push notifications enabled');
  }
  if (!process.env.MEDIAMTX_WHIP_URL || !process.env.MEDIAMTX_HLS_URL) {
    logger.warn('⚠️  MEDIAMTX_WHIP_URL / MEDIAMTX_HLS_URL not set. Browser-based live streaming will not work.');
  } else {
    logger.info('[Live] ✅ MediaMTX URLs detected — live streaming enabled');
  }
})();

async function start() {
  // Database connection — non-fatal: the server must start even if MongoDB is
  // unavailable so that GET /health is reachable and the operator can diagnose
  // the issue without a complete service outage.
  try {
    await connectDatabase();
  } catch (dbErr) {
    logger.error(`⚠️  Database connection failed at startup: ${dbErr.message}`);
    logger.error('   The server will start without a database connection.');
    logger.error('   MongoDB-dependent routes will return HTTP 503 until MONGODB_URI is set.');
    // Do NOT exit — fall through and start the HTTP server
  }

  // Ensure Supabase Storage buckets exist (non-fatal)
  try {
    const { ensureBuckets } = require('./services/storage/supabaseStorage');
    await ensureBuckets();
    logger.info('✅ Supabase Storage buckets verified');
  } catch (storageErr) {
    logger.warn(`⚠️  Supabase Storage bucket setup failed: ${storageErr.message}`);
    logger.warn('   Uploads will return HTTP 503 until SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
  }

  // Initialize Socket.io for real-time features (non-fatal)
  try {
    initializeSocketServer(server);
  } catch (socketErr) {
    logger.warn(`⚠️  Socket.io initialization failed: ${socketErr.message}`);
  }

  // Start HTTP server — this MUST succeed; if it fails, there is nothing to do
  server.listen(PORT, () => {
    logger.info(`🌅 AVENORA API running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);

    // ── Render free-tier keep-alive ─────────────────────────────────────
    // Render's free plan suspends a service after 15 minutes of inactivity.
    // Ping our own /health endpoint every 14 minutes so the process never
    // goes idle. Only runs in production when the RENDER env var is set
    // (Render injects RENDER=true automatically on all its instances).
    // Has zero effect in local development.
    if (process.env.NODE_ENV === 'production' && process.env.RENDER) {
      const _selfUrl = `http://localhost:${PORT}/health`;
      const _ping = () => {
        const http = require('http');
        http.get(_selfUrl, (res) => {
          // Drain the response so the socket closes cleanly
          res.resume();
          logger.debug('[keep-alive] self-ping ok — preventing Render free-tier sleep');
        }).on('error', (err) => {
          logger.warn(`[keep-alive] self-ping failed: ${err.message}`);
        });
      };
      // First ping after 14 minutes, then every 14 minutes
      setInterval(_ping, 14 * 60 * 1000);
      logger.info('[keep-alive] Render free-tier keep-alive active (ping every 14 min)');
    }
  });

  server.on('error', (err) => {
    logger.error(`HTTP server error: ${err.message}`);
    process.exit(1);
  });
}

start();

module.exports = { app, server }; // For testing
