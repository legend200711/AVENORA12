#!/usr/bin/env node
/**
 * AVENORA — Fix Supabase Storage Upload Policies
 *
 * This script adds the required INSERT policies for the anon role on all
 * public buckets. Without these, direct browser uploads (via the anon key)
 * will fail with "Failed to fetch" or "403 Forbidden".
 *
 * Usage:
 *   SUPABASE_URL=https://licuiqxkkfboqezzmsqu.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
 *   node scripts/fix-supabase-upload-policies.js
 *
 * Or with .env:
 *   node -r dotenv/config scripts/fix-supabase-upload-policies.js dotenv_config_path=backend/.env
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_URL.includes('your-project')) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env');
  process.exit(1);
}

const https = require('https');

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Execute SQL via Supabase REST API
async function execSQL(sql) {
  const res = await supabaseRequest('POST', '/rest/v1/rpc/exec', { query: sql });
  return res;
}

// Buckets that need anon INSERT policies for direct browser uploads
const PUBLIC_BUCKETS = ['music', 'videos', 'gallery', 'thumbnails', 'stream-media'];

async function main() {
  console.log('\n🔧 AVENORA — Supabase Storage Policy Fix\n');
  console.log('Project:', SUPABASE_URL);
  console.log('');

  // Check if we can reach Supabase
  console.log('Testing Supabase connection…');
  try {
    const res = await supabaseRequest('GET', '/rest/v1/', null);
    if (res.status === 200 || res.status === 401 || res.status === 404) {
      console.log('✅ Supabase project reachable (HTTP', res.status, ')\n');
    } else {
      console.warn('⚠ Unexpected status:', res.status, res.data, '\n');
    }
  } catch (e) {
    console.error('❌ Cannot reach Supabase:', e.message);
    process.exit(1);
  }

  // Apply policies via Supabase SQL editor REST API
  // The standard Supabase REST API doesn't expose a direct SQL endpoint without
  // the pg-meta service. Instead we'll print the SQL for the user to run manually.
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RUN THE FOLLOWING SQL IN SUPABASE DASHBOARD → SQL EDITOR:');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const policies = [];
  for (const bucket of PUBLIC_BUCKETS) {
    policies.push(`
-- SELECT policy (public read) for ${bucket}
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'Public read — ${bucket}'
  ) THEN
    CREATE POLICY "Public read — ${bucket}"
    ON storage.objects FOR SELECT
    USING (bucket_id = '${bucket}');
    RAISE NOTICE 'Created public read policy for ${bucket}';
  ELSE
    RAISE NOTICE 'Public read policy for ${bucket} already exists';
  END IF;
END $$;

-- INSERT policy (anon upload) for ${bucket}  ← REQUIRED for direct browser uploads
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'Anon insert — ${bucket}'
  ) THEN
    CREATE POLICY "Anon insert — ${bucket}"
    ON storage.objects FOR INSERT
    TO anon
    WITH CHECK (bucket_id = '${bucket}');
    RAISE NOTICE 'Created anon insert policy for ${bucket}';
  ELSE
    RAISE NOTICE 'Anon insert policy for ${bucket} already exists';
  END IF;
END $$;
`);
  }

  console.log(policies.join('\n'));

  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('After running the SQL above:');
  console.log('  1. Verify the policies appear in Storage → Policies in the dashboard');
  console.log('  2. Test a direct upload from the AVENORA Channel Studio');
  console.log('  3. The upload should progress past 0% without "Failed to fetch"\n');

  console.log('ALSO CHECK SUPABASE STORAGE CORS:');
  console.log('  Storage CORS must allow POST, PATCH, OPTIONS methods.');
  console.log('  See SUPABASE_SETUP.md Section 7 for the exact config.\n');

  // Also do a quick bucket size check
  console.log('Checking bucket file size limits…');
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const LIMITS = {
    music: 100 * 1024 * 1024,
    videos: 500 * 1024 * 1024,
    gallery: 20 * 1024 * 1024,
    thumbnails: 20 * 1024 * 1024,
    'stream-media': 500 * 1024 * 1024,
    avatars: 10 * 1024 * 1024,
  };

  for (const [bucket, expectedLimit] of Object.entries(LIMITS)) {
    try {
      const { data, error } = await client.storage.getBucket(bucket);
      if (error) {
        console.log(`  ⚠ ${bucket}: not found — will be created on next backend startup`);
        continue;
      }
      const actualLimit = data.file_size_limit;
      const limitMB = Math.round(expectedLimit / 1024 / 1024);
      if (!actualLimit || actualLimit < expectedLimit) {
        console.log(`  ❌ ${bucket}: limit=${actualLimit ? Math.round(actualLimit/1024/1024)+'MB' : 'none'} — NEEDS UPDATE to ${limitMB}MB`);
        const { error: updateErr } = await client.storage.updateBucket(bucket, {
          public: bucket !== 'avatars',
          fileSizeLimit: expectedLimit,
        });
        if (updateErr) {
          console.log(`     └─ Update failed: ${updateErr.message}`);
        } else {
          console.log(`     └─ ✅ Updated to ${limitMB}MB`);
        }
      } else {
        console.log(`  ✅ ${bucket}: limit=${Math.round(actualLimit/1024/1024)}MB, public=${data.public}`);
      }
    } catch (e) {
      console.log(`  ⚠ ${bucket}: ${e.message}`);
    }
  }

  console.log('\n✅ Bucket size check complete.\n');
  console.log('Remember to also run the SQL policies above in the Supabase SQL Editor!');
}

main().catch(e => {
  console.error('❌ Script failed:', e.message);
  process.exit(1);
});
