import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, ShiftWorkerType } from "@prisma/client";

const db = vi.hoisted(() => ({
  shiftGroup: { findMany: vi.fn() },
  booking: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import { getScheduleChangeHistory } from "@/lib/services/schedule-change-history";

const publishedAt = new Date("2026-10-01T12:00:00.000Z");
const before = new Date("2026-09-30T12:00:00.000Z");
const after = new Date("2026-10-02T12:00:00.000Z");

function row(id: string, entityType: string, entityId: string, action: string, overrides: Record<string, unknown> = {}) {
  return { id, actorUserId: "u1", entityType, entityId, action, beforeJson: null, afterJson: null, createdAt: after, actor: { id: "u1", name: "Sam", role: "STAFF" }, ...overrides };
}

async function only(auditRow: ReturnType<typeof row>, input: Partial<Parameters<typeof getScheduleChangeHistory>[0]> = {}) {
  db.auditLog.findMany.mockResolvedValue([auditRow]);
  const history = await getScheduleChangeHistory({ eventIds: ["e1"], ...input });
  return history.events.e1!.items[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  db.shiftGroup.findMany.mockResolvedValue([{
    id: "g1",
    eventId: "e1",
    publishedAt,
    shifts: [{ id: "s1", area: "PHOTO", workerType: ShiftWorkerType.ST, assignments: [{ id: "a1", user: { name: "Maya" } }, { id: "a2", user: null }] }],
  }]);
  db.booking.findMany.mockResolvedValue([]);
  db.auditLog.findMany.mockResolvedValue([]);
});

describe("schedule change labels", () => {
  it.each([
    ["shift_assignment", "a1", "shift_assignment_removed", "assignment_removed", "Removed worker", "Maya · PHOTO Student slot"],
    ["shift_assignment", "a2", "shift_swapped", "assignment_updated", "Swapped workers", "PHOTO Student slot"],
    ["shift_assignment", "a1", "shift_request_approved", "assignment_assigned", "Approved shift request", "Maya · PHOTO Student slot"],
    ["shift_assignment", "a1", "shift_request_declined", "assignment_removed", "Declined shift request", "Maya · PHOTO Student slot"],
    ["shift_assignment", "a1", "shift_assignment_acknowledged", "assignment_updated", "Acknowledged shift", "Maya · PHOTO Student slot"],
    ["shift_assignment", "a1", "shift_assignment_role_slot_repaired", "assignment_updated", "Repaired role slot", "Maya · PHOTO Student slot"],
    ["shift_assignment", "a1", "shift_pickup_requested", "pickup_requested", "Pickup requested", "Maya · PHOTO Student slot"],
    ["shift_assignment", "a1", "shift_pickup_claimed", "pickup_claimed", "Open shift claimed", "Maya · PHOTO Student slot"],
    ["shift", "s1", "shift_added", "shift_created", "Added shift", "PHOTO Student slot"],
    ["shift", "s1", "shift_removed", "shift_deleted", "Removed shift", "PHOTO Student slot"],
    ["shift", "s1", "shift_updated", "shift_updated", "Updated shift time", "PHOTO Student slot"],
    ["shift_group", "g1", "shift_backfill_executed", "copy_forward_applied", "Backfilled schedule", null],
    ["shift_group", "g1", "shift_group_regenerated", "republished", "Regenerated schedule", null],
    ["shift_group", "g1", "shift_group_updated", "shift_updated", "Updated schedule settings", null],
    ["shift_group", "g1", "shift_group_republished", "republished", "Republished schedule", null],
    ["shift_group", "g1", "shift_group_republished_now", "republished", "Republished schedule now", null],
    ["shift_group", "g1", "shift_group_archived", "shift_group_archived", "Archived schedule", null],
    ["calendar_event", "e1", "calendar_event_visibility_updated", "event_visibility_updated", "Updated visibility", null],
    ["shift_group", "g1", "crew_note_cleared", "unknown", "Crew note cleared", null],
  ])("%s %s", async (entityType, entityId, action, kind, label, detail) => {
    const item = await only(row("r1", entityType, entityId, action));
    expect(item).toMatchObject({ kind, label, detail });
  });

  it("names the event created and the crew copied forward", async () => {
    expect(await only(row("r1", "calendar_event", "e1", "calendar_event_created", { afterJson: { summary: "Volleyball vs Nebraska" } })))
      .toMatchObject({ kind: "event_created", detail: "Volleyball vs Nebraska" });
    expect(await only(row("r1", "shift_group", "g1", "shift_group_copy_forward_applied", { afterJson: { assigned: 4 } })))
      .toMatchObject({ label: "Copied crew forward", detail: "4 assigned" });
  });

  it("shows the new shift time in Madison time", async () => {
    const item = await only(row("r1", "shift", "s1", "shift_updated", {
      beforeJson: { startsAt: "2026-10-10T17:00:00.000Z" },
      afterJson: { startsAt: "2026-10-10T16:00:00.000Z" },
    }));
    expect(item!.detail).toBe("startsAt: Oct 10, 11:00 AM");
  });
});

describe("working-copy edits", () => {
  it.each([
    ["assignMany", undefined, "assignment_assigned", "Assigned workers"],
    ["unassign", undefined, "assignment_removed", "Removed worker"],
    ["convertAndReplace", undefined, "assignment_updated", "Replaced worker"],
    ["setCallWindowForAll", undefined, "assignment_updated", "Updated call time"],
    ["setCrewLabel", undefined, "assignment_updated", "Updated position label"],
    ["adjustSlots", -1, "shift_deleted", "Removed shift"],
    ["adjustSlots", 1, "shift_created", "Added shift"],
    ["removeSlot", undefined, "shift_deleted", "Removed shift"],
    ["setSlotCounts", undefined, "shift_updated", "Changed crew size"],
    ["convertSlot", undefined, "shift_updated", "Converted shift"],
  ])("%s %s", async (type, delta, kind, label) => {
    const item = await only(row("r1", "shift_group_working_copy", "g1", "working_copy_command", {
      beforeJson: { command: { type, delta } },
    }), { includeWorkingCopy: true });
    expect(item).toMatchObject({ kind, label, detail: "Working copy", target: { type: "shift_group", id: "g1" } });
  });

  it("falls back to the action words for an unknown command", async () => {
    const item = await only(row("r1", "shift_group_working_copy", "g1", "working_copy_command", { beforeJson: { command: { type: "teleport" } } }), { includeWorkingCopy: true });
    expect(item).toMatchObject({ kind: "unknown", label: "working copy command" });
  });
});

describe("calendar field changes", () => {
  it("writes each changed field in plain words", async () => {
    const item = await only(row("r1", "calendar_event", "e1", "calendar_event_updated", {
      beforeJson: { isHome: true, allDay: false, result: null, status: "SCHEDULED", description: "Old", locationId: "l1", locationLocked: false, site: "HOME" },
      afterJson: { isHome: false, allDay: true, result: "WIN", status: "IN_PROGRESS", description: `${"x".repeat(100)}`, locationId: "l2", locationLocked: true, site: "NEUTRAL" },
    }));
    const parts = item!.detail!.split(" · ");
    expect(parts).toEqual([
      "All day: Timed → All day",
      "Home/Away: Home → Away",
      "Site: Home → Neutral",
      "Status: SCHEDULED → IN PROGRESS",
      "Result: Win",
      `Description: Old → ${"x".repeat(77)}…`,
      "Pickup location changed",
    ]);
  });

  it("shows a cleared field, and skips the location when the venue text changed", async () => {
    const item = await only(row("r1", "calendar_event", "e1", "calendar_event_updated", {
      beforeJson: { opponent: "Iowa", description: "Bus at 9", rawLocationText: "Camp Randall", locationId: "l1" },
      afterJson: { opponent: null, description: "   ", rawLocationText: "Kohl Center", locationId: "l2" },
    }));
    // Recent activity keys on the "Opponent:" label, so a cleared opponent reads "→ None".
    expect(item!.detail).toBe("Opponent: Iowa → None · Description removed · Venue: Camp Randall → Kohl Center");
  });

  it("treats the same instant written two ways as unchanged", async () => {
    const item = await only(row("r1", "calendar_event", "e1", "calendar_event_updated", {
      beforeJson: { startsAt: "2026-10-10T16:00:00Z", isHome: null },
      afterJson: { startsAt: "2026-10-10T16:00:00.000Z" },
    }));
    expect(item!.detail).toBe("Calendar listing refreshed");
  });
});

describe("history summaries", () => {
  it("caps items per event, keeps the newest first, and marks recent changes", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T12:00:00.000Z") });
    try {
      db.auditLog.findMany.mockResolvedValue([
        row("r3", "shift", "s1", "shift_added", { createdAt: new Date("2026-10-04T12:00:00.000Z") }),
        row("r2", "shift", "s1", "shift_added", { createdAt: new Date("2026-10-03T12:00:00.000Z") }),
        row("r1", "shift", "s1", "shift_added", { createdAt: new Date("2026-10-02T12:00:00.000Z") }),
      ]);

      const { events } = await getScheduleChangeHistory({ eventIds: ["e1", "e1", ""], limitPerEvent: 2, since: before });

      expect(Object.keys(events)).toEqual(["e1"]);
      expect(events.e1).toMatchObject({ count: 2, latestAt: "2026-10-04T12:00:00.000Z", hasRecentChanges: true, needsReview: true });
      expect(events.e1!.items.map((item) => item.id)).toEqual(["r3", "r2"]);
      expect(db.auditLog.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { createdAt: { gte: before } }, take: 50 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask for review of publishing or acknowledging, and names system changes", async () => {
    expect(await only(row("r1", "shift_group", "g1", "shift_group_published_now"))).toMatchObject({ afterPublication: true, needsReview: false });
    expect(await only(row("r1", "shift_assignment", "a1", "shift_acknowledged"))).toMatchObject({ needsReview: false });
    expect(await only(row("r1", "calendar_event", "e1", "calendar_event_created", { actor: null, actorUserId: null, afterJson: { _actorRole: "SYSTEM" } })))
      .toMatchObject({ actorName: "System", actorRole: "SYSTEM", afterPublication: true });
  });

  it("answers empty summaries without a query when no event is asked for", async () => {
    expect(await getScheduleChangeHistory({ eventIds: [] })).toEqual({ events: {} });
    expect(db.shiftGroup.findMany).not.toHaveBeenCalled();
  });

  it("leaves working-copy rows out unless asked, and gear bookings only show as reservations", async () => {
    await getScheduleChangeHistory({ eventIds: ["e1"] });
    expect(JSON.stringify(db.auditLog.findMany.mock.calls[0]?.[0]?.where)).not.toContain("shift_group_working_copy");

    db.booking.findMany.mockResolvedValue([{ id: "b1", kind: BookingKind.RESERVATION, title: "Camera kit", eventId: null, shiftAssignmentId: "a1", events: [] }]);
    const item = await only(row("r1", "booking", "b1", "created", { createdAt: before }));
    expect(item).toMatchObject({ kind: "reservation_linked", label: "Reserved gear", detail: "Camera kit", afterPublication: false, target: { type: "booking", label: "Camera kit" } });
  });
});
