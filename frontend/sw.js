/**
 * AVENORA — Service Worker v5
 *
 * Deployment base: /AVENORA1/
 * GitHub Pages URL: https://legend200711.github.io/AVENORA1/
 *
 * Rules:
 *   • NEVER cache: API responses, Firebase data, auth responses,
 *     live-session data, feed data, dashboard data, Cloud Stream status.
 *   • ONLY cache: static HTML/CSS/JS/icon assets.
 *   • On activate: delete ALL old Avenora and Shadow Nexus caches.
 *   • On install:  self.skipWaiting() so the new SW takes over immediately.
 *   • On activate: clients.claim() so open pages get the new SW immediately.
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
    icon:     '/AVENORA1/icons/icon-192.svg',
    badge:    '/AVENORA1/icons/icon-72.svg',
    data:     { url: payload.data?.url || '/AVENORA1/index.html' },
    tag:      payload.data?.tag || 'avenora-notification',
    renotify: false,
  };
  return self.registration.showNotification(title, options);
});

// ── Cache identity ───────────────────────────────────────────────────────────
// SW_VERSION is embedded at build time so the diagnostic panel can read it.
const SW_VERSION  = 'v15';
const CACHE_NAME  = 'avenora-cache-v15';

// Prefixes of ALL old caches that must be wiped on activate.
// Covers every previous Avenora and Shadow Nexus name that may be installed
// on a user's device.
const OLD_CACHE_PREFIXES = [
  'avenora-v',        // avenora-v1, avenora-v2
  'avenora-cache-v1', // exact names below v9
  'avenora-cache-v2',
  'avenora-cache-v3', // v3 had wrong BASE path — evict
  'avenora-cache-v4', // v4 had wrong /AVENORA1/ base path — evict
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
  'legend-cache',     // old legend-universe names
  'shadow-nexus',     // old Shadow Nexus caches
  'snx-cache',
  'shadowsocial',
];

// ── Static assets to pre-cache ────────────────────────────────────────────────
// All paths are relative to the SW scope (/AVENORA1/).
// Do NOT list API URLs, Firebase URLs, or any runtime-fetched data here.
const BASE = '/AVENORA1';
const STATIC_ASSETS = [
  `${BASE}/index.html`,
  `${BASE}/offline.html`,
  `${BASE}/manifest.json`,
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
  `${BASE}/src/pages/cloudstream.js`,
  `${BASE}/src/pages/cloudstudio.js`,
  `${BASE}/cloud-stream/index.html`,
  `${BASE}/cloud-stream/css/cloud-stream.css`,
  `${BASE}/cloud-stream/js/cloud-stream.js`,
  `${BASE}/src/pages/dj.js`,
  `${BASE}/src/pages/music.js`,
  `${BASE}/src/pages/arcade.js`,
  `${BASE}/src/pages/chat.js`,
  `${BASE}/src/pages/gallery.js`,
  `${BASE}/src/pages/admin.js`,
  `${BASE}/src/pages/search.js`,
  `${BASE}/src/pages/profile.js`,
  `${BASE}/src/pages/settings.js`,
  `${BASE}/src/pages/customize.js`,
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
      .then((cache) => cache.addAll(STATIC_ASSETS))
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
      // Immediately control all open pages — they will reload with the new SW.
      return self.clients.claim();
    }).then(() => {
      // Tell every controlled client to reload so they pick up the new build.
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION, cache: CACHE_NAME });
        });
      });
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

  // Cache-first for static assets; network fallback with cache store
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
        // Offline fallback for navigation requests
        if (event.request.destination === 'document') {
          return (
            caches.match(`${BASE}/offline.html`) ||
            caches.match(`${BASE}/index.html`)
          );
        }
        return new Response('Offline', {
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
      // Post a message and wait for the client to reply with the API URL
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
        // Remove from offline store on success
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
    icon:     '/AVENORA1/icons/icon-192.svg',
    badge:    '/AVENORA1/icons/icon-72.svg',
    data:     { url: data.url || '/AVENORA1/index.html' },
    tag:      data.tag || 'avenora-notification',
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/AVENORA1/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
