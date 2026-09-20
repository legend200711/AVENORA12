# AVENORA — Supabase Storage Setup Guide

This document describes the exact Supabase Storage configuration required for the
AVENORA platform. Follow every step in order before deploying.

---

## 1. Project details

| Setting | Value |
|---------|-------|
| Supabase project URL | `https://licuiqxkkfboqezzmsqu.supabase.co` |
| Anon key location | `frontend/src/services/supabase.js` (safe — public anon key only) |
| Service-role key location | `backend/.env` → `SUPABASE_SERVICE_ROLE_KEY` (never exposed to frontend) |

---

## 2. Required buckets

Create the following buckets in **Storage → Buckets** in the Supabase dashboard.
The backend service auto-attempts to create missing buckets on startup, but you should
also create them manually to ensure the correct `public` setting.

| Bucket name | Public? | Max file size | Purpose |
|-------------|---------|---------------|---------|
| `videos` | **Yes** | 500 MB | Uploaded video files |
| `thumbnails` | **Yes** | 20 MB | Video / playlist cover art |
| `music` | **Yes** | 100 MB | Uploaded audio files |
| `stream-media` | **Yes** | 100 MB | 24-hour cloud stream media library |
| `gallery` | **Yes** | 20 MB | Community gallery images |
| `avatars` | No (private) | 5 MB | User profile pictures (signed URLs) |

> **Why public?** AVENORA generates public CDN URLs for playback (no token needed
> for read). Writes are always performed server-side via the service-role key, so
> setting buckets to public does not allow unauthorized writes.

---

## 3. Row Level Security (RLS) policies

### 3.0 `music_library` table (PostgREST — required for video list & playback)

The `music_library` table stores video and audio upload metadata.
The frontend reads it with the **anon key** (public).
All writes go through the backend service-role key.

Run in **SQL Editor**:

```sql
-- Create the music_library table if it does not yet exist
CREATE TABLE IF NOT EXISTS music_library (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  uid           text NOT NULL,
  title         text,
  description   text,
  artist_name   text,
  album_title   text,
  genre         text,
  file_url      text,
  storage_path  text,
  file_size     bigint,
  mime_type     text,
  original_name text,
  uploaded_at   timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE music_library ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read public rows (anon key — required for video list/playback)
CREATE POLICY "Public read music_library"
ON music_library FOR SELECT
USING (true);

-- Service-role key bypasses RLS automatically — no INSERT/UPDATE/DELETE policy needed
-- for the backend. All writes go through the Avenora backend API using service-role.
```

> **Note:** If the `music_library` table already exists you may skip the CREATE TABLE
> statement. Only apply the `ALTER TABLE ENABLE ROW LEVEL SECURITY` and the policy
> if RLS is not already enabled.

---

### 3.1–3.6 Storage bucket policies — CRITICAL FOR DIRECT BROWSER UPLOADS

> **IMPORTANT:** AVENORA Channel Studio uploads files **directly from the browser** to
> Supabase Storage using the anon key (bypassing the backend for the file transfer).
> This means you **MUST** add INSERT policies for the anon role on the `music`, `videos`,
> and `gallery` buckets, otherwise all uploads will fail with "Failed to fetch" / network error.

Enable RLS on all buckets and apply the policies below.
In the Supabase dashboard go to **Storage → Policies** and add the SQL policies,
or run them in **SQL Editor**.

### 3.1 `videos` bucket

```sql
-- Allow anyone to read (SELECT) objects in the videos bucket
CREATE POLICY "Public read — videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'videos');

-- REQUIRED: Allow direct browser uploads (anon key) for Channel Studio video uploads
CREATE POLICY "Anon insert — videos"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'videos');
```

### 3.2 `thumbnails` bucket

```sql
CREATE POLICY "Public read — thumbnails"
ON storage.objects FOR SELECT
USING (bucket_id = 'thumbnails');

CREATE POLICY "Anon insert — thumbnails"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'thumbnails');
```

### 3.3 `music` bucket — **REQUIRED for music uploads**

```sql
-- REQUIRED: Without this policy all music uploads return "Failed to fetch"
CREATE POLICY "Public read — music"
ON storage.objects FOR SELECT
USING (bucket_id = 'music');

CREATE POLICY "Anon insert — music"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'music');
```

### 3.4 `stream-media` bucket

```sql
CREATE POLICY "Public read — stream-media"
ON storage.objects FOR SELECT
USING (bucket_id = 'stream-media');

CREATE POLICY "Anon insert — stream-media"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'stream-media');
```

### 3.5 `gallery` bucket — **REQUIRED for photo/slideshow uploads**

```sql
-- REQUIRED: Without this policy all photo uploads return "Failed to fetch"
CREATE POLICY "Public read — gallery"
ON storage.objects FOR SELECT
USING (bucket_id = 'gallery');

CREATE POLICY "Anon insert — gallery"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'gallery');
```

### 3.6 `avatars` bucket (private — signed URLs only)

```sql
-- No public SELECT policy — all reads use signed URLs generated server-side.
-- INSERT/UPDATE/DELETE are performed by the backend via service-role key.
-- No additional client-side policies needed.
```

> **Security note:** The anon INSERT policies allow any client with the anon key to
> upload files to these buckets. This is intentional — AVENORA uses Firebase Auth to
> identify users (stored in the path as `{uid}/...`) and the backend validates ownership
> before creating media records. Service-role writes bypass RLS automatically.

---

## 4. Storage path conventions

The backend always writes files to paths in this format:

```
{bucket}/{uid}/{timestamp}-{sanitized-filename}
```

Examples:

| File type | Bucket | Example path |
|-----------|--------|--------------|
| Video | `videos` | `videos/abc123uid/1720000000000-my-video.mp4` |
| Thumbnail | `thumbnails` | `thumbnails/abc123uid/1720000000000-cover.jpg` |
| Audio | `music` | `music/abc123uid/1720000000000-track.mp3` |
| Stream media | `stream-media` | `stream-media/abc123uid/1720000000000-song.mp3` |
| Gallery image | `gallery` | `gallery/abc123uid/1720000000000-photo.jpg` |
| Avatar | `avatars` | `avatars/abc123uid/avatar.jpg` |

The `uid` segment is always the **Firebase UID** of the uploading user.
Ownership verification on the backend checks that `req.user.id` matches the UID
segment of the storage path before allowing updates or deletion.

---

## 5. Public URL format

For **public** buckets, the playback URL is:

```
https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public/{bucket}/{path}
```

This URL never expires. The backend stores it in MongoDB as `videoUrl` / `url`.

For the **`avatars`** bucket (private), the backend generates a signed URL:

```
https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/sign/{bucket}/{path}?token=...
```

Signed URLs from Supabase expire after 1 hour by default. The backend refreshes
them on demand via `GET /api/users/:id/avatar-url`.

---

## 6. Environment variables

Add to `backend/.env` (see `backend/.env.example` for the full template):

```env
SUPABASE_URL=https://licuiqxkkfboqezzmsqu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>   # Dashboard → Settings → API
SUPABASE_ANON_KEY=<your-anon-key>                   # Dashboard → Settings → API
```

The frontend uses only the anon key which is already embedded in
`frontend/src/services/supabase.js`. The service-role key must **never** appear
in any frontend file.

---

## 7. Bucket CORS configuration — CRITICAL FOR UPLOADS

> **IMPORTANT:** Supabase Storage CORS must allow `POST` and `PATCH` methods.
> Without these, all direct browser uploads will fail with "Failed to fetch".

In the **Supabase Dashboard → Storage → Policies → Configuration** (or via the API),
set CORS on every bucket to allow uploads from the AVENORA frontend origin.

Run in **SQL Editor** or via Supabase Management API:

```json
[
  {
    "allowedOrigins": [
      "https://legend200711.github.io",
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:3001"
    ],
    "allowedMethods": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allowedHeaders": [
      "authorization",
      "x-client-info",
      "apikey",
      "content-type",
      "content-length",
      "x-upsert",
      "tus-resumable",
      "upload-length",
      "upload-metadata",
      "upload-offset",
      "cache-control"
    ],
    "exposedHeaders": ["upload-offset", "location"],
    "maxAgeSeconds": 3600
  }
]
```

> **Note:** Supabase Storage has a built-in CORS config at the project level.
> Go to **Supabase Dashboard → Settings → API → Storage CORS** or use the
> Storage management API to apply this config to all buckets.
> The `tus-resumable`, `upload-length`, `upload-metadata`, `upload-offset`, `x-upsert`
> headers are required for the TUS resumable upload protocol used by AVENORA for
> files larger than 6 MB.

---

## 8. Large video upload support

AVENORA uploads videos **directly from the browser** to Supabase Storage using
the anon key and XHR. No backend server is involved in the file transfer.

Supabase Storage enforces file size at the **bucket level** via `fileSizeLimit`.
If a bucket was created without this setting it inherits the plan default
(typically **50 MB**), which causes the error:

> "The object exceeded the maximum allowed size"

### One-time fix for existing buckets

Run the fix script once to set the correct limits on all existing buckets:

```bash
SUPABASE_URL=https://licuiqxkkfboqezzmsqu.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
node scripts/fix-video-bucket-limit.js
```

Alternatively, from the **Supabase Dashboard**:
1. Go to **Storage → Buckets → videos**
2. Click **Edit bucket**
3. Set **"File size limit"** to `524288000` (500 MB in bytes)
4. Save

### Bucket limits (as configured in this project)

| Bucket | Limit |
|--------|-------|
| `videos` | **500 MB** |
| `stream-media` | 500 MB |
| `music` | 100 MB |
| `gallery` | 20 MB |
| `thumbnails` | 20 MB |
| `avatars` | 10 MB |

These limits are enforced automatically by `ensureBuckets()` in
`backend/src/services/storage/supabaseStorage.js` on every backend startup.

---

## 9. Quick verification checklist

After completing setup, verify each item:

- [ ] All 6 buckets exist in Supabase dashboard
- [ ] `videos`, `thumbnails`, `music`, `stream-media`, `gallery` are set to **public**
- [ ] `avatars` is set to **private** (RLS enabled, no public SELECT policy)
- [ ] Public read SELECT policies created for all 5 public buckets
- [ ] **Anon INSERT policies created for `music`, `videos`, `gallery`, `thumbnails`, `stream-media`** (required for direct browser upload)
- [ ] **Supabase Storage CORS includes `POST`, `PATCH`, `OPTIONS` methods** (required for direct browser upload)
- [ ] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` in `backend/.env`
- [ ] Backend starts without `[SupabaseStorage] Storage service is not configured` error
- [ ] Test direct browser upload to `music` bucket succeeds from `https://legend200711.github.io`
- [ ] Public URL is playable directly in the browser / `<video>` or `<audio>` tag
- [ ] Avatar signed URL is generated and refreshed by backend
- [ ] Render backend responds at `https://avenora-backend.onrender.com/health`

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `STORAGE_NOT_CONFIGURED` error | Missing env vars | Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` |
| **"Failed to fetch" at 0% on upload** | **Missing INSERT policy for anon role** | **Add `CREATE POLICY "Anon insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'music')` (and same for `videos`, `gallery`, `thumbnails`, `stream-media`)** |
| **"Failed to fetch" at 0% on upload** | **CORS not allowing POST/PATCH** | **Update Supabase Storage CORS to include `POST`, `PATCH`, `PUT`, `OPTIONS` methods — see Section 7** |
| `403 Forbidden` on public URL | Bucket is private or RLS blocks SELECT | Ensure bucket is public and public-read policy exists |
| `413 Payload Too Large` | Upload size exceeds limit | Increase `MAX_FILE_SIZE_MB` in backend `.env` |
| Video plays on desktop, black on mobile | CORS not set | Add CORS rule allowing `GET` from your frontend origin |
| Signed URL expired | Token expired after 1 hour | Backend auto-refreshes; if broken, check `GET /api/users/:id/avatar-url` |
| `Bucket not found` | Bucket not created yet | Create bucket in Supabase dashboard or restart backend to auto-create |
| **Backend `404 x-render-routing: no-server`** | **Render service not running** | **Go to Render dashboard → avenora-backend → Manual Deploy or check build/deploy logs** |
