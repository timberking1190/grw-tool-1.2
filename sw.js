/* ────────────────────────────────────────────────────────────────
   Boost Intelligence — Service Worker  (R9)
   Strategy: Cache-first for static assets, network-first for HTML
   Gives repeat visitors sub-100ms loads from cache.
   Cache busted automatically on new deploy via CACHE_VERSION.
──────────────────────────────────────────────────────────────── */

var CACHE_VERSION  = 'bi-v1';
var STATIC_ASSETS  = [
  '/',
  '/logo.png'
];

/* ── INSTALL: pre-cache critical assets ── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE: purge old caches ── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* ── FETCH: stale-while-revalidate for HTML, cache-first for assets ── */
self.addEventListener('fetch', function(e) {
  var req = e.request;

  /* Skip non-GET, cross-origin, and Supabase/API requests */
  if (req.method !== 'GET') return;
  if (req.url.indexOf(self.location.origin) !== 0) return;
  if (req.url.indexOf('/functions/v1') !== -1) return;
  if (req.url.indexOf('/rest/v1') !== -1) return;
  if (req.url.indexOf('supabase.co') !== -1) return;

  var isHtml  = req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') !== -1;
  var isAsset = req.url.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2|woff|ttf|ico|css|js)(\?|$)/);

  if (isAsset) {
    /* Cache-first: serve from cache, fall back to network, then cache new version */
    e.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache) { cache.put(req, clone); });
          }
          return response;
        });
      })
    );
  } else if (isHtml) {
    /* Stale-while-revalidate: serve cached immediately, refresh in background */
    e.respondWith(
      caches.open(CACHE_VERSION).then(function(cache) {
        return cache.match(req).then(function(cached) {
          var networkFetch = fetch(req).then(function(response) {
            if (response && response.status === 200) {
              cache.put(req, response.clone());
            }
            return response;
          });
          /* Return cache immediately if available, else wait for network */
          return cached || networkFetch;
        });
      })
    );
  }
  /* All other requests: fall through to browser default (network) */
});
