/**
 * Database config — MongoDB removed.
 * The app now uses Firestore (via firebase-admin).
 * This file is kept as a no-op stub so existing imports don't break.
 */

'use strict';

async function connectDatabase() {
  // No-op — Firestore Admin SDK is initialised lazily in config/firestore.js
}

function getDatabaseStatus() {
  return { connected: true, state: 'firestore' };
}

module.exports = { connectDatabase, getDatabaseStatus };
