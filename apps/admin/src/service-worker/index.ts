import { self as sw } from '$app/service-worker';
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

/**
 * Offline app shell for the back office (FR-SCAN-2): the built app and static files are cached per
 * release, so the admin opens on a warehouse tablet with a poor connection. Pages are network-first
 * with the cached shell as a fallback. API calls are never cached: their data is personal and must be
 * current (the offline scan queue keeps its own store).
 */
const CACHE = `openrent-admin-${version}`;
// The worker sits at {base}/service-worker.js; manifest paths are relative to it.
const at = (p: string) => new URL(p, sw.location.href).pathname;
const base = at('.').replace(/\/$/, '');
const SHELL = `${base}/index.html`;
const ASSETS = new Set([...immutable, ...assets].map((f) => at(f.path)));

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([...ASSETS]);
      // The shell exists in production builds only (adapter-static fallback page).
      await cache.add(SHELL).catch(() => undefined);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('openrent-admin-') && key !== CACHE) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin || !url.pathname.startsWith(`${base}/`)) return;

  if (ASSETS.has(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(req)));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(SHELL)) ?? new Response('', { status: 503, statusText: 'Offline' })),
    );
  }
});
