/**
 * AVENORA — Supabase Edge Function: admin-dashboard
 * GET /functions/v1/admin-dashboard
 *
 * Returns aggregate stats for the Founder Control dashboard.
 * Requires a Firebase ID token from the authorized founder account.
 *
 * Stats returned:
 *   users      — count of rows in `firebase_users` view (or Firebase user count)
 *   videos     — count of non-deleted rows in `videos` table
 *   posts      — count of non-deleted rows in `posts` table (if exists)
 *   liveStreams — always 0 (no RTMP backend)
 *   dbStatus   — { connected: true }
 *   timestamp  — ISO string
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FIREBASE_WEB_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') || 'AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI';
const FOUNDER_EMAIL        = Deno.env.get('FOUNDER_EMAIL')        || 'christijerina46@gmail.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  return user;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────
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

  // ── Founder-only ──────────────────────────────────────────────────────────────
  if ((fbUser.email || '').toLowerCase() !== FOUNDER_EMAIL.toLowerCase()) {
    return new Response(JSON.stringify({ error: true, message: 'Access restricted to the authorized founder account' }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // ── Supabase counts ───────────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Run counts in parallel — gracefully handle missing tables
  const [videoRes, postRes, userRes] = await Promise.all([
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
    supabase.from('user_profiles').select('*', { count: 'exact', head: true }),
  ]);

  const videoCount = videoRes.count ?? 0;
  const postCount  = postRes.count  ?? 0;
  const userCount  = userRes.count  ?? 0;

  return new Response(JSON.stringify({
    success: true,
    stats: {
      users:      userCount,
      posts:      postCount,
      videos:     videoCount,
      liveStreams: 0,
      dbStatus:   { connected: true },
      timestamp:  new Date().toISOString(),
    },
  }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
});
