import { describe, expect, it } from "vitest";
import {
  buildStaffScheduleDigestCandidates,
  categoryForScheduleNotificationType,
  scheduleMyShiftsNotificationPayload,
  scheduleNotificationPayload,
  shouldNotifyGearPrep,
  shouldNotifyWorkerForScheduleEvent,
} from "@/lib/services/schedule-notification-policy";

describe("schedule notification policy", () => {
  it("suppresses automatic worker schedule notifications while a schedule is still draft", () => {
    expect(shouldNotifyWorkerForScheduleEvent({ event: "assigned", publishedAt: null })).toBe(false);
    expect(shouldNotifyWorkerForScheduleEvent({ event: "approved", publishedAt: undefined })).toBe(false);
    expect(shouldNotifyWorkerForScheduleEvent({ event: "personal_call_time_changed", publishedAt: null })).toBe(false);

    expect(shouldNotifyWorkerForScheduleEvent({
      event: "assigned",
      publishedAt: "2026-06-18T10:00:00.000Z",
    })).toBe(true);
    expect(shouldNotifyWorkerForScheduleEvent({
      event: "removed",
      publishedAt: new Date("2026-06-18T10:00:00.000Z"),
    })).toBe(true);
    expect(shouldNotifyWorkerForScheduleEvent({
      event: "declined",
      publishedAt: new Date("2026-06-18T10:00:00.000Z"),
    })).toBe(true);
  });

  it("allows manual gear-prep nudges while suppressing automatic draft gear-up sends", () => {
    expect(shouldNotifyGearPrep({ source: "assignment", publishedAt: null })).toBe(false);
    expect(shouldNotifyGearPrep({ source: "assignment", publishedAt: "2026-06-18T10:00:00.000Z" })).toBe(true);
    expect(shouldNotifyGearPrep({ source: "manual_nudge", publishedAt: null })).toBe(true);
  });

  it("maps schedule notification types to their user preference categories", () => {
    expect(categoryForScheduleNotificationType("shift_assigned")).toBe("schedule");
    expect(categoryForScheduleNotificationType("shift_time_changed")).toBe("schedule");
    expect(categoryForScheduleNotificationType("shift_gear_up")).toBe("gearPrep");
    expect(categoryForScheduleNotificationType("trade_claimed")).toBe("trade");
    expect(categoryForScheduleNotificationType("checkout_due_now")).toBeNull();
  });

  it("builds event-routable payloads for web, push, and native inbox rows", () => {
    expect(scheduleNotificationPayload({
      eventId: "event-1",
      shiftId: "shift-1",
      assignmentId: "assignment-1",
      tradeId: "trade-1",
      extra: { area: "VIDEO" },
    })).toEqual({
      target: "event",
      href: "/events/event-1",
      eventId: "event-1",
      shiftId: "shift-1",
      assignmentId: "assignment-1",
      tradeId: "trade-1",
      area: "VIDEO",
    });
  });

  it("builds a recipient-scoped My Shifts deep link for a bulk assignment", () => {
    expect(scheduleMyShiftsNotificationPayload({
      rangeStartsAt: "2026-08-01T00:00:00.000Z",
      rangeEndsAt: "2026-08-31T23:59:59.999Z",
      sportCode: "MSOC",
      extra: { bulkAssignmentId: "batch-1", shiftCount: 42 },
    })).toEqual({
      bulkAssignmentId: "batch-1",
      shiftCount: 42,
      target: "schedule",
      href: "/schedule?myShifts=true&startDate=2026-08-01T00%3A00%3A00.000Z&endDate=2026-08-31T23%3A59%3A59.999Z&sportCode=MSOC",
      myShiftsOnly: true,
      sportCode: "MSOC",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-31T23:59:59.999Z",
    });
  });

  it("builds staff digest candidates without sending a recurring digest", () => {
    expect(buildStaffScheduleDigestCandidates({
      openSlots: 3,
      conflictedAssignments: 0,
      unacknowledgedWorkers: 2,
      missingGear: 1,
    })).toEqual([
      { queue: "needs-staffing", count: 3, title: "Open schedule slots", href: "/schedule?queue=needs-staffing" },
      { queue: "unacknowledged", count: 2, title: "Unacknowledged workers", href: "/schedule?queue=unacknowledged" },
      { queue: "gear-gaps", count: 1, title: "Gear gaps", href: "/schedule?queue=gear-gaps" },
    ]);
  });
});
