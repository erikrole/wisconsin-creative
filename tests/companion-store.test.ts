import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  sets: new Map<string, Set<string>>(),
  hashes: new Map<string, Map<string, unknown>>(),
  failSessionDeleteOnce: false,
  afterSessionDelete: null as null | (() => Promise<void>),
}));

vi.mock("@upstash/redis", () => {
  class FakeRedis {
    async get<T>(key: string): Promise<T | null> {
      return (redisState.values.get(key) as T | undefined) ?? null;
    }

    async eval(_script: string, keys: string[], args: string[]): Promise<number> {
      if (keys.length === 3 && args.length === 4) {
        const [epochKey = "", sessionKey = "", sessionsKey = ""] = keys;
        const [expectedEpoch = "0", rawRecord = "{}", , jti = ""] = args;
        const currentEpoch = Number(redisState.values.get(epochKey) ?? 0);
        if (currentEpoch !== Number(expectedEpoch)) return 0;
        redisState.values.set(sessionKey, JSON.parse(rawRecord));
        const sessions = redisState.sets.get(sessionsKey) ?? new Set<string>();
        sessions.add(jti);
        redisState.sets.set(sessionsKey, sessions);
        return 1;
      }

      if (keys.length === 3) {
        const [sessionKey = "", epochKey = "", devicesKey = ""] = keys;
        const [expectedEpoch = "0", token = "", rawRecord = "{}"] = args;
        if (!redisState.values.has(sessionKey)) return 0;
        const currentEpoch = Number(redisState.values.get(epochKey) ?? 0);
        if (currentEpoch !== Number(expectedEpoch)) return 0;
        const devices = redisState.hashes.get(devicesKey) ?? new Map<string, unknown>();
        devices.set(token, rawRecord);
        redisState.hashes.set(devicesKey, devices);
        return 1;
      }

      const [projectionKey = ""] = keys;
      const [rawProjection = "{}", revision = "0"] = args;
      const incoming = JSON.parse(rawProjection) as { revision: number };
      const current = redisState.values.get(projectionKey) as { revision?: number } | undefined;
      if (current?.revision !== undefined && current.revision >= Number(revision)) return 0;
      redisState.values.set(projectionKey, incoming);
      return 1;
    }

    async incr(key: string): Promise<number> {
      const next = Number(redisState.values.get(key) ?? 0) + 1;
      redisState.values.set(key, next);
      return next;
    }

    async smembers<T>(key: string): Promise<T> {
      return [...(redisState.sets.get(key) ?? [])] as T;
    }

    async srem(key: string, member: string): Promise<number> {
      return redisState.sets.get(key)?.delete(member) ? 1 : 0;
    }

    async del(...keys: string[]): Promise<number> {
      if (
        redisState.failSessionDeleteOnce &&
        keys.some((key) => key.startsWith("gear-tracker:companion:session:v1:"))
      ) {
        redisState.failSessionDeleteOnce = false;
        throw new Error("simulated session cleanup failure");
      }
      let removed = 0;
      for (const key of keys) {
        removed += redisState.values.delete(key) ? 1 : 0;
        removed += redisState.sets.delete(key) ? 1 : 0;
      }
      if (
        keys.some((key) => key.startsWith("gear-tracker:companion:session:v1:")) &&
        redisState.afterSessionDelete
      ) {
        const hook = redisState.afterSessionDelete;
        redisState.afterSessionDelete = null;
        await hook();
      }
      return removed;
    }

    async hgetall<T>(key: string): Promise<T | null> {
      const hash = redisState.hashes.get(key);
      return hash ? Object.fromEntries(hash) as T : null;
    }

    async hset(key: string, entries: Record<string, unknown>): Promise<number> {
      const hash = redisState.hashes.get(key) ?? new Map<string, unknown>();
      for (const [field, value] of Object.entries(entries)) hash.set(field, value);
      redisState.hashes.set(key, hash);
      return Object.keys(entries).length;
    }

    async hdel(key: string, ...fields: string[]): Promise<number> {
      const hash = redisState.hashes.get(key);
      if (!hash) return 0;
      return fields.reduce((count, field) => count + (hash.delete(field) ? 1 : 0), 0);
    }
  }

  return { Redis: FakeRedis };
});

import {
  getCompanionUserEpoch,
  issueCompanionSession,
  readCompanionPresence,
  listCompanionDevices,
  readCompanionProjection,
  registerCompanionDevice,
  requireCompanion,
  resetCompanionRedisForTests,
  renewCompanionSession,
  revokeCompanionSession,
  revokeCompanionUser,
  writeCompanionProjection,
} from "@/lib/companion-store";

const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalSessionSecret = process.env.SESSION_SECRET;

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function requestFor(token: string): Request {
  return new Request("https://wisconsincreative.com/api/companion/projection", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function tokenPayload(token: string): { jti: string } {
  const [body = ""] = token.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

describe("companion store", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-companion-session-secret-at-least-32-characters";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    redisState.values.clear();
    redisState.sets.clear();
    redisState.hashes.clear();
    redisState.failSessionDeleteOnce = false;
    redisState.afterSessionDelete = null;
    resetCompanionRedisForTests();
  });

  afterEach(() => {
    restoreEnvironment("UPSTASH_REDIS_REST_URL", originalRedisUrl);
    restoreEnvironment("UPSTASH_REDIS_REST_TOKEN", originalRedisToken);
    restoreEnvironment("SESSION_SECRET", originalSessionSecret);
    resetCompanionRedisForTests();
  });

  it("accepts an issued credential and rejects signature or stored-authority tampering", async () => {
    const token = await issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0);

    await expect(requireCompanion(requestFor(token))).resolves.toMatchObject({
      userId: "user-1",
      role: "ADMIN",
      epoch: 0,
    });
    const [body = "", tokenSignature = ""] = token.split(".");
    const tamperedSignature = `${tokenSignature.startsWith("a") ? "b" : "a"}${tokenSignature.slice(1)}`;
    await expect(requireCompanion(requestFor(`${body}.${tamperedSignature}`))).rejects.toMatchObject({
      status: 401,
    });

    const { jti } = tokenPayload(token);
    const key = `gear-tracker:companion:session:v1:${jti}`;
    redisState.values.set(key, {
      ...(redisState.values.get(key) as object),
      role: "STAFF",
    });
    await expect(requireCompanion(requestFor(token))).rejects.toMatchObject({ status: 401 });
  });

  it("issues a rolling credential from the external authority without touching Neon", async () => {
    const token = await issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0);

    const renewed = await renewCompanionSession(requestFor(token));

    expect(renewed).not.toEqual(token);
    await expect(requireCompanion(requestFor(token))).resolves.toMatchObject({
      userId: "user-1",
      role: "ADMIN",
      epoch: 0,
    });
    await expect(requireCompanion(requestFor(renewed))).resolves.toMatchObject({
      userId: "user-1",
      role: "ADMIN",
      epoch: 0,
    });
  });

  it("records menu bar presence in Redis on renewal, at most once per quarter hour", async () => {
    const token = await issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0);
    const request = new Request("https://wisconsincreative.com/api/companion/session", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "user-agent": "GearOps/1.4 macOS/26.1.0" },
    });

    const renewed = await renewCompanionSession(request);
    const presence = await readCompanionPresence();
    const record = presence.get("user-1");
    expect(record).toMatchObject({ appVersion: "1.4", osVersion: "26.1.0" });
    expect(record?.days).toHaveLength(1);

    await renewCompanionSession(requestFor(renewed));
    expect((await readCompanionPresence()).get("user-1")?.lastSeenAt).toBe(record?.lastSeenAt);
  });

  it("invalidates every prior credential before cleanup and rejects stale enrollment", async () => {
    const token = await issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0);

    await revokeCompanionUser("user-1");

    await expect(requireCompanion(requestFor(token))).rejects.toMatchObject({ status: 401 });
    await expect(issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0)).rejects.toMatchObject({
      status: 409,
    });
    expect(await getCompanionUserEpoch("user-1")).toBe(1);
    await expect(issueCompanionSession({ id: "user-1", role: "STAFF" }, 1)).resolves.toEqual(
      expect.any(String),
    );
  });

  it("keeps failed cleanup discoverable for an idempotent retry", async () => {
    const token = await issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0);
    const { jti } = tokenPayload(token);
    const indexKey = "gear-tracker:companion:user-sessions:v1:user-1";
    redisState.failSessionDeleteOnce = true;

    await expect(revokeCompanionUser("user-1")).rejects.toThrow("simulated session cleanup failure");
    expect(redisState.sets.get(indexKey)).toEqual(new Set([jti]));
    await expect(requireCompanion(requestFor(token))).rejects.toMatchObject({ status: 401 });

    await expect(revokeCompanionUser("user-1")).resolves.toBeUndefined();
    expect(redisState.sets.has(indexKey)).toBe(false);
  });

  it("rejects a device registration that crosses the user revocation fence", async () => {
    const token = await issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0);
    const session = await requireCompanion(requestFor(token));

    await registerCompanionDevice(session, "device-before-revoke");
    await expect(listCompanionDevices()).resolves.toHaveLength(1);
    await revokeCompanionUser("user-1");

    await expect(registerCompanionDevice(session, "device-after-revoke")).rejects.toMatchObject({
      status: 401,
    });
    await expect(listCompanionDevices()).resolves.toEqual([]);
  });

  it("deletes session authority before scanning devices during sign-out", async () => {
    const token = await issueCompanionSession({ id: "user-1", role: "ADMIN" }, 0);
    const session = await requireCompanion(requestFor(token));
    await registerCompanionDevice(session, "device-before-signout");
    redisState.afterSessionDelete = async () => {
      await expect(registerCompanionDevice(session, "device-during-signout")).rejects.toMatchObject({
        status: 401,
      });
    };

    await revokeCompanionSession(requestFor(token));

    await expect(listCompanionDevices()).resolves.toEqual([]);
  });

  it("installs only a strictly newer projection revision", async () => {
    const newer = { revision: 2, generatedAt: "2026-08-12T12:00:00.000Z", value: "new" };
    const older = { revision: 1, generatedAt: "2026-08-12T12:00:01.000Z", value: "old" };
    const duplicate = { ...newer, value: "duplicate" };

    await expect(writeCompanionProjection(newer)).resolves.toBe(true);
    await expect(writeCompanionProjection(older)).resolves.toBe(false);
    await expect(writeCompanionProjection(duplicate)).resolves.toBe(false);
    await expect(readCompanionProjection<typeof newer>()).resolves.toEqual(newer);
  });
});
