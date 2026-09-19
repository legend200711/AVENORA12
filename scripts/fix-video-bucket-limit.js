#!/usr/bin/env node
/**
 * AVENORA — Fix Supabase Storage bucket file-size limits
 *
 * Root cause of "The object exceeded the maximum allowed size":
 *   The Supabase 'videos' bucket was created without a fileSizeLimit, so it
 *   inherited the plan default (~50 MB). Direct browser → Supabase uploads of
 *   files larger than that limit fail with this error.
 *
 * This script updates ALL buckets to the limits defined in AVENORA's config:
 *   videos       → 500 MB
 *   stream-media → 500 MB
 *   music        → 100 MB
 *   gallery      → 20 MB
 *   thumbnails   → 20 MB
 *   avatars      → 10 MB
 *
 * Usage (from the project root):
 *   SUPABASE_URL=https://licuiqxkkfboqezzmsqu.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
 *   node scripts/fix-video-bucket-limit.js
 *
 * Or with a .env file in backend/:
 *   node -r dotenv/config scripts/fix-video-bucket-limit.js \
 *     dotenv_config_path=./backend/.env
 *
 * You can also run this from inside the backend/ directory:
 *   cd backend && node -r dotenv/config ../scripts/fix-video-bucket-limit.js
 */

'use strict';

// Allow running from either project root or backend/ directory
if (!process.env.SUPABASE_URL) {
  try { require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') }); } catch {}
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('');
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  console.error('');
  console.error('Run with:');
  console.error('  SUPABASE_URL=https://licuiqxkkfboqezzmsqu.supabase.co \\');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=<your-key> \\');
  console.error('  node scripts/fix-video-bucket-limit.js');
  console.error('');
  process.exit(1);
}

// Bucket limits in bytes
const BUCKET_LIMITS = {
  'videos':       500 * 1024 * 1024,  // 500 MB — main fix for the upload error
  'stream-media': 500 * 1024 * 1024,  // 500 MB
  'music':        100 * 1024 * 1024,  // 100 MB
  'gallery':       20 * 1024 * 1024,  //  20 MB
  'thumbnails':    20 * 1024 * 1024,  //  20 MB
  'avatars':       10 * 1024 * 1024,  //  10 MB
};

const BUCKET_PUBLIC = {
  'videos':       true,
  'stream-media': true,
  'music':        true,
  'gallery':      true,
  'thumbnails':   true,
  'avatars':      false,
};

async function updateBucket(bucketName, fileSizeLimit, isPublic) {
  const url = `${SUPABASE_URL}/storage/v1/bucket/${bucketName}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'apikey':        SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      id:              bucketName,
      name:            bucketName,
      public:          isPublic,
      file_size_limit: fileSizeLimit,
    }),
  });

  const text = await resp.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}

  if (!resp.ok) {
    return { ok: false, status: resp.status, message: json.message || text };
  }
  return { ok: true };
}

async function getBucket(bucketName) {
  const url = `${SUPABASE_URL}/storage/v1/bucket/${bucketName}`;
  const resp = await fetch(url, {
    headers: {
      'apikey':        SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  const text = await resp.text();
  if (!resp.ok) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  console.log('');
  console.log('AVENORA — Supabase bucket file-size limit fix');
  console.log(`Project: ${SUPABASE_URL}`);
  console.log('');

  let allOk = true;

  for (const [bucket, limit] of Object.entries(BUCKET_LIMITS)) {
    const limitMB = Math.round(limit / 1024 / 1024);
    const existing = await getBucket(bucket);

    if (!existing) {
      console.log(`  [SKIP] ${bucket} — bucket does not exist (will be created on next backend startup)`);
      continue;
    }

    const currentLimit = existing.file_size_limit;
    if (currentLimit === limit && existing.public === BUCKET_PUBLIC[bucket]) {
      console.log(`  [OK]   ${bucket} — already at ${limitMB} MB`);
      continue;
    }

    const result = await updateBucket(bucket, limit, BUCKET_PUBLIC[bucket]);
    if (result.ok) {
      const prev = currentLimit ? Math.round(currentLimit / 1024 / 1024) + ' MB' : 'plan default';
      console.log(`  [FIXED] ${bucket} — ${prev} → ${limitMB} MB`);
    } else {
      console.error(`  [FAIL]  ${bucket} — HTTP ${result.status}: ${result.message}`);
      allOk = false;
    }
  }

  console.log('');
  if (allOk) {
    console.log('All buckets updated successfully.');
    console.log('75 MB+ video uploads will now succeed.');
  } else {
    console.log('Some buckets could not be updated. Check the errors above.');
    process.exit(1);
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
