import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  publication: vi.fn(),
  callTimeApplies: vi.fn(),
  db: {
    shiftGroup: { count: vi.fn(), findMany: vi.fn() },
    shiftTrade: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@/lib/services/schedule-publication", () => ({ getSchedulePublicationState: mocks.publication }));
vi.mock("@/lib/shift-call-windows", () => ({ studentCallTimeAppliesToEvent: mocks.callTimeApplies }));

import { GET } from "@/app/api/shift-groups/route";

const callStartsAt = new Date("2026-10-31T16:00:00.000Z");
const callEndsAt = new Date("2026-10-31T22:00:00.000Z");
const autoReleaseAt = new Date("2026-10-30T14:00:00.000Z");

function group(extra: Record<string, unknown> = {}) {
  return {
    id: "g1",
    event: { id: "e1", allDay: false, startsAt: new Date("2026-10-31T17:00:00.000Z"), endsAt: new Date("2026-10-31T21:00:00.000Z") },
    workingCopy: null,
    shifts: [
      {
        id: "s-st", workerType: "ST", callStartsAt, callEndsAt,
        assignments: [{ id: "a1", userId: "ada", callStartsAt, callEndsAt, callNote: "Bring the gimbal" }],
      },
      { id: "s-ft", workerType: "FT", callStartsAt, callEndsAt, assignments: [] },
    ],
    ...extra,
  };
}

const list = (query = "") => GET(new Request(`https://app.example.com/api/shift-groups${query}`), routeCtx({}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
  mocks.publication.mockReturnValue({ status: "published", changedAfterPublish: false });
  mocks.callTimeApplies.mockReturnValue(true);
  mocks.db.shiftGroup.count.mockResolvedValue(1);
  mocks.db.shiftGroup.findMany.mockResolvedValue([group()]);
  mocks.db.shiftTrade.findMany.mockResolvedValue([{ id: "t1", status: "OPEN", shiftAssignmentId: "a1" }]);
  mocks.db.shiftAssignment.findMany.mockResolvedValue([{ id: "r1", shiftId: "s-ft", status: "REQUESTED", hasConflict: true, conflictNote: "Class" }]);
});

describe("GET /api/shift-groups", () => {
  it("filters by event, sport and an overlapping date window, capping the page at 200", async () => {
    await list("?eventId=e1&sportCode=FB&startDate=2026-10-01T05:00:00.000Z&endDate=2026-11-01T05:00:00.000Z&limit=900&offset=10");

    expect(mocks.db.shiftGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        eventId: "e1",
        event: { sportCode: "FB", startsAt: { lte: new Date("2026-11-01T05:00:00.000Z") }, endsAt: { gt: new Date("2026-10-01T05:00:00.000Z") } },
      },
      take: 200,
      skip: 10,
    }));
  });

  it("uses a one-sided window when only one date is given", async () => {
    await list("?startDate=2026-10-01T05:00:00.000Z");
    expect(mocks.db.shiftGroup.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { event: { endsAt: { gt: new Date("2026-10-01T05:00:00.000Z") } } } }));

    await list("?endDate=2026-11-01T05:00:00.000Z");
    expect(mocks.db.shiftGroup.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { event: { startsAt: { lte: new Date("2026-11-01T05:00:00.000Z") } } } }));

    await list();
    expect(mocks.db.shiftGroup.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it("adds coverage, board trades and only the viewer's own pending requests", async () => {
    const { data, total } = await (await list()).json();

    expect(total).toBe(1);
    expect(mocks.db.shiftAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shiftId: { in: ["s-st", "s-ft"] }, userId: "staff-1", status: "REQUESTED" } }));
    expect(data[0].coverage).toEqual({ total: 2, filled: 1, percentage: 50 });
    expect(data[0].shifts[0].assignments[0].activeTrade).toEqual({ id: "t1", status: "OPEN" });
    expect(data[0].shifts[1].viewerRequest).toEqual({ id: "r1", status: "REQUESTED", hasConflict: true, conflictNote: "Class" });
    expect(data[0].shifts[0].viewerRequest).toBeNull();
  });

  it("skips the trade and request lookups when there is nothing to look up", async () => {
    mocks.db.shiftGroup.findMany.mockResolvedValue([group({ shifts: [] })]);

    const { data } = await (await list()).json();

    expect(mocks.db.shiftTrade.findMany).not.toHaveBeenCalled();
    expect(mocks.db.shiftAssignment.findMany).not.toHaveBeenCalled();
    expect(data[0].coverage).toEqual({ total: 0, filled: 0, percentage: 0 });
  });

  it("shows staff the unreleased draft and its auto-release time", async () => {
    mocks.db.shiftGroup.findMany.mockResolvedValue([group({ workingCopy: { version: 7, autoReleaseAt, autoReleaseError: null } })]);

    const [row] = (await (await list()).json()).data;

    expect(row.publication).toEqual({ status: "changed", changedAfterPublish: true, workingVersion: 7 });
    expect(row).toEqual(expect.objectContaining({ hasWorkingCopy: true, claimsPaused: true, autoReleaseAt: autoReleaseAt.toISOString(), autoReleaseError: null }));
    expect(row).not.toHaveProperty("workingCopy");
  });

  it("tells a student only that claims are paused", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    mocks.db.shiftGroup.findMany.mockResolvedValue([group({ workingCopy: { version: 7, autoReleaseAt, autoReleaseError: "boom" } })]);

    const [row] = (await (await list()).json()).data;

    expect(row.publication).toEqual({ status: "published", changedAfterPublish: false });
    expect(row.claimsPaused).toBe(true);
    expect(row).not.toHaveProperty("hasWorkingCopy");
    expect(row).not.toHaveProperty("autoReleaseAt");
    expect(row).not.toHaveProperty("autoReleaseError");
  });

  it("shows students call times only on Student slots of events that use them", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));

    let [row] = (await (await list()).json()).data;
    expect(row.shifts[0]).toEqual(expect.objectContaining({ callStartsAt: callStartsAt.toISOString(), callEndsAt: callEndsAt.toISOString() }));
    expect(row.shifts[0].assignments[0].callNote).toBe("Bring the gimbal");
    expect(row.shifts[1]).toEqual(expect.objectContaining({ callStartsAt: null, callEndsAt: null }));

    mocks.callTimeApplies.mockReturnValue(false);
    [row] = (await (await list()).json()).data;
    expect(row.shifts[0]).toEqual(expect.objectContaining({ callStartsAt: null, callEndsAt: null }));
    expect(row.shifts[0].assignments[0]).toEqual(expect.objectContaining({ callStartsAt: null, callEndsAt: null, callNote: null }));

    mocks.callTimeApplies.mockReturnValue(true);
    mocks.db.shiftGroup.findMany.mockResolvedValue([group({ event: { ...group().event, allDay: true } })]);
    [row] = (await (await list()).json()).data;
    expect(row.shifts[0].callStartsAt).toBeNull();
  });

  it("keeps call times for staff even when students would not see them", async () => {
    mocks.callTimeApplies.mockReturnValue(false);

    const [row] = (await (await list()).json()).data;

    expect(row.shifts[0].callStartsAt).toBe(callStartsAt.toISOString());
    expect(mocks.callTimeApplies).not.toHaveBeenCalled();
  });
});
