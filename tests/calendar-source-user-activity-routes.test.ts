import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, CUID_A, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => {
  const tx = { booking: { updateMany: vi.fn() }, calendarSource: { delete: vi.fn() } };
  return {
    tx,
    requireAuth: vi.fn(),
    audit: vi.fn(),
    enforceRateLimit: vi.fn(),
    db: {
      calendarSource: { findUnique: vi.fn(), update: vi.fn() },
      user: { findUnique: vi.fn() },
      auditLog: { findFirst: vi.fn(), findMany: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
  };
});

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { DELETE as deleteSource, PATCH as patchSource } from "@/app/api/calendar-sources/[id]/route";
import { GET as activity } from "@/app/api/users/[id]/activity/route";

const staff = authUser(Role.STAFF);
const student = authUser(Role.STUDENT);
const ctx = routeCtx({ id: CUID_A });
const source = { id: CUID_A, name: "Football", url: "https://uwbadgers.com/calendar.ics", enabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.db.calendarSource.findUnique.mockResolvedValue(source);
});

describe("PATCH /api/calendar-sources/[id]", () => {
  it("updates only the sent fields and audits before and after", async () => {
    mocks.db.calendarSource.update.mockResolvedValue({ ...source, enabled: false, _count: { events: 4 } });

    const res = await patchSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "PATCH", { enabled: false }), ctx);

    expect(res.status).toBe(200);
    expect(mocks.db.calendarSource.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CUID_A }, data: { enabled: false } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "updated",
      before: { name: "Football", url: source.url, enabled: true },
      after: { enabled: false },
    }));
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`calendar-sources:write:${staff.id}`, expect.anything());
  });

  it("refuses an empty change, a bad URL and an unknown source", async () => {
    expect((await patchSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "PATCH", {}), ctx)).status).toBe(400);
    expect((await patchSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "PATCH", { url: "not a url" }), ctx)).status).toBe(400);

    mocks.db.calendarSource.findUnique.mockResolvedValue(null);
    expect((await patchSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "PATCH", { enabled: false }), ctx)).status).toBe(404);
    expect(mocks.db.calendarSource.update).not.toHaveBeenCalled();
  });

  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    expect((await patchSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "PATCH", { enabled: false }), ctx)).status).toBe(403);
    expect((await deleteSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "DELETE"), ctx)).status).toBe(403);
  });
});

describe("DELETE /api/calendar-sources/[id]", () => {
  it("unlinks bookings from the source's events before deleting it", async () => {
    const res = await deleteSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "DELETE"), ctx);

    expect(res.status).toBe(200);
    expect(mocks.tx.booking.updateMany).toHaveBeenCalledWith({ where: { event: { sourceId: CUID_A } }, data: { eventId: null } });
    expect(mocks.tx.calendarSource.delete).toHaveBeenCalledWith({ where: { id: CUID_A } });
    expect(mocks.tx.booking.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.calendarSource.delete.mock.invocationCallOrder[0]!);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", before: { name: "Football" } }));
  });

  it("returns 404 for an unknown source", async () => {
    mocks.db.calendarSource.findUnique.mockResolvedValue(null);

    expect((await deleteSource(jsonRequest(`/api/calendar-sources/${CUID_A}`, "DELETE"), ctx)).status).toBe(404);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/[id]/activity", () => {
  const get = (query = "", id = CUID_A) => activity(new Request(`https://app.example.com/api/users/${id}/activity${query}`), routeCtx({ id }));
  const logs = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `log-${index}` }));

  beforeEach(() => {
    mocks.db.user.findUnique.mockResolvedValue({ id: CUID_A });
    mocks.db.auditLog.findMany.mockResolvedValue(logs(3));
  });

  it("lets a student read only their own activity", async () => {
    mocks.requireAuth.mockResolvedValue(student);
    expect((await get()).status).toBe(403);

    mocks.db.user.findUnique.mockResolvedValue({ id: student.id });
    expect((await get("", student.id)).status).toBe(200);
  });

  it("returns 404 for an unknown person", async () => {
    mocks.db.user.findUnique.mockResolvedValue(null);

    expect((await get()).status).toBe(404);
  });

  it("pages with one extra row and returns the next cursor", async () => {
    const res = await get("?limit=2");

    expect(mocks.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ entityType: "user", entityId: CUID_A }, { actorUserId: CUID_A }] },
      take: 3,
    }));
    expect(await res.json()).toEqual({ data: logs(2), nextCursor: "log-1" });
  });

  it("returns no cursor on the last page and clamps the limit", async () => {
    expect(await (await get("?limit=5")).json()).toEqual({ data: logs(3), nextCursor: null });

    await get("?limit=500");
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 101 }));
    await get("?limit=0");
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 51 }));
    await get("?limit=-4");
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2 }));
  });

  it("continues after a cursor only when it belongs to this person", async () => {
    mocks.db.auditLog.findFirst.mockResolvedValueOnce({ id: "log-9" });
    await get("?cursor=log-9");
    expect(mocks.db.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "log-9", OR: expect.any(Array) }) }));
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { id: "log-9" }, skip: 1 }));

    mocks.db.auditLog.findFirst.mockResolvedValueOnce(null);
    expect((await get("?cursor=someone-else")).status).toBe(400);
  });
});
