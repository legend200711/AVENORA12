/**
 * AVENORA - Service Worker
 * Provides offline capability for static assets and cached pages.
 * Does NOT cache dynamic API responses (those require network).
 *
 * Also handles Firebase Cloud Messaging (FCM) background push notifications.
 */

// ── Firebase Messaging background handler ──────────────────────
// Must be imported BEFORE any other sw code per Firebase docs.
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

// Handle background push messages (app not in foreground)
_messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'AVENORA';
  const options = {
    body:    payload.notification?.body || 'You have a new notification',
    icon:    '/icons/icon-192.svg',
    badge:   '/icons/icon-72.svg',
    data:    { url: payload.data?.url || '/' },
    tag:     payload.data?.tag || 'avenora-notification',
    renotify: false,
  };
  return self.registration.showNotification(title, options);
});

const CACHE_NAME = 'avenora-v4';
// Bump version when static assets change so the old cache is pruned on activate.
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/src/styles/theme.css',
  '/src/styles/visual.css',
  '/src/styles/social.css',
  '/src/styles/midnight.css',
  '/src/styles/music.css',
  '/src/store/state.js',
  '/src/utils/ui.js',
  '/src/services/api.js',
  '/src/services/firebase.js',
  '/src/services/supabase.js',
  '/src/services/musicService.js',
  '/src/components/visual/visualEngine.js',
  '/src/app.js',
  '/src/pages/hub.js',
  '/src/pages/auth.js',
  '/src/pages/social.js',
  '/src/pages/video.js',
  '/src/pages/live.js',
  '/src/pages/cloudstream.js',
  '/src/pages/dj.js',
  '/src/pages/music.js',
  '/src/pages/arcade.js',
  '/src/pages/chat.js',
  '/src/pages/gallery.js',
  '/src/pages/admin.js',
  '/src/pages/search.js',
  '/src/pages/profile.js',
  '/src/pages/settings.js',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap',
];

// ─── Install: cache static assets ─────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ───────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch strategy ───────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls, Firebase traffic, Supabase, or socket connections
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('supabase.co')
  ) {
    return; // Network only
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // Only cache successful GET requests for same origin
        if (!response || response.status !== 200 || event.request.method !== 'GET') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(() => {
        // Offline fallback
        if (event.request.destination === 'document') {
          return caches.match('/offline.html') || caches.match('/index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

// ─── Background sync (for offline post submission) ─────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-posts') {
    event.waitUntil(syncOfflinePosts());
  }
});

async function syncOfflinePosts() {
  // Retrieve any posts saved offline and submit when connection restored
  // Implementation: read from IndexedDB, POST to API
  console.log('[SW] Syncing offline posts...');
}

// ─── Push notifications ────────────────────────────────────
// FCM background messages are handled by _messaging.onBackgroundMessage above.
// This listener handles non-FCM pushes (e.g. Web Push API from your own backend).
self.addEventListener('push', (event) => {
  // FCM pushes are intercepted by the Firebase SW compat shim above;
  // only handle raw pushes here if FCM is not available.
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }
  const title = data.title || 'AVENORA';
  const options = {
    body:    data.body || 'You have a new notification',
    icon:    '/icons/icon-192.svg',
    badge:   '/icons/icon-72.svg',
    data:    { url: data.url || '/' },
    tag:     data.tag || 'avenora-notification',
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
