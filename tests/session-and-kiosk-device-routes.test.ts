import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  cookie: { value: undefined as string | undefined },
  rateLimit: vi.fn(),
  audit: vi.fn(),
  forgetHeartbeat: vi.fn(),
  clearBeat: vi.fn(),
  db: {
    session: { findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
    kioskDevice: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    location: { findUnique: vi.fn() },
    booking: { groupBy: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  requireKiosk: vi.fn(),
  tokenHash: vi.fn(async (raw: string) => `hash:${raw}`),
  KIOSK_ACTIVATION_CODE_TTL_MS: 24 * 60 * 60 * 1000,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "wc_session" && mocks.cookie.value ? { value: mocks.cookie.value } : undefined),
  })),
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@/lib/env")>();
  return {
    env: new Proxy(env, {
      get: (target, key, receiver) => (key === "sessionCookieName" ? "wc_session" : Reflect.get(target, key, receiver)),
    }),
  };
});
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit, SETTINGS_MUTATION_LIMIT: { max: 20, windowMs: 60_000 } }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/kiosk-heartbeat-cache", () => ({
  withLatestKioskBeats: vi.fn(async (devices: unknown[]) => devices),
  forgetKioskHeartbeat: mocks.forgetHeartbeat,
  clearKioskBeat: mocks.clearBeat,
}));

import { DELETE as revokeOthers, GET as listSessions } from "@/app/api/me/sessions/route";
import { DELETE as revokeOne } from "@/app/api/me/sessions/[id]/route";
import { GET as listKiosks, POST as createKiosk } from "@/app/api/kiosk-devices/route";
import { POST as regenerateCode } from "@/app/api/kiosk-devices/[id]/regenerate-code/route";

const student = authUser(Role.STUDENT, "maya");
const admin = authUser(Role.ADMIN, "erik");
const noParams = routeCtx({});

beforeEach(() => {
  mocks.cookie.value = "raw-token";
  mocks.requireAuth.mockResolvedValue(student);
  mocks.db.session.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => (
    where.tokenHash === "hash:raw-token" ? { id: "current" } : null
  ));
});

describe("GET /api/me/sessions", () => {
  it("lists only the caller's live sessions, marks the current one and never returns token hashes", async () => {
    mocks.db.session.findMany.mockResolvedValue([
      { id: "current", createdAt: new Date("2026-10-20T15:00:00Z"), expiresAt: new Date("2026-11-20T15:00:00Z") },
      { id: "phone", createdAt: new Date("2026-10-01T15:00:00Z"), expiresAt: new Date("2026-11-01T15:00:00Z") },
    ]);

    const res = await listSessions(jsonRequest("/api/me/sessions", "GET"), noParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.db.session.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "maya", expiresAt: { gt: expect.any(Date) } },
      select: { id: true, createdAt: true, expiresAt: true },
    }));
    expect(body.data.map((s: { id: string; isCurrent: boolean }) => [s.id, s.isCurrent])).toEqual([
      ["current", true],
      ["phone", false],
    ]);
    expect(JSON.stringify(body)).not.toContain("hash:");
  });

  it("marks nothing current when there is no session cookie", async () => {
    mocks.cookie.value = undefined;
    mocks.db.session.findMany.mockResolvedValue([
      { id: "phone", createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
    ]);

    const body = await (await listSessions(jsonRequest("/api/me/sessions", "GET"), noParams)).json();

    expect(body.data[0].isCurrent).toBe(false);
    expect(mocks.db.session.findUnique).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    mocks.db.session.findMany.mockResolvedValue([]);
    await listSessions(jsonRequest("/api/me/sessions", "GET"), noParams);
    expect(mocks.rateLimit).toHaveBeenCalledWith("sessions:read:maya", expect.any(Object));
  });
});

describe("DELETE /api/me/sessions (sign out everywhere else)", () => {
  it("deletes every other session of the caller and keeps the current one", async () => {
    mocks.db.session.deleteMany.mockResolvedValue({ count: 3 });

    const res = await revokeOthers(jsonRequest("/api/me/sessions", "DELETE"), noParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revokedCount: 3 });
    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "maya", id: { not: "current" } },
    });
  });

  it("refuses when the current session cannot be verified, so it never wipes every session", async () => {
    mocks.cookie.value = "stale-token";

    const res = await revokeOthers(jsonRequest("/api/me/sessions", "DELETE"), noParams);

    expect(res.status).toBe(401);
    expect(mocks.db.session.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a cross-site request", async () => {
    const req = new Request("https://app.example.com/api/me/sessions", {
      method: "DELETE",
      headers: { host: "app.example.com", origin: "https://evil.example.net" },
    });

    const res = await revokeOthers(req, noParams);

    expect(res.status).toBe(403);
    expect(mocks.db.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/sessions/[id]", () => {
  it("revokes one of the caller's own sessions", async () => {
    mocks.db.session.deleteMany.mockResolvedValue({ count: 1 });

    const res = await revokeOne(jsonRequest("/api/me/sessions/phone", "DELETE"), routeCtx({ id: "phone" }));

    expect(res.status).toBe(200);
    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({ where: { id: "phone", userId: "maya" } });
  });

  it("will not revoke the session in use", async () => {
    const res = await revokeOne(jsonRequest("/api/me/sessions/current", "DELETE"), routeCtx({ id: "current" }));

    expect(res.status).toBe(400);
    expect(mocks.db.session.deleteMany).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's session id instead of deleting it", async () => {
    mocks.db.session.deleteMany.mockResolvedValue({ count: 0 });

    const res = await revokeOne(jsonRequest("/api/me/sessions/theirs", "DELETE"), routeCtx({ id: "theirs" }));

    expect(res.status).toBe(404);
    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({ where: { id: "theirs", userId: "maya" } });
  });
});

describe("kiosk device admin", () => {
  it.each([Role.STUDENT, Role.STAFF])("keeps the device list admin-only (%s gets 403)", async (role) => {
    mocks.requireAuth.mockResolvedValue(authUser(role));

    const res = await listKiosks(jsonRequest("/api/kiosk-devices", "GET"), noParams);

    expect(res.status).toBe(403);
    expect(mocks.db.kioskDevice.findMany).not.toHaveBeenCalled();
  });

  it("lists devices with per-location counts and never exposes session tokens or activation hashes", async () => {
    mocks.requireAuth.mockResolvedValue(admin);
    mocks.db.kioskDevice.findMany.mockResolvedValue([{
      id: "k1",
      name: "Camp Randall iPad",
      locationId: "cr",
      location: { id: "cr", name: "Camp Randall" },
      active: true,
      activatedAt: new Date("2026-09-01T15:00:00Z"),
      lastSeenAt: null,
      appVersion: "1.4.1",
      appBuild: "37",
      osVersion: "18.1",
      deviceModel: "iPad",
      createdAt: new Date("2026-08-01T15:00:00Z"),
      sessionToken: "secret-session",
      activationCode: "hash:123456",
    }]);
    mocks.db.booking.groupBy
      .mockResolvedValueOnce([{ locationId: "cr", status: "OPEN", _count: { id: 4 } }])
      .mockResolvedValueOnce([{ locationId: "cr", _count: { id: 2 } }]);
    mocks.db.booking.findMany.mockResolvedValue([{
      id: "b1",
      title: "Volleyball shoot",
      locationId: "cr",
      startsAt: new Date("2026-10-24T22:00:00Z"),
      endsAt: new Date("2026-10-25T02:00:00Z"),
      requester: { name: "Maya" },
    }]);

    const res = await listKiosks(jsonRequest("/api/kiosk-devices", "GET"), noParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      id: "k1",
      activated: true,
      openCheckoutCount: 4,
      pendingPickupCount: 2,
      pendingPickups: [{ id: "b1", requesterName: "Maya" }],
    });
    expect(JSON.stringify(body)).not.toContain("secret-session");
    expect(JSON.stringify(body)).not.toContain("hash:123456");
  });

  it("creates a device, stores only the hashed activation code and returns the raw code once", async () => {
    mocks.requireAuth.mockResolvedValue(admin);
    mocks.db.location.findUnique.mockResolvedValue({ id: "cr", name: "Camp Randall" });
    mocks.db.kioskDevice.create.mockImplementation(async ({ data }: { data: { name: string; locationId: string } }) => ({ id: "k2", ...data }));

    const res = await createKiosk(jsonRequest("/api/kiosk-devices", "POST", { name: "Field House iPad", locationId: "cr" }), noParams);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.activationCode).toMatch(/^\d{6}$/);
    const stored = mocks.db.kioskDevice.create.mock.calls[0]![0].data;
    expect(stored.activationCode).toBe(`hash:${body.activationCode}`);
    expect(stored.activationCodeExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "kiosk_device", action: "create", entityId: "k2" }));
    expect(JSON.stringify(mocks.audit.mock.calls[0]![0])).not.toContain(body.activationCode);
  });

  it("refuses an unknown location", async () => {
    mocks.requireAuth.mockResolvedValue(admin);
    mocks.db.location.findUnique.mockResolvedValue(null);

    const res = await createKiosk(jsonRequest("/api/kiosk-devices", "POST", { name: "Ghost", locationId: "nowhere" }), noParams);

    expect(res.status).toBe(404);
    expect(mocks.db.kioskDevice.create).not.toHaveBeenCalled();
  });

  it("keeps device creation admin-only", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));

    const res = await createKiosk(jsonRequest("/api/kiosk-devices", "POST", { name: "x", locationId: "cr" }), noParams);

    expect(res.status).toBe(403);
    expect(mocks.db.kioskDevice.create).not.toHaveBeenCalled();
  });

  it("regenerating a code signs the old kiosk session out and clears its heartbeat", async () => {
    mocks.requireAuth.mockResolvedValue(admin);
    mocks.db.kioskDevice.findUnique.mockResolvedValue({
      id: "k1",
      name: "Camp Randall iPad",
      activatedAt: new Date("2026-09-01T15:00:00Z"),
      sessionToken: "old-session",
    });

    const res = await regenerateCode(jsonRequest("/api/kiosk-devices/k1/regenerate-code", "POST"), routeCtx({ id: "k1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "k1", resetSession: true });
    expect(mocks.db.kioskDevice.update).toHaveBeenCalledWith({
      where: { id: "k1" },
      data: expect.objectContaining({
        activationCode: `hash:${body.activationCode}`,
        activatedAt: null,
        sessionToken: null,
        sessionExpiresAt: null,
      }),
    });
    expect(mocks.forgetHeartbeat).toHaveBeenCalledWith("old-session");
    expect(mocks.clearBeat).toHaveBeenCalledWith("k1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "regenerate_activation_code" }));
  });

  it("answers 404 when regenerating a code for a missing device", async () => {
    mocks.requireAuth.mockResolvedValue(admin);
    mocks.db.kioskDevice.findUnique.mockResolvedValue(null);

    const res = await regenerateCode(jsonRequest("/api/kiosk-devices/gone/regenerate-code", "POST"), routeCtx({ id: "gone" }));

    expect(res.status).toBe(404);
    expect(mocks.db.kioskDevice.update).not.toHaveBeenCalled();
  });
});
