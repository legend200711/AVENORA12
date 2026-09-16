# LEGEND UNIVERSE
### STAY LEGENDARY — Built by CHRIS LEGEND OF SHADOWS

A complete, production-ready modular web platform ecosystem.

---

## Module Status

| Module                       | Status             | Notes                                                                          |
|------------------------------|--------------------|--------------------------------------------------------------------------------|
| Legend Hub Core              | ✅ COMPLETE        | Dashboard, module grid, API health check, founder links                        |
| Account System               | ✅ COMPLETE        | Register, login, logout, refresh tokens, forgot/reset password, account deletion |
| Shadow Nexus Social          | ✅ COMPLETE        | Posts, likes, comments, reposts, stories, follows, notifications, reports      |
| Eclipse Feed                 | ✅ COMPLETE        | Real-time feed, pagination, image posts, editor                                |
| Shadow of Midnight           | ✅ COMPLETE        | Video upload, HTML5 player, channels, watch history, watch later, comments     |
| Shadow Fire Live             | ✅ COMPLETE        | Stream creation, RTMP credentials, live viewer list, stream status badges      |
| 24-Hour Cloud Stream         | ✅ COMPLETE        | Browser player, queue, shuffle, repeat, audio visualizer, error recovery       |
| 24-Hour Server Broadcast     | ⚙️ REQUIRES SETUP | Node.js + ffmpeg process (see `cloudStreamService.js`); needs RTMP endpoint    |
| Legend DJ System             | ✅ COMPLETE        | Dual decks, crossfader, EQ filters, BPM display, visualizer, local import     |
| Legend Music Hub             | ✅ COMPLETE        | Library, albums, artists, playlists, favorites, upload, visualizer             |
| Legend Arcade                | ✅ COMPLETE        | 7 games: Shadow Racer, Eclipse Memory, Nexus Gems, Lightning Reflex, Shadow Maze, Legend Sniper, Shadow Serpent |
| Legend Chat                  | ✅ COMPLETE        | Real-time rooms, message history, typing indicators, delete messages           |
| Legend Gallery               | ✅ COMPLETE        | Upload, masonry grid, lightbox, like, delete, filter, search                   |
| Founder Control Center       | ✅ COMPLETE        | Users, role management, moderation, system status, video management            |
| Global Search                | ✅ COMPLETE        | Users, posts, videos across all modules                                        |
| Notifications                | ✅ COMPLETE        | Real-time via Socket.io, persistent DB, unread badge                           |
| Profile Pages                | ✅ COMPLETE        | Edit profile, avatar, banner, follow/unfollow, followers/following lists       |
| Settings                     | ✅ COMPLETE        | Animations toggle, PWA install, sign out, account deletion                     |
| PWA                          | ✅ COMPLETE        | Service worker v3, manifest, offline shell, all CSS/JS cached                 |
| Visual Engine                | ✅ COMPLETE        | Starfield, rain, flame, lightning, particles, eclipse, music visualizer        |

---

## Architecture

```
legend-universe/
├── backend/                  # Node.js + Express + Socket.io API
│   ├── src/
│   │   ├── api/
│   │   │   ├── middleware/   # auth.js, errorHandler.js, rateLimiter.js
│   │   │   └── routes/       # 15 route files (all modules)
│   │   ├── config/
│   │   │   └── database.js   # MongoDB via Mongoose (graceful degradation)
│   │   ├── models/           # 18 Mongoose models
│   │   ├── services/         # Business logic, Socket.io, notifications
│   │   └── utils/            # Winston logger
│   ├── uploads/              # Dev file fallback (use Supabase Storage in production)
│   └── .env.example          # Copy to .env and fill in secrets
│
├── frontend/                 # Vanilla JS SPA (no build tools required)
│   ├── index.html            # Single entry point, all modules wired here
│   ├── sw.js                 # Service Worker v3 — caches all static assets
│   ├── manifest.json         # PWA manifest with shortcuts
│   ├── offline.html          # Offline fallback page
│   ├── icons/                # SVG PWA icons (72–512px)
│   └── src/
│       ├── app.js            # Hash-based SPA router + auth bootstrap
│       ├── components/
│       │   └── visual/       # visualEngine.js — Starfield, Rain, Flame, etc.
│       ├── pages/            # 15 page modules (hub, social, video, live, etc.)
│       ├── services/
│       │   ├── api.js        # All backend API calls (LegendAPI global)
│       │   └── musicService.js # Shared music state bridge
│       ├── store/
│       │   └── state.js      # Reactive state (LegendState global)
│       ├── styles/           # theme.css, visual.css, social.css, midnight.css, music.css
│       └── utils/
│           └── ui.js         # Toast, Modal, escapeHtml, formatters (global utils)
│
└── scripts/
    └── setup.sh              # One-command dev setup
```

---

## Quick Start

```bash
# 1. Run the setup script (installs deps, creates .env, creates upload dirs)
bash scripts/setup.sh

# 2. Edit the .env (REQUIRED before first run)
nano backend/.env
#   Set: JWT_SECRET, JWT_REFRESH_SECRET
#   Optional: MONGODB_URI (omit to run without database)

# 3. Start the backend
cd backend && npm run dev
# → API running at http://localhost:3001
# → Health: http://localhost:3001/api/health

# 4. Open the frontend
# Option A: open frontend/index.html directly in browser
# Option B: serve statically (recommended for PWA features)
cd frontend && npx serve .
# → App at http://localhost:3000
```

---

## Environment Variables

| Variable                | Required | Default           | Description                                  |
|-------------------------|----------|-------------------|----------------------------------------------|
| `PORT`                  | No       | `3001`            | Backend server port                          |
| `NODE_ENV`              | No       | `development`     | Environment name                             |
| `FRONTEND_URL`          | No       | `http://localhost:3000` | CORS origin for frontend               |
| `JWT_SECRET`            | **Yes**  | —                 | Access token secret (64+ chars)              |
| `JWT_EXPIRES_IN`        | No       | `7d`              | Access token lifetime                        |
| `JWT_REFRESH_SECRET`    | **Yes**  | —                 | Refresh token secret (different from above)  |
| `JWT_REFRESH_EXPIRES_IN`| No       | `30d`             | Refresh token lifetime                       |
| `MONGODB_URI`           | No       | —                 | MongoDB connection string (atlas or local)   |
| `UPLOAD_DIR`            | No       | `./uploads`       | Local file upload fallback directory         |
| `MUSIC_MAX_FILE_MB`     | No       | `100`             | Max audio file size in MB                    |
| `SUPABASE_URL`          | **Yes** (storage) | — | Supabase project URL                    |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** (storage) | — | Supabase service-role key (server only) |
| `SUPABASE_ANON_KEY`     | No       | —                 | Supabase anon key (optional public reads)    |
| `RESEND_API_KEY`        | No       | —                 | Email delivery (for real password reset)     |
| `RATE_LIMIT_MAX_REQUESTS`| No      | `100`             | API rate limit per 15 min window             |
| `AUTH_RATE_LIMIT_MAX`   | No       | `10`              | Auth endpoint rate limit per 15 min          |

---

## Features Requiring Backend Configuration

| Feature                     | Requirement                                               |
|-----------------------------|-----------------------------------------------------------|
| All persistence (posts, users, etc.) | `MONGODB_URI` — set to MongoDB Atlas or local   |
| Audio/video file uploads     | Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`. See `SUPABASE_SETUP.md` |
| Password reset emails        | `RESEND_API_KEY` — otherwise dev-mode returns token in API response |
| Real-time RTMP live streaming | MediaMTX server + `MEDIAMTX_URL` in `backend/.env` |
| 24/7 server-side broadcast   | ffmpeg on server + `CLOUD_STREAM_RTMP_TARGETS` (see `cloudStreamService.js`) |
| Push notifications           | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (web-push package) |

---

## Database Collections (MongoDB)

| Collection           | Model File                | Description                         |
|----------------------|---------------------------|-------------------------------------|
| `users`              | `User.js`                 | Accounts, profiles, roles, stats    |
| `posts`              | `Post.js`                 | Feed posts with comments, likes     |
| `follows`            | `Follow.js`               | Follow relationships                |
| `stories`            | `Story.js`                | 24-hour stories with view tracking  |
| `notifications`      | `Notification.js`         | In-app notifications                |
| `reports`            | `Report.js`               | Content reports / moderation queue  |
| `videos`             | `Video.js`                | Video uploads + metadata            |
| `videocomments`      | `VideoComment.js`         | Video comment threads               |
| `watchhistories`     | `WatchHistory.js`         | Per-user video watch history        |
| `channels`           | `Channel.js`              | Video creator channels              |
| `streams`            | `Stream.js`               | Live stream sessions                |
| `tracks`             | `Track.js`                | Music tracks                        |
| `albums`             | `Album.js`                | Music albums                        |
| `artists`            | `Artist.js`               | Music artists                       |
| `playlists`          | `Playlist.js`             | User playlists                      |
| `musicfavorites`     | `MusicFavorite.js`        | Liked/favorited tracks              |
| `musicplayhistories` | `MusicPlayHistory.js`     | Track play history                  |
| `galleryimages`      | `gallery.js` (inline)     | Gallery image uploads               |
| `chatmessages`       | `ChatMessage.js`          | Persistent chat messages            |

---

## Testing Guide

### Registration & Login
1. Open `http://localhost:3000` (or serve the frontend)
2. Click **Sign In** → **CREATE ACCOUNT** tab
3. Register with username, email, password
4. Verify modal closes and your username appears in the nav
5. Test logout via user menu → Sign Out
6. Test login again with same credentials
7. Test **Forgot password?** — enters email, receives success message (dev: token in console)

### Eclipse Feed (Shadow Nexus Social)
1. Navigate to **ECLIPSE FEED**
2. Create a text post — verify it appears immediately
3. Like/unlike the post
4. Add a comment, delete it
5. Edit your post (pencil icon in post menu)
6. Delete your post
7. Click a username to open their profile

### Shadow of Midnight (Video)
1. Navigate to **SHADOW MIDNIGHT**
2. Click **Upload** tab, fill in title, select a video file
3. Upload — video appears in the library
4. Click a video card to open the player
5. Test like, watch later, comment buttons

### Legend Arcade
1. Navigate to **ARCADE**
2. Launch any game — game appears fullscreen
3. Play until game over — score appears
4. Enter name in high-score prompt
5. Click **🏆 HIGH SCORES** to verify score is saved locally

### Legend Chat
1. Navigate to **CHAT**
2. Click a room in the sidebar
3. If not signed in: see the sign-in prompt
4. Send a message — appears in the chat area
5. Hover a message you sent — delete button appears

### Legend Gallery
1. Navigate to **GALLERY**
2. Click **📷 Upload** (requires sign-in)
3. Drop or select an image
4. Set title and category, click Upload
5. Image appears in the masonry grid
6. Click image to open fullscreen lightbox
7. Like it, then delete it (owner only)

### DJ System
1. Navigate to **DJ SYSTEM**
2. Click **📂 IMPORT** and select audio files
3. Files appear in the library
4. Click **→A** to load to Deck A
5. Click play ▶ on Deck A
6. Move the crossfader between A and B
7. Adjust EQ knobs and verify `+xdB` labels update

### Founder Control Center
1. Register an account, then use the admin route to set your role to `founder`
   ```
   # In MongoDB shell or Compass:
   db.users.updateOne({username:"yourusername"},{$set:{role:"founder"}})
   ```
2. Navigate to `#admin` — verify access is granted
3. Check Dashboard stats, System Status

---

## Platform & Browser Limitations

| Limitation                  | Explanation                                                                    |
|-----------------------------|--------------------------------------------------------------------------------|
| RTMP live streaming          | Browsers cannot push RTMP natively. Streamers use OBS/Streamlabs with the provided RTMP URL + key. Mux or Cloudflare Stream must be configured to transcode + deliver HLS. |
| 24/7 cloud broadcast         | True 24/7 server-side streaming requires ffmpeg running on a server process (see `cloudStreamService.js`). Browser tab cannot broadcast after it is closed. The browser player is a real continuous player with error recovery, not a broadcast. |
| Audio autoplay               | Browsers block autoplay before first user interaction. Clicking Play manually always works. |
| Password reset email         | In dev mode, `_devResetToken` is returned in the API response for testing. In production, configure `RESEND_API_KEY` and implement the email send in `auth.js`. |
| BPM detection in DJ System   | Real-time BPM analysis requires a dedicated audio analysis library (Essentia.js). The current implementation shows a placeholder; BPM sync button shows a tooltip explaining the dependency. |
| Online presence accuracy     | Online status uses Socket.io in-memory presence. With multiple server instances, use Redis adapter. |
| File storage                 | In dev, uploads fall back to `backend/uploads/`. In production, set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. See `SUPABASE_SETUP.md`. |
| High scores                  | Arcade high scores are stored in browser `localStorage` only — they are not synchronized to a server or shared between devices. |

---

## Security Notes

- JWT secrets must be long, random strings (use `openssl rand -hex 64`)
- Never expose `JWT_SECRET` or `JWT_REFRESH_SECRET` to the frontend
- Stream keys are only returned once (at creation) and never returned again via the API
- Admin routes enforce role on the server — frontend UI checks are UI-only
- All user input is HTML-escaped before rendering (`escapeHtml()`)
- Passwords are hashed with bcrypt (12 salt rounds)
- Rate limiting protects auth and upload endpoints
- CORS is restricted to `FRONTEND_URL`

---

## Deployment

### Backend (Node.js)
```bash
# Set NODE_ENV=production, fill in all env vars
# Use a process manager:
npm install -g pm2
pm2 start src/server.js --name legend-universe-api

# Or with Docker:
docker build -t legend-universe-api .
docker run -p 3001:3001 --env-file .env legend-universe-api
```

### Frontend (Static)
```bash
# Deploy the frontend/ directory to any static host:
# - Netlify
# - Vercel (static)
# - GitHub Pages
# - AWS S3 + CloudFront
# - Any static file server

# Set LU_CONFIG in a <script> before app.js:
# window.LU_CONFIG = { apiUrl: 'https://api.legenduniverse.com/api', socketUrl: 'https://api.legenduniverse.com' };
```

---

*LEGEND UNIVERSE · CHRIS LEGEND OF SHADOWS · STAY LEGENDARY*
