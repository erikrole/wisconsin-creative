import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serviceWorkerSource = readFileSync("public/sw.js", "utf8");
const manifestSource = readFileSync("src/app/manifest.ts", "utf8");

describe("PWA service-worker contract", () => {
  it("keeps the manifest installable with an explicit app identity and scope", () => {
    expect(manifestSource).toContain('id: "/"');
    expect(manifestSource).toContain('start_url: "/"');
    expect(manifestSource).toContain('scope: "/"');
    expect(manifestSource).toContain('src: "/icon-192.png"');
    expect(manifestSource).toContain('src: "/icon-512.png"');
  });

  it("never precaches or stores authenticated HTML", () => {
    expect(serviceWorkerSource).toContain('const CACHE_NAME = "gear-tracker-v3"');
    expect(serviceWorkerSource).toContain('"/offline.html"');
    expect(serviceWorkerSource).not.toMatch(/const PRECACHE_URLS = \[[\s\S]*?"\/",/);

    const navigationSource = serviceWorkerSource.slice(
      serviceWorkerSource.indexOf('if (request.mode === "navigate")'),
    );
    expect(navigationSource).toContain('fetch(request, { cache: "no-store" })');
    expect(navigationSource).toContain('caches.match("/offline.html")');
    expect(navigationSource).not.toContain("cache.put");
  });

  it("turns browser push payloads into safe same-origin notification clicks", () => {
    expect(serviceWorkerSource).toContain('self.addEventListener("push"');
    expect(serviceWorkerSource).toContain("self.registration.showNotification");
    expect(serviceWorkerSource).toContain('self.addEventListener("notificationclick"');
    expect(serviceWorkerSource).toContain('self.clients.openWindow(targetUrl)');
    expect(serviceWorkerSource).toContain('DEFAULT_NOTIFICATION_URL = "/notifications"');
  });

  it("ships a self-contained offline document", () => {
    expect(existsSync("public/offline.html")).toBe(true);
    const offlineSource = readFileSync("public/offline.html", "utf8");
    expect(offlineSource).toContain("Connection required");
    expect(offlineSource).toContain('min-height: 44px');
    expect(offlineSource).not.toMatch(/(?:src|href)=['"]https?:\/\//i);
  });
});
