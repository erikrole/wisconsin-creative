import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    shiftGroup: { findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
  },
  requireAuth: vi.fn(),
  history: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/services/schedule-change-history", () => ({ getScheduleChangeHistory: mocks.history }));

import { GET } from "@/app/api/calendar-events/[id]/command-center/route";

const staff = { id: "staff-1", role: "STAFF" as const, email: "staff@example.com", name: "Staff" };
const startsAt = new Date("2026-10-31T17:00:00.000Z");
const endsAt = new Date("2026-10-31T21:00:00.000Z");

type Booking = {
  id: string;
  kind: string;
  status: string;
  title: string;
  requesterUserId: string;
  shiftAssignmentId: string | null;
  requester: { id: string; name: string };
  serializedItems: Array<{ allocationStatus: string }>;
  bulkItems: Array<{ plannedQuantity: number; checkedOutQuantity: number }>;
};

function booking(id: string, requester: string, overrides: Partial<Booking> = {}): Booking {
  return {
    id,
    kind: "RESERVATION",
    status: "BOOKED",
    title: `${requester} gear`,
    requesterUserId: requester.toLowerCase(),
    shiftAssignmentId: null,
    requester: { id: requester.toLowerCase(), name: requester },
    serializedItems: [{ allocationStatus: "active" }],
    bulkItems: [],
    ...overrides,
  };
}

function assignment(id: string, userName: string, status = "DIRECT_ASSIGNED", overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: userName.toLowerCase(),
    status,
    user: { id: userName.toLowerCase(), name: userName },
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    crewLabel: null,
    crewHalf: null,
    bookings: [],
    ...overrides,
  };
}

function shift(id: string, area: string, workerType: string, assignments: unknown[], overrides: Record<string, unknown> = {}) {
  return { id, area, workerType, startsAt, endsAt, callStartsAt: null, callEndsAt: null, assignments, ...overrides };
}

async function load() {
  const response = await GET(new Request("https://app.example.com/api/calendar-events/event-1/command-center"), {
    params: Promise.resolve({ id: "event-1" }),
  });
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.history.mockResolvedValue({ events: { "event-1": { items: [{ id: "change-1" }] } } });
  mocks.db.shiftGroup.findUnique.mockResolvedValue(null);
  mocks.db.booking.findMany.mockResolvedValue([]);
});

describe("GET /api/calendar-events/[id]/command-center", () => {
  it.each([
    ["a student", "STUDENT", "Staff or admin access required"],
    ["a collaborator", "COLLABORATOR", "Forbidden"],
  ])("keeps %s out", async (_label, role, message) => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role });

    const { response, body } = await load();

    expect(response.status).toBe(403);
    expect(body.error).toBe(message);
    expect(mocks.db.shiftGroup.findUnique).not.toHaveBeenCalled();
  });

  it("returns an empty board with recent changes when the event has no schedule", async () => {
    const { body } = await load();

    expect(body.data).toEqual({
      shifts: [],
      gearSummary: { total: 0, byStatus: { draft: 0, reserved: 0, pendingPickup: 0, checkedOut: 0, completed: 0 } },
      gearPlans: [],
      missingGear: [],
      recentChanges: [{ id: "change-1" }],
    });
    expect(mocks.history).toHaveBeenCalledWith({ eventIds: ["event-1"], limitPerEvent: 40, includeWorkingCopy: true });
  });

  it("lists each slot with its working assignee, call window and pending requests", async () => {
    mocks.db.shiftGroup.findUnique.mockResolvedValue({
      shifts: [
        shift("s1", "VIDEO", "ST", [
          assignment("a1", "Ada", "APPROVED", {
            callStartsAt: new Date("2026-10-31T16:00:00.000Z"),
            bookings: [{ id: "b-ada", status: "BOOKED" }],
            crewLabel: "A crew",
          }),
          assignment("r1", "Grace", "REQUESTED"),
          assignment("r2", "Linus", "REQUESTED"),
        ], { callEndsAt: new Date("2026-10-31T22:00:00.000Z") }),
        shift("s2", "PHOTO", "FT", [assignment("x1", "Old", "DECLINED")]),
      ],
    });
    mocks.db.booking.findMany.mockResolvedValue([booking("b-ada", "Ada")]);

    const { body } = await load();

    expect(body.data.shifts).toEqual([
      expect.objectContaining({
        id: "s1",
        workerLabel: "Student",
        callStartsAt: startsAt.toISOString(),
        callEndsAt: "2026-10-31T22:00:00.000Z",
        pendingRequests: 2,
        assignment: expect.objectContaining({
          id: "a1",
          userName: "Ada",
          status: "APPROVED",
          callStartsAt: "2026-10-31T16:00:00.000Z",
          callEndsAt: "2026-10-31T22:00:00.000Z",
          crewLabel: "A crew",
          linkedBookingId: "b-ada",
          linkedBookingStatus: "BOOKED",
        }),
      }),
      expect.objectContaining({ id: "s2", workerLabel: "Staff", assignment: null, pendingRequests: 0 }),
    ]);
  });

  it("adds gear linked only through a shift assignment, once", async () => {
    mocks.db.shiftGroup.findUnique.mockResolvedValue({
      shifts: [shift("s1", "VIDEO", "ST", [assignment("a1", "Ada"), assignment("a2", "Grace", "REQUESTED")])],
    });
    mocks.db.booking.findMany
      .mockResolvedValueOnce([booking("b1", "Ada")])
      .mockResolvedValueOnce([booking("b1", "Ada"), booking("b2", "Ada", { status: "OPEN", kind: "CHECKOUT" })]);

    const { body } = await load();

    expect(mocks.db.booking.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { status: { not: "CANCELLED" }, shiftAssignmentId: { in: ["a1"] } },
    }));
    expect(body.data.gearSummary).toEqual({
      total: 2,
      byStatus: { draft: 0, reserved: 1, pendingPickup: 0, checkedOut: 1, completed: 0 },
    });
    expect(body.data.gearPlans).toEqual([expect.objectContaining({ requesterName: "Ada", bookingIds: ["b1", "b2"], state: "checked_out" })]);
  });

  it("names each person's gear state and counts planned items", async () => {
    mocks.db.shiftGroup.findUnique.mockResolvedValue({ shifts: [] });
    mocks.db.booking.findMany.mockResolvedValue([
      booking("b-zed", "Zed", { status: "DRAFT" }),
      booking("b-una", "Una", { status: "COMPLETED" }),
      booking("b-pat", "Pat", { status: "PENDING_PICKUP" }),
      booking("b-ray", "Ray", { serializedItems: [{ allocationStatus: "picked_up" }, { allocationStatus: "active" }] }),
      booking("b-ben", "Ben", { serializedItems: [], bulkItems: [{ plannedQuantity: 4, checkedOutQuantity: 1 }] }),
      booking("b-ann", "Ann", { serializedItems: [{ allocationStatus: "active" }], bulkItems: [{ plannedQuantity: 3, checkedOutQuantity: 0 }] }),
    ]);

    const { body } = await load();

    expect(body.data.gearPlans.map((plan: { requesterName: string; state: string; itemCount: number }) => [plan.requesterName, plan.state, plan.itemCount])).toEqual([
      ["Ann", "reserved", 4],
      ["Ben", "partially_picked_up", 4],
      ["Pat", "ready_for_pickup", 1],
      ["Ray", "partially_picked_up", 2],
      ["Una", "returned", 1],
      ["Zed", "draft", 1],
    ]);
    expect(body.data.gearSummary.byStatus).toEqual({ draft: 1, reserved: 3, pendingPickup: 1, checkedOut: 0, completed: 1 });
  });

  it("lists assigned people who have no gear for the event", async () => {
    mocks.db.shiftGroup.findUnique.mockResolvedValue({
      shifts: [
        shift("s1", "VIDEO", "ST", [assignment("a1", "Ada")]),
        shift("s2", "PHOTO", "ST", [assignment("a2", "Grace")]),
        shift("s3", "SOCIAL", "ST", []),
      ],
    });
    mocks.db.booking.findMany.mockResolvedValueOnce([booking("b1", "Ada")]).mockResolvedValueOnce([]);

    const { body } = await load();

    expect(body.data.missingGear).toEqual([
      { userId: "grace", userName: "Grace", area: "PHOTO", shiftId: "s2", assignmentId: "a2" },
    ]);
  });
});
