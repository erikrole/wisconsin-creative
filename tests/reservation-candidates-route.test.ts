import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: { booking: { findMany: vi.fn() } },
  requireAuth: vi.fn(),
  pickup: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/reservation-pickup-location", () => ({ assertSupportedReservationPickupLocation: mocks.pickup }));

import { POST } from "@/app/api/reservations/candidates/route";
import { HttpError } from "@/lib/http";
import { normalizeBookingTitle } from "@/lib/title-normalization";

const student = { id: "cstudent001", email: "s@example.com", name: "Student", role: Role.STUDENT };
const staff = { ...student, id: "cstaff00001", role: Role.STAFF };
const cage = "clocation001";
const game = "cevent00001";
const practice = "cevent00002";
const startsAt = "2026-10-31T15:00:00.000Z";
const endsAt = "2026-10-31T23:00:00.000Z";

function plan(overrides: Record<string, unknown> = {}) {
  return {
    requesterUserId: student.id,
    title: "Football vs Iowa",
    locationId: cage,
    startsAt,
    endsAt,
    eventIds: [game],
    ...overrides,
  };
}

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: "Football vs Iowa",
    refNumber: `R-${id}`,
    locationId: cage,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    events: [],
    serializedItems: [{ allocationStatus: "active" }, { allocationStatus: "active" }],
    bulkItems: [{ plannedQuantity: 3, checkedOutQuantity: 0 }],
    ...overrides,
  };
}

async function review(body: Record<string, unknown>) {
  const response = await POST(new Request("https://app.example.com/api/reservations/candidates", {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(student);
  mocks.pickup.mockResolvedValue(undefined);
  mocks.db.booking.findMany.mockResolvedValue([]);
});

describe("POST /api/reservations/candidates", () => {
  it("looks for the requester's booked reservations on the same event with the same title", async () => {
    await review(plan({ title: "  football vs iowa " }));

    expect(mocks.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        kind: "RESERVATION",
        status: "BOOKED",
        requesterUserId: student.id,
        custodyScope: "PERSON",
        eventId: game,
        title: { equals: normalizeBookingTitle("  football vs iowa "), mode: "insensitive" },
      },
      take: 10,
    }));
  });

  it("says whether each match will merge, has started pickup, or differs", async () => {
    mocks.db.booking.findMany.mockResolvedValue([
      candidate("same"),
      candidate("picked", { serializedItems: [{ allocationStatus: "picked_up" }] }),
      candidate("bulk-out", { bulkItems: [{ plannedQuantity: 2, checkedOutQuantity: 1 }] }),
      candidate("later", { endsAt: new Date("2026-11-01T01:00:00.000Z") }),
      candidate("elsewhere", { locationId: "clocation002" }),
    ]);

    const { body } = await review(plan());

    expect(body.data.map((row: { id: string; disposition: string }) => [row.id, row.disposition])).toEqual([
      ["same", "will_consolidate"],
      ["picked", "pickup_started"],
      ["bulk-out", "pickup_started"],
      ["later", "review_differences"],
      ["elsewhere", "review_differences"],
    ]);
    expect(body.data[0]).toEqual(expect.objectContaining({ refNumber: "R-same", serializedItemCount: 2, bulkQuantity: 3 }));
  });

  it("only offers reservations linked to exactly the same events", async () => {
    mocks.db.booking.findMany.mockResolvedValue([
      candidate("both", { events: [{ eventId: practice }, { eventId: game }] }),
      candidate("game-only", { events: [{ eventId: game }] }),
      candidate("unlinked"),
      candidate("other", { events: [{ eventId: game }, { eventId: "cevent00003" }] }),
    ]);

    const { body } = await review(plan({ eventIds: [game, practice] }));

    expect(body.data.map((row: { id: string }) => row.id)).toEqual(["both"]);
  });

  it("treats a reservation with no event links as linked to its main event", async () => {
    mocks.db.booking.findMany.mockResolvedValue([candidate("unlinked")]);

    expect((await review(plan())).body.data.map((row: { id: string }) => row.id)).toEqual(["unlinked"]);
  });

  it("keeps students to their own plans", async () => {
    const { response, body } = await review(plan({ requesterUserId: staff.id }));

    expect(response.status).toBe(403);
    expect(body.error).toBe("You can only review your own reservation plan");
    expect(mocks.db.booking.findMany).not.toHaveBeenCalled();
  });

  it("lets staff review someone else's plan", async () => {
    mocks.requireAuth.mockResolvedValue(staff);

    expect((await review(plan())).response.status).toBe(200);
  });

  it("checks shared gear against the person asking", async () => {
    mocks.requireAuth.mockResolvedValue(staff);

    await review(plan({ custodyScope: "SHARED" }));

    expect(mocks.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requesterUserId: staff.id, custodyScope: "SHARED" }),
    }));
  });

  it("keeps students from planning shared gear", async () => {
    expect((await review(plan({ custodyScope: "SHARED" }))).response.status).toBe(403);
  });

  it("stops at an unsupported pickup location", async () => {
    mocks.pickup.mockRejectedValue(new HttpError(400, "Pick a supported pickup location"));

    const { response } = await review(plan());

    expect(response.status).toBe(400);
    expect(mocks.db.booking.findMany).not.toHaveBeenCalled();
  });
});
