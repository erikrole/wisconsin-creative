import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: vi.fn() },
    auditLog: { findMany: vi.fn() },
    scanEvent: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { getBookingDetail } from "@/lib/services/bookings-queries";

function booking(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "booking-1",
    kind: "RESERVATION",
    title: "Past reservation",
    status: "BOOKED",
    requesterUserId: "student-1",
    requester: { id: "student-1", name: "Student One", email: "student@example.com", role: "STUDENT" },
    startsAt: new Date("2026-04-01T10:00:00Z"),
    endsAt: new Date("2026-04-01T12:00:00Z"),
    location: { id: "loc-1", name: "Equipment Room" },
    creator: { id: "staff-1", name: "Staff One", email: "staff@example.com", avatarUrl: null },
    serializedItems: [],
    bulkItems: [],
    event: null,
    events: [],
    sourceReservation: null,
    shiftAssignment: null,
    kit: null,
    photos: [],
    ...overrides,
  };
}

describe("getBookingDetail status read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(db.scanEvent.findMany).mockResolvedValue([]);
  });

  it("marks past-due booked reservations as overdue for detail badges", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(booking() as never);

    const detail = await getBookingDetail("booking-1");

    expect(detail.isOverdue).toBe(true);
    expect(detail.isActive).toBe(true);
  });

  it("corrects legacy abbreviated team casing in the detail read model", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(booking({ title: "Women's Soccer vs Tcu" }) as never);

    const detail = await getBookingDetail("booking-1");

    expect(detail.title).toBe("Women's Soccer vs TCU");
  });

  it("does not mark pending pickup as overdue from the return due date", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(booking({
      kind: "CHECKOUT",
      status: "PENDING_PICKUP",
      title: "Pending pickup",
    }) as never);

    const detail = await getBookingDetail("booking-1");

    expect(detail.isOverdue).toBe(false);
  });

  it("reports whether an internal event reservation is connected to the schedule", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(booking({
      event: { id: "event-1", summary: "Game" },
      shiftAssignment: {
        id: "assignment-1",
        userId: "student-1",
        status: "DIRECT_ASSIGNED",
        source: "RESERVATION",
        shift: { area: "VIDEO", shiftGroup: { eventId: "event-1" } },
      },
    }) as never);

    const detail = await getBookingDetail("booking-1");

    expect(detail.scheduleStatus).toBe("scheduled");
    expect(detail.scheduleStatusReason).toBeNull();
  });

  it("marks an internal event reservation without an active assignment for review", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(booking({
      event: { id: "event-1", summary: "Game" },
    }) as never);

    const detail = await getBookingDetail("booking-1");

    expect(detail.scheduleStatus).toBe("needs_review");
    expect(detail.scheduleStatusReason).toContain("not connected");
  });
});
