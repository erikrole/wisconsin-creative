import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    shiftAssignment: { findUnique: vi.fn() },
    notification: { createManyAndReturn: vi.fn(), count: vi.fn() },
    deviceToken: { findMany: vi.fn(async () => []) },
    notificationDelivery: { createMany: vi.fn() },
  },
}));
vi.mock("@/lib/push/apns", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/push/web", () => ({ sendWebPushToUsers: vi.fn(async () => new Map()) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), buildNotificationEmail: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { appTimezone: "America/Chicago" } }));
vi.mock("workflow/api", () => ({ start: vi.fn(async () => ({ runId: "run-1" })) }));
vi.mock("@/workflows/shift-reminder", () => ({ shiftReminderWorkflow: vi.fn() }));

import { db } from "@/lib/db";
import { start } from "workflow/api";
import { getShiftReminderTiming, sendShiftReminder } from "@/lib/services/notifications";
import { enqueueShiftReminder } from "@/lib/shift-reminder-workflow";

const call = new Date("2026-09-26T21:30:00.000Z"); // 4:30 PM Central
const now = new Date("2026-09-26T15:00:00.000Z");

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    userId: "u1",
    status: "DIRECT_ASSIGNED",
    callStartsAt: call,
    user: { active: true },
    shift: {
      id: "s1",
      area: "Photo",
      workerType: "ST",
      startsAt: new Date("2026-09-26T22:00:00.000Z"),
      callStartsAt: null,
      shiftGroup: {
        publishedAt: new Date("2026-09-20T00:00:00.000Z"),
        event: { id: "e1", summary: "Football vs Iowa", startsAt: call, allDay: false, status: "CONFIRMED" },
      },
    },
    ...overrides,
  };
}

describe("shift reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.shiftAssignment.findUnique).mockResolvedValue(assignment() as never);
    vi.mocked(db.notification.createManyAndReturn).mockResolvedValue([{ id: "n1" }] as never);
  });

  it("schedules two hours before the effective call time", async () => {
    expect(await getShiftReminderTiming({ assignmentId: "a1", expectedCallStartsAt: call, now })).toEqual({
      status: "scheduled",
      remindAt: "2026-09-26T19:30:00.000Z",
    });
  });

  it("stands down when the call time moved, the assignment ended, or the event was cancelled", async () => {
    const moved = new Date(call.getTime() + 30 * 60_000);
    expect((await getShiftReminderTiming({ assignmentId: "a1", expectedCallStartsAt: moved, now })).status).toBe("superseded");

    vi.mocked(db.shiftAssignment.findUnique).mockResolvedValue(assignment({ status: "SWAPPED" }) as never);
    expect((await getShiftReminderTiming({ assignmentId: "a1", expectedCallStartsAt: call, now })).status).toBe("inactive");

    const cancelled = assignment();
    cancelled.shift.shiftGroup.event.status = "CANCELLED";
    vi.mocked(db.shiftAssignment.findUnique).mockResolvedValue(cancelled as never);
    expect((await getShiftReminderTiming({ assignmentId: "a1", expectedCallStartsAt: call, now })).status).toBe("inactive");
  });

  it("sends once per call time, keyed so a retry is silent", async () => {
    expect(await sendShiftReminder({ assignmentId: "a1", expectedCallStartsAt: call, now })).toBe("sent");
    const row = vi.mocked(db.notification.createManyAndReturn).mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(row[0]).toMatchObject({
      type: "shift_reminder",
      title: "Shift in 2 hours",
      body: "You're on the Photo shift at Football vs Iowa. Call time 4:30 PM.",
      dedupeKey: `shift_reminder:a1:${call.toISOString()}`,
    });

    vi.mocked(db.notification.createManyAndReturn).mockResolvedValue([] as never);
    expect(await sendShiftReminder({ assignmentId: "a1", expectedCallStartsAt: call, now })).toBe("duplicate");
  });

  it("doesn't start a run when the reminder time has already passed", async () => {
    expect(await enqueueShiftReminder({ assignmentId: "a1", callStartsAt: new Date(now.getTime() + 60 * 60_000), now })).toBeNull();
    expect(start).not.toHaveBeenCalled();

    expect(await enqueueShiftReminder({ assignmentId: "a1", callStartsAt: call, now })).toBe("run-1");
    expect(start).toHaveBeenCalledWith(expect.anything(), ["a1", call.toISOString()]);
  });
});
