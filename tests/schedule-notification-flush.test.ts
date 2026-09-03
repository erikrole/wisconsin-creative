import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, findMany, notifyScheduleChanges } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  notifyScheduleChanges: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { shiftGroup: { findUnique, update, findMany } },
}));
vi.mock("@/lib/services/notifications", () => ({ notifyScheduleChanges }));

import {
  flushScheduleNotifications,
  sweepDueScheduleNotifications,
} from "@/lib/services/schedule-notification-flush";

const NOW = new Date("2026-10-15T12:00:00.000Z");

function shift(assignedUserIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt: new Date("2026-10-17T22:00:00.000Z"),
    endsAt: new Date("2026-10-18T03:00:00.000Z"),
    callStartsAt: new Date("2026-10-17T21:30:00.000Z"),
    callEndsAt: new Date("2026-10-18T02:00:00.000Z"),
    assignments: assignedUserIds.map((userId, index) => ({
      id: `assignment-${index}`,
      userId,
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
    })),
    ...overrides,
  };
}

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: "group-1",
    publishedAt: new Date("2026-10-01T00:00:00.000Z"),
    publishedVersion: 4,
    lastPublishedSnapshot: null,
    notifyAfter: null,
    // Comfortably in the future: a finished event is never notified about.
    event: {
      id: "event-1",
      summary: "Wisconsin vs Ohio State",
      endsAt: new Date("2099-01-01T00:00:00.000Z"),
    },
    shifts: [shift(["user-1"])],
    ...overrides,
  };
}

describe("finished events", () => {
  it("clears a pending release instead of paging the crew about last week", async () => {
    // Crew records get corrected after the fact, and every edit restarts the
    // quiet period. Two past events were sitting with a release scheduled.
    findUnique.mockResolvedValue(group({
      event: {
        id: "event-1",
        summary: "Volleyball vs Kentucky",
        endsAt: new Date("2026-08-22T04:00:00.000Z"),
      },
      lastPublishedSnapshot: markFor([]),
      notifyAfter: new Date("2026-08-24T20:35:00.000Z"),
    }));

    const outcome = await flushScheduleNotifications("group-1", {
      now: new Date("2026-08-24T20:36:00.000Z"),
    });

    expect(outcome.status).toBe("event_ended");
    expect(notifyScheduleChanges).not.toHaveBeenCalled();
    // The pending release is cleared so it cannot resurface...
    const write = update.mock.calls[0]?.[0];
    expect(write?.data?.notifyAfter).toBeNull();
    // ...but no publication version is claimed for a release that never ran.
    expect(write?.data?.publishedVersion).toBeUndefined();
  });

  it("still notifies for an event that has not happened yet", async () => {
    findUnique.mockResolvedValue(group({
      lastPublishedSnapshot: markFor([]),
    }));

    const outcome = await flushScheduleNotifications("group-1", {
      now: new Date("2026-10-02T00:00:00.000Z"),
    });

    expect(outcome.status).toBe("delivered");
    expect(notifyScheduleChanges).toHaveBeenCalled();
  });
});

/** The snapshot a previous flush would have stored for the same crew. */
function markFor(userIds: string[]) {
  return {
    shifts: [{
      shiftId: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      startsAt: "2026-10-17T22:00:00.000Z",
      endsAt: "2026-10-18T03:00:00.000Z",
      callStartsAt: "2026-10-17T21:30:00.000Z",
      callEndsAt: "2026-10-18T02:00:00.000Z",
      assignments: userIds.map((userId, index) => ({
        id: `assignment-${index}`,
        userId,
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
      })),
    }],
  };
}

describe("flushScheduleNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({});
    notifyScheduleChanges.mockResolvedValue({ notified: [] });
  });

  it("sends nothing when the crew ends the quiet period where it started", async () => {
    findUnique.mockResolvedValue(group({ lastPublishedSnapshot: markFor(["user-1"]) }));

    const result = await flushScheduleNotifications("group-1", { now: NOW });

    expect(result).toEqual({ status: "nothing_to_tell", shiftGroupId: "group-1" });
    expect(notifyScheduleChanges).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notifyAfter: null, notifyError: null }),
    }));
  });

  it("tells the worker whose assignment is new", async () => {
    findUnique.mockResolvedValue(group({ lastPublishedSnapshot: markFor([]) }));

    const result = await flushScheduleNotifications("group-1", { now: NOW });

    expect(result).toMatchObject({ status: "delivered", userIds: ["user-1"], version: 5 });
    expect(notifyScheduleChanges).toHaveBeenCalledWith(expect.objectContaining({
      eventTitle: "Wisconsin vs Ohio State",
      flushVersion: 5,
    }));
  });

  it("does not notify about a Student call-only edit for an Away event", async () => {
    findUnique.mockResolvedValue(group({
      event: {
        id: "event-1",
        summary: "Wisconsin at Iowa",
        startsAt: new Date("2026-10-17T21:00:00.000Z"),
        endsAt: new Date("2026-10-18T02:00:00.000Z"),
        allDay: false,
        opponent: "Iowa",
        isHome: false,
        site: "AWAY",
      },
      shifts: [shift(["user-1"], {
        callStartsAt: new Date("2026-10-17T20:00:00.000Z"),
        assignments: [{
          id: "assignment-0",
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
          callStartsAt: new Date("2026-10-17T20:15:00.000Z"),
          callEndsAt: null,
          callNote: "Use the visitor entrance.",
        }],
      })],
      lastPublishedSnapshot: markFor(["user-1"]),
    }));

    const result = await flushScheduleNotifications("group-1", { now: NOW });

    expect(result).toEqual({ status: "nothing_to_tell", shiftGroupId: "group-1" });
    expect(notifyScheduleChanges).not.toHaveBeenCalled();
  });

  it("holds the high-water mark when delivery throws", async () => {
    findUnique.mockResolvedValue(group({ lastPublishedSnapshot: markFor([]) }));
    notifyScheduleChanges.mockRejectedValue(new Error("APNs unavailable"));

    const result = await flushScheduleNotifications("group-1", { now: NOW });

    expect(result).toMatchObject({ status: "failed", error: "APNs unavailable" });
    const written = update.mock.calls.at(-1)?.[0]?.data;
    expect(written).toMatchObject({ notifyError: "APNs unavailable" });
    expect(written).not.toHaveProperty("lastPublishedSnapshot");
  });

  it("stands down when a later edit pushed the quiet period out", async () => {
    findUnique.mockResolvedValue(group({
      notifyAfter: new Date(NOW.getTime() + 60_000),
      lastPublishedSnapshot: markFor([]),
    }));

    const result = await flushScheduleNotifications("group-1", { now: NOW });

    expect(result).toMatchObject({ status: "deferred" });
    expect(notifyScheduleChanges).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("runs anyway when forced", async () => {
    findUnique.mockResolvedValue(group({
      notifyAfter: new Date(NOW.getTime() + 60_000),
      lastPublishedSnapshot: markFor([]),
    }));

    const result = await flushScheduleNotifications("group-1", { now: NOW, force: true });
    expect(result).toMatchObject({ status: "delivered" });
  });

  it("reports a group that no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    expect(await flushScheduleNotifications("group-1", { now: NOW }))
      .toEqual({ status: "missing", shiftGroupId: "group-1" });
  });

  it("stamps publishedAt on the first flush and keeps it afterwards", async () => {
    findUnique.mockResolvedValue(group({ publishedAt: null, lastPublishedSnapshot: markFor([]) }));
    await flushScheduleNotifications("group-1", { now: NOW });
    expect(update.mock.calls.at(-1)?.[0]?.data).toMatchObject({ publishedAt: NOW });

    update.mockClear();
    const earlier = new Date("2026-10-01T00:00:00.000Z");
    findUnique.mockResolvedValue(group({ publishedAt: earlier, lastPublishedSnapshot: markFor([]) }));
    await flushScheduleNotifications("group-1", { now: NOW });
    expect(update.mock.calls.at(-1)?.[0]?.data).toMatchObject({ publishedAt: earlier });
  });

  it("treats a removal as worth telling someone about", async () => {
    findUnique.mockResolvedValue(group({
      shifts: [shift([])],
      lastPublishedSnapshot: markFor(["user-1"]),
    }));

    expect(await flushScheduleNotifications("group-1", { now: NOW }))
      .toMatchObject({ status: "delivered", userIds: ["user-1"] });
  });
});

describe("sweepDueScheduleNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({});
    notifyScheduleChanges.mockResolvedValue({ notified: [] });
  });

  it("delivers flushes whose timer never fired", async () => {
    findMany.mockResolvedValue([{ id: "group-1" }, { id: "group-2" }]);
    findUnique.mockResolvedValue(group({ lastPublishedSnapshot: markFor([]) }));

    const outcomes = await sweepDueScheduleNotifications({ now: NOW });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { notifyAfter: { not: null, lte: NOW } },
    }));
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => outcome.status === "delivered")).toBe(true);
  });

  it("does nothing when no group is waiting", async () => {
    findMany.mockResolvedValue([]);
    expect(await sweepDueScheduleNotifications({ now: NOW })).toEqual([]);
  });
});
