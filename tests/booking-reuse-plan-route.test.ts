import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(),
}));

vi.mock("@/lib/services/booking-reuse", () => ({
  getBookingReusePlan: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { getBookingReusePlan } from "@/lib/services/booking-reuse";
import { GET } from "@/app/api/bookings/[id]/reuse-plan/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const BOOKING_ID = "cm000000000000000000000001";

const reusePlan = {
  sourceId: BOOKING_ID,
  kind: "RESERVATION" as const,
  title: "Slow 1",
  notes: null,
  requesterUserId: "cm000000000000000000000002",
  requesterName: "Alex Photographer",
  custodyScope: "PERSON" as const,
  locationId: "cm000000000000000000000003",
  kitId: "cm000000000000000000000004",
  kitName: "Slow 1",
  sportCode: "FB",
  keepTitle: true,
  startsAt: "2026-09-06T15:00:00.000Z",
  endsAt: "2026-09-06T22:00:00.000Z",
  events: [],
  serializedItems: [],
  bulkItems: [],
};

function request() {
  return new Request(`https://app.example.com/api/bookings/${BOOKING_ID}/reuse-plan`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: BOOKING_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(requireBookingAction).mockResolvedValue({
    id: BOOKING_ID,
    kind: BookingKind.RESERVATION,
    custodyScope: BookingCustodyScope.PERSON,
  } as Awaited<ReturnType<typeof requireBookingAction>>);
  vi.mocked(getBookingReusePlan).mockResolvedValue(reusePlan);
});

describe("booking reuse-plan route", () => {
  it("returns the reconstructed plan after the duplicate action check", async () => {
    const res = await GET(request(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(BOOKING_ID, staffUser, "duplicate");
    expect(getBookingReusePlan).toHaveBeenCalledWith(BOOKING_ID);
    expect(body.data.title).toBe("Slow 1");
    expect(body.data.keepTitle).toBe(true);
  });
});
