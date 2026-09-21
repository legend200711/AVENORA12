/**
 * AVENORA — Firestore Admin SDK initialisation
 *
 * Provides a singleton `db` (Firestore instance) and helper utilities
 * used by every route that was previously backed by Mongoose/MongoDB.
 *
 * Authentication (choose one, in order of preference):
 *
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service-account
 *      JSON key file path  — used in local dev and on Render.
 *
 *   2. FIREBASE_SERVICE_ACCOUNT_JSON env var containing the full JSON string
 *      of the service-account key (useful when key files cannot be mounted).
 *
 *   3. Application Default Credentials (ADC) — works on Google Cloud Run /
 *      GCE automatically without any configuration.
 *
 * How to obtain a service-account key:
 *   Firebase Console → Project Settings → Service Accounts → Generate new private key
 *   Save the downloaded JSON as FIREBASE_SERVICE_ACCOUNT_JSON in Render secrets.
 */

'use strict';

const admin  = require('firebase-admin');
const logger = require('../utils/logger');

let _db   = null;
let _app  = null;
let _initFailed = false; // set to true when credentials are unavailable — avoids repeated retries

function _initAdmin() {
  if (_app) return _app;

  // Already initialised (e.g. by another require() call)
  if (admin.apps.length) {
    _app = admin.apps[0];
    _db  = admin.firestore(_app);
    return _app;
  }

  let credential;

  // Option 1: inline JSON string in env var (Render secrets-friendly)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(svc);
      logger.info('[Firestore] Using service-account from FIREBASE_SERVICE_ACCOUNT_JSON');
    } catch (e) {
      logger.error('[Firestore] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }

  // Option 2: file path via GOOGLE_APPLICATION_CREDENTIALS (set automatically if key file exists)
  if (!credential && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      credential = admin.credential.applicationDefault();
      logger.info('[Firestore] Using application default credentials (GOOGLE_APPLICATION_CREDENTIALS)');
    } catch (e) {
      logger.warn('[Firestore] ADC failed:', e.message);
    }
  }

  // Option 3: ADC fallback (works on Cloud Run / GCE / local with gcloud auth)
  // Wrap in try/catch — on Render free tier (without GCP metadata service) this
  // throws "Could not load the default credentials" and must NOT crash the process.
  if (!credential) {
    try {
      credential = admin.credential.applicationDefault();
      logger.info('[Firestore] Attempting application default credentials (ADC)');
    } catch (adcErr) {
      logger.warn('[Firestore] ADC not available on this host: ' + adcErr.message);
      logger.warn('[Firestore] Set FIREBASE_SERVICE_ACCOUNT_JSON in Render dashboard to enable Firestore.');
      // No credential available — Firebase Admin will not be initialised.
      // Channel engine, media-save, etc. will degrade gracefully (return 503).
      return null;
    }
  }

  _app = admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID || 'avenora-6e147',
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID || 'avenora-6e147'}-default-rtdb.firebaseio.com`,
  });

  _db = admin.firestore(_app);
  // Use ISO timestamps (consistent with the rest of the app)
  _db.settings({ ignoreUndefinedProperties: true });

  logger.info('[Firestore] Admin SDK initialised — project: ' + (_app.options.projectId));
  return _app;
}

/**
 * Returns the Firestore db instance.
 * Initialises the Admin SDK on first call.
 * Returns null if credentials are unavailable (callers must handle null gracefully).
 */
function getDb() {
  if (_initFailed) return null;
  if (!_db) {
    const result = _initAdmin();
    if (result === null) {
      _initFailed = true;
      return null;
    }
  }
  return _db;
}

// ─── Firestore field value helpers (re-exported for convenience) ─────────────
const { FieldValue, Timestamp } = admin.firestore;

/**
 * Generate a new Firestore document ID.
 * Equivalent to calling db.collection('x').doc().id
 */
function newId() {
  return getDb().collection('_').doc().id;
}

/**
 * serverTimestamp() shorthand
 */
function now() {
  return FieldValue.serverTimestamp();
}

/**
 * Fetch a single document; returns data+id or null.
 */
async function getDoc(collection, id) {
  const snap = await getDb().collection(collection).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Set (create or overwrite) a document.
 */
async function setDoc(collection, id, data) {
  await getDb().collection(collection).doc(id).set(data);
}

/**
 * Update specific fields in an existing document.
 * Throws if the document does not exist.
 */
async function updateDoc(collection, id, data) {
  await getDb().collection(collection).doc(id).update(data);
}

/**
 * Delete a document.
 */
async function deleteDoc(collection, id) {
  await getDb().collection(collection).doc(id).delete();
}

/**
 * Add a new document with an auto-generated ID.
 * Returns { id, ...data }
 */
async function addDoc(collection, data) {
  const ref = await getDb().collection(collection).add(data);
  const snap = await ref.get();
  return { id: ref.id, ...snap.data() };
}

// Expose admin.firestore.FieldValue for increment/arrayUnion/arrayRemove
module.exports = {
  getDb,
  newId,
  now,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  FieldValue,
  Timestamp,
  _initAdmin,
};
