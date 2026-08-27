import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assignmentFindMany: vi.fn(),
  workerFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shiftAssignment: { findMany: mocks.assignmentFindMany },
    eventWorker: { findMany: mocks.workerFindMany },
  },
}));

vi.mock("@/lib/env", () => ({ env: { appTimezone: "America/Chicago" } }));

import { db } from "@/lib/db";
import { shiftAutomaticRuleCounts } from "@/lib/badges/automatic-rules";
import {
  loadWorkedShiftEvidence,
  recentlyWorkedEventUsers,
  usersWithRecentlyWorkedEvents,
} from "@/lib/badges/worked-evidence";

const TZ = "America/Chicago";
const NOW = new Date("2026-11-01T12:00:00.000Z");

function assignmentRow(eventId: string, overrides: Partial<{ area: string; sportCode: string }> = {}) {
  return {
    hasConflict: false,
    callStartsAt: null,
    callEndsAt: null,
    shift: {
      startsAt: new Date("2026-10-10T18:00:00.000Z"),
      endsAt: new Date("2026-10-10T22:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      area: overrides.area ?? "VIDEO",
      shiftGroup: {
        event: {
          id: eventId,
          isHome: true,
          sportCode: overrides.sportCode ?? "FB",
          result: "WIN",
          site: "HOME",
          locationId: "camp-randall",
          opponent: "Ohio State",
        },
      },
    },
  };
}

function workerRow(eventId: string, overrides: Partial<{ allDay: boolean; startsAt: string; endsAt: string; sportCode: string }> = {}) {
  return {
    event: {
      id: eventId,
      startsAt: new Date(overrides.startsAt ?? "2026-10-17T19:00:00.000Z"),
      endsAt: new Date(overrides.endsAt ?? "2026-10-17T23:00:00.000Z"),
      allDay: overrides.allDay ?? false,
      isHome: false,
      sportCode: overrides.sportCode ?? "MBB",
      result: "LOSS",
      site: "AWAY",
      locationId: "kohl-center",
      opponent: "Purdue",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignmentFindMany.mockResolvedValue([]);
  mocks.workerFindMany.mockResolvedValue([]);
});

describe("loadWorkedShiftEvidence", () => {
  it("counts an added worker as worked evidence when no assignment covers the event", async () => {
    mocks.assignmentFindMany.mockResolvedValue([assignmentRow("event-1")]);
    mocks.workerFindMany.mockResolvedValue([workerRow("event-2")]);

    const evidence = await loadWorkedShiftEvidence(db, "user-1", NOW, TZ);

    expect(evidence).toHaveLength(2);
    expect(evidence[1]?.shift.shiftGroup.event.sportCode).toBe("MBB");
  });

  it("never stacks an added worker on top of an assignment for the same event", async () => {
    mocks.assignmentFindMany.mockResolvedValue([assignmentRow("event-1")]);
    mocks.workerFindMany.mockResolvedValue([workerRow("event-1"), workerRow("event-2")]);

    const evidence = await loadWorkedShiftEvidence(db, "user-1", NOW, TZ);

    expect(evidence).toHaveLength(2);
    expect(evidence.filter((row) => row.shift.shiftGroup.event.id === "event-1")).toHaveLength(1);
  });

  it("reads only finished, non-cancelled events on both sides", async () => {
    await loadWorkedShiftEvidence(db, "user-1", NOW, TZ);

    const assignmentWhere = mocks.assignmentFindMany.mock.calls[0]![0].where;
    expect(assignmentWhere.shift.shiftGroup.event).toEqual({
      endsAt: { lt: NOW },
      status: "CONFIRMED",
    });
    const workerWhere = mocks.workerFindMany.mock.calls[0]![0].where;
    expect(workerWhere).toEqual({
      userId: "user-1",
      event: { endsAt: { lt: NOW }, status: "CONFIRMED" },
    });
  });

  it("claims no area for an added worker, so area breadth is not inflated", async () => {
    mocks.workerFindMany.mockResolvedValue([workerRow("event-2")]);

    const evidence = await loadWorkedShiftEvidence(db, "user-1", NOW, TZ);
    const counts = shiftAutomaticRuleCounts(evidence, TZ);

    expect(evidence[0]?.shift.area).toBe("");
    expect(counts.get("shift_areas")).toBe(0);
    expect(counts.get("shift_sport_area_pairs")).toBe(0);
  });

  it("takes the away, loss, opponent, and venue rules from the event itself", async () => {
    mocks.workerFindMany.mockResolvedValue([workerRow("event-2")]);

    const counts = shiftAutomaticRuleCounts(await loadWorkedShiftEvidence(db, "user-1", NOW, TZ), TZ);

    expect(counts.get("shift_away_completed")).toBe(1);
    expect(counts.get("shift_losses")).toBe(1);
    expect(counts.get("shift_opponents")).toBe(1);
    expect(counts.get("shift_venues")).toBe(1);
  });

  it("keeps an all-day added worker out of the early-start and late-finish rules", async () => {
    // Stored as a date at UTC midnight: reading its hours as a work window
    // would claim a midnight start and a next-day finish nobody worked.
    mocks.workerFindMany.mockResolvedValue([
      workerRow("event-3", {
        allDay: true,
        startsAt: "2026-10-20T00:00:00.000Z",
        endsAt: "2026-10-21T00:00:00.000Z",
      }),
    ]);

    const evidence = await loadWorkedShiftEvidence(db, "user-1", NOW, TZ);
    const counts = shiftAutomaticRuleCounts(evidence, TZ);

    expect(evidence[0]?.hoursKnown).toBe(false);
    expect(counts.get("shift_before_7")).toBe(0);
    expect(counts.get("shift_after_22")).toBe(0);
  });

  it("anchors an all-day added worker to its own calendar date, not the UTC boundary", async () => {
    mocks.workerFindMany.mockResolvedValue([
      workerRow("event-3", {
        allDay: true,
        startsAt: "2026-10-20T00:00:00.000Z",
        endsAt: "2026-10-21T00:00:00.000Z",
      }),
    ]);

    const evidence = await loadWorkedShiftEvidence(db, "user-1", NOW, TZ);
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
      evidence[0]!.shift.startsAt,
    );

    expect(localDate).toBe("2026-10-20");
  });

  it("still trips the hour rules for a timed added worker", async () => {
    mocks.workerFindMany.mockResolvedValue([
      workerRow("event-4", {
        // 5:00am–6:30am Central.
        startsAt: "2026-10-22T10:00:00.000Z",
        endsAt: "2026-10-22T11:30:00.000Z",
      }),
    ]);

    const counts = shiftAutomaticRuleCounts(await loadWorkedShiftEvidence(db, "user-1", NOW, TZ), TZ);

    expect(counts.get("shift_before_7")).toBe(1);
  });
});

describe("usersWithRecentlyWorkedEvents", () => {
  it("marks recent added-worker users for a silent nightly recognition pass", async () => {
    mocks.assignmentFindMany.mockResolvedValue([{ userId: "user-1" }, { userId: "user-2" }]);
    mocks.workerFindMany.mockResolvedValue([{ userId: "user-2" }, { userId: "user-3" }]);

    const since = new Date("2026-10-30T12:00:00.000Z");
    const users = await recentlyWorkedEventUsers(since, NOW);

    expect(users).toEqual([
      { userId: "user-1", hasAddedWorker: false, hasBackfilledAssignment: false },
      { userId: "user-2", hasAddedWorker: true, hasBackfilledAssignment: false },
      { userId: "user-3", hasAddedWorker: true, hasBackfilledAssignment: false },
    ]);
  });

  it("marks assignments created after their event ended for silent recognition", async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      {
        userId: "user-1",
        createdAt: new Date("2026-10-31T23:00:00.000Z"),
        shift: { shiftGroup: { event: { endsAt: new Date("2026-10-31T22:00:00.000Z") } } },
      },
    ]);

    await expect(recentlyWorkedEventUsers(new Date("2026-10-30T12:00:00.000Z"), NOW)).resolves.toEqual([
      { userId: "user-1", hasAddedWorker: false, hasBackfilledAssignment: true },
    ]);
  });

  it("sweeps added workers alongside assigned people, without duplicates", async () => {
    mocks.assignmentFindMany.mockResolvedValue([{ userId: "user-1" }, { userId: "user-2" }]);
    mocks.workerFindMany.mockResolvedValue([{ userId: "user-2" }, { userId: "user-3" }]);

    const since = new Date("2026-10-30T12:00:00.000Z");
    const users = await usersWithRecentlyWorkedEvents(since, NOW);

    expect(users.sort()).toEqual(["user-1", "user-2", "user-3"]);
    expect(mocks.workerFindMany.mock.calls[0]![0].where.event).toEqual({
      endsAt: { lt: NOW, gte: since },
      status: "CONFIRMED",
    });
  });
});
