"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const SESSION_STORAGE_KEY = "usage-session-key";
const INSTALLATION_STORAGE_KEY = "usage-installation-key";

function sessionKey(): string | undefined {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID().replaceAll("-", "");
    sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}

function installationKey(): string | undefined {
  try {
    const existing = localStorage.getItem(INSTALLATION_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID().replaceAll("-", "");
    localStorage.setItem(INSTALLATION_STORAGE_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}

function surfaceForPath(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return "home";
  // The Users page is now Staff; the analytics surface keeps its stable "users" name.
  if (first === "staff") return "users";
  if (["bookings", "items", "schedule", "reports", "settings", "search", "notifications", "users", "resources", "licenses", "kiosk"].includes(first)) return first;
  return "other";
}

function send(eventName: "app_opened" | "surface_viewed", surface: string) {
  void fetch("/api/product-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventName,
      platform: "web",
      surface,
      sessionKey: sessionKey(),
      installationKey: installationKey(),
      releaseChannel: "web",
    }),
    keepalive: true,
  }).catch(() => undefined);
}

export function ProductUsageTracker() {
  const pathname = usePathname();
  const opened = useRef(false);

  useEffect(() => {
    const surface = surfaceForPath(pathname);
    if (!opened.current) {
      opened.current = true;
      send("app_opened", surface);
    }
    send("surface_viewed", surface);
  }, [pathname]);

  return null;
}
