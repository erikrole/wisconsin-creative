import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  buildNotificationEmail: vi.fn().mockReturnValue({ html: "<p>n</p>", text: "n" }),
}));
vi.mock("@/lib/push/apns", () => ({
  sendPush: vi.fn().mockResolvedValue({ revoked: [], ok: 1 }),
}));
vi.mock("@/lib/push/web", () => ({
  sendWebPushToUsers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/shift-reminder-workflow", () => ({ enqueueShiftReminder: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    $executeRaw: vi.fn().mockResolvedValue(0),
    booking: { findFirst: vi.fn() },
    shiftAssignment: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    notification: { create: vi.fn(), createManyAndReturn: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    notificationDelivery: { createMany: vi.fn() },
    deviceToken: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { sendPush } from "@/lib/push/apns";
import {
  createReservationLifecycleNotification,
  createShiftGearUpNotification,
  createShiftScheduleNotificationFromSnapshot,
  sendPushToUser,
} from "@/lib/services/notifications";
import { resolveSettledNotifications } from "@/lib/services/notification-resolution";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function gearUpAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    userId: "student-1",
    shiftId: "shift-1",
    source: "MANUAL",
    user: { id: "student-1", email: "student@example.com", active: true },
    shift: {
      area: "Video",
      startsAt: new Date("2026-11-01T18:00:00Z"),
      shiftGroup: {
        publishedAt: new Date("2026-10-01T00:00:00Z"),
        event: { id: "event-1", summary: "Football vs Iowa", startsAt: new Date(), sportCode: "FB", opponent: "Iowa", isHome: true, locationId: null },
      },
    },
    ...overrides,
  };
}

const snapshot = {
  assignmentId: "assignment-1",
  shiftId: "shift-1",
  userId: "student-1",
  userEmail: "student@example.com",
  userActive: true,
  publishedAt: new Date("2026-10-01T00:00:00Z"),
  area: "Video",
  workerType: "ST",
  shiftStartsAt: new Date("2026-11-01T18:00:00Z"),
  callStartsAt: null,
  callEndsAt: null,
  callNote: null,
  calendarEvent: {
    id: "event-1",
    summary: "Football vs Iowa",
    startsAt: new Date("2026-11-01T18:00:00Z"),
    endsAt: new Date("2026-11-01T22:00:00Z"),
    allDay: false,
    sportCode: "FB",
    opponent: "Iowa",
    isHome: true,
    site: "HOME" as const,
    locationId: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.notification.createManyAndReturn).mockResolvedValue([{ id: "n-1" }] as never);
  vi.mocked(db.notification.create).mockResolvedValue({ id: "n-1" } as never);
  vi.mocked(db.notification.findUnique).mockResolvedValue(null);
  vi.mocked(db.notification.count).mockResolvedValue(1);
  vi.mocked(db.deviceToken.findMany).mockResolvedValue([{ token: "a".repeat(64) }] as never);
  vi.mocked(db.user.findUnique).mockResolvedValue({ active: true, notificationPrefs: { channels: { email: true, push: true } } } as never);
  vi.mocked(db.booking.findFirst).mockResolvedValue(null);
});

describe("receipts for things people did themselves", () => {
  it("writes a self-made reservation as read and never pushes it", async () => {
    await createReservationLifecycleNotification({
      bookingId: "booking-1",
      bookingTitle: "Camera kit",
      requesterUserId: "student-1",
      actorUserId: "student-1",
      event: "updated",
      version: new Date(),
    });
    await flush();

    const row = vi.mocked(db.notification.createManyAndReturn).mock.calls[0]![0]!.data as Array<{ readAt: Date | null }>;
    expect(row[0]!.readAt).toBeInstanceOf(Date);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("still tells someone when staff made the reservation for them", async () => {
    await createReservationLifecycleNotification({
      bookingId: "booking-1",
      bookingTitle: "Camera kit",
      requesterUserId: "student-1",
      actorUserId: "staff-1",
      event: "booked",
    });
    await flush();

    const row = vi.mocked(db.notification.createManyAndReturn).mock.calls[0]![0]!.data as Array<{ readAt: Date | null }>;
    expect(row[0]!.readAt).toBeNull();
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("makes a shift the worker put themselves on a silent read receipt", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot, "assigned", { actorUserId: "student-1" });
    await flush();

    expect(vi.mocked(db.notification.create).mock.calls[0]![0].data.readAt).toBeInstanceOf(Date);
    expect(sendPush).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still pushes a shift someone else assigned", async () => {
    await createShiftScheduleNotificationFromSnapshot(snapshot, "assigned", { actorUserId: "staff-1" });
    await flush();

    expect(vi.mocked(db.notification.create).mock.calls[0]![0].data.readAt).toBeNull();
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("gear-up nudge", () => {
  it("skips an assignment that came from the worker's own reservation", async () => {
    vi.mocked(db.shiftAssignment.findUnique).mockResolvedValue(gearUpAssignment({ source: "RESERVATION" }) as never);

    await createShiftGearUpNotification("assignment-1", { source: "assignment" });

    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("skips someone who already has gear booked for the event", async () => {
    vi.mocked(db.shiftAssignment.findUnique).mockResolvedValue(gearUpAssignment() as never);
    vi.mocked(db.booking.findFirst).mockResolvedValue({ id: "booking-1" } as never);

    await createShiftGearUpNotification("assignment-1", { source: "assignment" });

    expect(db.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requesterUserId: "student-1",
        status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] },
        OR: [{ shiftAssignmentId: "assignment-1" }, { events: { some: { eventId: "event-1" } } }],
      }),
    }));
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("nudges someone with no gear for the event", async () => {
    vi.mocked(db.shiftAssignment.findUnique).mockResolvedValue(gearUpAssignment() as never);

    await createShiftGearUpNotification("assignment-1", { source: "assignment" });

    expect(db.notification.create).toHaveBeenCalledTimes(1);
  });

  it("always sends a staff nudge", async () => {
    vi.mocked(db.shiftAssignment.findUnique).mockResolvedValue(gearUpAssignment({ source: "RESERVATION" }) as never);
    vi.mocked(db.booking.findFirst).mockResolvedValue({ id: "booking-1" } as never);

    await createShiftGearUpNotification("assignment-1", { source: "manual_nudge" });

    expect(db.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe("settling resolved notifications", () => {
  function sqlOf(call: unknown[]): string {
    const [strings] = call as [TemplateStringsArray];
    return strings.join("?");
  }

  it("covers closed bookings, ended events, decided reviews, and old badges in one update", async () => {
    vi.mocked(db.$executeRaw).mockResolvedValueOnce(42 as never);

    const settled = await resolveSettledNotifications({ now: new Date("2026-10-21T12:00:00Z") });

    expect(settled).toBe(42);
    const sql = sqlOf(vi.mocked(db.$executeRaw).mock.calls[0]!);
    expect(sql).toContain(`UPDATE "notifications"`);
    expect(sql).toContain(`n."read_at" IS NULL`);
    expect(sql).toContain(`b."status" IN ('BOOKED', 'PENDING_PICKUP', 'OPEN')`);
    expect(sql).toContain(`FROM "calendar_events"`);
    expect(sql).toContain(`a."status" = 'REQUESTED'`);
    expect(sql).toContain(`t."status" = 'CLAIMED'`);
    expect(sql).toContain(`n."type" = 'badge_awarded'`);
    expect(sql).toContain(`n."type" = 'shift_gear_up'`);
    expect(sql).toContain(`newer."created_at" > n."created_at"`);
    // Item reports and other rows someone still has to look at are left alone.
    expect(sql).not.toContain("checkin_item");
  });

  it("scopes the per-person variant to that person", async () => {
    await resolveSettledNotifications({ userId: "student-1" });

    const call = vi.mocked(db.$executeRaw).mock.calls[0]!;
    const values = call.slice(1).flatMap((value) => {
      const sql = value as { values?: unknown[] };
      return sql && typeof sql === "object" && Array.isArray(sql.values) ? sql.values : [value];
    });
    expect(values).toContain("student-1");
  });
});

describe("overnight staff follow-ups", () => {
  async function pushAt(iso: string, quietOvernight: boolean) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
    try {
      await sendPushToUser("staff-1", { title: "Checkout 4 hours overdue", category: "checkoutOverdue", quietOvernight });
    } finally {
      vi.useRealTimers();
    }
    return vi.mocked(sendPush).mock.calls.at(-1)![1] as { sound: boolean; interruptionLevel: string };
  }

  it("arrives silently at 3 AM Central", async () => {
    const sent = await pushAt("2026-10-21T08:00:00Z", true);
    expect(sent).toMatchObject({ sound: false, interruptionLevel: "passive" });
  });

  it("alerts normally in the daytime", async () => {
    const sent = await pushAt("2026-10-21T15:00:00Z", true);
    expect(sent).toMatchObject({ sound: true, interruptionLevel: "time-sensitive" });
  });

  it("never quiets the person holding the gear", async () => {
    const sent = await pushAt("2026-10-21T08:00:00Z", false);
    expect(sent).toMatchObject({ sound: true, interruptionLevel: "time-sensitive" });
  });
});
