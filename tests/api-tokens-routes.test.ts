import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimit: vi.fn(),
  audit: vi.fn(),
  db: {
    apiToken: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAuth: mocks.requireAuth,
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));

import { tokenHash } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { GET, POST } from "@/app/api/me/api-tokens/route";
import { DELETE } from "@/app/api/me/api-tokens/[id]/route";

const staff = authUser(Role.STAFF);
const noParams = routeCtx({});
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.db.apiToken.findMany.mockResolvedValue([]);
  mocks.db.apiToken.deleteMany.mockResolvedValue({ count: 0 });
  mocks.db.apiToken.count.mockResolvedValue(0);
  mocks.db.apiToken.create.mockImplementation(async ({ data }: { data: { name: string; scope: string; expiresAt: Date } }) => ({
    id: "tok-1", name: data.name, scope: data.scope, expiresAt: data.expiresAt,
  }));
});

describe("GET /api/me/api-tokens", () => {
  it("lists only the caller's unexpired tokens and never selects the hash", async () => {
    mocks.db.apiToken.findMany.mockResolvedValue([{ id: "tok-1", name: "Laptop", scope: "READ" }]);

    const res = await GET(jsonRequest("/api/me/api-tokens", "GET"), noParams);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: "tok-1", name: "Laptop", scope: "READ" }]);
    const query = mocks.db.apiToken.findMany.mock.calls[0]![0];
    expect(query.where.userId).toBe(staff.id);
    expect(query.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(query.select).not.toHaveProperty("tokenHash");
  });

  it("is staff and admin only", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));

    const res = await GET(jsonRequest("/api/me/api-tokens", "GET"), noParams);

    expect(res.status).toBe(403);
    expect(mocks.db.apiToken.findMany).not.toHaveBeenCalled();
  });

  it("cannot be read with an API token, only a signed-in session", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, apiTokenScope: "WRITE" });

    const res = await GET(jsonRequest("/api/me/api-tokens", "GET"), noParams);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/signed-in session/);
  });
});

describe("POST /api/me/api-tokens", () => {
  const create = (body: unknown) => POST(jsonRequest("/api/me/api-tokens", "POST", body), noParams);

  it("mints a wc_ secret, stores only its hash, audits, and returns the secret once", async () => {
    const before = Date.now();
    const res = await create({ name: "  Laptop  ", scope: "WRITE", days: 30 });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.secret).toMatch(/^wc_[0-9a-f]{64}$/);
    expect(body.data).toMatchObject({ id: "tok-1", name: "Laptop", scope: "WRITE" });
    const stored = mocks.db.apiToken.create.mock.calls[0]![0].data;
    expect(stored.tokenHash).toBe(await tokenHash(body.data.secret));
    expect(stored.tokenHash).not.toContain(body.data.secret);
    expect(stored.userId).toBe(staff.id);
    const ttl = stored.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(30 * DAY - 1000);
    expect(ttl).toBeLessThanOrEqual(30 * DAY + 5000);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "api_token_created",
      entityType: "api_token",
      entityId: "tok-1",
      after: { name: "Laptop", scope: "WRITE", expiresAt: stored.expiresAt },
    }));
    expect(JSON.stringify(mocks.audit.mock.calls[0])).not.toContain(body.data.secret);
  });

  it("defaults to 90 days and sweeps the caller's expired tokens first", async () => {
    const before = Date.now();
    await create({ name: "CLI", scope: "READ" });

    const stored = mocks.db.apiToken.create.mock.calls[0]![0].data;
    expect(stored.expiresAt.getTime() - before).toBeGreaterThanOrEqual(90 * DAY - 1000);
    const sweep = mocks.db.apiToken.deleteMany.mock.calls[0]![0];
    expect(sweep.where.userId).toBe(staff.id);
    expect(sweep.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(mocks.db.apiToken.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.db.apiToken.count.mock.invocationCallOrder[0]!);
  });

  it("caps a person at ten active tokens", async () => {
    mocks.db.apiToken.count.mockResolvedValue(10);

    const res = await create({ name: "Eleventh", scope: "READ" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/10 active tokens/);
    expect(mocks.db.apiToken.create).not.toHaveBeenCalled();
  });

  it.each([
    ["empty name", { name: "   ", scope: "READ" }],
    ["unknown scope", { name: "CLI", scope: "ADMIN" }],
    ["more than a year", { name: "CLI", scope: "READ", days: 366 }],
    ["zero days", { name: "CLI", scope: "READ", days: 0 }],
  ])("rejects %s", async (_label, body) => {
    const res = await create(body);

    expect(res.status).toBe(400);
    expect(mocks.db.apiToken.create).not.toHaveBeenCalled();
  });

  it("rate-limits creation per user before reading the body", async () => {
    mocks.rateLimit.mockRejectedValue(new HttpError(429, "Too many requests. Try again in 30s."));

    const res = await create({ name: "CLI", scope: "READ" });

    expect(res.status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledWith(`api-token:create:${staff.id}`, { max: 10, windowMs: 60_000 });
    expect(mocks.db.apiToken.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses students and refuses a token minting another token", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    expect((await create({ name: "CLI", scope: "READ" })).status).toBe(403);

    mocks.requireAuth.mockResolvedValue({ ...staff, apiTokenScope: "WRITE" });
    const req = jsonRequest("/api/me/api-tokens", "POST", { name: "CLI", scope: "READ" });
    req.headers.set("authorization", "Bearer wc_" + "a".repeat(64));
    expect((await POST(req, noParams)).status).toBe(403);
    expect(mocks.db.apiToken.create).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/api-tokens/[id]", () => {
  const revoke = (id = "tok-1") => DELETE(jsonRequest(`/api/me/api-tokens/${id}`, "DELETE"), routeCtx({ id }));

  it("revokes only a token the caller owns and audits it", async () => {
    mocks.db.apiToken.deleteMany.mockResolvedValue({ count: 1 });

    const res = await revoke();

    expect(res.status).toBe(200);
    expect(mocks.db.apiToken.deleteMany).toHaveBeenCalledWith({ where: { id: "tok-1", userId: staff.id } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "api_token_revoked", entityId: "tok-1", actorId: staff.id }));
  });

  it("404s on someone else's token without writing an audit row", async () => {
    const res = await revoke("not-mine");

    expect(res.status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("is staff and admin only", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.COLLABORATOR));

    expect((await revoke()).status).toBe(403);
    expect(mocks.db.apiToken.deleteMany).not.toHaveBeenCalled();
  });
});
