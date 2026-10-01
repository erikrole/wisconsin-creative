import { describe, expect, it } from "vitest";
import {
  crewWithoutGear,
  projectNextUp,
  projectPickups,
  projectTodayTiles,
  type HomeCheckoutRow,
  type HomeEventRow,
  type HomePickupRow,
} from "@/lib/services/kiosk-dashboard-home";

const now = new Date("2026-09-25T18:00:00.000Z"); // 1:00 PM Central
const today = { start: new Date("2026-09-25T05:00:00.000Z"), end: new Date("2026-09-26T05:00:00.000Z") };
const hour = 60 * 60 * 1000;
const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * hour);
const person = (id: string) => ({ id, name: `Person ${id}`, avatarUrl: null });

function checkout(id: string, requesterId: string, endsAt: Date, extra: Partial<HomeCheckoutRow> = {}): HomeCheckoutRow {
  return { id, endsAt, custodyScope: "PERSON", eventId: null, shiftAssignmentId: null, events: [], requester: person(requesterId), ...extra };
}

function pickupRow(id: string, requesterId: string, startsAt: Date, extra: Partial<HomePickupRow> = {}): HomePickupRow {
  return {
    id, kind: "RESERVATION", title: `Pickup ${id}`, startsAt, custodyScope: "PERSON", eventId: null,
    requester: person(requesterId), _count: { serializedItems: 2 }, bulkItems: [{ plannedQuantity: 3, checkedOutQuantity: 1 }], ...extra,
  };
}

function event(id: string, assignments: Array<{ id: string; user: string; callAt: Date }>): HomeEventRow {
  return {
    id, summary: `Event ${id}`, startsAt: at(3), allDay: false,
    shiftGroup: {
      shifts: assignments.map((a) => ({
        callStartsAt: null, startsAt: a.callAt, endsAt: at(6),
        assignments: [{ id: a.id, callStartsAt: a.callAt, user: person(a.user) }],
      })),
    },
  };
}

describe("kiosk home projections", () => {
  it("projects pickups with remaining item counts and hides SHARED requesters", () => {
    const pickups = projectPickups([
      pickupRow("p2", "u2", at(2)),
      pickupRow("p1", "u1", at(-1), { custodyScope: "SHARED", events: [{ eventId: "ev-1" }] }),
      pickupRow("empty", "u3", at(1), { _count: { serializedItems: 0 }, bulkItems: [] }),
    ], (t) => t);
    expect(pickups.map((p) => p.bookingId)).toEqual(["p1", "p2"]);
    expect(pickups[0]).toMatchObject({ requester: null, custodyScope: "SHARED", eventId: "ev-1", itemCount: 4 });
    expect(pickups[1]).toMatchObject({ requester: { id: "u2" }, itemCount: 4, readyAt: at(2) });
    expect(pickups[1]!.items).toEqual([]);
  });

  it("lists pickup gear thumbnails: serialized first, then bulk still to pick up, capped at six", () => {
    const [pickup] = projectPickups([
      pickupRow("p1", "u1", at(1), {
        _count: { serializedItems: 6 },
        serializedItems: Array.from({ length: 6 }, (_, i) => ({ asset: { assetTag: `CAM-${i}`, imageUrl: i === 0 ? "https://x/cam.png" : null } })),
        bulkItems: [{ plannedQuantity: 2, checkedOutQuantity: 0, bulkSku: { name: "Battery", imageUrl: "https://x/b.png" } }],
      }),
    ], (t) => t);
    expect(pickup!.items).toHaveLength(6);
    expect(pickup!.items[0]).toEqual({ tagName: "CAM-0", imageUrl: "https://x/cam.png" });

    const [bulkOnly] = projectPickups([
      pickupRow("p2", "u1", at(1), {
        _count: { serializedItems: 1 },
        serializedItems: [{ asset: { assetTag: "CAM-9", imageUrl: null } }],
        bulkItems: [
          { plannedQuantity: 2, checkedOutQuantity: 2, bulkSku: { name: "Done", imageUrl: null } },
          { plannedQuantity: 1, checkedOutQuantity: 0, bulkSku: { name: "Battery", imageUrl: "https://x/b.png" } },
        ],
      }),
    ], (t) => t);
    expect(bulkOnly!.items).toEqual([
      { tagName: "CAM-9", imageUrl: null },
      { tagName: "Battery", imageUrl: "https://x/b.png" },
    ]);
  });

  it("builds one tile per person with merged reasons, never for SHARED custody", () => {
    const pickups = projectPickups([pickupRow("p1", "u1", at(1))], (t) => t);
    const tiles = projectTodayTiles({
      now,
      today,
      checkouts: [
        checkout("c1", "u1", at(-2)),
        checkout("c2", "u2", at(4)),
        checkout("c3", "u9", at(-2), { custodyScope: "SHARED" }),
      ],
      pickups,
      events: [event("e1", [
        { id: "a1", user: "u3", callAt: at(1.5) },
        { id: "a2", user: "u2", callAt: at(1) }, // has gear already
        { id: "a3", user: "u4", callAt: at(3) }, // outside two hours
      ])],
    });
    expect(tiles.map((t) => [t.userId, t.reasons])).toEqual([
      ["u1", ["overdue", "pickup"]],
      ["u3", ["shift_soon"]],
      ["u2", ["return_due"]],
    ]);
    expect(tiles[0]!.pickupAt).toEqual(at(1));
    expect(tiles[1]!.callAt).toEqual(at(1.5));
  });

  it("lists crew without a personal checkout linked to the event or their shift", () => {
    const e = event("e1", [
      { id: "a1", user: "u1", callAt: at(1) },
      { id: "a2", user: "u2", callAt: at(1) },
      { id: "a3", user: "u3", callAt: at(1) },
      { id: "a4", user: "u4", callAt: at(1) },
      { id: "a5", user: "u5", callAt: at(1) },
    ]);
    const crew = crewWithoutGear(e, [
      checkout("c1", "u1", at(5), { eventId: "e1" }),
      checkout("c2", "u2", at(5), { events: [{ eventId: "e1" }] }),
      checkout("c3", "u3", at(5), { shiftAssignmentId: "a3" }),
      checkout("c4", "u4", at(5), { eventId: "other" }),
      checkout("c5", "u5", at(5), { eventId: "e1", custodyScope: "SHARED" }),
    ]);
    expect(crew.map((u) => u.id)).toEqual(["u4", "u5"]);
  });

  it("counts a reserved pickup for the event as gear", () => {
    const e = event("e1", [
      { id: "a1", user: "u1", callAt: at(1) },
      { id: "a2", user: "u2", callAt: at(1) },
    ]);
    const crew = crewWithoutGear(e, [], [
      { eventId: "e1", custodyScope: "PERSON", requester: { id: "u1", name: "U1", avatarUrl: null } },
      { eventId: "e1", custodyScope: "SHARED", requester: { id: "u2", name: "U2", avatarUrl: null } },
    ]);
    expect(crew.map((u) => u.id)).toEqual(["u2"]);
  });

  it("picks the next event call or pickup window after now", () => {
    const pickups = projectPickups([pickupRow("p1", "u1", at(2)), pickupRow("p0", "u1", at(-1))], (t) => t);
    expect(projectNextUp({
      now,
      events: [
        { title: "Volleyball", startsAt: at(4), callStartsAt: at(2.5), allDay: false },
        { title: "Media day", startsAt: at(0.5), callStartsAt: null, allDay: true },
      ],
      pickups,
    })).toEqual({ title: "Pickup p1", at: at(2), kind: "pickup" });
    expect(projectNextUp({ now, events: [], pickups: [] })).toBeNull();
  });
});
