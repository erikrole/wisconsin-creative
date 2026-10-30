import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    eventTravelMember: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { loadTravelRoster } from "@/lib/services/event-travel";

const user = (id: string, name: string) => ({ id, name, role: "STUDENT", primaryArea: null, avatarUrl: null });

describe("loadTravelRoster", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds the away crew after hand-added travelers without duplicates", async () => {
    vi.mocked(db.eventTravelMember.findMany).mockResolvedValue([
      { id: "m1", eventId: "e1", userId: "u1", notes: null, createdAt: new Date(), user: user("u1", "Zed") },
    ] as never);
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([
      { userId: "u1", createdAt: new Date(), user: user("u1", "Zed") },
      { userId: "u2", createdAt: new Date(), user: user("u2", "Amy") },
    ] as never);

    vi.mocked(db.booking.findMany).mockResolvedValue([
      { requesterUserId: "u2", _count: { serializedItems: 2 }, bulkItems: [{ checkedOutQuantity: 4, checkedInQuantity: 1 }] },
    ] as never);

    const roster = await loadTravelRoster("e1", true);

    expect(roster.map((r) => [r.userId, r.fromCrew, r.gearOut])).toEqual([["u2", true, 5], ["u1", false, 0]]);
    expect(roster[0]?.id).toBe("crew:u2");
  });

  it("skips the crew for home games", async () => {
    vi.mocked(db.eventTravelMember.findMany).mockResolvedValue([]);
    expect(await loadTravelRoster("e1", false)).toEqual([]);
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });
});
