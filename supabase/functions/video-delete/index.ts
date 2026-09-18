/**
 * AVENORA — Supabase Edge Function: video-delete
 * DELETE /functions/v1/video-delete
 *
 * Verifies a Firebase ID token, confirms the caller is the row owner OR
 * the authorized founder, then deletes the music_library row and the
 * corresponding Storage object.
 *
 * Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
 *   FIREBASE_PROJECT_ID      — avenora-6e147
 *   FIREBASE_WEB_API_KEY     — AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI
 *   FOUNDER_EMAIL            — christijerina46@gmail.com
 *   SUPABASE_URL             — injected automatically by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically by Supabase
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FIREBASE_WEB_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') || 'AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI';
const FOUNDER_EMAIL        = Deno.env.get('FOUNDER_EMAIL')        || 'christijerina46@gmail.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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
  return user; // { localId, email, ... }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: true, message: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: true, message: 'Missing Firebase ID token' }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  let fbUser: { localId: string; email: string };
  try {
    fbUser = await verifyFirebaseToken(authHeader.slice(7));
  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: 'Authentication failed: ' + (e as Error).message }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const callerUid      = fbUser.localId;
  const callerEmail    = (fbUser.email || '').toLowerCase();
  const isFounder      = callerEmail === FOUNDER_EMAIL.toLowerCase();

  // ── Row ID from query-string ─────────────────────────────────────────────────
  const url  = new URL(req.url);
  const rowId = url.searchParams.get('id');
  if (!rowId) {
    return new Response(JSON.stringify({ error: true, message: 'Missing ?id= query parameter' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // ── Fetch the row to verify ownership and get storage_path ───────────────────
  const { data: row, error: fetchErr } = await supabase
    .from('music_library')
    .select('id, uid, storage_path, mime_type')
    .eq('id', rowId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[video-delete] fetch error:', fetchErr);
    return new Response(JSON.stringify({ error: true, message: 'Database error: ' + fetchErr.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  if (!row) {
    return new Response(JSON.stringify({ error: true, message: 'Video not found' }),
      { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Authorization: must be owner or founder ───────────────────────────────────
  if (row.uid !== callerUid && !isFounder) {
    return new Response(JSON.stringify({ error: true, message: 'Forbidden: you do not own this video' }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Delete the database row ───────────────────────────────────────────────────
  const { error: deleteErr } = await supabase
    .from('music_library')
    .delete()
    .eq('id', rowId);

  if (deleteErr) {
    console.error('[video-delete] delete error:', deleteErr);
    return new Response(JSON.stringify({ error: true, message: 'Delete failed: ' + deleteErr.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Best-effort: delete the storage object ────────────────────────────────────
  const storagePath = row.storage_path as string | null;
  if (storagePath) {
    const bucket     = storagePath.startsWith('stream-media/') ? 'stream-media' : 'videos';
    const objectPath = storagePath.replace(/^(videos|stream-media)\//, '');
    await supabase.storage.from(bucket).remove([objectPath]).catch(() => {});
  }

  return new Response(JSON.stringify({ success: true }),
    { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
});
