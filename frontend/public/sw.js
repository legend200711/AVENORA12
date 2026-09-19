/**
 * AVENORA — Service Worker eviction stub (public/ copy)
 *
 * This file is registered from frontend/public/ which is NOT the deployment
 * root on GitHub Pages. The canonical SW is at:
 *   /AVENORA12/sw.js
 *
 * This stub exists only to evict any old SW registrations that may
 * have been made from the /AVENORA12/public/ path on old deployments.
 * It caches nothing and passes all fetches through.
 *
 * Deployment base: /AVENORA12/
 */

// ── Cache identity ───────────────────────────────────────────────────────────
const SW_VERSION = 'v3-stub';
const CACHE_NAME = 'avenora-cache-v3';

// Old cache names that must be evicted from any device that installed them.
const OLD_CACHE_PREFIXES = [
  'avenora-v',
  'avenora-cache-v1',
  'avenora-cache-v2',
  'avenora-cache-v3',
  'legend-cache',
  'shadow-nexus',
  'snx-cache',
  'shadowsocial',
];

// ── Install: skip waiting immediately ────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log(`[SW stub ${SW_VERSION}] install — skipping wait`);
  event.waitUntil(self.skipWaiting());
});

// ── Activate: purge all old caches, claim clients ─────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      const deletions = names
        .filter((n) =>
          n !== CACHE_NAME &&
          (OLD_CACHE_PREFIXES.some((p) => n.startsWith(p)) || n.startsWith('avenora'))
        )
        .map((n) => {
          console.log(`[SW stub ${SW_VERSION}] Deleting old cache: ${n}`);
          return caches.delete(n);
        });
      return Promise.all(deletions);
    }).then(() => self.clients.claim())
  );
});

// ── Fetch: pass everything through (no caching in stub) ──────────────────────
self.addEventListener('fetch', () => {
  // Pass all requests straight to the network — the canonical SW at
  // /AVENORA12/sw.js handles caching.
});
