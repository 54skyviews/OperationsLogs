const CACHE_NAME = "operationslogs-v1-4-8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=148",
  "./data.js?v=148",
  "./app.js?v=148",
  "./sync.js?v=148",
  "./supabase-config.js?v=148",
  "./manifest.webmanifest",
  "./icon.svg",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      for (const asset of APP_SHELL) {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn("Could not cache", asset, error);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Supabase is live operational data. Never place API responses in the
  // service-worker Cache API and never satisfy them from an old cache entry.
  if (url.hostname.endsWith(".supabase.co")) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigations are network-first so a published update is picked up promptly.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Only cache GET requests.
  if (request.method !== "GET") {
    event.respondWith(fetch(request));
    return;
  }

  // Same-origin application assets and the explicitly pre-cached CDN libraries
  // may use cache-first behaviour. Other cross-origin requests stay network-only.
  const sameOrigin = url.origin === self.location.origin;
  const isKnownCdnAsset =
    url.hostname === "cdn.jsdelivr.net" ||
    url.hostname === "cdn.sheetjs.com";

  if (!sameOrigin && !isKnownCdnAsset) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
