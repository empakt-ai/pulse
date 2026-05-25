// ═════════════════════════════════════════════════════════════════════════
// Mashal service worker — installable PWA shell, conservative caching.
//
// Strategy:
//   - SHELL_CACHE holds the SPA shell + marketing chrome (HTML, CSS, JS,
//     fonts, icons). Updated on every SW version bump via the cache name.
//   - For /api/* requests: NETWORK-ONLY. The brief is time-sensitive
//     ("what should I post tomorrow?") and the platform's tier gates +
//     usage caps are server-authoritative. A cached /api/brief response
//     would be worse than a network failure — never serve one.
//   - For navigations (HTML documents): NETWORK-FIRST with cache fallback.
//     Keeps the app online-feels-fresh, but a flaky connection lands
//     on the last-good shell instead of a browser error page.
//   - For static assets (CSS, JS, images, fonts): CACHE-FIRST, then
//     network. Long-lived; once cached they don't refetch until the
//     SW version bumps the cache name.
//
// Versioning:
//   - Bump SHELL_VERSION when changing this file or adding assets to
//     PRECACHE_URLS. The activate handler deletes any cache whose key
//     doesn't match the current version, so users get clean updates.
// ═════════════════════════════════════════════════════════════════════════

const SHELL_VERSION = 'mashal-shell-v1-20260525';
const SHELL_CACHE   = `mashal-shell-${SHELL_VERSION}`;

// Files the SPA needs to render at minimum on cold cache. Keep this list
// SHORT — anything heavy that's also fetched on first paint will work
// via the runtime cache-first handler below.
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/images/mashal-favicon.png',
  '/images/mashal-logo.png',
  '/css/marketing.css',
  '/js/marketing.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {
        // Best-effort precache — if any single asset 404s we don't want
        // the install to fail. Runtime cache-first will fill the gaps.
      })
    )
  );
  // Activate immediately on first install so first-page-load users get
  // the SW behavior without needing a hard refresh.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('mashal-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Helpers — keep `fetch` strategy choices declarative.
const isApiRequest = (url) =>
  url.pathname.startsWith('/api/') ||
  url.hostname.endsWith('supabase.co') ||
  url.hostname.endsWith('stripe.com');

const isNavigationRequest = (req) =>
  req.mode === 'navigate' ||
  (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));

const isStaticAsset = (url) =>
  /\.(css|js|png|jpg|jpeg|webp|svg|woff2?|ico|webmanifest)$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;          // POSTs etc. — never intercept

  const url = new URL(req.url);

  // ─── API: network-only ────────────────────────────────────────────────
  // The brief is time-sensitive; a stale response would be a real bug.
  if (isApiRequest(url)) {
    return; // let the browser handle the fetch normally
  }

  // ─── Navigations: network-first, fallback to cached shell ─────────────
  if (isNavigationRequest(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Store a fresh copy of the navigated HTML so the offline
          // fallback is the most recent shell the user has seen.
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  // ─── Static assets: cache-first ───────────────────────────────────────
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // Only cache same-origin responses. CDN responses (fonts.gstatic
          // .com, cdn.tailwindcss.com) come back as opaque and would bloat
          // the cache; let the browser HTTP cache handle those.
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // Everything else: pass through.
});

// Allow the page to ask the SW to update itself without a full reload.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
