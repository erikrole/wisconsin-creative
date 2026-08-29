// Wisconsin Creative Service Worker — static asset caching with a safe offline fallback
const CACHE_NAME = "gear-tracker-v3";

// Only cache public, identity-independent files during install. Authenticated
// HTML must never become a shared offline shell.
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/offline.html",
];

const DEFAULT_NOTIFICATION_URL = "/notifications";

function safeNotificationUrl(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : DEFAULT_NOTIFICATION_URL;
}

// Install: precache public metadata and assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Browser Push payloads contain only presentation data and a same-origin
// destination. The server remains the source of truth for notification data.
self.addEventListener("push", (event) => {
  let rawData = {};
  try {
    rawData = event.data ? event.data.json() : {};
  } catch {
    rawData = {};
  }
  const data = rawData && typeof rawData === "object" ? rawData : {};
  const title = typeof data.title === "string" && data.title.trim()
    ? data.title
    : "Wisconsin Creative";
  const body = typeof data.body === "string" ? data.body : "";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: safeNotificationUrl(data.url) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const targetUrl = new URL(
    safeNotificationUrl(event.notification.data && event.notification.data.url),
    self.location.origin
  ).href;
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      const existing = windowClients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        await existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // API calls: network-first with no cache fallback
  if (url.pathname.startsWith("/api/")) return;

  // Static assets (JS, CSS, images, fonts): cache-first
  if (
    url.pathname.match(/\.(js|css|svg|png|jpg|jpeg|webp|woff2?|ttf|ico)$/) ||
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests (including authenticated app pages): always ask the
  // server for the current session. If the device is offline, show only the
  // identity-independent offline page instead of returning private HTML.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() =>
        caches.match("/offline.html")
      )
    );
    return;
  }
});
