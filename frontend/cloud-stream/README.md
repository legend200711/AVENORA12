# 24-Hour Audio Cloud Stream

---

## PROJECT

**24-Hour Audio Cloud Stream** — the Avenora 24-hour audio broadcasting system.

A creator configures a playlist, goes live, and listeners receive real-time synchronized
playback. Audio files are served from **Supabase Storage** (music bucket). Stream state
(Now Playing, queue, status) is stored in **Firestore**. The client advances the playlist
automatically when each track ends — no Cloudflare Worker or Durable Object is required.

---

## ARCHITECTURE

```
Creator client (cloud-stream.js)
  ├── reads studioPlaylists/{uid}/playlists + cloudStreamTracks/{uid}/tracks from Firestore
  ├── writes cloudStreams/{streamId} (broadcast record) to Firestore
  ├── writes studioCloudStreamMusic/{streamId} (Now Playing + full queue) to Firestore
  └── auto-advances queue in studioCloudStreamMusic when each track ends

Listener client (cloud-stream.js)
  └── subscribes to studioCloudStreamMusic/{streamId} via onSnapshot
        → loads and plays audio from Supabase Storage signed URLs

AVENORA Backend (/api/music/upload, /api/admin/cloud-stream/*)
  └── Supabase Storage (music, stream-media, thumbnails buckets)
```

---

## FIREBASE

**Active Firebase project: `avenora-6e147`**

| Service | Purpose |
|---------|---------|
| **Firebase Authentication** | Creator sign-in; persisted via `browserLocalPersistence` |
| **Firestore** | `cloudStreams/{streamId}` — broadcast record; `studioCloudStreamMusic/{streamId}` — live Now Playing + queue; `studioPlaylists/{uid}/playlists/{plId}` — creator playlists; `cloudStreamTracks/{uid}/tracks/{trackId}` — creator track library; `users/{uid}` — display name / role |
| **Firebase SDK** | CDN-loaded `firebase/app`, `firebase/auth`, `firebase/firestore` v10.12.2 |

> **Credentials:** The Firebase config (API key, project ID, etc.) is embedded in `js/cloud-stream.js`.
> These are web-tier, client-safe credentials. Do NOT embed Firebase Admin or service account keys here.

---

## SUPABASE STORAGE

Audio files are uploaded via the **AVENORA backend** (`/api/music/upload`) and stored in the
`music` bucket in Supabase Storage. The backend uses the service-role key (never exposed to
the browser). Signed URLs (1-hour expiry by default) are returned and stored in Firestore
track documents.

Required environment variables in `backend/.env`:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server only — never in frontend
SUPABASE_ANON_KEY=<anon-key>
```

See `SUPABASE_SETUP.md` for full bucket creation and policy instructions.

---

## REMOVED: Cloudflare Workers / KV / Durable Objects

The following Cloudflare resources have been **removed** and are **no longer used**:

| Removed Resource | Replaced By |
|-----------------|-------------|
| Cloudflare Worker (`avenora-cloudstream`) | Client-side Firestore writes + AVENORA backend |
| Cloudflare KV (`cloudStreamKV`) | Firestore `studioCloudStreamMusic/{streamId}` |
| Durable Object (`CloudStreamScheduler`) | Client-side `_autoAdvanceQueue()` in `cloud-stream.js` |
| Cloudflare R2 storage | Supabase Storage (music bucket) |
| `wrangler-studio.jsonc` | Deprecated — do not deploy |
| `workers/cloudstream-worker.js` | Deprecated — do not deploy |

---

## REQUIRED FILES

```
frontend/cloud-stream/
│
├── index.html                         — App shell & HTML
│
├── css/
│   └── cloud-stream.css               — All UI styles (standalone)
│
├── js/
│   └── cloud-stream.js                — All client-side logic (creator + listener)
│
├── workers/
│   └── cloudstream-worker.js          — DEPRECATED (removal notice only, do not deploy)
│
├── assets/
│   ├── apple-touch-icon.png
│   ├── favicon.ico
│   ├── favicon-16x16.png
│   └── favicon-32x32.png
│
├── config/
│   └── wrangler-studio.jsonc          — DEPRECATED (removal notice only)
│
└── README.md                          — This file
```

---

## BACKEND API ENDPOINTS (AVENORA)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/music/upload` | Upload audio track to Supabase Storage |
| GET  | `/api/music/tracks` | List music library |
| GET  | `/api/music/tracks/:id/url` | Refresh signed URL for a private track |
| POST | `/api/admin/cloud-stream/media/upload` | Upload to stream-media bucket (founder) |
| GET  | `/api/admin/cloud-stream/media/library` | List stream-media bucket files (founder) |
| GET  | `/api/stream/health/:streamId` | Poll stream health + Now Playing |

---

## TEST CHECKLIST

- [ ] `index.html` opens and shows the loading spinner
- [ ] Firebase Auth resolves — app shows Create Broadcast form or active stream panel
- [ ] Selecting a playlist populates the queue preview
- [ ] Clicking GO LIVE FOR 24 HOURS starts the broadcast and writes to Firestore
- [ ] Stream status panel shows LIVE badge, title, host, expiry countdown
- [ ] Another device opens `index.html?id=<streamId>` and sees the listener player
- [ ] Listener hears audio (browser autoplay may require user interaction)
- [ ] Now Playing updates automatically when each track ends (`_autoAdvanceQueue`)
- [ ] Skip Track advances to the next track
- [ ] Broadcast history panel lists past streams
- [ ] Cover artwork displays if uploaded
- [ ] END CLOUD BROADCAST stops the stream and updates Firestore
- [ ] No camera is requested at any point
- [ ] Refreshing the page re-opens the active stream (session persists via Firebase localStorage)
