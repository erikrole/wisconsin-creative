import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assignmentFindUnique: vi.fn(),
  createManyAndReturn: vi.fn(),
  sendPush: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shiftAssignment: { findUnique: mocks.assignmentFindUnique },
    notification: { createManyAndReturn: mocks.createManyAndReturn },
  },
}));
vi.mock("@/lib/services/notification-delivery", () => ({
  deferPush: vi.fn(),
  sendPushToUser: mocks.sendPush,
  sendEmailToUser: vi.fn(),
}));

import { getShiftReminderTiming, sendShiftReminder, SHIFT_REMINDER_LEAD_MS } from "@/lib/services/shift-notifications";

// 6:00 PM Chicago (CDT) on a Saturday.
const SHIFT_START = new Date("2026-10-24T23:00:00.000Z");
const CALL_TIME = new Date("2026-10-24T22:30:00.000Z");
const NOW = new Date("2026-10-24T19:00:00.000Z");

function assignment(over: Record<string, unknown> = {}, shiftOver: Record<string, unknown> = {}, groupOver: Record<string, unknown> = {}, eventOver: Record<string, unknown> = {}) {
  return {
    id: "sa-1",
    userId: "maya",
    status: "DIRECT_ASSIGNED",
    callStartsAt: null,
    user: { active: true },
    shift: {
      id: "shift-1",
      area: "Video",
      workerType: "ST",
      startsAt: SHIFT_START,
      callStartsAt: CALL_TIME,
      shiftGroup: {
        publishedAt: new Date("2026-10-20T15:00:00.000Z"),
        event: { id: "ev-1", summary: "Volleyball vs. Nebraska", startsAt: SHIFT_START, allDay: false, status: "CONFIRMED", ...eventOver },
        ...groupOver,
      },
      ...shiftOver,
    },
    ...over,
  };
}

const timing = (expectedCallStartsAt = CALL_TIME, now = NOW) =>
  getShiftReminderTiming({ assignmentId: "sa-1", expectedCallStartsAt, now });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignmentFindUnique.mockResolvedValue(assignment());
  mocks.createManyAndReturn.mockResolvedValue([{ id: "n1" }]);
});

describe("getShiftReminderTiming", () => {
  it("schedules the reminder two hours before the shift's call time", async () => {
    await expect(timing()).resolves.toEqual({
      status: "scheduled",
      remindAt: new Date(CALL_TIME.getTime() - SHIFT_REMINDER_LEAD_MS).toISOString(),
    });
  });

  it("uses the worker's own call time over the shift's, and the shift start when neither is set", async () => {
    const ownCall = new Date("2026-10-24T22:00:00.000Z");
    mocks.assignmentFindUnique.mockResolvedValue(assignment({ callStartsAt: ownCall }));
    await expect(timing(ownCall)).resolves.toMatchObject({ status: "scheduled" });

    mocks.assignmentFindUnique.mockResolvedValue(assignment({}, { callStartsAt: null }));
    await expect(timing(SHIFT_START)).resolves.toMatchObject({ status: "scheduled" });
  });

  it("hands off to the newer run when the call time moved", async () => {
    await expect(timing(SHIFT_START)).resolves.toEqual({ status: "superseded" });
  });

  it("stops once the call time has passed", async () => {
    await expect(timing(CALL_TIME, new Date("2026-10-24T22:31:00.000Z"))).resolves.toEqual({ status: "passed" });
  });

  it.each([
    ["a missing assignment", null],
    ["an inactive worker", assignment({ user: { active: false } })],
    ["a released assignment", assignment({ status: "RELEASED" })],
    ["a pending request", assignment({ status: "REQUESTED" })],
    ["an unpublished schedule", assignment({}, {}, { publishedAt: null })],
    ["an all-day event", assignment({}, {}, {}, { allDay: true })],
    ["a cancelled event", assignment({}, {}, {}, { status: "CANCELLED" })],
  ])("sends nothing for %s", async (_label, row) => {
    mocks.assignmentFindUnique.mockResolvedValue(row);

    await expect(timing()).resolves.toEqual({ status: "inactive" });
  });

  it("still reminds an approved request", async () => {
    mocks.assignmentFindUnique.mockResolvedValue(assignment({ status: "APPROVED" }));

    await expect(timing()).resolves.toMatchObject({ status: "scheduled" });
  });
});

describe("sendShiftReminder", () => {
  const send = (expectedCallStartsAt = CALL_TIME) => sendShiftReminder({ assignmentId: "sa-1", expectedCallStartsAt, now: NOW });

  it("tells a student their call time in Chicago time, in-app and by push", async () => {
    await expect(send()).resolves.toBe("sent");

    const row = mocks.createManyAndReturn.mock.calls[0]![0].data[0];
    expect(row).toMatchObject({
      userId: "maya",
      type: "shift_reminder",
      title: "Shift in 2 hours",
      body: "You're on the Video shift at Volleyball vs. Nebraska. Call time 5:30 PM.",
      dedupeKey: `shift_reminder:sa-1:${CALL_TIME.toISOString()}`,
    });
    expect(mocks.sendPush).toHaveBeenCalledWith("maya", expect.objectContaining({
      title: "Shift in 2 hours",
      subtitle: "Volleyball vs. Nebraska",
      body: "You're on Video. Call time 5:30 PM.",
      category: "shiftReminder",
      notificationId: "n1",
    }));
  });

  it("tells staff when the shift starts instead of a call time", async () => {
    mocks.assignmentFindUnique.mockResolvedValue(assignment({}, { workerType: "FT" }));

    await send();

    expect(mocks.createManyAndReturn.mock.calls[0]![0].data[0].body).toBe("You're on the Video shift at Volleyball vs. Nebraska. Starts 5:30 PM.");
  });

  it("sends once per call time", async () => {
    mocks.createManyAndReturn.mockResolvedValue([]);

    await expect(send()).resolves.toBe("duplicate");
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });

  it("does nothing for a superseded run", async () => {
    await expect(send(SHIFT_START)).resolves.toBe("superseded");
    expect(mocks.createManyAndReturn).not.toHaveBeenCalled();
  });
});
