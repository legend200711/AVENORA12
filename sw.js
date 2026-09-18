/**
 * AVENORA — Service Worker (root stub)
 *
 * This file exists at the repository root. GitHub Pages serves it at /.
 * The canonical, production service worker is at /AVENORA1/sw.js
 * (registered by frontend/index.html with scope: '/AVENORA1/').
 *
 * This stub exists only to:
 *   1. Unregister any old service worker registrations made from this root path.
 *   2. Clean up any stale caches left by old versions.
 *   3. Pass all requests straight to the network (no caching here).
 *
 * DO NOT add caching or Firebase Messaging here — this file is not the
 * production service worker.
 */

const STUB_VERSION = 'root-stub-v2';

// ── Old cache names that must be evicted from any device that installed them ─
// NOTE: Do NOT include 'avenora-cache-v' as a prefix — that would match
// 'avenora-cache-v12' (the current production cache) and wipe it.
const OLD_CACHE_PREFIXES = [
  'avenora-v',           // avenora-v1 .. v4
  'avenora-cache-v1',    // v1 through v11 only — listed explicitly to avoid wiping v12+
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

// ── Install: skip waiting so this stub takes over immediately ─────────────────
self.addEventListener('install', (event) => {
  console.log(`[SW root stub ${STUB_VERSION}] install`);
  event.waitUntil(self.skipWaiting());
});

// ── Activate: purge ALL old caches and claim clients ─────────────────────────
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

// ── Fetch: pass all requests through to the network ──────────────────────────
// The canonical service worker at /AVENORA1/sw.js handles all caching.
self.addEventListener('fetch', () => {
  // Intentionally empty — pass through to network.
});
