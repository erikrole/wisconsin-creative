import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser, CUID_A, CUID_B } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimit: vi.fn(),
  audit: vi.fn(),
  createAndSend: vi.fn(),
  resolveTargets: vi.fn(),
  db: { blast: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit, SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 } }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/services/blasts", () => ({ createAndSendBlast: mocks.createAndSend }));
vi.mock("@/lib/services/blast-targeting", () => ({ resolveBlastTargets: mocks.resolveTargets }));

import { GET, POST } from "@/app/api/blasts/route";
import { GET as GET_ONE } from "@/app/api/blasts/[id]/route";

const staff = authUser(Role.STAFF);
const list = (query = "") => GET(jsonRequest(`/api/blasts${query}`, "GET"), routeCtx({}));
const send = (body: unknown) => POST(jsonRequest("/api/blasts", "POST", body), routeCtx({}));
const one = (id = CUID_A) => GET_ONE(jsonRequest(`/api/blasts/${id}`, "GET"), routeCtx({ id }));

const sentBlast = {
  id: CUID_A,
  title: "Call time moved",
  body: "Be at Camp Randall by 9.",
  severity: "URGENT",
  status: "SENT",
  targetKind: "EVENT_CREW",
  targetSpec: { kind: "EVENT_CREW", eventId: CUID_B },
  targetSummary: "Football vs. Iowa crew",
  eventId: CUID_B,
  requiresAck: true,
  expiresAt: null,
  recipientCount: 2,
  sentAt: new Date("2026-10-31T14:00:00.000Z"),
  cancelledAt: null,
  createdAt: new Date("2026-10-31T14:00:00.000Z"),
  createdBy: { id: staff.id, name: "Staff" },
  cancelledBy: null,
  event: { id: CUID_B, summary: "Football vs. Iowa", startsAt: new Date("2026-11-01T16:00:00.000Z") },
  recipients: [
    { userId: "u1", pushStatus: "SENT", acknowledgedAt: null, user: { id: "u1", name: "Avery" } },
    { userId: "u2", pushStatus: "SENT", acknowledgedAt: new Date(), user: { id: "u2", name: "Blake" } },
  ],
};

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.db.blast.findMany.mockResolvedValue([]);
  mocks.db.blast.count.mockResolvedValue(0);
  mocks.db.blast.findUnique.mockResolvedValue(sentBlast);
  mocks.createAndSend.mockResolvedValue({ id: CUID_A, targetSummary: "Football vs. Iowa crew", recipientCount: 2 });
  mocks.resolveTargets.mockResolvedValue({ users: [{ id: "u1", name: "Avery" }, { id: "u2", name: "Blake" }] });
});

describe("GET /api/blasts", () => {
  it("pages newest-sent first and folds the acknowledged count into each row", async () => {
    mocks.db.blast.findMany.mockResolvedValue([{ id: CUID_A, title: "Call time moved", _count: { recipients: 1 } }]);
    mocks.db.blast.count.mockResolvedValue(7);

    const res = await list("?limit=5&offset=5");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 7, limit: 5, offset: 5 });
    expect(body.data).toEqual([{ id: CUID_A, title: "Call time moved", acknowledgedCount: 1 }]);
    const query = mocks.db.blast.findMany.mock.calls[0]![0];
    expect(query).toMatchObject({ take: 5, skip: 5, orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }] });
    expect(query.select._count.select.recipients.where).toEqual({ acknowledgedAt: { not: null } });
  });

  it("students cannot see the blast log", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));

    expect((await list()).status).toBe(403);
    expect(mocks.db.blast.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/blasts", () => {
  const valid = { title: "Call time moved", body: "Be at Camp Randall by 9.", severity: "URGENT", target: { kind: "EVENT_CREW", eventId: CUID_B } };

  it("sends to the resolved crew and audits the send with the reach", async () => {
    const res = await send({ ...valid, expiresAt: "2026-11-01T18:00:00.000Z" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ id: CUID_A, recipientCount: 2 });
    expect(mocks.createAndSend).toHaveBeenCalledWith({
      title: "Call time moved",
      body: "Be at Camp Randall by 9.",
      severity: "URGENT",
      requiresAck: true,
      expiresAt: new Date("2026-11-01T18:00:00.000Z"),
      spec: { kind: "EVENT_CREW", eventId: CUID_B },
    }, staff);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "blast", entityId: CUID_A, action: "sent",
      after: { title: "Call time moved", severity: "URGENT", targetKind: "EVENT_CREW", targetSummary: "Football vs. Iowa crew", recipientCount: 2 },
    }));
  });

  it("defaults to an informational blast that needs acknowledgement and never expires", async () => {
    await send({ title: "Fridge clean-out", body: "Friday.", target: { kind: "USERS", userIds: [CUID_B] } });

    expect(mocks.createAndSend).toHaveBeenCalledWith(expect.objectContaining({ severity: "INFO", requiresAck: true, expiresAt: null }), staff);
  });

  it.each([
    ["an empty body", { ...valid, body: " " }],
    ["a dynamic target with nothing selected", { ...valid, target: { kind: "DYNAMIC" } }],
    ["no recipients", { ...valid, target: { kind: "USERS", userIds: [] } }],
    ["a bad expiry", { ...valid, expiresAt: "tomorrow" }],
  ])("rejects %s before sending anything", async (_label, body) => {
    const res = await send(body);

    expect(res.status).toBe(400);
    expect(mocks.createAndSend).not.toHaveBeenCalled();
  });

  it("is staff and admin only, and rate-limited per sender", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.COLLABORATOR));
    expect((await send(valid)).status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(staff);
    await send(valid);
    expect(mocks.rateLimit).toHaveBeenCalledWith(`blasts:create:${staff.id}`, { max: 60, windowMs: 60_000 });
  });
});

describe("GET /api/blasts/[id]", () => {
  it("returns the blast with recipients and who joined the crew since the send, hiding the raw target spec", async () => {
    mocks.resolveTargets.mockResolvedValue({ users: [{ id: "u1", name: "Avery" }, { id: "u3", name: "Casey" }] });

    const res = await one();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty("targetSpec");
    expect(body.data.recipients).toHaveLength(2);
    expect(body.data.addedSinceSend).toEqual([{ id: "u3", name: "Casey" }]);
    expect(mocks.resolveTargets).toHaveBeenCalledWith({ kind: "EVENT_CREW", eventId: CUID_B });
    const query = mocks.db.blast.findUnique.mock.calls[0]![0];
    expect(query.select.recipients.orderBy[0]).toEqual({ acknowledgedAt: "asc" });
  });

  it("does not compute drift for a cancelled blast", async () => {
    mocks.db.blast.findUnique.mockResolvedValue({ ...sentBlast, status: "CANCELLED" });

    const body = await (await one()).json();

    expect(body.data.addedSinceSend).toEqual([]);
    expect(mocks.resolveTargets).not.toHaveBeenCalled();
  });

  it("still serves the tracking page when the event behind the target is gone", async () => {
    mocks.resolveTargets.mockRejectedValue(new Error("Event not found"));

    const res = await one();

    expect(res.status).toBe(200);
    expect((await res.json()).data.addedSinceSend).toEqual([]);
  });

  it("404s an unknown blast and refuses students", async () => {
    mocks.db.blast.findUnique.mockResolvedValue(null);
    expect((await one()).status).toBe(404);

    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    expect((await one()).status).toBe(403);
  });
});
