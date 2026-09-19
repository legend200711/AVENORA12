/**
 * AVENORA — Service Worker (root stub)
 *
 * This file exists at the repository root. It is NOT the production SW.
 * The canonical, production service worker is at /AVENORA12/sw.js
 * (deployed by the GitHub Actions workflow from frontend/sw.js).
 *
 * This stub exists only to:
 *   1. Unregister any old service worker registrations made from the root path.
 *   2. Clean up stale caches left by old versions of the app.
 *   3. Pass all requests straight to the network (no caching here).
 */

const STUB_VERSION = 'root-stub-v3';

// Old cache names that must be evicted — covers all versions through v26.
const OLD_CACHE_PREFIXES = [
  'avenora-v',
  'avenora-cache-v1',
  'avenora-cache-v2',
  'avenora-cache-v3',
  'avenora-cache-v4',
  'avenora-cache-v5',
  'avenora-cache-v6',
  'avenora-cache-v7',
  'avenora-cache-v8',
  'avenora-cache-v9',
  'avenora-cache-v10',
  'avenora-cache-v11',
  'legend-cache',
  'shadow-nexus',
  'snx-cache',
  'shadowsocial',
];

self.addEventListener('install', (event) => {
  console.log(`[SW root stub ${STUB_VERSION}] install`);
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => {
        const deletions = names
          .filter((n) => OLD_CACHE_PREFIXES.some((p) => n.startsWith(p)))
          .map((n) => {
            console.log(`[SW root stub ${STUB_VERSION}] Deleting old cache: ${n}`);
            return caches.delete(n);
          });
        return Promise.all(deletions);
      })
      .then(() => self.clients.claim())
  );
});

// Pass all requests through to the network — the production SW at
// /AVENORA12/sw.js handles all caching for the real app.
self.addEventListener('fetch', () => {});
