/**
 * Offline shell.
 *
 * Deliberately small. A service worker that caches pages aggressively is the
 * fastest way to serve a stale price or a sold-out variant, so nothing that
 * carries stock, money or a session is cached at all — those requests go
 * straight to the network and fail honestly when there is none.
 *
 * What is cached is the shell: the offline page, the brand icons, and hashed
 * build assets, which are immutable by construction.
 */

const VERSION = "siumora-v1";
const SHELL = ["/offline", "/icons/favicon-192.png", "/icons/favicon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Paths whose answer changes with stock, money or who is asking. */
const NEVER_CACHE = /^\/(api|cart|checkout|account|orders|admin|signin)(\/|$)/;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.test(url.pathname)) return;

  // Immutable build output: cache first, because the filename changes whenever
  // the contents do.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else: network first, and the offline page only when the network
  // is genuinely gone. Serving a cached catalogue page would show yesterday's
  // price as though it were today's.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline").then((hit) => hit ?? Response.error()),
      ),
    );
  }
});
