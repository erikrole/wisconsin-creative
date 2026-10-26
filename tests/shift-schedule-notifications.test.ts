import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assignmentFindUnique: vi.fn(),
  bookingFindFirst: vi.fn(),
  notificationFindUnique: vi.fn(),
  notificationCreate: vi.fn(),
  sendPush: vi.fn(),
  sendEmail: vi.fn(),
  enqueueShiftReminder: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shiftAssignment: { findUnique: mocks.assignmentFindUnique },
    booking: { findFirst: mocks.bookingFindFirst },
    notification: { findUnique: mocks.notificationFindUnique, create: mocks.notificationCreate },
  },
}));
vi.mock("@/lib/services/notification-delivery", () => ({
  deferPush: (task: Promise<void>) => { void task; },
  sendPushToUser: mocks.sendPush,
  sendEmailToUser: mocks.sendEmail,
}));
vi.mock("@/lib/shift-reminder-workflow", () => ({ enqueueShiftReminder: mocks.enqueueShiftReminder }));

import {
  createShiftGearUpNotification,
  createShiftScheduleNotificationFromSnapshot,
  dispatchScheduleAssignmentNotifications,
  type ShiftScheduleNotificationSnapshot,
} from "@/lib/services/shift-notifications";

// Saturday 6:00 PM Chicago (CDT); call window 4:30 to 5:00 PM.
const EVENT_START = new Date("2026-10-24T23:00:00.000Z");
const CALL_START = new Date("2026-10-24T21:30:00.000Z");
const CALL_END = new Date("2026-10-24T22:00:00.000Z");

function snapshot(over: Partial<ShiftScheduleNotificationSnapshot> = {}, eventOver: Partial<ShiftScheduleNotificationSnapshot["calendarEvent"]> = {}): ShiftScheduleNotificationSnapshot {
  return {
    assignmentId: "sa-1",
    shiftId: "shift-1",
    userId: "maya",
    userEmail: "maya@example.com",
    userActive: true,
    publishedAt: new Date("2026-10-20T15:00:00.000Z"),
    area: "Video",
    workerType: "ST",
    shiftStartsAt: EVENT_START,
    callStartsAt: CALL_START,
    callEndsAt: CALL_END,
    callNote: "Meet at the tunnel.",
    calendarEvent: {
      id: "ev-1",
      summary: "Volleyball vs. Nebraska",
      startsAt: EVENT_START,
      endsAt: new Date("2026-10-25T01:00:00.000Z"),
      allDay: false,
      sportCode: "WVB",
      opponent: "Nebraska",
      isHome: true,
      site: "HOME",
      locationId: "uw-fieldhouse",
      ...eventOver,
    },
    ...over,
  };
}

const created = () => mocks.notificationCreate.mock.calls[0]![0].data;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notificationFindUnique.mockResolvedValue(null);
  mocks.notificationCreate.mockResolvedValue({ id: "n1" });
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.bookingFindFirst.mockResolvedValue(null);
});

describe("createShiftScheduleNotificationFromSnapshot", () => {
  it("tells a student about a home shift with the call window in Chicago time, by push and email, and queues the reminder", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot(), "assigned");

    expect(created()).toMatchObject({
      userId: "maya",
      type: "shift_assigned",
      title: "Shift assigned",
      body: "You're on the Video shift at Volleyball vs. Nebraska. Call time: Sat, Oct 24, 4:30 PM - Sat, Oct 24, 5:00 PM. Meet at the tunnel.",
      readAt: null,
      payload: expect.objectContaining({ callStartsAt: CALL_START.toISOString(), callEndsAt: CALL_END.toISOString(), workerType: "Student" }),
    });
    expect(mocks.enqueueShiftReminder).toHaveBeenCalledWith({ assignmentId: "sa-1", callStartsAt: CALL_START });
    expect(mocks.sendPush).toHaveBeenCalledWith("maya", expect.objectContaining({ subtitle: "Volleyball vs. Nebraska", category: "schedule", notificationId: "n1" }));
    expect(mocks.sendEmail).toHaveBeenCalledWith("maya", expect.objectContaining({ to: "maya@example.com", subject: "Shift assigned" }), "schedule");
  });

  it("leaves the call time out for an away game", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot({}, { isHome: false, site: "AWAY", summary: "Volleyball at Nebraska" }), "assigned");

    expect(created().body).toBe("You're on the Video shift at Volleyball at Nebraska.");
    expect(created().payload).not.toHaveProperty("callStartsAt");
  });

  it("leaves the call time out for staff", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot({ workerType: "FT" }), "assigned");

    expect(created().body).toBe("You're on the Video shift at Volleyball vs. Nebraska.");
    expect(created().payload.startsAt).toBe(EVENT_START.toISOString());
  });

  it("is clear a request holds no shift yet, and queues no reminder", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot(), "requested");

    expect(created()).toMatchObject({ type: "shift_request_pending", title: "Shift request sent" });
    expect(created().body).toContain("You're not on the schedule until it's approved.");
    expect(mocks.enqueueShiftReminder).not.toHaveBeenCalled();
  });

  it.each([
    ["declined", "shift_request_declined", "Your request for the Video shift at Volleyball vs. Nebraska was declined."],
    ["removed", "shift_assignment_removed", "You're no longer on the Video shift at Volleyball vs. Nebraska."],
  ] as const)("words a %s shift plainly", async (event, type, body) => {
    await createShiftScheduleNotificationFromSnapshot(snapshot(), event);

    expect(created()).toMatchObject({ type, body });
  });

  it("names a single call time once when the window has no length", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot({ callEndsAt: CALL_START }), "personal_call_time_changed");

    expect(created().title).toBe("Your call time changed");
    expect(created().body).toBe("Your call time for the Video shift at Volleyball vs. Nebraska is now Sat, Oct 24, 4:30 PM. Meet at the tunnel.");
  });

  it("gives each call-time change its own row so a second move still notifies", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot(), "shift_time_changed");
    await createShiftScheduleNotificationFromSnapshot(snapshot({ callStartsAt: new Date("2026-10-24T21:00:00.000Z") }), "shift_time_changed");

    const [first, second] = mocks.notificationCreate.mock.calls.map((call) => call[0].data.dedupeKey);
    expect(first).not.toBe(second);
  });

  it("keeps a change the worker made themselves as an already-read receipt", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot(), "assigned", { actorUserId: "maya" });

    expect(created().readAt).toEqual(created().sentAt);
    expect(mocks.sendPush).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["an inactive worker", snapshot({ userActive: false })],
    ["an unpublished schedule", snapshot({ publishedAt: null })],
  ])("says nothing to %s", async (_label, row) => {
    await createShiftScheduleNotificationFromSnapshot(row, "assigned");

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("doesn't repeat a notification that already exists", async () => {
    mocks.notificationFindUnique.mockResolvedValue({ id: "old" });

    await createShiftScheduleNotificationFromSnapshot(snapshot(), "assigned");

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });
});

describe("createShiftGearUpNotification", () => {
  function assignmentRow(over: Record<string, unknown> = {}, groupOver: Record<string, unknown> = {}) {
    return {
      id: "sa-1",
      userId: "maya",
      shiftId: "shift-1",
      source: "ADMIN",
      user: { id: "maya", email: "maya@example.com", active: true },
      shift: {
        area: "Video",
        startsAt: EVENT_START,
        shiftGroup: {
          publishedAt: new Date("2026-10-20T15:00:00.000Z"),
          event: { id: "ev-1", summary: "Volleyball vs. Nebraska", startsAt: EVENT_START, sportCode: "WVB", opponent: "Nebraska", isHome: true, locationId: "uw-fieldhouse" },
          ...groupOver,
        },
      },
      ...over,
    };
  }

  beforeEach(() => {
    mocks.assignmentFindUnique.mockResolvedValue(assignmentRow());
  });

  it("nudges a newly assigned worker to reserve gear, in Chicago time", async () => {
    await createShiftGearUpNotification("sa-1", { source: "assignment" });

    expect(created()).toMatchObject({
      type: "shift_gear_up",
      title: "Gear up for your shift",
      body: "You're on Video at Volleyball vs. Nebraska, Sat, Oct 24, 6:00 PM. Reserve your gear now.",
      dedupeKey: "shift:sa-1:gear_up",
    });
    expect(mocks.sendPush).toHaveBeenCalledWith("maya", expect.objectContaining({ category: "gearPrep" }));
    expect(mocks.sendEmail).toHaveBeenCalledWith("maya", expect.anything(), "gearPrep");
  });

  it("skips the nudge when the worker already has gear for the event", async () => {
    mocks.bookingFindFirst.mockResolvedValue({ id: "res-1" });

    await createShiftGearUpNotification("sa-1", { source: "assignment" });

    expect(mocks.bookingFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requesterUserId: "maya", OR: [{ shiftAssignmentId: "sa-1" }, { events: { some: { eventId: "ev-1" } } }] }),
    }));
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("skips it when the shift came from their own reservation", async () => {
    mocks.assignmentFindUnique.mockResolvedValue(assignmentRow({ source: "RESERVATION" }));

    await createShiftGearUpNotification("sa-1", { source: "assignment" });

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("still sends a staff nudge even if they have gear or the schedule is unpublished", async () => {
    mocks.bookingFindFirst.mockResolvedValue({ id: "res-1" });
    mocks.assignmentFindUnique.mockResolvedValue(assignmentRow({}, { publishedAt: null }));

    await createShiftGearUpNotification("sa-1");

    expect(mocks.notificationCreate).toHaveBeenCalled();
  });

  it("waits for the schedule to be published before an assignment nudge", async () => {
    mocks.assignmentFindUnique.mockResolvedValue(assignmentRow({}, { publishedAt: null }));

    await createShiftGearUpNotification("sa-1", { source: "assignment" });

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("sends nothing to an inactive worker or twice to anyone", async () => {
    mocks.assignmentFindUnique.mockResolvedValue(assignmentRow({ user: { id: "maya", email: null, active: false } }));
    await createShiftGearUpNotification("sa-1");

    mocks.assignmentFindUnique.mockResolvedValue(assignmentRow());
    mocks.notificationFindUnique.mockResolvedValue({ id: "old" });
    await createShiftGearUpNotification("sa-1");

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });
});

describe("dispatchScheduleAssignmentNotifications", () => {
  beforeEach(() => {
    mocks.assignmentFindUnique.mockResolvedValue(null);
  });

  it.each([
    ["requested", false],
    ["declined", false],
    ["approved", true],
    ["assigned", true],
  ] as const)("on %s, gear prep runs: %s", async (event, gearUp) => {
    await dispatchScheduleAssignmentNotifications("sa-1", event);

    // The schedule notice always looks the assignment up; gear prep adds a second lookup.
    expect(mocks.assignmentFindUnique).toHaveBeenCalledTimes(gearUp ? 2 : 1);
  });
});
