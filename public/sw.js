// IfeCollection service worker.
// - App files (/_next/static, icons): cache first (they have unique names per build).
// - Product photos (Cloudinary or Supabase Storage): cache first (each upload has a unique path), capped in size.
// - Pages: network first; if offline show /offline.
// - Supabase data/auth requests are NEVER cached here (sales must hit the server).
const VERSION = "ife-v2";
const STATIC_CACHE = `${VERSION}-static`;
const IMAGE_CACHE = `${VERSION}-images`;
const MAX_IMAGES = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((c) => c.addAll(["/offline", "/icons/icon-192.png", "/icons/icon-512.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") {
    cache.put(request, res.clone());
    if (limit) {
      cache.keys().then((keys) => {
        if (keys.length > limit) keys.slice(0, keys.length - limit).forEach((k) => cache.delete(k));
      });
    }
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.includes("/storage/v1/object/public/product-images/") || url.hostname === "res.cloudinary.com") {
    event.respondWith(cacheFirst(req, IMAGE_CACHE, MAX_IMAGES));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match("/offline")) || new Response("Offline", { status: 503 })),
    );
  }
});
