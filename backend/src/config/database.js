/**
 * Database connection configuration
 * Supports MongoDB via Mongoose.
 *
 * Connection priority:
 *   1. MONGODB_URI env var (Atlas or any MongoDB URI)
 *   2. Local MongoDB at localhost:27017
 *   3. mongodb-memory-server (in-process, dev-only fallback — data resets on restart)
 *
 * For persistent data in production set MONGODB_URI to a MongoDB Atlas URI:
 *   mongodb+srv://user:pass@cluster.mongodb.net/legend_universe
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

let isConnected = false;

async function _tryConnect(uri, label) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  isConnected = true;
  logger.info(`✅ Database connected (${label})`);
  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('Database disconnected — attempting reconnect...');
  });
}

async function connectDatabase() {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI;

  // 1. Try configured URI first
  if (uri && uri !== 'mongodb://localhost:27017/legend_universe') {
    try {
      await _tryConnect(uri, 'configured URI');
      return;
    } catch (err) {
      logger.warn(`Could not connect to configured MONGODB_URI: ${err.message}`);
    }
  }

  // 2. Try local MongoDB
  const localUri = uri || 'mongodb://localhost:27017/legend_universe';
  try {
    await _tryConnect(localUri, 'localhost');
    return;
  } catch {
    logger.warn('Local MongoDB not available — falling back to in-process database.');
  }

  // 3. Fallback in production: log clearly but DO NOT exit — the server must stay
  //    up so that GET /health is reachable and the operator can diagnose the issue
  //    from the Render dashboard, browser DevTools, or an uptime monitor.
  //    All MongoDB-dependent routes will return HTTP 503 while the DB is unavailable.
  if (process.env.NODE_ENV === 'production') {
    logger.error('');
    logger.error('══════════════════════════════════════════════════════════════════════');
    logger.error('❌  MONGODB_URI NOT CONFIGURED — DATABASE UNAVAILABLE');
    logger.error('══════════════════════════════════════════════════════════════════════');
    logger.error('   The server is starting WITHOUT a database connection.');
    logger.error('   All routes that require MongoDB will return HTTP 503.');
    logger.error('');
    logger.error('   To fix:');
    logger.error('   1. Go to Render dashboard → avenora-backend → Environment');
    logger.error('   2. Add secret: MONGODB_URI = mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/legend_universe');
    logger.error('   3. Save — Render will redeploy automatically');
    logger.error('   GET /health will still respond OK so you can verify the server is alive.');
    logger.error('══════════════════════════════════════════════════════════════════════');
    logger.error('');
    return; // Server continues without DB — NOT process.exit()
  }
  // 4. Development fallback: mongodb-memory-server (data resets on restart)
  try {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const memServer = await MongoMemoryServer.create({ instance: { dbName: 'legend_universe' } });
    const memUri = memServer.getUri();
    await _tryConnect(memUri, 'in-process (data resets on restart)');
    logger.warn('⚠️  Using in-process MongoDB. Data will NOT persist across restarts.');
    logger.warn('   For persistence: set MONGODB_URI=mongodb+srv://... in backend/.env');
    logger.warn('   Get a free Atlas cluster at: https://mongodb.com/atlas');
    // Keep the server alive for the duration of the process
    process.on('beforeExit', () => memServer.stop());
  } catch (err) {
    logger.error(`All database connection methods failed: ${err.message}`);
    logger.warn('Server starting without database — posts, videos, and music will not persist.');
  }
}

function getDatabaseStatus() {
  return {
    connected: isConnected,
    state: mongoose.connection.readyState,
  };
}

module.exports = { connectDatabase, getDatabaseStatus };
