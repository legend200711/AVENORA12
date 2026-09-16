# AVENORA — Supabase Storage Setup Guide

## Overview

AVENORA uses Supabase Storage for all media file uploads:
- **avatars** — user profile pictures
- **gallery** — gallery images (public)
- **music** — uploaded audio files
- **videos** — uploaded videos
- **thumbnails** — video/playlist cover art (public)
- **stream-media** — 24-hour cloud stream media library

Firebase Storage and all Cloudflare Workers / KV / Durable Objects have been removed.

---

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Note your **Project URL** and **anon key** from **Settings → API**.
3. Also copy the **service_role key** (keep this secret — backend only).

---

## 2. Configure Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
SUPABASE_ANON_KEY=your-anon-key-here
```

**Never commit `.env` to Git. Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.**

---

## 3. Storage Buckets

Buckets are created automatically when the backend starts (`ensureBuckets()` in `supabaseStorage.js`).

To create them manually in the Supabase dashboard:

| Bucket Name    | Public | Max File Size |
|----------------|--------|--------------|
| `avatars`      | No     | 500 MB       |
| `gallery`      | Yes    | 500 MB       |
| `music`        | No     | 500 MB       |
| `videos`       | No     | 2 GB         |
| `thumbnails`   | Yes    | 500 MB       |
| `stream-media` | No     | 500 MB       |

---

## 4. Storage Policies

In the Supabase dashboard → Storage → select each bucket → Policies:

### `gallery` (public read, authenticated write)
```sql
-- Allow public read
CREATE POLICY "public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'gallery');

-- Allow authenticated upload
CREATE POLICY "authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gallery');
```

### `thumbnails` (public read, authenticated write)
Same pattern as `gallery` with `bucket_id = 'thumbnails'`.

### `avatars`, `music`, `videos`, `stream-media` (private — service role only)
The backend uses the service-role key, which bypasses RLS. No additional policies are needed for service-role access.

To allow users to read their own files (optional):
```sql
CREATE POLICY "owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'music' AND (storage.foldername(name))[1] = auth.uid()::text);
```

---

## 5. Start the Backend

```bash
cd backend
npm install
npm run dev
```

On startup the server will:
1. Connect to MongoDB
2. Create missing Supabase Storage buckets
3. Start the Express API on port 3001

---

## 6. Frontend Configuration

Set `window.LU_CONFIG` in `frontend/index.html` (or wherever your frontend is served):

```html
<script>
  window.LU_CONFIG = {
    apiUrl: "https://your-backend.com/api"
  };
</script>
```

Then load `frontend/src/services/supabase.js` **before** any page scripts:

```html
<script src="src/services/supabase.js"></script>
```

The `AvenoraStorage` global will be available for all upload operations.

---

## 7. Upload API Reference

All uploads go through the AVENORA backend. The service-role key never reaches the browser.

### Profile Avatar
```
POST /api/upload/avatar
Content-Type: multipart/form-data
field: file (image/jpeg|png|webp, max 5 MB)
```

### Gallery Image
```
POST /api/gallery/upload
Content-Type: multipart/form-data
fields: file[] (up to 10), category, title, caption
```

### Music Upload
```
POST /api/music/upload
Content-Type: multipart/form-data
fields: file (audio), title, artistName, albumTitle, genre
```

### Video Upload
```
POST /api/videos/upload
Content-Type: multipart/form-data
fields: video (video file), thumbnail (optional), title, description, category, visibility
```

### Refresh Signed URL
```
GET /api/upload/signed-url?bucket=music&path=uid/filename.mp3
Authorization: Bearer <id-token>
```

### Stream-Media Upload (admin only)
```
POST /api/admin/cloud-stream/media/upload
Content-Type: multipart/form-data
field: file (audio/video)
```

---

## 8. 24-Hour Cloud Stream

The Cloudflare Worker, KV, and Durable Objects have been **removed**.

Stream control now works through:
- **Firestore** (`cloudStreams/{streamId}`) — stream state
- **Firestore** (`studioCloudStreamMusic/{streamId}`) — now-playing state
- **Supabase Storage** (`stream-media` bucket) — media files
- **AVENORA backend** (`/api/admin/cloud-stream/*`) — RTMP push, queue management

### Upload media for the stream
Use the admin dashboard or:
```
POST /api/admin/cloud-stream/media/upload
```

### List stream-media library
```
GET /api/admin/cloud-stream/media/library
```

### Add to stream queue (Supabase items)
The `addSupabaseItemsToQueue` method accepts `{ name, storagePath, signedUrl? }` objects.

---

## 9. Migration from Firebase Storage

Existing files in Firebase Storage are **not deleted**. They will remain accessible via their existing URLs as long as Firebase Storage is not disabled.

To migrate existing files:
1. Export file URLs from Firebase Storage using the Firebase Admin SDK.
2. Download each file and re-upload to Supabase Storage via the appropriate bucket.
3. Update MongoDB records to point to the new Supabase URLs/paths.

**Firebase Authentication, Firestore, and Realtime Database are preserved unchanged.**

---

## 10. Environment Variables Reference

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Firebase (authentication + Firestore — NOT storage)
FIREBASE_PROJECT_ID=avenora-6e147
FIREBASE_WEB_API_KEY=your-key

# MongoDB
MONGODB_URI=mongodb://localhost:27017/legend_universe

# JWT
JWT_SECRET=at-least-64-random-chars
JWT_EXPIRES_IN=7d

# Supabase Storage (REQUIRED for file uploads)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # backend only — NEVER expose
SUPABASE_ANON_KEY=your-anon-key                   # safe for frontend read-only use

# Upload limits
MAX_FILE_SIZE_MB=500
MUSIC_MAX_FILE_MB=100

# 24-Hour Cloud Stream (optional)
CLOUD_STREAM_MEDIA_DIR=./media        # local media dir (fallback)
CLOUD_STREAM_RTMP_TARGETS=            # RTMP URL(s) — leave blank for simulation mode
CLOUD_STREAM_SHUFFLE=true
CLOUD_STREAM_REPEAT=true
```

---

## 11. Local Development

```bash
# Install dependencies
cd backend && npm install

# Copy and fill in env vars
cp .env.example .env
# Edit .env: add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

# Start backend
npm run dev

# Open frontend
# Serve frontend/ from any static server, e.g.:
cd frontend && npx serve .
```

---

## 12. What Was Removed

| Removed | Replaced By |
|---------|------------|
| Firebase Storage (`avenora-6e147.firebasestorage.app`) | Supabase Storage |
| Cloudflare Workers (`avenora-cloudstream`) | AVENORA backend + Firestore |
| Cloudflare KV (`cloudStreamKV`) | Firestore + Supabase Storage |
| Cloudflare Durable Objects (`CloudStreamScheduler`) | Backend `cloudStreamService.js` |
| Cloudflare R2 storage references | Supabase Storage |
| `wrangler-studio.jsonc` | Deleted |
| `workers/cloudstream-worker.js` | Placeholder comment only |

Firebase Authentication, Firestore, and Realtime Database are **unchanged**.
