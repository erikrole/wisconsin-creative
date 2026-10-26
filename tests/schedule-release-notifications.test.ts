import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, deferPush, sendPushToUser, sendEmailToUser, enqueueShiftReminder } = vi.hoisted(() => ({
  db: {
    shiftGroup: { findUnique: vi.fn() },
    shiftAssignment: { findUnique: vi.fn(), findMany: vi.fn() },
    scheduleBulkAssignment: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { create: vi.fn(), createManyAndReturn: vi.fn() },
  },
  deferPush: vi.fn(),
  sendPushToUser: vi.fn<(userId: string, message: unknown) => Promise<void>>(async () => undefined),
  sendEmailToUser: vi.fn<(userId: string, message: unknown) => Promise<void>>(async () => undefined),
  enqueueShiftReminder: vi.fn<(row: unknown) => Promise<void>>(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/services/notification-delivery", () => ({ deferPush, sendPushToUser, sendEmailToUser }));
vi.mock("@/lib/shift-reminder-workflow", () => ({ enqueueShiftReminder }));
vi.mock("@/lib/email", () => ({ buildNotificationEmail: (args: Record<string, unknown>) => ({ html: "", text: "", args }) }));

import {
  createBulkScheduleAssignmentNotifications,
  createPublishedShiftGroupNotifications,
  notifyPickupRequestReviewers,
  notifyPublishedScheduleFollowers,
  notifyPublishedShiftGroupWorkers,
} from "@/lib/services/shift-notifications";
import { formatAppDateTime } from "@/lib/app-time";

const shiftStart = new Date("2026-10-31T17:00:00.000Z");
const studentCall = new Date("2026-10-31T15:30:00.000Z");
const earlierCall = new Date("2026-10-31T14:00:00.000Z");

const homeGame = {
  id: "event-1",
  summary: "Football vs Iowa",
  startsAt: shiftStart,
  endsAt: new Date("2026-10-31T21:00:00.000Z"),
  allDay: false,
  sportCode: "FB",
  opponent: "Iowa",
  isHome: true,
  site: "HOME",
};

type Assignment = { id: string; userId: string; callStartsAt: Date | null; user?: { email: string | null } };
type Shift = { workerType: string; startsAt: Date; callStartsAt: Date | null; assignments: Assignment[] };

function group(shifts: Shift[], overrides: Record<string, unknown> = {}) {
  return { publishedAt: new Date("2026-10-20T15:00:00.000Z"), publishedVersion: 3, event: homeGame, shifts, ...overrides };
}

function created() {
  return db.notification.create.mock.calls.map(([args]) => args.data as Record<string, unknown>);
}

function emails() {
  return sendEmailToUser.mock.calls.map(([userId, message]) => ({ userId, message: message as Record<string, unknown> }));
}

function duplicate() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

beforeEach(() => {
  vi.clearAllMocks();
  let seq = 0;
  db.notification.create.mockImplementation(async () => ({ id: `n-${++seq}` }));
});

describe("createPublishedShiftGroupNotifications", () => {
  const shifts: Shift[] = [
    {
      workerType: "ST",
      startsAt: shiftStart,
      callStartsAt: studentCall,
      assignments: [
        { id: "a-1", userId: "student-1", callStartsAt: null, user: { email: "maddy@wisc.edu" } },
        { id: "a-2", userId: "staff-1", callStartsAt: null, user: { email: null } },
      ],
    },
    {
      workerType: "ST",
      startsAt: shiftStart,
      callStartsAt: null,
      assignments: [{ id: "a-3", userId: "student-1", callStartsAt: earlierCall, user: { email: "maddy@wisc.edu" } }],
    },
  ];

  it("sends each worker one Schedule ready row with their shift count and earliest call time", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(group(shifts));

    await createPublishedShiftGroupNotifications("group-1");

    const student = created().find((row) => row.userId === "student-1");
    expect(student).toMatchObject({
      type: "shift_schedule_published",
      title: "Schedule ready",
      body: `You're on 2 shifts at Football vs Iowa. Call time: ${formatAppDateTime(earlierCall)}.`,
      dedupeKey: "shift_group_publish:group-1:v3:student-1",
      channel: "IN_APP",
    });
    expect(created().find((row) => row.userId === "staff-1")?.body).toBe(
      `You're on 1 shift at Football vs Iowa. Call time: ${formatAppDateTime(studentCall)}.`,
    );
    expect(sendPushToUser).toHaveBeenCalledWith("student-1", expect.objectContaining({
      title: "Schedule ready",
      subtitle: "Football vs Iowa",
      body: `You're on 2 shifts. Call time: ${formatAppDateTime(earlierCall)}.`,
      category: "schedule",
    }));
    expect(deferPush).toHaveBeenCalledTimes(2);
  });

  it("emails only workers with an address, linked to the event", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(group(shifts));

    await createPublishedShiftGroupNotifications("group-1");

    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({
      userId: "student-1",
      message: { to: "maddy@wisc.edu", subject: "Schedule ready", args: { href: "/events/event-1", dueAt: earlierCall.toISOString() } },
    });
  });

  it("schedules a reminder for every assignment at its effective call time", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(group(shifts));

    await createPublishedShiftGroupNotifications("group-1");

    expect(enqueueShiftReminder.mock.calls.map(([row]) => row)).toEqual([
      { assignmentId: "a-1", callStartsAt: studentCall },
      { assignmentId: "a-2", callStartsAt: studentCall },
      { assignmentId: "a-3", callStartsAt: earlierCall },
    ]);
  });

  it("leaves call time out for staff shifts and away games", async () => {
    const staffShift: Shift = { workerType: "FT", startsAt: shiftStart, callStartsAt: studentCall, assignments: [{ id: "a-9", userId: "staff-2", callStartsAt: null, user: { email: null } }] };
    db.shiftGroup.findUnique.mockResolvedValue(group([staffShift]));
    await createPublishedShiftGroupNotifications("group-1");
    expect(created()[0]?.body).toBe("You're on 1 shift at Football vs Iowa.");

    vi.clearAllMocks();
    db.notification.create.mockResolvedValue({ id: "n-1" });
    db.shiftGroup.findUnique.mockResolvedValue(group([{ ...shifts[1]! }], { event: { ...homeGame, isHome: false, site: "AWAY" } }));
    await createPublishedShiftGroupNotifications("group-1");
    expect(created()[0]?.body).toBe("You're on 1 shift at Football vs Iowa.");
  });

  it("does nothing for an unpublished schedule", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(group(shifts, { publishedAt: null }));

    await createPublishedShiftGroupNotifications("group-1");

    expect(db.notification.create).not.toHaveBeenCalled();
    expect(enqueueShiftReminder).not.toHaveBeenCalled();
  });

  it("stays silent for a worker who already has this version's row", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(group(shifts));
    db.notification.create.mockImplementation(async ({ data }: { data: { userId: string } }) => {
      if (data.userId === "student-1") throw duplicate();
      return { id: "n-1" };
    });

    await createPublishedShiftGroupNotifications("group-1");

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith("staff-1", expect.anything());
    expect(sendEmailToUser).not.toHaveBeenCalled();
  });
});

describe("notifyPublishedShiftGroupWorkers", () => {
  const shifts: Shift[] = [
    { workerType: "ST", startsAt: shiftStart, callStartsAt: studentCall, assignments: [{ id: "a-1", userId: "student-1", callStartsAt: null }] },
  ];

  it("tells kept workers their new count and removed workers they are off", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(group(shifts));
    db.user.findMany.mockResolvedValue([
      { id: "student-1", email: "maddy@wisc.edu" },
      { id: "student-2", email: null },
    ]);

    await notifyPublishedShiftGroupWorkers("group-1", ["student-1", "student-2", "student-1"]);

    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["student-1", "student-2"] }, active: true },
      select: { id: true, email: true },
    });
    expect(created()).toEqual([
      expect.objectContaining({
        userId: "student-1",
        type: "shift_schedule_updated",
        title: "Schedule updated",
        body: `Your schedule for Football vs Iowa changed. You now have 1 shift. Call time: ${formatAppDateTime(studentCall)}.`,
        dedupeKey: "shift_group_update:group-1:v3:student-1",
      }),
      expect.objectContaining({
        userId: "student-2",
        body: "You're no longer on the schedule for Football vs Iowa.",
        dedupeKey: "shift_group_update:group-1:v3:student-2",
      }),
    ]);
    expect(sendPushToUser).toHaveBeenCalledWith("student-2", expect.objectContaining({ body: "You're no longer on the schedule." }));
    expect(emails().map((email) => email.userId)).toEqual(["student-1"]);
    expect(enqueueShiftReminder).toHaveBeenCalledWith({ assignmentId: "a-1", callStartsAt: studentCall });
  });

  it("skips the lookup entirely when nobody changed", async () => {
    await notifyPublishedShiftGroupWorkers("group-1", []);
    expect(db.shiftGroup.findUnique).not.toHaveBeenCalled();
  });

  it("does nothing for an unpublished schedule", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(group(shifts, { publishedAt: null }));
    db.user.findMany.mockResolvedValue([{ id: "student-1", email: null }]);

    await notifyPublishedShiftGroupWorkers("group-1", ["student-1"]);

    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe("notifyPublishedScheduleFollowers", () => {
  function followed(follows: Array<{ user: { id: string; email: string | null } }>, overrides: Record<string, unknown> = {}) {
    return { publishedAt: new Date(), publishedVersion: 4, event: { id: "event-1", summary: "Football vs Iowa", startsAt: shiftStart, follows }, ...overrides };
  }

  it("asks only for unmuted, active collaborators who can see the published schedule", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(followed([]));

    await notifyPublishedScheduleFollowers("group-1");

    const follows = db.shiftGroup.findUnique.mock.calls[0]?.[0]?.select.event.select.follows;
    expect(follows.where).toEqual({
      mutedAt: null,
      user: {
        active: true,
        role: "COLLABORATOR",
        collaboratorPolicy: { is: { status: "ACTIVE", grants: { some: { capabilityKey: "PUBLISHED_SCHEDULE_VIEW" } } } },
      },
    });
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("tells each follower the crew changed, once per published version", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(followed([
      { user: { id: "btn-1", email: "producer@btn.com" } },
      { user: { id: "btn-2", email: null } },
    ]));

    await notifyPublishedScheduleFollowers("group-1");

    expect(created()).toEqual([
      expect.objectContaining({
        userId: "btn-1",
        type: "published_schedule_updated",
        title: "Crew schedule updated",
        body: "The crew schedule for Football vs Iowa changed.",
        payload: { eventId: "event-1" },
        dedupeKey: "published_schedule:event-1:v4:btn-1",
      }),
      expect.objectContaining({ userId: "btn-2", dedupeKey: "published_schedule:event-1:v4:btn-2" }),
    ]);
    expect(sendPushToUser).toHaveBeenCalledWith("btn-1", expect.objectContaining({ body: "Tap to see who's working." }));
    expect(emails().map((email) => email.userId)).toEqual(["btn-1"]);
  });

  it("does nothing before the schedule is published", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(followed([{ user: { id: "btn-1", email: null } }], { publishedAt: null }));
    await notifyPublishedScheduleFollowers("group-1");
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe("createBulkScheduleAssignmentNotifications", () => {
  const batch = {
    id: "batch-1",
    sportCode: "FB",
    rangeStartsAt: new Date("2026-10-26T05:00:00.000Z"),
    rangeEndsAt: new Date("2026-11-09T06:00:00.000Z"),
    items: [
      { shiftGroupId: "group-1", proposalPayload: [{ shiftId: "s-1", userId: "student-1" }, { shiftId: "s-2", userId: "student-1" }, { bad: true }] },
      { shiftGroupId: "group-2", proposalPayload: [{ shiftId: "s-3", userId: "student-1" }, { shiftId: "s-1", userId: "student-1" }] },
      { shiftGroupId: "group-3", proposalPayload: "not a list" },
    ],
  };

  it("rolls a whole release into one row per worker", async () => {
    db.scheduleBulkAssignment.findUnique.mockResolvedValue(batch);
    db.shiftAssignment.findMany.mockResolvedValue([
      { shiftId: "s-1", userId: "student-1", user: { email: "maddy@wisc.edu" }, shift: { shiftGroupId: "group-1" } },
      { shiftId: "s-2", userId: "student-1", user: { email: "maddy@wisc.edu" }, shift: { shiftGroupId: "group-1" } },
      { shiftId: "s-3", userId: "student-1", user: { email: "maddy@wisc.edu" }, shift: { shiftGroupId: "group-2" } },
    ]);

    await createBulkScheduleAssignmentNotifications("batch-1");

    // Duplicate and malformed proposals drop out before the lookup.
    expect(db.shiftAssignment.findMany.mock.calls[0]?.[0]?.where.OR).toEqual([
      { shiftId: "s-1", userId: "student-1" },
      { shiftId: "s-2", userId: "student-1" },
      { shiftId: "s-3", userId: "student-1" },
    ]);
    expect(created()).toHaveLength(1);
    expect(created()[0]).toMatchObject({
      userId: "student-1",
      type: "shift_schedule_bulk_assigned",
      title: "You have 3 new shifts",
      body: "Tap to see them.",
      dedupeKey: "schedule_bulk_assignment:batch-1:student-1",
      payload: expect.objectContaining({ bulkAssignmentId: "batch-1", shiftCount: 3, eventCount: 2 }),
    });
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(emails()[0]?.message).toMatchObject({ subject: "You have 3 new shifts", args: { bookingTitle: "FB schedule" } });
  });

  it("says shift for one, and skips a batch with nothing released", async () => {
    db.scheduleBulkAssignment.findUnique.mockResolvedValue({ ...batch, sportCode: null, items: [batch.items[0]!] });
    db.shiftAssignment.findMany.mockResolvedValue([
      { shiftId: "s-1", userId: "student-1", user: { email: "maddy@wisc.edu" }, shift: { shiftGroupId: "group-1" } },
    ]);
    await createBulkScheduleAssignmentNotifications("batch-1");
    expect(created()[0]?.title).toBe("You have 1 new shift");
    expect(emails()[0]?.message).toMatchObject({ args: { bookingTitle: "Upcoming shifts" } });

    vi.clearAllMocks();
    db.scheduleBulkAssignment.findUnique.mockResolvedValue({ ...batch, items: [batch.items[2]!] });
    await createBulkScheduleAssignmentNotifications("batch-1");
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("notifyPickupRequestReviewers", () => {
  const request = {
    id: "a-1",
    shiftId: "s-1",
    user: { name: "Maddy Student" },
    shift: { area: "VIDEO", shiftGroup: { publishedAt: new Date(), event: { id: "event-1", summary: "Football vs Iowa" } } },
  };

  it("asks each admin to review, pushing only rows that are new", async () => {
    db.shiftAssignment.findUnique.mockResolvedValue(request);
    db.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
    db.notification.createManyAndReturn.mockResolvedValue([{ id: "n-2", userId: "admin-2" }]);

    await notifyPickupRequestReviewers("a-1");

    const args = db.notification.createManyAndReturn.mock.calls[0]?.[0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toEqual([
      expect.objectContaining({
        userId: "admin-1",
        type: "shift_request_review",
        title: "Shift request needs review",
        body: "Maddy Student requested the VIDEO shift at Football vs Iowa.",
        dedupeKey: "shift_request_review_a-1_admin-1",
      }),
      expect.objectContaining({ userId: "admin-2", dedupeKey: "shift_request_review_a-1_admin-2" }),
    ]);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith("admin-2", expect.objectContaining({
      body: "Maddy Student wants the VIDEO shift.",
      notificationId: "n-2",
    }));
  });

  it("waits for the schedule to be published", async () => {
    db.shiftAssignment.findUnique.mockResolvedValue({ ...request, shift: { ...request.shift, shiftGroup: { ...request.shift.shiftGroup, publishedAt: null } } });
    await notifyPickupRequestReviewers("a-1");
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
