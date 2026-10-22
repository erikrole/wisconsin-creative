import { beforeEach, describe, expect, it, vi } from "vitest";
import { source } from "./_helpers/source";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/env", () => ({
  env: {
    sessionCookieName: "app_session",
    trustedOrigins: ["https://app.example.com"],
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 30, windowMs: 60_000 },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeSidebarPrefs } from "@/lib/services/sidebar-prefs";
import { GET, PUT } from "@/app/api/me/sidebar-prefs/route";

const user = {
  id: "cm000000000000000000000001",
  email: "staff@example.com",
  name: "Staff User",
  role: "STAFF" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

function request(method: "GET" | "PUT", body?: unknown) {
  return new Request("https://app.example.com/api/me/sidebar-prefs", {
    method,
    headers: { "Content-Type": "application/json", origin: "https://app.example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("normalizeSidebarPrefs", () => {
  it("treats a never-saved record as null", () => {
    expect(normalizeSidebarPrefs(null)).toBeNull();
    expect(normalizeSidebarPrefs([])).toBeNull();
  });

  it("keeps only plain app hrefs, once each, in order", () => {
    expect(
      normalizeSidebarPrefs({
        pinned: ["/schedule", "/items", "/schedule", "https://evil.example", "javascript:alert(1)", 4],
        hidden: "nope",
      }),
    ).toEqual({ pinned: ["/schedule", "/items"], hidden: [] });
  });
});

describe("/api/me/sidebar-prefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(user);
  });

  it("returns null until the sidebar is first customized", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ sidebarPrefs: null } as never);
    const res = await GET(request("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
  });

  it("stores the caller's normalized pins and hidden pages", async () => {
    const res = await PUT(request("PUT", { pinned: ["/budget", "/budget"], hidden: ["/scoreboard"] }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { sidebarPrefs: { pinned: ["/budget"], hidden: ["/scoreboard"] } },
    });
  });

  it("rejects a malformed body", async () => {
    const res = await PUT(request("PUT", { pinned: "/budget" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("sidebar account sync", () => {
  it("loads account prefs over the browser copy and saves dialog changes through them", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toContain('const SIDEBAR_PREFS_URL = "/api/me/sidebar-prefs";');
    expect(sidebar).toContain("onPinnedChange={accountPrefs.setPinned}");
    expect(sidebar).toContain("onHiddenChange={accountPrefs.setHidden}");
    const migration = source("prisma/migrations/0194_user_sidebar_prefs/migration.sql");
    expect(migration).toContain('ADD COLUMN "sidebar_prefs" JSONB');
  });
});
