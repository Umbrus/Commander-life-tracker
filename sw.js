const CACHE_NAME = "commander-pod-v50";
const ASSETS = [
  "./",
  "./index.html",
  "./decks.html",
  "./stats.html",
  "./profile.html",
  "./style.css",
  "./app.js",
  "./decks.js",
  "./stats.js",
  "./profile.js",
  "./manifest.json",
  "./images/icon-512.png",
  "./images/icon.svg",
  "./images/icons/nav-play.svg",
  "./images/icons/nav-decks.svg",
  "./images/icons/nav-stats.svg",
  "./images/icons/nav-profile.svg",
  "./images/icons/glyph-cmdr.svg",
  "./images/icons/glyph-poison.svg",
  "./images/icons/glyph-tax.svg",
  "./images/icons/glyph-energy.svg",
  "./images/icons/glyph-experience.svg",
  "./images/icons/glyph-storm.svg",
  "./images/icons/glyph-rad.svg",
  "./images/icons/glyph-monarch.svg",
  "./images/icons/glyph-ko.svg",
  "./images/icons/die-d20.svg",
  "./images/icons/die-d4.svg",
  "./images/icons/die-d6.svg",
  "./images/icons/die-d8.svg",
  "./images/icons/die-d10.svg",
  "./images/icons/die-d12.svg",
  "./images/icons/die-coin.svg",
  "./images/icons/die-planar.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch((error) => {
      console.error("Service worker precache failed:", error);
      throw error;
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});