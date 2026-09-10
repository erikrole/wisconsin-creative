import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, ShiftWorkerType } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  shiftGroup: {
    findMany: vi.fn(),
  },
  booking: {
    findMany: vi.fn(),
  },
  auditLog: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { getScheduleChangeHistory } from "@/lib/services/schedule-change-history";

describe("getScheduleChangeHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.shiftGroup.findMany.mockResolvedValue([]);
    dbMock.booking.findMany.mockResolvedValue([]);
    dbMock.auditLog.findMany.mockResolvedValue([]);
  });

  it("summarizes assignment and call-window changes after publication as review work", async () => {
    const publishedAt = new Date("2026-07-01T12:00:00Z");
    dbMock.shiftGroup.findMany.mockResolvedValue([
      {
        id: "group-1",
        eventId: "event-1",
        publishedAt,
        shifts: [
          {
            id: "shift-1",
            area: "VIDEO",
            workerType: ShiftWorkerType.FT,
            assignments: [{ id: "assignment-1", user: { name: "Ada Lovelace" } }],
          },
        ],
      },
    ]);
    dbMock.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-1",
        actorUserId: "staff-1",
        entityType: "shift_assignment",
        entityId: "assignment-1",
        action: "shift_assignment_updated",
        beforeJson: { callStartsAt: "2026-07-10T15:00:00Z" },
        afterJson: { callStartsAt: "2026-07-10T16:00:00Z", _actorRole: "STAFF" },
        createdAt: new Date("2026-07-02T10:00:00Z"),
        actor: { id: "staff-1", name: "Sam Staff", role: "STAFF" },
      },
      {
        id: "audit-2",
        actorUserId: "staff-1",
        entityType: "shift_assignment",
        entityId: "assignment-1",
        action: "shift_assigned",
        beforeJson: null,
        afterJson: { _actorRole: "STAFF" },
        createdAt: new Date("2026-06-30T10:00:00Z"),
        actor: { id: "staff-1", name: "Sam Staff", role: "STAFF" },
      },
    ]);

    const history = await getScheduleChangeHistory({
      eventIds: ["event-1"],
      limitPerEvent: 5,
    });

    expect(history.events["event-1"]?.needsReview).toBe(true);
    expect(history.events["event-1"]?.items).toEqual([
      expect.objectContaining({
        id: "audit-1",
        kind: "assignment_updated",
        label: "Updated call time",
        detail: expect.stringContaining("callStartsAt"),
        actorName: "Sam Staff",
        afterPublication: true,
        needsReview: true,
        target: expect.objectContaining({
          type: "assignment",
          label: "Ada Lovelace · VIDEO Staff slot",
        }),
      }),
      expect.objectContaining({
        id: "audit-2",
        kind: "assignment_assigned",
        afterPublication: false,
        needsReview: false,
      }),
    ]);
  });

  it("maps reservation audit rows through event and assignment links", async () => {
    dbMock.shiftGroup.findMany.mockResolvedValue([
      {
        id: "group-1",
        eventId: "event-1",
        publishedAt: null,
        shifts: [
          {
            id: "shift-1",
            area: "PHOTO",
            workerType: ShiftWorkerType.ST,
            assignments: [{ id: "assignment-1", user: { name: "Grace Hopper" } }],
          },
        ],
      },
    ]);
    dbMock.booking.findMany.mockResolvedValue([
      {
        id: "booking-1",
        kind: BookingKind.RESERVATION,
        title: "Grace gear prep",
        eventId: null,
        shiftAssignmentId: "assignment-1",
        events: [],
      },
    ]);
    dbMock.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-booking",
        actorUserId: "staff-1",
        entityType: "booking",
        entityId: "booking-1",
        action: "created",
        beforeJson: null,
        afterJson: { kind: "RESERVATION", _actorRole: "STAFF" },
        createdAt: new Date("2026-07-02T10:00:00Z"),
        actor: { id: "staff-1", name: "Sam Staff", role: "STAFF" },
      },
    ]);

    const history = await getScheduleChangeHistory({
      eventIds: ["event-1"],
      limitPerEvent: 5,
    });

    expect(history.events["event-1"]?.items[0]).toEqual(expect.objectContaining({
      kind: "reservation_linked",
      label: "Reserved gear",
      detail: "Grace gear prep",
      target: expect.objectContaining({
        type: "booking",
        label: "Grace gear prep",
      }),
    }));
  });

  it("keeps unknown booking audit rows out of the schedule timeline", async () => {
    dbMock.booking.findMany.mockResolvedValue([
      {
        id: "booking-1",
        kind: BookingKind.CHECKOUT,
        title: "Checkout",
        eventId: "event-1",
        shiftAssignmentId: null,
        events: [],
      },
    ]);
    dbMock.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-booking",
        actorUserId: "staff-1",
        entityType: "booking",
        entityId: "booking-1",
        action: "created",
        beforeJson: null,
        afterJson: { kind: "CHECKOUT", _actorRole: "STAFF" },
        createdAt: new Date("2026-07-02T10:00:00Z"),
        actor: { id: "staff-1", name: "Sam Staff", role: "STAFF" },
      },
    ]);

    const history = await getScheduleChangeHistory({
      eventIds: ["event-1"],
      limitPerEvent: 5,
    });

    expect(history.events["event-1"]?.items).toEqual([]);
  });

  it("recognizes immediate publication audit actions as published schedule history", async () => {
    const publishedAt = new Date("2026-07-01T12:00:00Z");
    dbMock.shiftGroup.findMany.mockResolvedValue([
      {
        id: "group-1",
        eventId: "event-1",
        publishedAt,
        shifts: [],
      },
    ]);
    dbMock.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-publish-now",
        actorUserId: "admin-1",
        entityType: "shift_group",
        entityId: "group-1",
        action: "shift_group_republished_now",
        beforeJson: null,
        afterJson: null,
        createdAt: new Date("2026-07-02T10:00:00Z"),
        actor: { id: "admin-1", name: "Admin User", role: "ADMIN" },
      },
    ]);

    const history = await getScheduleChangeHistory({
      eventIds: ["event-1"],
      limitPerEvent: 5,
    });

    expect(history.events["event-1"]?.items[0]).toEqual(expect.objectContaining({
      kind: "republished",
      label: "Republished schedule now",
      afterPublication: true,
      needsReview: false,
    }));
  });

  it("includes private working-copy assignment edits only when the caller opts in", async () => {
    dbMock.shiftGroup.findMany.mockResolvedValue([
      {
        id: "group-1",
        eventId: "event-1",
        publishedAt: new Date("2026-07-01T12:00:00Z"),
        shifts: [],
      },
    ]);
    dbMock.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-working-copy",
        actorUserId: "staff-1",
        entityType: "shift_group_working_copy",
        entityId: "group-1",
        action: "working_schedule_assign",
        beforeJson: { command: { type: "assign", slotKey: "slot-1", userId: "worker-1" } },
        afterJson: { changes: { assignmentChanges: 1 }, _actorRole: "STAFF" },
        createdAt: new Date("2026-07-02T10:00:00Z"),
        actor: { id: "staff-1", name: "Sam Staff", role: "STAFF" },
      },
    ]);

    const history = await getScheduleChangeHistory({
      eventIds: ["event-1"],
      limitPerEvent: 5,
      includeWorkingCopy: true,
    });

    expect(history.events["event-1"]?.items[0]).toEqual(expect.objectContaining({
      kind: "assignment_assigned",
      label: "Assigned worker",
      detail: "Working copy",
      actorName: "Sam Staff",
      target: { type: "shift_group", id: "group-1", label: null },
    }));
    expect(dbMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({
            entityType: "shift_group_working_copy",
            entityId: { in: ["group-1"] },
          }),
        ]),
      }),
    }));

    dbMock.auditLog.findMany.mockResolvedValue([]);
    const publishedOnly = await getScheduleChangeHistory({
      eventIds: ["event-1"],
      limitPerEvent: 5,
    });
    const publishedOnlyQuery = dbMock.auditLog.findMany.mock.calls.at(-1)?.[0] as {
      where: { OR: Array<{ entityType?: string }> };
    };

    expect(publishedOnly.events["event-1"]?.items).toEqual([]);
    expect(publishedOnlyQuery.where.OR).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "shift_group_working_copy" }),
    ]));
  });
});
