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

  // 3. Fallback: mongodb-memory-server (dev only — data resets on restart)
  // Block this fallback in production — if the database is not available in production,
  // we must fail fast so the operator knows to fix the MONGODB_URI configuration.
  if (process.env.NODE_ENV === 'production') {
    logger.error('❌ Database connection failed in production mode. Server cannot start safely.');
    logger.error('   Set MONGODB_URI to a valid MongoDB Atlas URI in your deployment environment.');
    process.exit(1);
  }
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
