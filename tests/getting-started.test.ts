import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 30, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET, PATCH } from "@/app/api/me/getting-started/route";
import {
  mergeGettingStarted,
  normalizeGettingStarted,
  withinGettingStartedWindow,
} from "@/lib/getting-started";

const actor = { id: "user-1", email: "s@wisc.edu", name: "S", role: "STUDENT" as const, avatarUrl: null };
const noParams = { params: Promise.resolve({}) };

function patch(body: unknown) {
  return new Request("https://app.example.com/api/me/getting-started", {
    method: "PATCH",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(actor);
  dbMock.$transaction.mockImplementation(async (op: (tx: typeof dbMock) => Promise<unknown>) => op(dbMock));
  dbMock.user.update.mockResolvedValue({});
});

describe("getting started state", () => {
  it("normalizes unknown or empty storage", () => {
    expect(normalizeGettingStarted(null)).toEqual({ done: [], dismissed: false });
    expect(normalizeGettingStarted({ done: ["schedule", "bogus", "schedule"], dismissed: "yes" })).toEqual({ done: ["schedule"], dismissed: false });
  });

  it("only moves forward when merging", () => {
    const merged = mergeGettingStarted({ done: ["schedule"], dismissed: true }, { done: ["guides"], dismissed: false });
    expect(merged).toEqual({ done: ["schedule", "guides"], dismissed: true });
  });

  it("offers itself for 14 days after the account is created", () => {
    const now = Date.UTC(2026, 9, 26);
    expect(withinGettingStartedWindow(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe(true);
    expect(withinGettingStartedWindow(new Date(now - 15 * 86_400_000).toISOString(), now)).toBe(false);
    expect(withinGettingStartedWindow(null, now)).toBe(false);
  });
});

describe("/api/me/getting-started", () => {
  it("returns the caller's saved progress", async () => {
    dbMock.user.findUnique.mockResolvedValue({ gettingStarted: { done: ["guides"], dismissed: false } });
    const res = await GET(new Request("https://app.example.com/api/me/getting-started"), noParams);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ done: ["guides"], dismissed: false });
    expect(dbMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }));
  });

  it("adds rows without dropping ones another device saved", async () => {
    dbMock.user.findUnique.mockResolvedValue({ gettingStarted: { done: ["notifications"], dismissed: false } });
    const res = await PATCH(patch({ done: ["schedule"] }), noParams);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ done: ["notifications", "schedule"], dismissed: false });
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { gettingStarted: { done: ["notifications", "schedule"], dismissed: false } },
    });
  });

  it("rejects unknown rows and un-dismissing", async () => {
    dbMock.user.findUnique.mockResolvedValue({ gettingStarted: null });
    expect((await PATCH(patch({ done: ["bogus"] }), noParams)).status).toBe(400);
    expect((await PATCH(patch({ dismissed: false }), noParams)).status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
});

describe("web card", () => {
  const card = readFileSync("src/app/(app)/_home/GettingStartedCard.tsx", "utf8");

  it("syncs through the server and keeps the old browser copy", () => {
    expect(card).toContain('fetch("/api/me/getting-started"');
    expect(card).toContain("wc-getting-started");
    expect(card).toContain("withinGettingStartedWindow(user?.accountCreatedAt)");
  });

  it("has a staff version and never shows to collaborators or previews", () => {
    expect(card).toContain('role === "STUDENT" || role === "STAFF" || role === "ADMIN"');
    expect(card).toContain("!user?.preview?.readOnly");
    expect(card).toContain('href: "/staff/onboarding-status"');
  });
});
