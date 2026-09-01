import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

const transactionCalls: Array<{ options: unknown }> = [];

vi.mock("@/lib/db", () => {
  const mockTx = {
    shift: { findUnique: vi.fn() },
    shiftAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  return {
    db: {
      user: { findUnique: vi.fn() },
      shift: { findMany: vi.fn() },
      shiftAssignment: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

import { db } from "@/lib/db";
import {
  getScheduleOpenWork,
  pickupOpenShift,
  withdrawPickupRequest,
} from "@/lib/services/schedule-open-work";

const mockDb = db as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  shift: { findMany: ReturnType<typeof vi.fn> };
  shiftAssignment: { findMany: ReturnType<typeof vi.fn> };
  _mockTx: {
    shift: { findUnique: ReturnType<typeof vi.fn> };
    shiftAssignment: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    user: { findUnique: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
  };
};

const now = new Date("2026-09-01T12:00:00Z");

function baseEvent() {
  return {
    id: "event-1",
    summary: "Wisconsin vs Iowa",
    startsAt: new Date("2026-09-05T18:00:00Z"),
    endsAt: new Date("2026-09-05T21:00:00Z"),
    sportCode: "football",
    opponent: "Iowa",
    isHome: true,
    allDay: false,
    isHidden: false,
    archivedAt: null,
    status: "CONFIRMED",
  };
}

function baseShift(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt: new Date("2026-09-05T16:00:00Z"),
    endsAt: new Date("2026-09-05T21:00:00Z"),
    callStartsAt: null,
    callEndsAt: null,
    shiftGroupId: "group-1",
    assignments: [],
    shiftGroup: {
      id: "group-1",
      publishedAt: new Date("2026-09-01T10:00:00Z"),
      archivedAt: null,
      event: baseEvent(),
    },
    ...overrides,
  };
}

function activeStudent() {
  return {
    id: "student-1",
    role: "STUDENT",
    staffingType: "ST",
    active: true,
    primaryArea: "VIDEO",
    areaAssignments: [{ area: "VIDEO", isPrimary: true }],
    sportAssignments: [{ sportCode: "football" }],
    availabilityBlocks: [],
  };
}

beforeEach(() => {
  transactionCalls.length = 0;
  mockDb.user.findUnique.mockReset();
  mockDb.shift.findMany.mockReset();
  mockDb.shiftAssignment.findMany.mockReset();
  mockDb._mockTx.shift.findUnique.mockReset();
  mockDb._mockTx.user.findUnique.mockReset();
  mockDb._mockTx.shiftAssignment.findUnique.mockReset();
  mockDb._mockTx.shiftAssignment.findFirst.mockReset();
  mockDb._mockTx.shiftAssignment.findMany.mockReset();
  mockDb._mockTx.shiftAssignment.create.mockReset();
  mockDb._mockTx.shiftAssignment.update.mockReset();
  mockDb._mockTx.shiftAssignment.updateMany.mockReset();
  mockDb._mockTx.shiftAssignment.findMany.mockResolvedValue([]);
  mockDb._mockTx.auditLog.create.mockReset();
  mockDb._mockTx.auditLog.create.mockResolvedValue({});
  mockDb._mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
});

describe("schedule open work", () => {
  it("returns published open Student shifts with candidate eligibility", async () => {
    mockDb.user.findUnique.mockResolvedValue(activeStudent());
    mockDb.shiftAssignment.findMany.mockResolvedValue([]);
    mockDb.shift.findMany.mockResolvedValue([baseShift()]);

    const result = await getScheduleOpenWork({
      userId: "student-1",
      role: "STUDENT",
      now,
    });

    expect(mockDb.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { callStartsAt: null, startsAt: { gt: now } },
              { callStartsAt: { gt: now } },
              { shiftGroup: { event: { allDay: true, startsAt: { gt: now } } } },
            ],
          },
        ],
        area: { in: ["VIDEO"] },
        workerType: "ST",
        assignments: { none: { status: { in: ["DIRECT_ASSIGNED", "APPROVED"] } } },
        shiftGroup: expect.objectContaining({
          publishedAt: { not: null },
          archivedAt: null,
        }),
      }),
    }));
    expect(result.openShifts[0]).toEqual(expect.objectContaining({
      id: "shift-1",
      action: "claim",
      canAct: true,
      requestCount: 0,
    }));
  });

  it("lists open work by effective call start instead of raw shift start", async () => {
    mockDb.user.findUnique.mockResolvedValue(activeStudent());
    mockDb.shiftAssignment.findMany.mockResolvedValue([]);
    mockDb.shift.findMany.mockResolvedValue([]);

    await getScheduleOpenWork({
      userId: "student-1",
      role: "STUDENT",
      now,
    });

    expect(mockDb.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { callStartsAt: null, startsAt: { gt: now } },
              { callStartsAt: { gt: now } },
              { shiftGroup: { event: { allDay: true, startsAt: { gt: now } } } },
            ],
          },
        ],
      }),
      orderBy: { startsAt: "asc" },
    }));
  });

  it("returns the full pending-request review payload only to Admin", async () => {
    mockDb.user.findUnique.mockResolvedValue(activeStudent());
    mockDb.shift.findMany.mockResolvedValue([]);
    mockDb.shiftAssignment.findMany.mockResolvedValue([]);

    await getScheduleOpenWork({ userId: "staff-1", role: "STAFF", now });
    const staffRequestQuery = mockDb.shiftAssignment.findMany.mock.calls
      .map(([query]) => query)
      .find((query) => query.where?.status === "REQUESTED");
    expect(staffRequestQuery).toEqual(expect.objectContaining({
      where: expect.objectContaining({ status: "REQUESTED", userId: "staff-1" }),
    }));

    mockDb.shiftAssignment.findMany.mockClear();
    await getScheduleOpenWork({ userId: "admin-1", role: "ADMIN", now });
    const adminRequestQuery = mockDb.shiftAssignment.findMany.mock.calls
      .map(([query]) => query)
      .find((query) => query.where?.status === "REQUESTED");
    expect(adminRequestQuery?.where).not.toHaveProperty("userId");
  });

  it("does not present malformed Staff slots as student-pickup actions", async () => {
    mockDb.user.findUnique.mockResolvedValue(activeStudent());
    mockDb.shiftAssignment.findMany.mockResolvedValue([]);
    mockDb.shift.findMany.mockResolvedValue([baseShift({ workerType: "FT" })]);

    const result = await getScheduleOpenWork({
      userId: "student-1",
      role: "STUDENT",
      now,
    });

    expect(result.openShifts[0]).toEqual(expect.objectContaining({
      action: "none",
      canAct: false,
    }));
  });

  it("surfaces approved time off as blocked open-work context", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...activeStudent(),
      availabilityBlocks: [{
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "APPROVED",
        date: "2026-09-05",
        startsAt: "10:00",
        endsAt: "18:00",
        label: "Family trip",
      }],
    });
    mockDb.shiftAssignment.findMany.mockResolvedValue([]);
    mockDb.shift.findMany.mockResolvedValue([baseShift()]);

    const result = await getScheduleOpenWork({
      userId: "student-1",
      role: "STUDENT",
      now,
    });

    expect(result.openShifts[0]).toEqual(expect.objectContaining({
      action: "none",
      canAct: false,
      reason: "Approved time off: Family trip (10:00-18:00)",
      availabilityContext: expect.objectContaining({
        state: "blocked",
        label: "Approved time off",
        detail: "Approved time off: Family trip (10:00-18:00)",
        blocking: true,
      }),
    }));
  });

  it("surfaces preferred windows as positive open-work context", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...activeStudent(),
      availabilityBlocks: [{
        kind: "AD_HOC",
        intent: "PREFER",
        status: "APPROVED",
        date: "2026-09-05",
        startsAt: "10:00",
        endsAt: "18:00",
        label: "Video games",
      }],
    });
    mockDb.shiftAssignment.findMany.mockResolvedValue([]);
    mockDb.shift.findMany.mockResolvedValue([baseShift()]);

    const result = await getScheduleOpenWork({
      userId: "student-1",
      role: "STUDENT",
      now,
    });

    expect(result.openShifts[0]).toEqual(expect.objectContaining({
      action: "claim",
      canAct: true,
      availabilityContext: expect.objectContaining({
        state: "preferred",
        label: "Preferred window",
        detail: "Prefers Video games (10:00-18:00)",
        blocking: false,
      }),
    }));
  });

  it("allows staff-access users with Student scheduling class to claim Student open work", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift());
    mockDb._mockTx.user.findUnique.mockResolvedValue({
      ...activeStudent(),
      id: "staff-access-student-worker",
      role: "STAFF",
      staffingType: "ST",
    });
    mockDb._mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockDb._mockTx.shiftAssignment.create.mockResolvedValue({ id: "assignment-1", status: "REQUESTED" });

    await pickupOpenShift("shift-1", "staff-access-student-worker");

    // Scheduling class, not app role, decides eligibility — and the request
    // still waits for review like any other student's.
    expect(mockDb._mockTx.shiftAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shiftId: "shift-1",
        userId: "staff-access-student-worker",
        status: "REQUESTED",
      }),
    }));
  });

  it("hides other-area open shifts from Students but preserves the Photo/Graphics exception", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...activeStudent(),
      primaryArea: "PHOTO",
      areaAssignments: [{ area: "VIDEO", isPrimary: false }],
    });
    mockDb.shiftAssignment.findMany.mockResolvedValue([]);
    mockDb.shift.findMany.mockResolvedValue([]);

    await getScheduleOpenWork({ userId: "student-1", role: "STUDENT", now });

    expect(mockDb.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ area: { in: ["PHOTO", "GRAPHICS"] } }),
    }));
  });

  it("rejects a direct open-shift claim outside the primary area", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift());
    mockDb._mockTx.user.findUnique.mockResolvedValue({
      ...activeStudent(),
      primaryArea: "PHOTO",
      areaAssignments: [{ area: "VIDEO", isPrimary: false }],
    });

    await expect(pickupOpenShift("shift-1", "student-1")).rejects.toThrow(
      "cannot claim shifts in this area",
    );
    expect(mockDb._mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("allows a Photo student to claim a Graphics open shift", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift({ area: "GRAPHICS" }));
    mockDb._mockTx.user.findUnique.mockResolvedValue({
      ...activeStudent(),
      primaryArea: "PHOTO",
    });
    mockDb._mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockDb._mockTx.shiftAssignment.create.mockResolvedValue({ id: "assignment-1", status: "REQUESTED" });

    await expect(pickupOpenShift("shift-1", "student-1")).resolves.toMatchObject({
      status: "REQUESTED",
    });
  });

  it("files an open-slot claim as a pending request, holding no slot", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift());
    mockDb._mockTx.user.findUnique.mockResolvedValue(activeStudent());
    mockDb._mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockDb._mockTx.shiftAssignment.create.mockResolvedValue({ id: "assignment-1", status: "REQUESTED" });

    await pickupOpenShift("shift-1", "student-1");

    const created = mockDb._mockTx.shiftAssignment.create.mock.calls[0]![0];
    expect(created.data).toEqual(expect.objectContaining({
      shiftId: "shift-1",
      userId: "student-1",
      status: "REQUESTED",
      assignedBy: "student-1",
    }));
    // Acknowledging here would show the student as confirmed for a slot that
    // staff have not given them.
    expect(created.data.acknowledgedAt).toBeUndefined();
    expect(created.data.acknowledgedById).toBeUndefined();
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("leaves competing requests alone so staff choose between them", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift());
    mockDb._mockTx.user.findUnique.mockResolvedValue(activeStudent());
    mockDb._mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockDb._mockTx.shiftAssignment.create.mockResolvedValue({ id: "assignment-1", status: "REQUESTED" });

    await pickupOpenShift("shift-1", "student-1");

    // Declining the other requests here would hand the slot to whoever tapped
    // first, which is the instant-claim behaviour the gate replaced.
    expect(mockDb._mockTx.shiftAssignment.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a second request from the same student on one shift", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift());
    mockDb._mockTx.user.findUnique.mockResolvedValue(activeStudent());
    // No active assignment, but this student already has one waiting.
    mockDb._mockTx.shiftAssignment.findFirst.mockResolvedValue({ id: "existing-request" });

    await expect(pickupOpenShift("shift-1", "student-1")).rejects.toThrow(
      "already have a request waiting"
    );
    expect(mockDb._mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("rejects draft shifts before worker pickup", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift({
      shiftGroup: {
        id: "group-1",
        publishedAt: null,
        archivedAt: null,
        event: baseEvent(),
      },
    }));
    mockDb._mockTx.user.findUnique.mockResolvedValue(activeStudent());

    await expect(pickupOpenShift("shift-1", "student-1")).rejects.toThrow("Draft shifts are not open for pickup");
  });

  it("rejects already filled shifts", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift({
      assignments: [{ id: "assignment-1", userId: "other", status: "APPROVED" }],
    }));
    mockDb._mockTx.user.findUnique.mockResolvedValue(activeStudent());

    await expect(pickupOpenShift("shift-1", "student-1")).rejects.toThrow("already has an active assignment");
  });

  it("rejects pickup after the effective call start even when raw shift start is future", async () => {
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift({
      startsAt: new Date("2999-09-05T16:00:00Z"),
      endsAt: new Date("2999-09-05T21:00:00Z"),
      callStartsAt: new Date("2000-09-05T14:00:00Z"),
      callEndsAt: new Date("2999-09-05T21:00:00Z"),
    }));
    mockDb._mockTx.user.findUnique.mockResolvedValue(activeStudent());

    await expect(pickupOpenShift("shift-1", "student-1")).rejects.toThrow("This shift has already started");
    expect(mockDb._mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("uses the canonical all-day event window when rejecting pickup conflicts", async () => {
    const eventStartsAt = new Date("2026-09-05T00:00:00Z");
    const eventEndsAt = new Date("2026-09-06T00:00:00Z");
    mockDb._mockTx.shift.findUnique.mockResolvedValue(baseShift({
      startsAt: new Date("2026-09-05T18:00:00Z"),
      endsAt: new Date("2026-09-05T19:00:00Z"),
      shiftGroup: {
        id: "group-1",
        publishedAt: new Date("2026-09-01T10:00:00Z"),
        archivedAt: null,
        event: {
          ...baseEvent(),
          startsAt: eventStartsAt,
          endsAt: eventEndsAt,
          allDay: true,
        },
      },
    }));
    mockDb._mockTx.user.findUnique.mockResolvedValue(activeStudent());
    mockDb._mockTx.shiftAssignment.findMany.mockResolvedValue([{
      id: "existing-assignment",
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        area: "PHOTO",
        startsAt: new Date("2026-09-05T02:00:00Z"),
        endsAt: new Date("2026-09-05T03:00:00Z"),
        callStartsAt: null,
        callEndsAt: null,
        shiftGroup: {
          event: { startsAt: eventStartsAt, endsAt: eventEndsAt, allDay: true },
        },
      },
    }]);
    mockDb._mockTx.shiftAssignment.findFirst.mockResolvedValue(null);

    await expect(pickupOpenShift("shift-1", "student-1")).rejects.toThrow(
      "User already has a shift during this time (PHOTO)"
    );
    expect(mockDb._mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("withdraws only the student's pending request and records the reason", async () => {
    const assignment = {
      id: "request-1",
      shiftId: "shift-1",
      userId: "student-1",
      status: "REQUESTED",
      shift: { id: "shift-1", shiftGroup: { workingCopy: null } },
    };
    mockDb._mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockDb._mockTx.shiftAssignment.update.mockResolvedValue({
      ...assignment,
      status: "DECLINED",
    });

    const result = await withdrawPickupRequest("request-1", {
      id: "student-1",
      role: "STUDENT",
    });

    expect(result.status).toBe("DECLINED");
    expect(mockDb._mockTx.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "request-1" },
      data: { status: "DECLINED" },
    });
    expect(mockDb._mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "shift_request_withdrawn" }),
    }));
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("does not let another user or a resolved request be withdrawn", async () => {
    const assignment = {
      id: "request-1",
      shiftId: "shift-1",
      userId: "student-1",
      status: "REQUESTED",
      shift: { id: "shift-1", shiftGroup: { workingCopy: null } },
    };
    mockDb._mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);

    await expect(withdrawPickupRequest("request-1", { id: "student-2", role: "STUDENT" }))
      .rejects.toThrow("only withdraw your own");
    mockDb._mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...assignment, status: "DECLINED" });
    await expect(withdrawPickupRequest("request-1", { id: "student-1", role: "STUDENT" }))
      .rejects.toThrow("Only pending requests");
    expect(mockDb._mockTx.shiftAssignment.update).not.toHaveBeenCalled();
  });
});
