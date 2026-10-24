import type { Redis } from "@upstash/redis";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearKioskBeat,
  heartbeatCanSkipDatabase,
  KIOSK_HEARTBEAT_DB_REFRESH_MS,
  recordKioskBeat,
  resetKioskHeartbeatRedisForTests,
  withLatestKioskBeats,
  type CachedKioskHeartbeat,
} from "@/lib/kiosk-heartbeat-cache";
import { source } from "./_helpers/source";

const now = new Date("2026-10-22T08:00:00Z");
const report = { appVersion: "1.3", appBuild: "2", osVersion: "18.6", deviceModel: "iPad14,1" };

function cached(overrides: Partial<CachedKioskHeartbeat> = {}): CachedKioskHeartbeat {
  return {
    kioskId: "kiosk-1",
    sessionExpiresAt: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    dbSeenAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    report,
    ...overrides,
  };
}

function fakeRedis() {
  const hash = new Map<string, string>();
  return {
    hash,
    client: {
      hset: async (_key: string, values: Record<string, string>) => {
        for (const [k, v] of Object.entries(values)) hash.set(k, v);
      },
      hdel: async (_key: string, field: string) => hash.delete(field),
      hgetall: async () => (hash.size ? Object.fromEntries(hash) : null),
    } as unknown as Redis,
  };
}

afterEach(() => resetKioskHeartbeatRedisForTests(undefined));

describe("heartbeatCanSkipDatabase", () => {
  it("skips Neon for an unchanged beat soon after a database heartbeat", () => {
    expect(heartbeatCanSkipDatabase(cached(), null, now)).toBe(true);
    expect(heartbeatCanSkipDatabase(cached(), report, now)).toBe(true);
    // Null fields mean "not reported", not "changed".
    expect(heartbeatCanSkipDatabase(cached(), { ...report, deviceModel: null }, now)).toBe(true);
  });

  it("goes to the database when nothing is cached", () => {
    expect(heartbeatCanSkipDatabase(null, null, now)).toBe(false);
  });

  it("lets the database see the kiosk at least every 12 hours", () => {
    const old = new Date(now.getTime() - KIOSK_HEARTBEAT_DB_REFRESH_MS).toISOString();
    expect(heartbeatCanSkipDatabase(cached({ dbSeenAt: old }), null, now)).toBe(false);
  });

  it("goes to the database to slide a session near expiry", () => {
    const soon = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
    expect(heartbeatCanSkipDatabase(cached({ sessionExpiresAt: soon }), null, now)).toBe(false);
  });

  it("goes to the database when the build report changed", () => {
    expect(heartbeatCanSkipDatabase(cached(), { ...report, appBuild: "3" }, now)).toBe(false);
  });
});

describe("withLatestKioskBeats", () => {
  it("returns devices untouched without Redis", async () => {
    resetKioskHeartbeatRedisForTests(null);
    const devices = [{ id: "kiosk-1", lastSeenAt: null }];
    expect(await withLatestKioskBeats(devices)).toBe(devices);
  });

  it("shows a newer Redis beat and keeps a newer database value", async () => {
    const redis = fakeRedis();
    resetKioskHeartbeatRedisForTests(redis.client);
    const dbSeen = new Date("2026-10-22T06:00:00Z");
    await recordKioskBeat("kiosk-1", now);
    await recordKioskBeat("kiosk-2", new Date("2026-10-22T05:00:00Z"));

    const result = await withLatestKioskBeats([
      { id: "kiosk-1", lastSeenAt: dbSeen },
      { id: "kiosk-2", lastSeenAt: dbSeen },
      { id: "kiosk-3", lastSeenAt: null },
    ]);

    expect(result.map((d) => d.lastSeenAt)).toEqual([now, dbSeen, null]);
  });

  it("forgets a reset kiosk's beat", async () => {
    const redis = fakeRedis();
    resetKioskHeartbeatRedisForTests(redis.client);
    await recordKioskBeat("kiosk-1", now);
    await clearKioskBeat("kiosk-1");
    expect(await withLatestKioskBeats([{ id: "kiosk-1", lastSeenAt: null }])).toEqual([
      { id: "kiosk-1", lastSeenAt: null },
    ]);
  });
});

describe("kiosk heartbeat wiring", () => {
  it("tries the Redis path before authenticating against Neon", () => {
    const route = source("src/app/api/kiosk/heartbeat/route.ts");
    expect(route).toContain("{ withoutDatabase: cachedHeartbeat }");
    // The early exit runs inside withKiosk, after its CSRF and preview checks.
    const api = source("src/lib/api.ts");
    expect(api.indexOf("assertKioskSameOrigin(req);")).toBeLessThan(api.indexOf("options.withoutDatabase(req)"));
    expect(api.indexOf("options.withoutDatabase(req)")).toBeLessThan(api.indexOf("const kiosk = await requireKiosk();"));
    expect(route).toContain("rememberKioskHeartbeat(");
  });

  it("drops the cached session wherever an admin revokes a kiosk", () => {
    expect(source("src/app/api/kiosk-devices/[id]/route.ts")).toContain("forgetKioskHeartbeat(device.sessionToken)");
    expect(source("src/app/api/kiosk-devices/[id]/regenerate-code/route.ts")).toContain(
      "forgetKioskHeartbeat(device.sessionToken)",
    );
  });

  it("shows the newest beat wherever last seen is read", () => {
    expect(source("src/app/api/kiosk-devices/route.ts")).toContain("withLatestKioskBeats(storedDevices)");
    expect(source("src/lib/services/companion-projection.ts")).toContain("withLatestKioskBeats(storedDevices)");
  });
});
