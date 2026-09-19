/**
 * AVENORA — Supabase Storage Service
 *
 * Central service for all file storage operations.
 * Replaces Firebase Storage and Cloudflare R2.
 *
 * Buckets used:
 *   avatars      — user profile pictures (private, signed URLs)
 *   gallery      — gallery images (public)
 *   music        — uploaded audio files (public)
 *   videos       — uploaded videos (public)
 *   thumbnails   — video/playlist cover art (public)
 *   stream-media — media for the 24-hour cloud stream (public)
 *
 * Configuration (in .env):
 *   SUPABASE_URL              — https://your-project.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (NEVER expose to frontend)
 *   SUPABASE_ANON_KEY         — anon/public key (safe for frontend)
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const logger = require('../../utils/logger');

// ─── Supabase client (service-role — backend only) ─────────────────────────
let _supabase = null;

// Sentinel: set to the config-missing error message on first failed getClient()
// so subsequent calls return a 503 AppError instead of a generic 500.
let _configError = null;

function getClient() {
  if (_supabase) return _supabase;

  if (_configError) {
    // Already logged — re-throw with a 503 so the frontend gets a clear message
    const err = new Error(_configError);
    err.statusCode = 503;
    err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }

  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || url === 'https://your-project-id.supabase.co' || key === 'your-service-role-key-here') {
    _configError =
      'Storage service is not configured. ' +
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the backend .env file. ' +
      'See SUPABASE_SETUP.md for instructions.';
    logger.error('[SupabaseStorage] ' + _configError);
    const err = new Error(_configError);
    err.statusCode = 503;
    err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }

  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  logger.info('[SupabaseStorage] Supabase client initialised successfully.');
  return _supabase;
}

// ─── Bucket definitions ────────────────────────────────────────────────────
// fileSizeLimit is in bytes. Supabase Storage enforces this at the bucket level
// and returns "The object exceeded the maximum allowed size" if exceeded.
// The videos bucket must allow at least 500 MB so 75+ MB uploads succeed.
const VIDEO_MAX_BYTES   = 500 * 1024 * 1024; // 500 MB
const MUSIC_MAX_BYTES   = 100 * 1024 * 1024; // 100 MB
const IMAGE_MAX_BYTES   =  20 * 1024 * 1024; //  20 MB
const AVATAR_MAX_BYTES  =  10 * 1024 * 1024; //  10 MB
const THUMB_MAX_BYTES   =  20 * 1024 * 1024; //  20 MB
const STREAM_MAX_BYTES  = 500 * 1024 * 1024; // 500 MB

const BUCKETS = {
  avatars:       { name: 'avatars',      public: false, fileSizeLimit: AVATAR_MAX_BYTES  },
  gallery:       { name: 'gallery',      public: true,  fileSizeLimit: IMAGE_MAX_BYTES   },
  music:         { name: 'music',        public: true,  fileSizeLimit: MUSIC_MAX_BYTES   },
  videos:        { name: 'videos',       public: true,  fileSizeLimit: VIDEO_MAX_BYTES   },
  thumbnails:    { name: 'thumbnails',   public: true,  fileSizeLimit: THUMB_MAX_BYTES   },
  'stream-media':{ name: 'stream-media', public: true,  fileSizeLimit: STREAM_MAX_BYTES  },
};

const SIGNED_URL_EXPIRY_SECS = 60 * 60 * 24 * 7; // 7 days

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a unique storage path.
 * e.g. uploadFilePath('music', 'uid123', 'track.mp3')
 *   → 'uid123/1715000000000-a1b2c3d4e5f6g7h8.mp3'
 */
function uploadFilePath(bucket, uid, originalName) {
  const crypto = require('crypto');
  const path = require('path');
  const ext = path.extname(originalName).toLowerCase();
  const rand = crypto.randomBytes(8).toString('hex');
  return `${uid}/${Date.now()}-${rand}${ext}`;
}

/**
 * Upload a file buffer to the given bucket.
 *
 * @param {object} opts
 * @param {string}  opts.bucket        — one of BUCKETS keys
 * @param {string}  opts.storagePath   — path inside the bucket
 * @param {Buffer}  opts.buffer        — file data
 * @param {string}  opts.mimetype      — MIME type
 * @returns {Promise<{publicUrl?: string, signedUrl?: string, storagePath: string}>}
 */
async function uploadBuffer({ bucket, storagePath, buffer, mimetype }) {
  const client = getClient();
  const bucketName = BUCKETS[bucket]?.name;
  if (!bucketName) throw new Error(`Unknown storage bucket: ${bucket}`);

  const { error } = await client.storage
    .from(bucketName)
    .upload(storagePath, buffer, {
      contentType: mimetype,
      upsert: true, // allow overwriting (critical for avatar re-uploads)
    });

  if (error) {
    logger.error(`[SupabaseStorage] Upload error (${bucket}/${storagePath}): ${error.message}`);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  let url;
  if (BUCKETS[bucket].public) {
    const { data } = client.storage.from(bucketName).getPublicUrl(storagePath);
    url = data.publicUrl;
    return { publicUrl: url, storagePath };
  } else {
    const { data, error: signErr } = await client.storage
      .from(bucketName)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECS);
    if (signErr) throw new Error(`Failed to create signed URL: ${signErr.message}`);
    return { signedUrl: data.signedUrl, storagePath };
  }
}

/**
 * Generate a new signed URL for an existing private file.
 *
 * @param {string} bucket
 * @param {string} storagePath
 * @param {number} [expirySecs]
 * @returns {Promise<string>}
 */
async function getSignedUrl(bucket, storagePath, expirySecs = SIGNED_URL_EXPIRY_SECS) {
  const client = getClient();
  const bucketName = BUCKETS[bucket]?.name || bucket;
  const { data, error } = await client.storage
    .from(bucketName)
    .createSignedUrl(storagePath, expirySecs);
  if (error) throw new Error(`getSignedUrl failed: ${error.message}`);
  return data.signedUrl;
}

/**
 * Get the permanent public URL for a file in a public bucket.
 *
 * @param {string} bucket
 * @param {string} storagePath
 * @returns {string}
 */
function getPublicUrl(bucket, storagePath) {
  const client = getClient();
  const bucketName = BUCKETS[bucket]?.name || bucket;
  const { data } = client.storage.from(bucketName).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Delete a file from storage.
 *
 * @param {string} bucket
 * @param {string} storagePath
 */
async function deleteFile(bucket, storagePath) {
  const client = getClient();
  const bucketName = BUCKETS[bucket]?.name || bucket;
  const { error } = await client.storage.from(bucketName).remove([storagePath]);
  if (error) {
    logger.warn(`[SupabaseStorage] Delete error (${bucket}/${storagePath}): ${error.message}`);
  }
}

/**
 * List files in a bucket/prefix (for stream-media library).
 *
 * @param {string} bucket
 * @param {string} [prefix]
 * @returns {Promise<Array<{name: string, size: number, storagePath: string}>>}
 */
async function listFiles(bucket, prefix = '') {
  const client = getClient();
  const bucketName = BUCKETS[bucket]?.name || bucket;
  const { data, error } = await client.storage
    .from(bucketName)
    .list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(`listFiles failed: ${error.message}`);
  return (data || []).map(f => ({
    name: f.name,
    size: f.metadata?.size || 0,
    storagePath: prefix ? `${prefix}/${f.name}` : f.name,
  }));
}

/**
 * Ensure all required buckets exist with the correct settings.
 * Sets fileSizeLimit on every bucket so Supabase enforces our limits instead of
 * the plan default (~50 MB), which was the root cause of the
 * "object exceeded the maximum allowed size" error on 75+ MB videos.
 *
 * Call once on startup (safe to call multiple times).
 */
async function ensureBuckets() {
  let client;
  try { client = getClient(); } catch { return; } // skip if not configured

  for (const [key, cfg] of Object.entries(BUCKETS)) {
    const { data: existing } = await client.storage.getBucket(cfg.name);
    if (!existing) {
      const { error } = await client.storage.createBucket(cfg.name, {
        public: cfg.public,
        fileSizeLimit: cfg.fileSizeLimit,
        allowedMimeTypes: null,
      });
      if (error && error.message !== 'Bucket already exists') {
        logger.warn(`[SupabaseStorage] Could not create bucket "${cfg.name}": ${error.message}`);
      } else {
        logger.info(
          `[SupabaseStorage] Bucket ready: ${cfg.name} ` +
          `(public=${cfg.public}, limit=${Math.round(cfg.fileSizeLimit / 1024 / 1024)} MB)`
        );
      }
    } else {
      // Bucket exists — always sync public setting AND fileSizeLimit to match config.
      // This is the fix for existing buckets that were created without a fileSizeLimit
      // (inheriting the plan default of ~50 MB), which caused the upload failure.
      const needsUpdate =
        existing.public !== cfg.public ||
        existing.file_size_limit !== cfg.fileSizeLimit;

      if (needsUpdate) {
        const { error: updateErr } = await client.storage.updateBucket(cfg.name, {
          public: cfg.public,
          fileSizeLimit: cfg.fileSizeLimit,
        });
        if (updateErr) {
          logger.warn(
            `[SupabaseStorage] Could not update bucket "${cfg.name}": ${updateErr.message}`
          );
        } else {
          logger.info(
            `[SupabaseStorage] Bucket "${cfg.name}" updated: ` +
            `public=${cfg.public}, limit=${Math.round(cfg.fileSizeLimit / 1024 / 1024)} MB`
          );
        }
      } else {
        logger.info(
          `[SupabaseStorage] Bucket OK: ${cfg.name} ` +
          `(public=${cfg.public}, limit=${Math.round(cfg.fileSizeLimit / 1024 / 1024)} MB)`
        );
      }
    }
  }
}

module.exports = {
  getClient,
  uploadBuffer,
  uploadFilePath,
  getSignedUrl,
  getPublicUrl,
  deleteFile,
  listFiles,
  ensureBuckets,
  BUCKETS,
  SIGNED_URL_EXPIRY_SECS,
};
