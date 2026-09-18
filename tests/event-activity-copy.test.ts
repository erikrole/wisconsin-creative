import { describe, expect, it } from "vitest";
import type { ScheduleChangeItem } from "@/lib/schedule-change-history-types";
import { describeScheduleChange, prettyChangeTarget } from "@/app/(app)/events/[id]/_activity";

function item(overrides: Partial<ScheduleChangeItem>): ScheduleChangeItem {
  return {
    id: "change-1",
    eventId: "event-1",
    entityType: "shift_assignment",
    entityId: "assignment-1",
    action: "shift_assigned",
    kind: "assignment_assigned",
    label: "Assigned worker",
    detail: null,
    actorId: "user-1",
    actorName: "Erik Role",
    actorRole: "ADMIN",
    createdAt: "2026-09-17T12:00:00.000Z",
    target: { type: "assignment", id: "assignment-1", label: null },
    afterPublication: false,
    needsReview: false,
    source: "audit",
    ...overrides,
  };
}

describe("event activity copy", () => {
  it("turns slot details into readable assignment sentences", () => {
    expect(prettyChangeTarget("Alex Role · VIDEO Student slot")).toBe("Alex Role to Video Student");
    expect(
      describeScheduleChange(item({
        detail: "Alex Role · VIDEO Student slot",
      })).headline,
    ).toBe("Assigned Alex Role to Video Student");
  });

  it("attributes calendar sync rows to UWBadgers.com", () => {
    const described = describeScheduleChange(
      item({
        kind: "event_updated",
        action: "calendar_event_updated",
        label: "Updated event details",
        actorId: null,
        actorName: "System",
        detail: "summary: Volleyball vs Marquette- White Out",
        afterPublication: true,
        needsReview: true,
      }),
      "UWBadgers.com",
    );
    expect(described.headline).toBe("Updated from UWBadgers.com");
    expect(described.actorLabel).toBe("UWBadgers.com");
    expect(described.supporting).toBe("Title: Volleyball vs Marquette- White Out");
    expect(described.filter).toBe("calendar");
    expect(described.showReview).toBe(false);
  });

  it("keeps calendar field diffs readable instead of dropping them", () => {
    const described = describeScheduleChange(
      item({
        kind: "event_updated",
        action: "calendar_event_updated",
        label: "Updated event details",
        actorId: null,
        actorName: "System",
        detail: "Title: Football vs Illinois → Football vs Eastern Michigan · Calendar start: Sep 2, 2:00 AM → Sep 2, 3:19 AM",
      }),
      "UWBadgers.com",
    );
    expect(described.headline).toBe("Updated from UWBadgers.com");
    expect(described.supporting).toBe(
      "Title: Football vs Illinois → Football vs Eastern Michigan · Calendar start: Sep 2, 2:00 AM → Sep 2, 3:19 AM",
    );
  });

  it("says when a calendar update did not record the fields", () => {
    expect(describeScheduleChange(
      item({
        kind: "event_updated",
        action: "calendar_event_updated",
        actorId: null,
        actorName: "System",
        detail: null,
      }),
      "UWBadgers.com",
    ).supporting).toBe("The specific fields were not recorded.");

    expect(describeScheduleChange(
      item({
        kind: "event_updated",
        action: "calendar_event_updated",
        actorId: null,
        actorName: "System",
        detail: "Calendar listing refreshed",
      }),
      "UWBadgers.com",
    ).supporting).toBe("Calendar listing refreshed");
  });
});
