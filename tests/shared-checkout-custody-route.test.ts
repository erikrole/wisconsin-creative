import { BookingCustodyScope, BookingKind, BookingStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBookingDetail: vi.fn(),
  updateBookingCustodyScope: vi.fn(),
  requireBookingAction: vi.fn(),
  getAllowedBookingActions: vi.fn(() => ["edit", "manage-custody"]),
}));

let actor: { id: string; role: Role } = { id: "staff-1", role: Role.STAFF };

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (request: Request, context: { user: typeof actor; params: { id: string } }) => unknown) =>
    (request: Request) => handler(request, { user: actor, params: { id: "booking-1" } }),
}));
vi.mock("@/lib/services/bookings", () => ({ getBookingDetail: mocks.getBookingDetail }));
vi.mock("@/lib/services/booking-custody", () => ({
  updateBookingCustodyScope: mocks.updateBookingCustodyScope,
}));
vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: mocks.requireBookingAction,
  getAllowedBookingActions: mocks.getAllowedBookingActions,
}));

import { POST } from "@/app/api/bookings/[id]/custody-scope/route";

const updatedAt = new Date("2026-09-03T18:00:00.000Z");
const personal = {
  id: "booking-1",
  kind: BookingKind.CHECKOUT,
  status: BookingStatus.OPEN,
  custodyScope: BookingCustodyScope.PERSON,
  updatedAt,
};

function request(scope: BookingCustodyScope) {
  return POST(new Request("https://app.example.com/api/bookings/booking-1/custody-scope", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Booking-Updated-At": updatedAt.toISOString(),
    },
    body: JSON.stringify({ custodyScope: scope }),
  }), { params: Promise.resolve({ id: "booking-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  actor = { id: "staff-1", role: Role.STAFF };
  mocks.getBookingDetail
    .mockResolvedValueOnce(personal)
    .mockResolvedValueOnce({ ...personal, custodyScope: BookingCustodyScope.SHARED });
});

describe("POST /api/bookings/[id]/custody-scope", () => {
  it("uses permission, action, snapshot, service, and enriched response boundaries", async () => {
    const response = await request(BookingCustodyScope.SHARED);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireBookingAction).toHaveBeenCalledWith(
      "booking-1",
      actor,
      "manage-custody",
      BookingKind.CHECKOUT,
    );
    expect(mocks.updateBookingCustodyScope).toHaveBeenCalledWith({
      bookingId: "booking-1",
      actorUserId: "staff-1",
      custodyScope: BookingCustodyScope.SHARED,
      expectedUpdatedAt: updatedAt,
    });
    expect(json.data).toMatchObject({
      id: "booking-1",
      custodyScope: "SHARED",
      allowedActions: ["edit", "manage-custody"],
    });
  });

  it("rejects students at the coarse permission boundary", async () => {
    actor = { id: "student-1", role: Role.STUDENT };
    await expect(request(BookingCustodyScope.SHARED)).rejects.toMatchObject({ status: 403 });
    expect(mocks.updateBookingCustodyScope).not.toHaveBeenCalled();
  });
});
