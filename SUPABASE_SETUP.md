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

### 3.1–3.6 Storage bucket policies

Enable RLS on all buckets and apply the policies below.
In the Supabase dashboard go to **Storage → Policies** and add the SQL policies,
or run them in **SQL Editor**.

### 3.1 `videos` bucket (public read, backend-only write)

```sql
-- Allow anyone to read (SELECT) objects in the videos bucket
CREATE POLICY "Public read — videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'videos');

-- Allow INSERT via service role only (backend uses service-role key)
-- No client-side INSERT policy needed — all uploads go through the backend API.
```

### 3.2 `thumbnails` bucket (public read, backend-only write)

```sql
CREATE POLICY "Public read — thumbnails"
ON storage.objects FOR SELECT
USING (bucket_id = 'thumbnails');
```

### 3.3 `music` bucket (public read, backend-only write)

```sql
CREATE POLICY "Public read — music"
ON storage.objects FOR SELECT
USING (bucket_id = 'music');
```

### 3.4 `stream-media` bucket (public read, backend-only write)

```sql
CREATE POLICY "Public read — stream-media"
ON storage.objects FOR SELECT
USING (bucket_id = 'stream-media');
```

### 3.5 `gallery` bucket (public read, backend-only write)

```sql
CREATE POLICY "Public read — gallery"
ON storage.objects FOR SELECT
USING (bucket_id = 'gallery');
```

### 3.6 `avatars` bucket (private — signed URLs only)

```sql
-- No public SELECT policy — all reads use signed URLs generated server-side.
-- INSERT/UPDATE/DELETE are performed by the backend via service-role key.
-- No additional client-side policies needed.
```

> **Why no client-side INSERT policies?**
> All file uploads flow through the AVENORA backend API (`/api/upload/*`,
> `/api/videos/save-meta`, etc.). The backend uses the Supabase **service-role** key
> which bypasses RLS entirely, so no client-facing INSERT policy is needed.
> This prevents users from uploading to arbitrary paths.

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

## 7. Bucket CORS configuration

In **Storage → Buckets → {bucket} → CORS**, add:

```json
[
  {
    "allowedOrigins": [
      "https://legend200711.github.io",
      "http://localhost:3000",
      "http://localhost:5173"
    ],
    "allowedMethods": ["GET", "HEAD"],
    "allowedHeaders": ["*"],
    "maxAgeSeconds": 3600
  }
]
```

For the `avatars` bucket also add `Authorization` to `allowedHeaders`.

---

## 8. Large video upload support

The backend uploads videos server-side via the Supabase JS SDK using stream
piping. Supabase Storage supports files up to **5 GB** by default.

To support videos larger than 50 MB reliably:
1. In **Storage → Settings**, ensure **"Resumable uploads"** is enabled (it is
   by default for projects created after 2023).
2. Set `MAX_FILE_SIZE_MB=500` in `backend/.env` (or higher if needed).
3. The frontend uses `XMLHttpRequest` with `upload.onprogress` to track progress
   before handing off to the backend API.

---

## 9. Quick verification checklist

After completing setup, verify each item:

- [ ] All 6 buckets exist in Supabase dashboard
- [ ] `videos`, `thumbnails`, `music`, `stream-media`, `gallery` are set to **public**
- [ ] `avatars` is set to **private** (RLS enabled, no public SELECT policy)
- [ ] Public read SELECT policies created for all 5 public buckets
- [ ] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` in `backend/.env`
- [ ] Backend starts without `[SupabaseStorage] Storage service is not configured` error
- [ ] Test upload via `POST /api/videos/save-meta` returns a public URL
- [ ] Public URL is playable directly in the browser / `<video>` tag
- [ ] Avatar signed URL is generated and refreshed by backend

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `STORAGE_NOT_CONFIGURED` error | Missing env vars | Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` |
| `403 Forbidden` on public URL | Bucket is private or RLS blocks SELECT | Ensure bucket is public and public-read policy exists |
| `413 Payload Too Large` | Upload size exceeds limit | Increase `MAX_FILE_SIZE_MB` in backend `.env` |
| Video plays on desktop, black on mobile | CORS not set | Add CORS rule allowing `GET` from your frontend origin |
| Signed URL expired | Token expired after 1 hour | Backend auto-refreshes; if broken, check `GET /api/users/:id/avatar-url` |
| `Bucket not found` | Bucket not created yet | Create bucket in Supabase dashboard or restart backend to auto-create |
