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
  forceCheckoutReservation: vi.fn(),
  getBookingDetail: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { forceCheckoutReservation, getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";
import { POST } from "@/app/api/reservations/[id]/force-checkout/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

const RESERVATION_ID = "cm000000000000000000000001";

function post(body: Record<string, unknown>) {
  return new Request(`https://app.example.com/api/reservations/${RESERVATION_ID}/force-checkout`, {
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
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(requireBookingAction).mockResolvedValue({ id: RESERVATION_ID } as Awaited<ReturnType<typeof requireBookingAction>>);
  vi.mocked(forceCheckoutReservation).mockResolvedValue({ id: "checkout-1" } as Awaited<ReturnType<typeof forceCheckoutReservation>>);
  vi.mocked(getBookingDetail).mockResolvedValue({
    id: RESERVATION_ID,
    kind: BookingKind.RESERVATION,
    status: "COMPLETED",
    requesterUserId: "student-1",
    createdBy: "admin-1",
  } as Awaited<ReturnType<typeof getBookingDetail>>);
  vi.mocked(getAllowedBookingActions).mockReturnValue([]);
});

describe("admin force-checkout route", () => {
  it("requires the reservation force-checkout action and opens linked custody with a reason", async () => {
    const res = await POST(
      post({ reason: "Kiosk unavailable; admin verified the handoff." }),
      ctx(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(
      RESERVATION_ID,
      adminUser,
      "force-checkout",
      BookingKind.RESERVATION,
    );
    expect(forceCheckoutReservation).toHaveBeenCalledWith({
      reservationId: RESERVATION_ID,
      actorUserId: adminUser.id,
      reason: "Kiosk unavailable; admin verified the handoff.",
    });
    expect(body.checkoutId).toBe("checkout-1");
    expect(body.data.allowedActions).toEqual([]);
  });

  it("rejects missing or too-short reasons before writing", async () => {
    const res = await POST(post({ reason: "too short" }), ctx());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(requireBookingAction).not.toHaveBeenCalled();
    expect(forceCheckoutReservation).not.toHaveBeenCalled();
  });
});
