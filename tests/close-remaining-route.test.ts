import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(),
  getAllowedBookingActions: vi.fn(),
}));

vi.mock("@/lib/services/bookings", () => ({
  closeReservationRemaining: vi.fn(),
  getBookingDetail: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { closeReservationRemaining, getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";
import { POST } from "@/app/api/reservations/[id]/close-remaining/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const RESERVATION_ID = "cm000000000000000000000001";

function post(body: Record<string, unknown> = {}) {
  return new Request(`https://app.example.com/api/reservations/${RESERVATION_ID}/close-remaining`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function ctx() {
  return { params: Promise.resolve({ id: RESERVATION_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(requireBookingAction).mockResolvedValue({ id: RESERVATION_ID } as Awaited<ReturnType<typeof requireBookingAction>>);
  vi.mocked(closeReservationRemaining).mockResolvedValue({
    id: RESERVATION_ID,
    status: "COMPLETED",
    releasedSerialized: [{ assetId: "535", name: "Manfrotto 535 MPro Tripod" }],
    releasedBulk: [],
    linkedCheckouts: [{ id: "co-1", refNumber: "CO-0454" }],
  } as Awaited<ReturnType<typeof closeReservationRemaining>>);
  vi.mocked(getBookingDetail).mockResolvedValue({
    id: RESERVATION_ID,
    kind: BookingKind.RESERVATION,
    status: "COMPLETED",
    requesterUserId: "student-1",
    createdBy: "admin-1",
  } as Awaited<ReturnType<typeof getBookingDetail>>);
  vi.mocked(getAllowedBookingActions).mockReturnValue([]);
});

describe("close-remaining reservation route", () => {
  it("requires the close-remaining action and releases leftover holds", async () => {
    const res = await POST(
      post({ reason: "Grabbed the 755CX3 instead of the reserved 535." }),
      ctx(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(
      RESERVATION_ID,
      staffUser,
      "close-remaining",
      BookingKind.RESERVATION,
    );
    expect(closeReservationRemaining).toHaveBeenCalledWith({
      reservationId: RESERVATION_ID,
      actorUserId: staffUser.id,
      reason: "Grabbed the 755CX3 instead of the reserved 535.",
    });
    expect(body.released.serialized).toEqual([
      { assetId: "535", name: "Manfrotto 535 MPro Tripod" },
    ]);
    expect(body.data.allowedActions).toEqual([]);
  });
});
