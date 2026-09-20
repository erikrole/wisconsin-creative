import { describe, expect, it } from "vitest";
import type { ScheduleChangeItem } from "@/lib/schedule-change-history-types";
import {
  recentScheduleActivityItems,
  recentScheduleSyncItems,
  scheduleRelevantSyncDetail,
} from "@/lib/schedule-recent-activity";

function item(overrides: Partial<ScheduleChangeItem>): ScheduleChangeItem {
  return {
    id: "1",
    eventId: "evt",
    entityType: "assignment",
    entityId: "a",
    action: "updated",
    kind: "assignment_assigned",
    label: "Assigned",
    detail: "Nolan · PHOTO",
    actorId: "u1",
    actorName: "Erik",
    actorRole: "ADMIN",
    createdAt: new Date().toISOString(),
    target: { type: "assignment", id: "a", label: "Nolan" },
    afterPublication: true,
    needsReview: false,
    source: "audit",
    ...overrides,
  };
}

describe("recent schedule activity", () => {
  it("keeps crew changes and schedule-meaningful calendar diffs", () => {
    const older = item({ id: "old", createdAt: new Date(Date.now() - 10 * 24 * 3600_000).toISOString() });
    const crew = item({ id: "crew", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const calendar = item({
      id: "cal",
      kind: "event_updated",
      detail: "Opponent: Portland → Gonzaga · Description: TV: Big Ten Network",
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const gear = item({ id: "gear", kind: "reservation_linked", createdAt: new Date().toISOString() });
    const health = {
      changeHistory: {
        events: {
          evt: {
            eventId: "evt",
            count: 4,
            latestAt: calendar.createdAt,
            hasRecentChanges: true,
            needsReview: false,
            items: [older, crew, calendar, gear],
          },
        },
      },
    };

    expect(recentScheduleActivityItems(health as never).map((row) => row.id)).toEqual(["cal", "crew", "old"]);
    expect(recentScheduleActivityItems(health as never)[0]?.detail).toBe("Opponent: Portland → Gonzaga");
    expect(recentScheduleSyncItems(health as never).map((row) => row.id)).toEqual(["cal"]);
  });

  it("drops TV, listing refreshes, and other non-schedule calendar noise", () => {
    expect(scheduleRelevantSyncDetail("Calendar listing refreshed")).toBeNull();
    expect(scheduleRelevantSyncDetail("Description: TV: Big Ten Network → TV: FS1")).toBeNull();
    expect(scheduleRelevantSyncDetail("Title: Football vs Notre Dame - BTN → Football vs Notre Dame - FS1")).toBeNull();
    expect(scheduleRelevantSyncDetail("Label: White Out · Result: Win")).toBeNull();
    expect(scheduleRelevantSyncDetail("Calendar start: Sep 6, 7:00 PM → Sep 6, 8:00 PM")).toBeNull();
    expect(scheduleRelevantSyncDetail("Pickup location changed")).toBeNull();
    expect(
      scheduleRelevantSyncDetail("Title: Volleyball vs Marquette → Volleyball vs Marquette- White Out · Opponent: Marquette → Marquette - White Out"),
    ).toBeNull();
    expect(
      scheduleRelevantSyncDetail("Title: Volleyball vs Milwaukee → Volleyball vs Milwaukee- Wisconsin Day · Opponent: Milwaukee → Milwaukee - Wisconsin Day"),
    ).toBeNull();
  });

  it("keeps time, date, opponent, venue, and addition-shaped calendar diffs", () => {
    expect(scheduleRelevantSyncDetail("Start: Sep 6, 7:00 PM → Sep 6, 8:00 PM")).toBe(
      "Start: Sep 6, 7:00 PM → Sep 6, 8:00 PM",
    );
    expect(scheduleRelevantSyncDetail("Opponent: Illinois → Eastern Michigan · Description: TV: BTN")).toBe(
      "Opponent: Illinois → Eastern Michigan",
    );
    expect(scheduleRelevantSyncDetail("Venue: Camp Randall → Lambeau Field")).toBe(
      "Venue: Camp Randall → Lambeau Field",
    );
    expect(scheduleRelevantSyncDetail("Title: Football vs Illinois → Football vs Eastern Michigan")).toBe(
      "Title: Football vs Illinois → Football vs Eastern Michigan",
    );

    const added = item({
      id: "added",
      kind: "event_created",
      detail: "Women's Soccer at Central Michigan",
    });
    const tvOnly = item({
      id: "tv",
      kind: "event_updated",
      detail: "Description: TV: Peacock",
    });
    const health = {
      changeHistory: {
        events: {
          evt: {
            eventId: "evt",
            count: 2,
            latestAt: added.createdAt,
            hasRecentChanges: true,
            needsReview: false,
            items: [added, tvOnly],
          },
        },
      },
    };

    expect(recentScheduleSyncItems(health as never).map((row) => row.id)).toEqual(["added"]);
  });
});
