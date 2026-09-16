# AVENORA — Storage Architecture & Feature Map

## Storage System

AVENORA uses **Firebase** (project `avenora-6e147`) for all storage, NOT Supabase.

| Layer | Technology | Purpose |
|-------|-----------|---------|
| File storage | **Firebase Storage** (`avenora-6e147.firebasestorage.app`) | Audio, video, images, thumbnails, avatars |
| Metadata DB | **Firebase Firestore** | Posts, users, videos, gallery, tracks, playlists |
| Real-time chat | **Firebase Realtime Database** | Chat messages, typing indicators |
| Auth | **Firebase Authentication** | Sign-in, ID tokens, session |
| Backend DB | **MongoDB** (optional) | Shared music catalogue, admin features |

---

## Firebase Storage Bucket Paths

| Path | Feature | Who Writes |
|------|---------|-----------|
| `audio/{uid}/{filename}` | Music Hub cloud uploads | User (browser → Firebase) |
| `videos/{uid}/{filename}` | Video page uploads | User (browser → Firebase) |
| `images/thumbnails/{uid}/{filename}` | Video thumbnail uploads | User (browser → Firebase) |
| `images/{filename}` | Feed images, gallery, stories | User (browser → Firebase) |
| `avatars/{uid}.{ext}` | Profile avatar | User (browser → Firebase) |

---

## Firestore Collections

| Collection | Description | Who Reads | Who Writes |
|-----------|-------------|-----------|-----------|
| `posts/{postId}` | Social feed posts + media URLs | Public | Owner |
| `posts/{postId}/comments/{id}` | Post comments | Public | Any signed-in user |
| `videos/{videoId}` | Video metadata + download URLs | Public | Owner |
| `videos/{videoId}/comments/{id}` | Video comments | Public | Any signed-in user |
| `users/{uid}` | User profiles | Public | Owner |
| `gallery/{itemId}` | Gallery images | Public | Owner |
| `stories/{storyId}` | 24-hour stories | Public | Owner |
| `companions/{uid}` | AI companion data | Owner only | Owner |
| `userPreferences/{uid}` | User settings | Owner only | Owner |
| `cloudStreamTracks/{uid}/tracks/{id}` | Music Hub uploaded tracks | Owner + public/unlisted reads | Owner |
| `studioPlaylists/{uid}/playlists/{id}` | Cloud stream playlists | Owner only | Owner |
| `cloudStreams/{streamId}` | Live stream broadcast records | Public | Owner |
| `studioCloudStreamMusic/{streamId}` | Now-Playing real-time state | Public | Any auth user |
| `liveRooms/{roomId}` | Live room metadata | Public | Host |
| `liveRooms/{roomId}/liveMessages/{id}` | Live chat messages | Public | Any auth user |

---

## Upload Flows (End-to-End)

### Music Upload (Music Hub → Cloud Stream)

1. User selects audio file in **Music Hub → Upload tab**
2. `musicUploadSubmit()` uploads directly to Firebase Storage: `audio/{uid}/{timestamp}_{filename}`
3. On success, `addDoc()` creates a Firestore record in `cloudStreamTracks/{uid}/tracks/{autoId}`:
   ```
   { uid, title, artist, album, genre, visibility, url, downloadURL, storagePath,
     duration, fileName, fileSize, mimeType, status: 'ready', createdAt }
   ```
4. Track appears in **Music Hub → Library → MY CLOUD UPLOADS** section
5. Track appears in **Creator Studio** (cloudstudio page) for playlist building
6. Playlists created in Creator Studio write to `studioPlaylists/{uid}/playlists/{id}`
7. **24-Hour Cloud Stream** reads playlists and resolves track URLs from Firestore

### Video Upload

1. User selects video in **Video → Upload tab**
2. `initUploadForm()` uploads directly to Firebase Storage: `videos/{uid}/{timestamp}_{filename}`
3. Optional thumbnail → `images/thumbnails/{uid}/{timestamp}_{filename}`
4. On success, `addDoc()` creates Firestore record in `videos/{videoId}`:
   ```
   { title, description, category, visibility, videoUrl, thumbnailUrl, storagePath,
     owner: { uid, username, avatarUrl }, views, likes, commentCount,
     processingStatus: 'ready', createdAt }
   ```
5. Video appears in Video Hub with correct playback URL

### Gallery Upload

1. User selects image in **Gallery → Upload**
2. `submitGalleryUpload()` → `LegendAPI.gallery.upload(formData)`
3. `GalleryAPI.upload()` → `StorageService.uploadImage()` → Firebase Storage: `images/{timestamp}_{filename}`
4. `Firestore.addGalleryItem(url, category, title)` → `gallery/{autoId}`
5. Image appears in Gallery grid

### Feed Post with Image

1. User clicks 📷 in compose area
2. `SNFeed.triggerImageUpload()` → `LegendAPI.upload.image(file)`
3. `UploadAPI.image()` → `StorageService.uploadImage()` → Firebase Storage: `images/{timestamp}_{filename}`
4. URL added to `_pendingImages[]`
5. On POST: `LegendAPI.posts.create(content, mediaUrls)` → Firestore `posts/{id}`

### Avatar Upload

1. User taps edit avatar on Profile page
2. `SNProfile.editAvatar()` → `LegendAPI.upload.avatar(file)`
3. `UploadAPI.avatar()` → `StorageService.uploadAvatar()` → Firebase Storage: `avatars/{uid}.{ext}`
4. Profile updated in Firestore `users/{uid}` with new `profile.avatarUrl`

---

## Required Environment Variables (Backend)

Set these in `backend/.env` (copy from `backend/.env.example`):

```bash
# Required
FIREBASE_PROJECT_ID=avenora-6e147
FIREBASE_WEB_API_KEY=AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/legend_universe
JWT_SECRET=<64+ random chars>
JWT_REFRESH_SECRET=<different 64+ random chars>
FOUNDER_EMAIL=christijerina46@gmail.com

# Optional (for backend Music Hub catalogue API only)
# MAX_FILE_SIZE_MB=500
# UPLOAD_DIR=./uploads
```

**No Supabase variables are required or used.**

---

## Firebase Security Rules

### Storage Rules (storage.rules)

Deployed to Firebase with: `firebase deploy --only storage`

Key rules:
- `audio/{uid}/{filename}` — owner write, public read (100 MB max)
- `videos/{uid}/{filename}` — owner write, public read (2 GB max)
- `images/thumbnails/{uid}/{filename}` — owner write, public read (5 MB)
- `images/{filename}` — any auth user write, public read (20 MB)
- `avatars/{uid}.{ext}` — owner write, public read (5 MB)

### Firestore Rules (firestore.rules)

Deployed to Firebase with: `firebase deploy --only firestore:rules`

Key rules:
- `cloudStreamTracks` — owner write; owner + public/unlisted reads by any auth user
- `studioPlaylists` — owner only
- `videos` — owner write, public read
- `posts` — owner write, public read

Deploy rules:
```bash
firebase deploy --only storage,firestore:rules
```

---

## What Does NOT Use Supabase

**There is zero Supabase integration in this project.** The request to "reconnect Supabase Storage" was based on a misunderstanding — AVENORA was built entirely on Firebase from the start. All media storage is through Firebase Storage (`avenora-6e147.firebasestorage.app`).

---

## Known Fixes Applied (this session)

1. **`storage.rules`** — Added missing `avatars/{uid}/{filename}` subdirectory rule; moved thumbnail rule above flat `images/` rule to prevent rule shadowing; added clearer comments.

2. **`firestore.rules`** — Fixed `cloudStreamTracks` read rule: previously owner-only, now allows any authenticated user to read tracks with `visibility != 'private'` so the cloud stream player can resolve audio URLs for public/unlisted tracks.

3. **`frontend/src/pages/music.js` — `renderLibrary()`** — Added Firestore-backed "MY CLOUD UPLOADS" section that reads directly from `cloudStreamTracks/{uid}/tracks`. Previously, uploaded tracks only showed in Creator Studio and were invisible in the Music Hub Library tab. Now they appear immediately after upload.

4. **`frontend/src/pages/music.js` — `renderLibrary()` genre endpoint** — Replaced broken `fetch('/api/music/genres')` (relative URL that fails when backend is on a different host) with `LegendAPI.request('GET', '/music/genres')` which uses the configured API base URL.

5. **`backend/.env.example`** — Added clear documentation of Firebase Storage bucket paths so deployment is unambiguous.
