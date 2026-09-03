import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock("@/lib/services/bookings", () => ({
  createBooking: vi.fn(),
}));

vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/services/notifications", () => ({
  createReservationLifecycleNotification: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createBooking } from "@/lib/services/bookings";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { POST as convert } from "@/app/api/reservations/[id]/convert/route";
import { POST as duplicate } from "@/app/api/reservations/[id]/duplicate/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const RESERVATION_ID = "cm000000000000000000000001";

const baseSource = {
  id: RESERVATION_ID,
  kind: "RESERVATION",
  title: "Camera reservation",
  status: "BOOKED",
  requesterUserId: "cm000000000000000000000002",
  locationId: "cm000000000000000000000003",
  startsAt: new Date("2026-06-01T10:00:00.000Z"),
  endsAt: new Date("2026-06-01T12:00:00.000Z"),
  serializedItems: [{ assetId: "cm000000000000000000000004" }],
  bulkItems: [{ bulkSkuId: "cm000000000000000000000005", plannedQuantity: 2 }],
  notes: "Original notes",
  eventId: "evt-primary",
  sportCode: null,
  shiftAssignmentId: null,
  events: [] as Array<{ eventId: string }>,
};

function request(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com" },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: RESERVATION_ID }) };
}

function bookingActionResult(row: unknown) {
  return row as Awaited<ReturnType<typeof requireBookingAction>>;
}

function sourceReservation(row: unknown) {
  return row as Awaited<ReturnType<typeof db.booking.findUniqueOrThrow>>;
}

function createdBooking(row: unknown) {
  return row as Awaited<ReturnType<typeof createBooking>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(requireBookingAction).mockResolvedValue(bookingActionResult(baseSource));
  vi.mocked(createBooking).mockResolvedValue(createdBooking({ id: "new-booking", title: "x" }));
});

describe("reservation convert custody boundary", () => {
  it("blocks app/web conversion before creating checkout custody", async () => {
    vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(sourceReservation({
      ...baseSource,
      events: [{ eventId: "evt-a" }, { eventId: "evt-b" }],
    }));

    const res = await convert(request(`/api/reservations/${RESERVATION_ID}/convert`), ctx());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Pick up this reservation at a kiosk. App/web cannot create checkout custody.");
    expect(createBooking).not.toHaveBeenCalled();
    expect(db.booking.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("reservation duplicate preserves multi-event links", () => {
  it("clones ordered eventIds and omits legacy eventId for multi-event sources", async () => {
    vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(sourceReservation({
      ...baseSource,
      events: [{ eventId: "evt-a" }, { eventId: "evt-b" }],
    }));

    await duplicate(request(`/api/reservations/${RESERVATION_ID}/duplicate`), ctx());

    const arg = vi.mocked(createBooking).mock.calls[0]![0];
    expect(arg.eventIds).toEqual(["evt-a", "evt-b"]);
    expect("eventId" in arg).toBe(false);
  });

  it("falls back to legacy eventId for single-event sources with no junction rows", async () => {
    vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(sourceReservation({
      ...baseSource,
      events: [],
    }));

    await duplicate(request(`/api/reservations/${RESERVATION_ID}/duplicate`), ctx());

    const arg = vi.mocked(createBooking).mock.calls[0]![0];
    expect(arg.eventId).toBe("evt-primary");
    expect("eventIds" in arg).toBe(false);
  });

  it("rejects duplicating a non-BOOKED reservation before calling createBooking", async () => {
    vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(sourceReservation({
      ...baseSource,
      status: "CANCELLED",
      events: [],
    }));

    const res = await duplicate(request(`/api/reservations/${RESERVATION_ID}/duplicate`), ctx());

    expect(res.status).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });
});
