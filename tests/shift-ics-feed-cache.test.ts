import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "@upstash/redis";
import { hashIcsToken } from "@/lib/ics-token";

const mocks = vi.hoisted(() => ({ readScheduleRevision: vi.fn() }));

vi.mock("@/lib/schedule-live", () => ({
  readScheduleRevision: mocks.readScheduleRevision,
  bumpScheduleRevision: vi.fn(),
  isScheduleMutation: () => false,
}));
vi.mock("@/lib/db", () => ({
  db: { user: { findFirst: vi.fn() }, shiftAssignment: { findMany: vi.fn() } },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 })),
  getClientIp: vi.fn(() => "203.0.113.10"),
}));

import { GET } from "@/app/api/shifts/ics/[token]/route";
import { db } from "@/lib/db";
import { forgetIcsFeed, icsFeedCacheKey, resetIcsFeedRedisForTests } from "@/lib/ics-feed-cache";

/** Just enough of Upstash Redis for the cache: a Map with get/set/del. */
function fakeRedis() {
  const store = new Map<string, unknown>();
  return {
    store,
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    } as unknown as Redis,
  };
}

const token = "b".repeat(48);
const params = { params: Promise.resolve({ token }) };
const request = (headers: Record<string, string> = {}) =>
  new Request(`https://app.example.com/api/shifts/ics/${token}`, { headers: { "x-forwarded-for": "203.0.113.10", ...headers } });

let redis: ReturnType<typeof fakeRedis>;

beforeEach(() => {
  vi.clearAllMocks();
  redis = fakeRedis();
  resetIcsFeedRedisForTests(redis.client);
  mocks.readScheduleRevision.mockResolvedValue(7);
  vi.mocked(db.user.findFirst).mockResolvedValue({ id: "user-1", name: "Student One", role: "STUDENT" } as never);
  vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([] as never);
});

describe("shift ICS feed cache", () => {
  it("builds from the database once, then answers the same revision from Redis", async () => {
    const first = await GET(request(), params);
    expect(first.status).toBe(200);
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(1);
    const etag = first.headers.get("ETag");
    expect(etag).toMatch(/^"[a-f0-9]{32}"$/);
    // Keyed on the stored (hashed) token form, never the raw credential.
    expect(redis.store.has(icsFeedCacheKey(hashIcsToken(token)))).toBe(true);
    expect([...redis.store.keys()].some((key) => key.includes(token))).toBe(false);

    const second = await GET(request(), params);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(await first.text());
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toBe("no-cache, no-store");
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(1);
  });

  it("answers a matching If-None-Match with 304 and no body, without Neon", async () => {
    const first = await GET(request(), params);
    const res = await GET(request({ "if-none-match": first.headers.get("ETag")! }), params);
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("ETag")).toBe(first.headers.get("ETag"));
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it("rebuilds once the schedule revision moves", async () => {
    await GET(request(), params);
    mocks.readScheduleRevision.mockResolvedValue(8);
    await GET(request(), params);
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(2);
    // And the rebuilt feed is cached under the new revision.
    await GET(request(), params);
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(2);
  });

  it("remembers an unknown token so a dead link stops waking the database", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(404);
    expect((await GET(request(), params)).status).toBe(404);
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it("forgets a rotated token's feed by its stored value", async () => {
    await GET(request(), params);
    await forgetIcsFeed(hashIcsToken(token));
    await GET(request(), params);
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(2);
  });

  it("takes the database path when Redis or the revision is unavailable, and caches nothing", async () => {
    mocks.readScheduleRevision.mockResolvedValue(null);
    await GET(request(), params);
    await GET(request(), params);
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(2);
    expect(redis.store.size).toBe(0);

    resetIcsFeedRedisForTests(null);
    mocks.readScheduleRevision.mockResolvedValue(7);
    await GET(request(), params);
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(3);
  });
});
