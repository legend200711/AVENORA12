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
  const set = new Set(['http://localhost:3000', 'http://localhost:5173']);
  const add = (v) => {
    if (v && v !== 'null' && v !== 'undefined') {
      // Strip trailing slash and add
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

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, mobile apps, same-host)
    if (!origin) return callback(null, true);
    if (_allowedOrigins.includes(origin)) return callback(null, true);
    // Also accept any github.io subdomain (covers preview deployments)
    if (/^https:\/\/[^.]+\.github\.io$/.test(origin)) return callback(null, true);
    logger.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

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

// ─── Public: Published Theme Tokens (no auth required) ───────
// Returns only the CSS token values of the current live theme.
// Contains no PII, credentials, or internal data.
app.get('/api/themes/active', async (req, res) => {
  try {
    const FounderTheme = require('./models/FounderTheme');
    const theme = await FounderTheme.findOne({ status: 'published' })
      .sort({ publishedAt: -1 })
      .select('name tokens publishedAt')
      .lean();
    res.json({ success: true, theme: theme ? { name: theme.name, tokens: theme.tokens, publishedAt: theme.publishedAt } : null });
  } catch {
    res.json({ success: true, theme: null });
  }
});

// ─── Health Check ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Avenora API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

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

async function start() {
  try {
    await connectDatabase();

    // Ensure Supabase Storage buckets exist
    try {
      const { ensureBuckets } = require('./services/storage/supabaseStorage');
      await ensureBuckets();
      logger.info('✅ Supabase Storage buckets verified');
    } catch (storageErr) {
      logger.warn(`⚠️  Supabase Storage bucket setup failed: ${storageErr.message}`);
      logger.warn('   Uploads will return HTTP 503 until SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in backend/.env');
    }

    // Initialize Socket.io for real-time features
    initializeSocketServer(server);

    server.listen(PORT, () => {
      logger.info(`🌅 AVENORA API running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

module.exports = { app, server }; // For testing
