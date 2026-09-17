/**
 * AVENORA — Supabase Edge Function: videos-list
 * GET /functions/v1/videos-list?sort=new&limit=20&category=
 *
 * Returns public videos from the Supabase `videos` table.
 * No auth required for public/unlisted videos.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url      = new URL(req.url);
  const sort     = url.searchParams.get('sort') || 'new';
  const limit    = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
  const category = url.searchParams.get('category') || null;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase
    .from('videos')
    .select('*')
    .eq('is_deleted', false)
    .eq('is_published', true)
    .in('visibility', ['public', 'unlisted'])
    .limit(limit);

  if (category) query = query.eq('category', category);
  if (sort === 'trending') query = query.order('views', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  const { data: videos, error, count } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: true, message: error.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    success: true,
    videos: (videos || []).map(_serialize),
    total:  count ?? (videos || []).length,
  }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
});

function _serialize(row: Record<string, unknown>) {
  return {
    _id:             row.id,
    id:              row.id,
    title:           row.title,
    description:     row.description,
    category:        row.category,
    visibility:      row.visibility,
    videoUrl:        row.hls_url || row.original_file_url,
    thumbnailUrl:    row.thumbnail_url,
    storagePath:     row.storage_path,
    fileSize:        row.file_size,
    mimeType:        row.mime_type,
    views:           row.views ?? 0,
    likeCount:       row.like_count ?? 0,
    processingStatus: row.processing_status ?? 'ready',
    uploader: {
      _id:      row.uploader_uid,
      username: row.uploader_name,
      profile:  { displayName: row.uploader_name, avatarUrl: null },
    },
    createdAt: row.created_at,
  };
}
