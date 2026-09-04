import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BookingKind, BookingStatus, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/bookings", () => ({
  createBooking: vi.fn(),
  listBookings: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
    },
    bulkStockBalance: {
      findMany: vi.fn(),
    },
    bulkSku: {
      findMany: vi.fn(),
    },
    location: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/services/notifications", () => ({
  createReservationLifecycleNotification: vi.fn(),
  notifyLowStock: vi.fn(),
}));

vi.mock("@/lib/services/checkout-policies", () => ({
  loadCheckoutPolicies: vi.fn(),
}));

vi.mock("@/lib/services/event-defaults", () => ({
  resolveEventDefaults: vi.fn(),
}));

vi.mock("@/lib/services/reservation-rules", () => ({
  loadReservationRules: vi.fn(),
}));

vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
  deferCompanionProjectionRefreshForCommittedMutation: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createBooking, listBookings } from "@/lib/services/bookings";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import { resolveEventDefaults } from "@/lib/services/event-defaults";
import { loadReservationRules } from "@/lib/services/reservation-rules";
import { createReservationLifecycleNotification } from "@/lib/services/notifications";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";
import { HttpError } from "@/lib/http";
import { GET as getCheckouts, POST as postCheckouts } from "@/app/api/checkouts/route";
import { GET as getReservations, POST as postReservations } from "@/app/api/reservations/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@example.com",
  name: "Student One",
  role: Role.STUDENT,
  avatarUrl: null,
};

function get(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function malformedPost(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: "{not-json",
  });
}

function post(path: string, body: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(listBookings).mockResolvedValue({ data: [], total: 0, limit: 20, offset: 0 } as never);
  vi.mocked(loadCheckoutPolicies).mockResolvedValue({
    defaultLoanDays: 2,
    gracePeriodHours: 1,
    maxItemsPerUser: null,
  });
  vi.mocked(loadReservationRules).mockResolvedValue({
    advanceWindowDays: null,
    noShowExpiryHours: 48,
    maxConcurrentReservations: null,
  });
  vi.mocked(db.booking.count).mockResolvedValue(0);
  vi.mocked(db.booking.findFirst).mockResolvedValue(null);
  vi.mocked(db.auditLog.findFirst).mockResolvedValue(null);
  vi.mocked(db.location.findUnique).mockResolvedValue({ active: true, name: "Camp Randall" } as never);
  vi.mocked(createBooking).mockResolvedValue({
    id: "booking-1",
    title: "Event kit",
    requesterUserId: "student-1",
    bulkItems: [],
  } as never);
});

describe("booking list routes", () => {
  it("creates a staff shared travel-case reservation without personal notification attribution", async () => {
    vi.mocked(createBooking).mockResolvedValueOnce({
      id: "booking-shared",
      title: "Football Travel Case",
      requesterUserId: adminUser.id,
      custodyScope: "SHARED",
      bulkItems: [],
    } as never);
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);

    const res = await postReservations(
      post("/api/reservations", {
        title: "Football Travel Case",
        requesterUserId: "cm000000000000000000000001",
        custodyScope: "SHARED",
        locationId: "cm000000000000000000000002",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        serializedAssetIds: ["cm000000000000000000000003"],
        bulkItems: [],
        shiftAssignmentId: "cm000000000000000000000004",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({
      kind: BookingKind.RESERVATION,
      custodyScope: "SHARED",
      requesterUserId: adminUser.id,
      shiftAssignmentId: undefined,
    }));
    expect(createReservationLifecycleNotification).not.toHaveBeenCalled();
  });

  it("rejects Field House reservation creation before calling the booking service", async () => {
    vi.mocked(db.location.findUnique).mockResolvedValue({ active: true, name: "UW Field House" } as never);
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);

    const res = await postReservations(
      post("/api/reservations", {
        title: "Field House reservation",
        requesterUserId: "cm000000000000000000000001",
        locationId: "cm000000000000000000000002",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        serializedAssetIds: ["cm000000000000000000000003"],
        bulkItems: [],
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("rejects a student attempt to create shared custody", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(studentUser);
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);

    const res = await postReservations(
      post("/api/reservations", {
        title: "Football Travel Case",
        requesterUserId: "cm000000000000000000000001",
        custodyScope: "SHARED",
        locationId: "cm000000000000000000000002",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        serializedAssetIds: ["cm000000000000000000000003"],
        bulkItems: [],
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(403);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("maps reservation overdue links to booked reservations past their end time", async () => {
    const res = await getReservations(
      get("/api/reservations?filter=overdue"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(listBookings).toHaveBeenCalledWith(
      BookingKind.RESERVATION,
      expect.any(URLSearchParams),
      expect.objectContaining({
        status: BookingStatus.BOOKED,
        endsAt: expect.objectContaining({ lt: expect.any(Date) }),
      }),
      undefined,
    );
  });

  it("maps the event-day queue to booked reservations starting today", async () => {
    const res = await getReservations(
      get("/api/reservations?filter=due-today"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(listBookings).toHaveBeenCalledWith(
      BookingKind.RESERVATION,
      expect.any(URLSearchParams),
      expect.objectContaining({
        status: BookingStatus.BOOKED,
        startsAt: expect.objectContaining({
          gte: expect.any(Date),
          lt: expect.any(Date),
        }),
      }),
      undefined,
    );
  });

  it("keeps report overdue drill-down links on the special filter parameter", () => {
    const checkoutsReport = readFileSync("src/app/(app)/reports/checkouts/page.tsx", "utf8");
    const overdueReport = readFileSync("src/app/(app)/reports/overdue/page.tsx", "utf8");

    expect(checkoutsReport).toContain('href="/checkouts?filter=overdue"');
    expect(overdueReport).toContain('href="/checkouts?filter=overdue"');
    expect(checkoutsReport).not.toContain("status=overdue");
    expect(overdueReport).not.toContain("status=overdue");
  });

  it("lets students read all checkout and reservation rows while preserving requester filters", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const reservationRes = await getReservations(
      get("/api/reservations?filter=overdue&requester_id=admin-1"),
      { params: Promise.resolve({}) },
    );

    expect(reservationRes.status).toBe(200);
    expect(listBookings).toHaveBeenCalledWith(
      BookingKind.RESERVATION,
      expect.any(URLSearchParams),
      expect.objectContaining({
        status: BookingStatus.BOOKED,
        endsAt: expect.objectContaining({ lt: expect.any(Date) }),
      }),
      undefined,
    );

    const checkoutRes = await getCheckouts(
      get("/api/checkouts?requester_id=admin-1"),
      { params: Promise.resolve({}) },
    );

    expect(checkoutRes.status).toBe(200);
    expect(listBookings).toHaveBeenCalledWith(
      BookingKind.CHECKOUT,
      expect.any(URLSearchParams),
      undefined,
      undefined,
    );
  });

  it("blocks app/web checkout creation before creating a booking", async () => {
    const res = await postCheckouts(
      malformedPost("/api/checkouts"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Create a reservation in app/web. Direct checkout is only available at a kiosk.");
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("rejects malformed reservation create JSON before creating a booking", async () => {
    const res = await postReservations(
      malformedPost("/api/reservations"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Request body must be valid JSON");
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("BUG: passes the reservation cap into the transactional service without counting in the route", async () => {
    vi.mocked(loadReservationRules).mockResolvedValue({
      advanceWindowDays: null,
      noShowExpiryHours: 48,
      maxConcurrentReservations: 2,
    });
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);

    const res = await postReservations(
      post("/api/reservations", {
        title: "Event kit",
        requesterUserId: "cm000000000000000000000001",
        locationId: "cm000000000000000000000002",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        sourceDraftId: "cm000000000000000000000004",
        serializedAssetIds: ["cm000000000000000000000003"],
        bulkItems: [],
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(db.booking.count).not.toHaveBeenCalled();
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: BookingKind.RESERVATION,
        maxConcurrentReservations: 2,
        requesterUserId: "cm000000000000000000000001",
        sourceDraftId: "cm000000000000000000000004",
      }),
    );
  });

  it("schedules projection repair after commit even when notification persistence fails", async () => {
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);
    vi.mocked(createReservationLifecycleNotification).mockRejectedValueOnce(
      new Error("notification persistence unavailable"),
    );
    const req = post("/api/reservations", {
      title: "Event kit",
      requesterUserId: "cm000000000000000000000001",
      locationId: "cm000000000000000000000002",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      serializedAssetIds: ["cm000000000000000000000003"],
      bulkItems: [],
    });

    const res = await postReservations(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(deferCompanionProjectionRefreshForCommittedMutation).toHaveBeenCalledWith(req);
  });

  it("replays the committed reservation and ignores changed payload after a response is lost", async () => {
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);
    const sourceDraftId = "cm000000000000000000000004";
    vi.mocked(createBooking).mockRejectedValueOnce(new HttpError(404, "Source draft not found"));
    vi.mocked(db.auditLog.findFirst).mockResolvedValueOnce({
      afterJson: { createdReservationId: "booking-replayed" },
    } as never);
    vi.mocked(db.booking.findFirst).mockResolvedValueOnce({
      id: "booking-replayed",
      title: "Event kit",
      requesterUserId: "original-requester",
      bulkItems: [],
    } as never);

    const res = await postReservations(
      post("/api/reservations", {
        title: "Event kit",
        requesterUserId: "cm000000000000000000000001",
        locationId: "cm000000000000000000000002",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        sourceDraftId,
        serializedAssetIds: ["cm000000000000000000000003"],
        bulkItems: [],
      }),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.id).toBe("booking-replayed");
    expect(db.auditLog.findFirst).toHaveBeenCalledWith({
      where: {
        entityType: "booking",
        entityId: sourceDraftId,
        action: "draft_consumed",
        actorUserId: adminUser.id,
      },
      orderBy: { createdAt: "desc" },
      select: { afterJson: true },
    });
    expect(db.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "booking-replayed",
          kind: BookingKind.RESERVATION,
          createdBy: adminUser.id,
        },
      }),
    );
    expect(createReservationLifecycleNotification).toHaveBeenCalledWith({
      bookingId: "booking-replayed",
      bookingTitle: "Event kit",
      requesterUserId: "original-requester",
      actorUserId: adminUser.id,
      event: "booked",
    });
  });

  it("does not run checkout event-default or create logic for app/web checkout POST", async () => {
    const res = await postCheckouts(
      post("/api/checkouts", {
        title: "Event kit",
        requesterUserId: "cm000000000000000000000001",
        locationId: "cm000000000000000000000002",
        startsAt: "2026-07-01T12:00:00.000Z",
        endsAt: "2026-07-01T18:00:00.000Z",
        serializedAssetIds: ["cm000000000000000000000003"],
        eventIds: [
          "cm000000000000000000000004",
          "cm000000000000000000000005",
        ],
        sportCode: "MBB",
      }),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Create a reservation in app/web. Direct checkout is only available at a kiosk.");
    expect(resolveEventDefaults).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });
});
