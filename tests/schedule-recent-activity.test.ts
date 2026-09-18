import { describe, expect, it } from "vitest";
import type { ScheduleChangeItem } from "@/lib/schedule-change-history-types";
import { recentScheduleActivityItems } from "@/lib/schedule-recent-activity";

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
  it("returns newest crew and calendar changes and skips unrelated kinds", () => {
    const older = item({ id: "old", createdAt: new Date(Date.now() - 10 * 24 * 3600_000).toISOString() });
    const crew = item({ id: "crew", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const calendar = item({
      id: "cal",
      kind: "event_updated",
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
  });
});
