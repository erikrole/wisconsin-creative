import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  eventFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  pickupOpenShift: vi.fn(),
  createAuditEntry: vi.fn(),
  deferPush: vi.fn(),
  enforceRateLimit: vi.fn(),
  transaction: vi.fn(),
  committed: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    calendarEvent: { findUnique: mocks.eventFindUnique },
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (req: Request, ctx: unknown) => Promise<Response>) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
      try {
        return await handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1", locationId: "loc-1" } });
      } catch (error) {
        const { HttpError } = await import("@/lib/http");
        if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
        throw error;
      }
    },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: (_tx: unknown, entry: unknown) => mocks.createAuditEntry(entry) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit, getClientIp: () => "1.1.1.1" }));
vi.mock("@/lib/services/schedule-open-work", () => ({
  pickupOpenShiftTx: (_tx: unknown, shiftId: string, userId: string) => mocks.pickupOpenShift(shiftId, userId),
}));
vi.mock("@/lib/services/notifications", () => ({
  deferPush: mocks.deferPush,
  dispatchScheduleAssignmentNotifications: vi.fn(async () => undefined),
  notifyPickupRequestReviewers: vi.fn(async () => undefined),
}));
vi.mock("@/lib/claim-review-workflow", () => ({ enqueuePendingClaimReview: vi.fn(async () => undefined) }));

import { POST } from "@/app/api/kiosk/events/[id]/crew-request/route";

const run = POST as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function request(body: unknown) {
  return run(
    new Request("http://test", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "event-1" }) },
  );
}

function event(shifts: Array<{ id: string; area: string; workerType: string; assignments?: Array<{ id: string; userId: string; status: string }> }>) {
  return {
    id: "event-1",
    summary: "Football vs Iowa",
    shiftGroup: { shifts: shifts.map((shift) => ({ assignments: [], ...shift })) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.committed = [];
  // One transaction: the claim and its audit commit together or not at all.
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>, options: unknown) => {
    const result = await fn({});
    mocks.committed.push(JSON.stringify(options));
    return result;
  });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.userFindFirst.mockResolvedValue({ id: "student-1", role: "STUDENT" });
  mocks.userFindUnique.mockResolvedValue({ role: "STUDENT", staffingType: "ST" });
  mocks.pickupOpenShift.mockResolvedValue({
    id: "assignment-1",
    status: "REQUESTED",
    hasConflict: false,
    conflictNote: null,
    callStartsAt: null,
    shift: { callStartsAt: null, startsAt: new Date("2026-10-06T18:00:00Z") },
  });
});

describe("POST /api/kiosk/events/[id]/crew-request", () => {
  it("files a pending REQUESTED claim on an open slot in the chosen area", async () => {
    mocks.eventFindUnique.mockResolvedValue(event([
      { id: "shift-ft", area: "VIDEO", workerType: "FT" },
      { id: "shift-taken", area: "VIDEO", workerType: "ST", assignments: [{ id: "a", userId: "other", status: "APPROVED" }] },
      { id: "shift-open", area: "VIDEO", workerType: "ST" },
    ]));

    const res = await request({ actorId: "student-1", area: "VIDEO" });

    expect(res.status).toBe(201);
    expect(mocks.pickupOpenShift).toHaveBeenCalledWith("shift-open", "student-1");
    expect((await res.json()).data).toMatchObject({ status: "requested", assignmentId: "assignment-1" });
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "student-1",
      action: "kiosk_crew_requested",
    }));
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.committed).toEqual([JSON.stringify({ isolationLevel: "Serializable" })]);
  });

  it("does not record an audit when the claim fails inside the transaction", async () => {
    mocks.eventFindUnique.mockResolvedValue(event([{ id: "shift-1", area: "VIDEO", workerType: "ST" }]));
    mocks.pickupOpenShift.mockRejectedValue(new Error("boom"));

    await expect(request({ actorId: "student-1", area: "VIDEO" })).rejects.toThrow("boom");
    expect(mocks.createAuditEntry).not.toHaveBeenCalled();
    expect(mocks.committed).toEqual([]);
  });

  it("refuses a collaborator with the kiosk's wording, like the schedule pickup (D-053)", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "collab-1", role: "COLLABORATOR" });

    const res = await request({ actorId: "collab-1", area: "VIDEO" });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Ask staff to add you/);
    expect(mocks.eventFindUnique).not.toHaveBeenCalled();
    expect(mocks.pickupOpenShift).not.toHaveBeenCalled();
  });

  it("is idempotent when the person already requested or holds a slot", async () => {
    mocks.eventFindUnique.mockResolvedValue(event([
      { id: "shift-1", area: "PHOTO", workerType: "ST", assignments: [{ id: "req-1", userId: "student-1", status: "REQUESTED" }] },
    ]));

    const res = await request({ actorId: "student-1", area: "VIDEO" });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: "already_requested", assignmentId: "req-1" });
    expect(mocks.pickupOpenShift).not.toHaveBeenCalled();
  });

  it("returns a friendly conflict when the area has no open slot", async () => {
    mocks.eventFindUnique.mockResolvedValue(event([
      { id: "shift-1", area: "VIDEO", workerType: "ST", assignments: [{ id: "a", userId: "other", status: "DIRECT_ASSIGNED" }] },
    ]));

    const res = await request({ actorId: "student-1", area: "VIDEO" });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/No open Video spot/);
  });

  it("maps a unique-constraint race to a friendly conflict", async () => {
    mocks.eventFindUnique.mockResolvedValue(event([{ id: "shift-1", area: "VIDEO", workerType: "ST" }]));
    mocks.pickupOpenShift.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));

    const res = await request({ actorId: "student-1", area: "VIDEO" });

    expect(res.status).toBe(409);
    expect(mocks.createAuditEntry).not.toHaveBeenCalled();
  });

  it("rejects an actor the kiosk roster would not offer", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    const res = await request({ actorId: "ghost", area: "VIDEO" });

    expect(res.status).toBe(404);
    expect(mocks.eventFindUnique).not.toHaveBeenCalled();
  });
});
