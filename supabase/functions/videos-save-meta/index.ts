/**
 * AVENORA — Supabase Edge Function: videos-save-meta
 * POST /functions/v1/videos-save-meta
 *
 * Verifies a Firebase ID token, then upserts a video metadata row
 * in the Supabase `videos` table. Returns the created/existing row.
 *
 * Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
 *   FIREBASE_PROJECT_ID   — avenora-6e147
 *   FIREBASE_WEB_API_KEY  — AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI
 *   SUPABASE_URL          — injected automatically by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically by Supabase
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FIREBASE_PROJECT_ID  = Deno.env.get('FIREBASE_PROJECT_ID')  || 'avenora-6e147';
const FIREBASE_WEB_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') || 'AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI';
const FOUNDER_EMAIL        = Deno.env.get('FOUNDER_EMAIL')        || 'christijerina46@gmail.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Verify Firebase ID token via Google Identity Toolkit ──────────────────────
async function verifyFirebaseToken(idToken: string) {
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'Firebase token verification failed');
  const user = data.users?.[0];
  if (!user) throw new Error('Firebase: user not found');
  return user; // { localId, email, displayName, ... }
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: true, message: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: true, message: 'Missing Firebase ID token' }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  let fbUser: { localId: string; email: string; displayName?: string };
  try {
    fbUser = await verifyFirebaseToken(authHeader.slice(7));
  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: 'Authentication failed: ' + (e as Error).message }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const uid   = fbUser.localId;
  const email = (fbUser.email || '').toLowerCase();

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: true, message: 'Invalid JSON body' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const { title, description, category, visibility, videoUrl, thumbnailUrl, storagePath, fileSize, mimeType } = body as {
    title?: string; description?: string; category?: string; visibility?: string;
    videoUrl?: string; thumbnailUrl?: string; storagePath?: string;
    fileSize?: number; mimeType?: string;
  };

  if (!title?.toString().trim()) {
    return new Response(JSON.stringify({ error: true, message: 'Title is required.' }),
      { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  if (!videoUrl || !storagePath) {
    return new Response(JSON.stringify({ error: true, message: 'videoUrl and storagePath are required.' }),
      { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Supabase client (service role — can bypass RLS) ───────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // ── Idempotency: return existing record if already saved ──────────────────────
  const { data: existing } = await supabase
    .from('videos')
    .select('*')
    .eq('storage_path', storagePath)
    .eq('uploader_uid', uid)
    .eq('is_deleted', false)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ success: true, video: _serialize(existing) }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Validate enums ────────────────────────────────────────────────────────────
  const VALID_CATEGORIES = ['movies','shows','music','short','gaming','education','comedy','other'];
  const VALID_VISIBILITY  = ['public','unlisted','private'];
  const VALID_MIME        = String(mimeType || '').startsWith('video/') ? String(mimeType) : 'video/mp4';

  // ── Insert ────────────────────────────────────────────────────────────────────
  const row = {
    title:            String(title).trim().slice(0, 200),
    description:      String(description || '').trim().slice(0, 5000),
    uploader_uid:     uid,
    uploader_email:   email,
    uploader_name:    fbUser.displayName || email.split('@')[0] || uid,
    is_founder:       email === FOUNDER_EMAIL.toLowerCase(),
    original_file_url: videoUrl,
    hls_url:          videoUrl,
    storage_path:     storagePath,
    thumbnail_url:    thumbnailUrl || null,
    file_size:        Number(fileSize) || 0,
    mime_type:        VALID_MIME,
    category:         VALID_CATEGORIES.includes(String(category || '')) ? String(category) : 'other',
    visibility:       VALID_VISIBILITY.includes(String(visibility || '')) ? String(visibility) : 'public',
    is_published:     true,
    processing_status: 'ready',
    is_deleted:       false,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('videos')
    .insert(row)
    .select()
    .single();

  if (insertErr) {
    console.error('[save-meta] insert error:', insertErr);
    return new Response(JSON.stringify({ error: true, message: 'Database error: ' + insertErr.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ success: true, video: _serialize(inserted) }),
    { status: 201, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
});

// Normalize DB row to the shape the frontend expects
function _serialize(row: Record<string, unknown>) {
  return {
    _id:             row.id,
    id:              row.id,
    title:           row.title,
    description:     row.description,
    category:        row.category,
    visibility:      row.visibility,
    videoUrl:        row.hls_url || row.original_file_url,
    originalFileUrl: row.original_file_url,
    hlsUrl:          row.hls_url,
    thumbnailUrl:    row.thumbnail_url,
    storagePath:     row.storage_path,
    fileSize:        row.file_size,
    mimeType:        row.mime_type,
    isPublished:     row.is_published,
    processingStatus: row.processing_status,
    uploader: {
      _id:      row.uploader_uid,
      username: row.uploader_name,
      profile:  { displayName: row.uploader_name, avatarUrl: null },
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
