/**
 * AVENORA — Service Worker v32
 *
 * Deployment-aware: detects GitHub Pages vs Firebase Hosting automatically.
 *   GitHub Pages:      https://legend200711.github.io/AVENORA12/  → BASE = /AVENORA12
 *   Firebase Hosting:  https://<project>.web.app/                 → BASE = (empty string)
 *
 * Rules:
 *   • NEVER cache: API responses, Firebase data, auth responses,
 *     live-session data, feed data, dashboard data, Cloud Stream status.
 *   • ONLY cache: static HTML/CSS/JS/icon assets.
 *   • On activate: delete ALL old Avenora and Shadow Nexus caches.
 *   • On install:  self.skipWaiting() so the new SW takes over immediately.
 *   • On activate: clients.claim() so open pages get the new SW immediately.
 *   • Navigation requests: always served from cache (index.html app shell)
 *     so the SPA works offline and refreshes don't break the app.
 */

// ── Firebase Cloud Messaging background handler ─────────────────────────────
// Must be imported BEFORE any other SW code per Firebase docs.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI',
  authDomain:        'avenora-6e147.firebaseapp.com',
  projectId:         'avenora-6e147',
  storageBucket:     'avenora-6e147.firebasestorage.app',
  messagingSenderId: '389692647062',
  appId:             '1:389692647062:web:6a2dd06ade8bc92d3e84b7',
});

const _messaging = firebase.messaging();

_messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'AVENORA';
  const options = {
    body:     payload.notification?.body || 'You have a new notification',
    icon:     `${self.location.pathname.startsWith('/AVENORA12/') ? '/AVENORA12' : ''}/icons/icon-192.png`,
    badge:    `${self.location.pathname.startsWith('/AVENORA12/') ? '/AVENORA12' : ''}/icons/icon-192.png`,
    data:     { url: payload.data?.url || `${self.location.pathname.startsWith('/AVENORA12/') ? '/AVENORA12' : ''}/index.html` },
    tag:      payload.data?.tag || 'avenora-notification',
    renotify: false,
  };
  return self.registration.showNotification(title, options);
});

// ── Cache identity ───────────────────────────────────────────────────────────
// SW_VERSION is embedded at build time so the diagnostic panel can read it.
const SW_VERSION  = 'v33';
const CACHE_NAME  = 'avenora-cache-v33';

// Prefixes of ALL old caches that must be wiped on activate.
// Covers every previous Avenora and Shadow Nexus name that may be installed
// on a user's device.
const OLD_CACHE_PREFIXES = [
  'avenora-v',        // avenora-v1, avenora-v2
  'avenora-cache-v1', // exact names below v9
  'avenora-cache-v2',
  'avenora-cache-v3', // v3 had wrong BASE path — evict
  'avenora-cache-v4', // v4 had wrong /AVENORA1/ or /AVENORA12/ base path — evict
  'avenora-cache-v5', // v5 — evict to pick up cloud-stream/ assets
  'avenora-cache-v6', // v6 — evict: CSS diag removed, video upload fixed
  'avenora-cache-v7', // v7 — evict: supabase.js was missing from cache list
  'avenora-cache-v8', // v8 — evict: music queue, video URL, Firebase role fixes
  'avenora-cache-v9', // v9 — evict: UID/model fixes, cloud stream skip fix
  'avenora-cache-v10', // v10 — evict: API URL fix, error diagnostics
  'avenora-cache-v11', // v11 — evict: backend API URL, video delete, dashboard fixes
  'avenora-cache-v12', // v12 — evict: music queue advance, upload URL, reset-password, push setup
  'avenora-cache-v13', // v13 — evict: Render URL removal, Firebase+Supabase-only architecture
  'avenora-cache-v14', // v14 — evict: CloudStream/Theme/Video still called old backend
  'avenora-cache-v15', // v15 — evict: add dj-cosmic.css to cache, cosmic UI upgrade
  'avenora-cache-v16', // v16 — evict: global cosmic design system, avenora-cosmic.css
  'avenora-cache-v17', // v17 — evict: Cloud Stream auth gate, queue advance, network retry fixes
  'avenora-cache-v18', // v18 — evict: 24-Hour Channel full implementation
  'avenora-cache-v19', // v19 — evict: missing channel/radio pages in cache list
  'avenora-cache-v20', // v20 — evict: SVG-only icons, channel offline fix
  'avenora-cache-v21', // v21 — evict: PWA installability, PNG icons, 404 routing fix
  'avenora-cache-v22', // v22 — evict: firebase.json public path was wrong (all assets 404'd)
  'avenora-cache-v23', // v23 — evict: radio LU_CONFIG crash, cloud-stream engine stall fallback
  'avenora-cache-v24', // v24 — evict: cloudRadioEngine require path fix, 404.html redirect
  'avenora-cache-v25', // v25 — evict: SW_UPDATED reload loop fix; bump to force fresh install
  'avenora-cache-v26', // v26 — evict: fix compat SDK calls in app.js + music.js; visibility passthrough
  'avenora-cache-v27', // v27 — evict: remove snx-gifts/cohost refs, fix channel queue loop, live pages deployed
  'avenora-cache-v28', // v28 — evict: channel upload→queue wiring, direct upload buttons, idle advance fix
  'avenora-cache-v29', // v29 — (unused, evict for safety)
  'avenora-cache-v30', // v30 — evict: fix video-delete key error, channel/userMedia Firestore rules, upload progress
  'avenora-cache-v31', // v31 — evict: channel start false-success, queue count, viewer audio loop
  'avenora-cache-v32', // v32 — evict: channelNowPlaying write rule, frontend schedule engine
  'legend-cache',     // old legend-universe names
  'shadow-nexus',     // old Shadow Nexus caches
  'snx-cache',
  'shadowsocial',
];

// ── Deployment base path ──────────────────────────────────────────────────────
// GitHub Pages serves the app under /AVENORA12/.
// Firebase Hosting serves it at the domain root /.
// We detect which host we're on at SW install time.
// self.location.pathname is the SW script URL path, e.g.:
//   GitHub Pages:  /AVENORA12/sw.js  → BASE = '/AVENORA12'
//   Firebase:      /sw.js            → BASE = ''
const BASE = self.location.pathname.startsWith('/AVENORA12/') ? '/AVENORA12' : '';

// ── Static assets to pre-cache ────────────────────────────────────────────────
// All paths are relative to BASE (auto-detected above).
// Do NOT list API URLs, Firebase URLs, or any runtime-fetched data here.
const STATIC_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/offline.html`,
  `${BASE}/404.html`,
  `${BASE}/manifest.json`,
  // Standalone live pages (deployed inside frontend/)
  `${BASE}/live.html`,
  `${BASE}/live.css`,
  `${BASE}/live.js`,
  `${BASE}/live-hub.html`,
  `${BASE}/live-room.html`,
  `${BASE}/src/styles/avenora-cosmic.css`,
  `${BASE}/src/styles/theme.css`,
  `${BASE}/src/styles/visual.css`,
  `${BASE}/src/styles/social.css`,
  `${BASE}/src/styles/midnight.css`,
  `${BASE}/src/styles/music.css`,
  `${BASE}/src/styles/hub.css`,
  `${BASE}/src/styles/chat-extended.css`,
  `${BASE}/src/styles/companion.css`,
  `${BASE}/src/styles/cloudstudio.css`,
  `${BASE}/src/styles/responsive.css`,
  `${BASE}/src/styles/customize.css`,
  `${BASE}/src/styles/theme-control.css`,
  `${BASE}/src/styles/dj-cosmic.css`,
  `${BASE}/src/styles/radio.css`,
  `${BASE}/src/styles/channel.css`,
  `${BASE}/src/store/state.js`,
  `${BASE}/src/utils/ui.js`,
  `${BASE}/src/services/api.js`,
  `${BASE}/src/services/firebase.js`,
  `${BASE}/src/services/supabase.js`,
  `${BASE}/src/services/musicService.js`,
  `${BASE}/src/services/themeService.js`,
  `${BASE}/src/components/visual/visualEngine.js`,
  `${BASE}/src/components/admin/ThemeControlCenter.js`,
  `${BASE}/src/components/companion/companion.js`,
  `${BASE}/src/app.js`,
  `${BASE}/src/pages/hub.js`,
  `${BASE}/src/pages/auth.js`,
  `${BASE}/src/pages/social.js`,
  `${BASE}/src/pages/video.js`,
  `${BASE}/src/pages/live.js`,
  `${BASE}/src/pages/channel.js`,
  `${BASE}/src/pages/channelstudio.js`,
  `${BASE}/src/pages/cloudstream.js`,
  `${BASE}/src/pages/cloudstudio.js`,
  `${BASE}/cloud-stream/index.html`,
  `${BASE}/cloud-stream/css/cloud-stream.css`,
  `${BASE}/cloud-stream/js/cloud-stream.js`,
  `${BASE}/src/pages/dj.js`,
  `${BASE}/src/pages/music.js`,
  `${BASE}/src/pages/radio.js`,
  `${BASE}/src/pages/radioadmin.js`,
  `${BASE}/src/pages/arcade.js`,
  `${BASE}/src/pages/chat.js`,
  `${BASE}/src/pages/gallery.js`,
  `${BASE}/src/pages/admin.js`,
  `${BASE}/src/pages/search.js`,
  `${BASE}/src/pages/profile.js`,
  `${BASE}/src/pages/settings.js`,
  `${BASE}/src/pages/customize.js`,
  // PNG icons (required for Chrome PWA installability)
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/apple-touch-icon.png`,
  // SVG icons (supplemental)
  `${BASE}/icons/icon-72.svg`,
  `${BASE}/icons/icon-96.svg`,
  `${BASE}/icons/icon-128.svg`,
  `${BASE}/icons/icon-144.svg`,
  `${BASE}/icons/icon-152.svg`,
  `${BASE}/icons/icon-192.svg`,
  `${BASE}/icons/icon-384.svg`,
  `${BASE}/icons/icon-512.svg`,
];

// ── Patterns that must NEVER be cached ───────────────────────────────────────
function shouldNeverCache(url) {
  const u = new URL(url);
  // API calls (REST backend)
  if (u.pathname.includes('/api/')) return true;
  // Socket.io
  if (u.pathname.startsWith('/socket.io')) return true;
  // Firebase Realtime Database
  if (u.hostname.includes('firebaseio.com')) return true;
  // Firebase / Google APIs (auth, Firestore, Cloud Messaging)
  if (u.hostname.includes('googleapis.com')) return true;
  if (u.hostname.includes('firebasestorage.googleapis.com')) return true;
  if (u.hostname.includes('identitytoolkit.googleapis.com')) return true;
  if (u.hostname.includes('securetoken.googleapis.com')) return true;
  // Firebase hosting CDN (dynamic data fetched at runtime)
  if (u.hostname.includes('firebaseapp.com') && u.pathname.includes('/api')) return true;
  // Supabase — never cache storage uploads, auth, REST, or realtime traffic
  if (u.hostname.includes('supabase.co')) return true;
  // Analytics / tracking
  if (u.hostname.includes('google-analytics.com')) return true;
  if (u.hostname.includes('analytics.google.com')) return true;
  return false;
}

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Use individual requests with {cache: 'no-cache'} so that GitHub Pages
        // CDN doesn't serve stale files to the SW during install.
        return Promise.allSettled(
          STATIC_ASSETS.map((url) =>
            cache.add(new Request(url, { cache: 'no-cache' })).catch((err) => {
              // Log but do not abort install if a non-critical asset fails
              console.warn(`[SW ${SW_VERSION}] Failed to cache: ${url}`, err.message);
            })
          )
        );
      })
      .then(() => {
        console.log(`[SW ${SW_VERSION}] Installed — cache: ${CACHE_NAME}`);
        // Take over immediately; do not wait for old SW to become idle.
        return self.skipWaiting();
      })
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const deletions = cacheNames
        .filter((name) => {
          if (name === CACHE_NAME) return false; // keep current
          // Delete anything that matches old Avenora / Shadow Nexus prefixes
          return OLD_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
                 (name !== CACHE_NAME && name.startsWith('avenora'));
        })
        .map((name) => {
          console.log(`[SW ${SW_VERSION}] Deleting old cache: ${name}`);
          return caches.delete(name);
        });
      return Promise.all(deletions);
    }).then(() => {
      console.log(`[SW ${SW_VERSION}] Activated — controlling all clients`);
      // Immediately control all open pages — no reload needed; clients will get
      // fresh assets on their next fetch. The SW_UPDATED message is intentionally
      // NOT sent here to avoid a reload loop when the page is mid-load.
      return self.clients.claim();
    })
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Never intercept dynamic/API/Firebase traffic
  if (shouldNeverCache(url)) return;

  // ── Navigation requests (document loads / page refreshes) ──────────────────
  // For any navigation within the AVENORA scope, return the cached index.html
  // (app shell). This ensures that refreshing on any "page" (e.g. after a
  // push-state navigation or direct URL) still loads the SPA — not a 404.
  //
  // AVENORA uses hash routing so real navigation is already handled by the SPA,
  // but some browsers (e.g. installed PWA with standalone mode) may issue a
  // navigation request for the full URL on cold start.
  //
  // We serve from cache-first for the shell, falling back to network, then
  // to the offline page if both fail.
  if (event.request.destination === 'document' ||
      event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(`${BASE}/index.html`).then((cached) => {
        if (cached) {
          // Refresh the cached shell in the background so it stays up to date.
          fetch(new Request(`${BASE}/index.html`, { cache: 'no-cache' }))
            .then((response) => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME).then((c) => c.put(`${BASE}/index.html`, response));
              }
            })
            .catch(() => {});
          return cached;
        }
        // Not yet cached — fetch from network
        return fetch(event.request).catch(() =>
          caches.match(`${BASE}/offline.html`)
        );
      })
    );
    return;
  }

  // ── Static asset requests (cache-first with network fallback) ──────────────
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // Only cache successful same-origin or CORS-safe responses
        if (!response || response.status !== 200) return response;

        // Do not cache opaque responses (cross-origin without CORS)
        if (response.type === 'opaque') return response;

        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Offline fallback for sub-resources: return nothing (browser handles gracefully)
        return new Response('', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      });
    })
  );
});

// ── Background sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-posts') {
    event.waitUntil(syncOfflinePosts());
  }
});

/**
 * Reads queued offline posts from IndexedDB and submits them to the API.
 * The main thread writes to the 'offline-posts' store when the network is down.
 * This background sync handler fires when connectivity is restored.
 */
async function syncOfflinePosts() {
  console.log(`[SW ${SW_VERSION}] Syncing offline posts…`);

  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('avenora-offline', 1);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains('offline-posts')) {
          _db.createObjectStore('offline-posts', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn(`[SW ${SW_VERSION}] Could not open offline DB:`, err.message);
    return;
  }

  // Read all pending posts
  let pending = [];
  try {
    pending = await new Promise((resolve, reject) => {
      const tx    = db.transaction('offline-posts', 'readonly');
      const store = tx.objectStore('offline-posts');
      const req   = store.getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn(`[SW ${SW_VERSION}] Could not read offline posts:`, err.message);
    return;
  }

  if (!pending.length) {
    console.log(`[SW ${SW_VERSION}] No offline posts to sync`);
    return;
  }

  // Try to get the API base URL from the main client's config
  const clients = await self.clients.matchAll({ type: 'window' });
  let apiBase = null;
  for (const client of clients) {
    try {
      const ch = new MessageChannel();
      const reply = await new Promise((resolve) => {
        ch.port1.onmessage = (e) => resolve(e.data);
        client.postMessage({ type: 'GET_API_URL' }, [ch.port2]);
        setTimeout(() => resolve(null), 2000);
      });
      if (reply?.apiUrl) { apiBase = reply.apiUrl; break; }
    } catch {}
  }

  if (!apiBase) {
    console.warn(`[SW ${SW_VERSION}] Could not determine API URL for offline sync`);
    return;
  }

  let synced = 0;
  for (const post of pending) {
    try {
      const res = await fetch(`${apiBase}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(post.token ? { 'Authorization': `Bearer ${post.token}` } : {}),
        },
        body: JSON.stringify({ content: post.content, mediaUrls: post.mediaUrls || [], tags: post.tags || [] }),
      });

      if (res.ok) {
        await new Promise((resolve, reject) => {
          const tx    = db.transaction('offline-posts', 'readwrite');
          const store = tx.objectStore('offline-posts');
          const req   = store.delete(post.id);
          req.onsuccess = () => resolve();
          req.onerror   = (e) => reject(e.target.error);
        });
        synced++;
      }
    } catch (err) {
      console.warn(`[SW ${SW_VERSION}] Failed to sync post ${post.id}:`, err.message);
    }
  }

  console.log(`[SW ${SW_VERSION}] Synced ${synced}/${pending.length} offline posts`);
}

// ── Push notifications ────────────────────────────────────────────────────────
// FCM background messages are handled by _messaging.onBackgroundMessage above.
// This handles raw Web Push (non-FCM) pushes from the Avenora backend.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }
  const title = data.title || 'AVENORA';
  const options = {
    body:     data.body || 'You have a new notification',
    icon:     `${BASE}/icons/icon-192.png`,
    badge:    `${BASE}/icons/icon-192.png`,
    data:     { url: data.url || `${BASE}/index.html` },
    tag:      data.tag || 'avenora-notification',
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || `${BASE}/index.html`;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
