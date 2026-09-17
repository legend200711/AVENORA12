# AVENORA — Supabase Storage Setup Guide

## ⚠️ If You Are Seeing These Errors Right Now

| Error | Cause | Fix |
|-------|-------|-----|
| **"Upload blocked by storage policy"** | Missing INSERT policy for `anon` role on the bucket | Apply the SQL policies from Section 4 below in the Supabase dashboard SQL editor. |
| **"Upload rejected (permission denied)"** | Same as above — RLS denying the anon key | Apply the SQL policies from Section 4 below. |
| **"Upload failed: Failed to fetch"** (Gallery) | Backend is not running or `apiUrl` in `index.html` is wrong | Start the backend: `cd backend && npm run dev`. Verify `window.LU_CONFIG.apiUrl` in `frontend/index.html`. |
| **"Storage service not configured"** (Video / Music Hub) | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing in `backend/.env` | Add Supabase credentials to `backend/.env` (see Section 2 below) and restart the server. |
| **"Upload failed: could not reach the server"** | Network error — backend is unreachable | Confirm the backend is running (`curl http://localhost:3001/api/health`). Check CORS in `backend/.env` (`FRONTEND_URL`). |
| **"You must be signed in to upload"** | Firebase Auth not resolved yet | Wait for sign-in to complete before uploading. |

**Quick check:** Open your browser devtools console. You will see one of:
- `[AvenoraStorage] ✅ Supabase Storage connected — direct upload mode` — Supabase project is reachable
- `[AvenoraStorage] ❌ Cannot reach Supabase` — network error or wrong project URL

---

## Overview

AVENORA uses Supabase Storage for all media file uploads:
- **avatars** — user profile pictures (private — signed URLs)
- **gallery** — gallery images (public)
- **music** — uploaded audio files (public)
- **videos** — uploaded video files (public)
- **thumbnails** — video/playlist cover art (public)
- **stream-media** — 24-hour cloud stream media library (public)

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

To create them manually in the Supabase dashboard (Storage → New bucket):

| Bucket Name    | Public | Purpose |
|----------------|--------|---------|
| `avatars`      | No     | User profile pictures |
| `gallery`      | Yes    | Gallery feed images |
| `music`        | Yes    | Uploaded audio tracks |
| `videos`       | Yes    | Uploaded video files |
| `thumbnails`   | Yes    | Video/playlist cover art |
| `stream-media` | Yes    | 24-hour cloud stream media |

**Why are most buckets public?** AVENORA uploads files directly from the browser using the anon key. Public buckets require an INSERT policy for the `anon` role (added in Section 4). Private buckets can only be written by the service-role key (backend only).

---

## 4. Storage Policies (REQUIRED)

### ⚠️ Run these SQL statements in the Supabase dashboard SQL editor

Go to **Supabase Dashboard → SQL Editor** and run all of the following.

> These policies allow the browser (using the anon key) to upload and read files.
> The `avatars` bucket keeps its existing private setting — the backend serves signed URLs.

---

### `gallery` — public read, authenticated (anon) write

```sql
-- Allow anyone to read gallery images
CREATE POLICY "gallery_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'gallery');

-- Allow any authenticated or anon request to upload gallery images.
-- AVENORA validates auth at the application layer (Firebase UID in path).
CREATE POLICY "gallery_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'gallery');

-- Allow the file owner (path starts with their UID) to delete their own images
CREATE POLICY "gallery_owner_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'gallery');
```

---

### `music` — public read, authenticated (anon) write

```sql
CREATE POLICY "music_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'music');

CREATE POLICY "music_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'music');

CREATE POLICY "music_owner_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'music');
```

---

### `videos` — public read, authenticated (anon) write

```sql
CREATE POLICY "videos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'videos');

CREATE POLICY "videos_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'videos');

CREATE POLICY "videos_owner_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'videos');
```

---

### `thumbnails` — public read, authenticated (anon) write

```sql
CREATE POLICY "thumbnails_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'thumbnails');

CREATE POLICY "thumbnails_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'thumbnails');

CREATE POLICY "thumbnails_owner_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'thumbnails');
```

---

### `avatars` — private; backend service-role only (no additional policies needed)

The backend uses the **service-role key** which bypasses RLS completely.
No additional policies are required for `avatars` — the service-role key always has full access.

If you want to also allow direct browser avatar uploads (via the anon key), add:

```sql
-- Optional: allow browser direct avatar uploads (anon key)
CREATE POLICY "avatars_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars');

-- Optional: allow public avatar reading
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
```

---

### `stream-media` — public read, authenticated (anon) write

```sql
CREATE POLICY "stream_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'stream-media');

CREATE POLICY "stream_media_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'stream-media');

CREATE POLICY "stream_media_owner_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'stream-media');
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

Set `window.LU_CONFIG` in `frontend/index.html`:

```html
<script>
  window.LU_CONFIG = {
    apiUrl: "https://your-backend.com/api"
  };
</script>
```

The frontend already loads `frontend/src/services/supabase.js` before any page scripts.
The `AvenoraStorage` global is available for all upload operations.

---

## 7. Upload API Reference

### Direct browser uploads (frontend `AvenoraStorage`)

All of the following are available on `window.AvenoraStorage`:

```js
// Avatar (overwrites existing — stable path per user)
await AvenoraStorage.uploadAvatar(file)          // → { url, storagePath, bucket }

// Gallery image
await AvenoraStorage.uploadImage(file)           // → { url, storagePath, bucket }

// Audio track (also saves to Firestore cloudStreamTracks)
await AvenoraStorage.uploadMusic(file, meta)     // → { success, track }

// Video (also saves to Firestore videos collection)
await AvenoraStorage.uploadVideoWithMeta(videoFile, thumbFile, meta) // → { success, video }

// Thumbnail
await AvenoraStorage.uploadThumbnail(file)       // → { url, storagePath, bucket }

// Stream media
await AvenoraStorage.uploadStreamMedia(file)     // → { url, storagePath, bucket }
```

### Backend API uploads (go through Express + Supabase service-role key)

#### Profile Avatar
```
POST /api/upload/avatar
Content-Type: multipart/form-data
Authorization: Bearer <firebase-id-token>
field: file (image/jpeg|png|webp, max 5 MB)
```

#### Gallery Image
```
POST /api/gallery/upload
Content-Type: multipart/form-data
Authorization: Bearer <firebase-id-token>
fields: file[] (up to 10), category, title, caption
```

#### Music Upload
```
POST /api/music/upload
Content-Type: multipart/form-data
Authorization: Bearer <firebase-id-token>
fields: file (audio), title, artistName, albumTitle, genre
```

#### Video Upload
```
POST /api/videos/upload
Content-Type: multipart/form-data
Authorization: Bearer <firebase-id-token>
fields: video (video file), thumbnail (optional), title, description, category, visibility
```

#### Refresh Signed URL (private buckets)
```
GET /api/upload/signed-url?bucket=music&path=uid/filename.mp3
Authorization: Bearer <firebase-id-token>
```

#### Stream-Media Upload (founder only)
```
POST /api/admin/cloud-stream/media/upload
Content-Type: multipart/form-data
Authorization: Bearer <firebase-id-token>
field: file (audio/video)
```

---

## 8. 24-Hour Cloud Radio (Real Server-Side Playback)

The cloud radio is now powered by the **AVENORA backend** running a real Node.js
playback engine. The broadcast continues on the server even when your phone is
off and the browser is closed.

### How it works

| Component | Role |
|---|---|
| **CloudRadioEngine** (`backend/src/services/stream/cloudRadioEngine.js`) | Server-side scheduler — advances tracks, writes Now Playing to Firestore every 10 s |
| **Firestore `studioCloudStreamMusic/{streamId}`** | Live Now Playing state — browser clients subscribe and play the audio URL |
| **Supabase Storage (`music` bucket)** | Public audio URLs — browser clients fetch and play directly |
| **`/api/cloud-radio/*`** | Authenticated REST API — start, stop, skip, status |

### Requirements to run 24/7

The backend server must stay running. Options:

| Hosting | Command |
|---|---|
| **Railway / Render / Fly.io** | Deploy `backend/` — it stays up automatically |
| **VPS (Ubuntu)** | `pm2 start src/server.js --name avenora-api` |
| **Local development** | `cd backend && npm run dev` (stops when you close terminal) |

> ⚠️ If the backend is running locally and you close your laptop, the broadcast stops.
> Deploy the backend to a cloud host for true 24/7 operation.

### Firestore authentication for the engine

The engine writes to Firestore using the REST API. It tries two auth strategies:

1. **Google Application Default Credentials** — works automatically on GCP, Cloud Run, Railway, Render, and Fly.io.
2. **Firebase anonymous sign-in** — works anywhere using `FIREBASE_WEB_API_KEY`.

If neither works the engine still runs but does not update Firestore (local status only). Verify by checking the `Worker` field on the dashboard.

### Cloud Radio API

```
POST   /api/cloud-radio/start          Start a session (any authenticated user)
POST   /api/cloud-radio/stop           Stop a session (owner or admin)
POST   /api/cloud-radio/skip           Skip current track (owner or admin)
GET    /api/cloud-radio/status/:id     Get live status (any authenticated user)
GET    /api/cloud-radio/sessions       List all sessions (founder/admin only)
```

### How listeners hear the music

There is **no media server or audio relay** — listeners play the audio file URLs
from Supabase Storage directly in their browser. The engine publishes the current
track URL + how many seconds have elapsed, and the browser seeks to that position.
This means:
- Any audio format the browser supports (MP3, AAC, OGG, FLAC, WAV) works.
- No latency from relay servers.
- Playback is synchronized within ~1 second across all listeners.

### Upload media for the stream
Use the Creator Studio (24-Hour Studio page) to upload music. Files go to the
`music` bucket in Supabase Storage and are saved to Firestore `cloudStreamTracks`.

Or use the admin endpoint (founder only):
```
POST /api/admin/cloud-stream/media/upload
```

### List stream-media library
```
GET /api/admin/cloud-stream/media/library
```

---

## 9. Environment Variables Reference

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=https://legend200711.github.io   # your GitHub Pages / production frontend URL

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
SUPABASE_ANON_KEY=your-anon-key                   # safe for frontend direct uploads

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

## 10. Troubleshooting

### Upload returns HTTP 400 with "policy" in the message
→ The bucket's RLS INSERT policy is missing. Run the SQL from Section 4.

### Upload returns HTTP 401 or 403
→ Same cause — RLS is blocking the anon key. Run the SQL from Section 4.

### Upload succeeds but the image doesn't display
→ The bucket may be set to private but the SELECT policy is missing.
   Run the `_public_read` policy SQL for that bucket (Section 4).

### Avatar re-upload returns "The resource already exists" (409)
→ The `upsert: true` header should prevent this. If it persists, check that
   your Supabase project version supports the `x-upsert` header (all recent versions do).

### Music/video plays once then shows 403 after page refresh
→ Signed URLs expire after 7 days. The music player and video player now
   automatically refresh signed URLs on every `mpLoadBackendTrack()` and
   `openVideoDetail()` call. If you see stale URLs in the database, they
   will be replaced on the next playback attempt.

### "You must be signed in to upload files"
→ Firebase Auth has not resolved yet. Wait for the sign-in flow to complete
   before initiating an upload. All upload functions check for a valid UID.

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

Firebase Authentication, Firestore, and Realtime Database are **unchanged**.
