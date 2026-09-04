import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/bookings", () => ({
  getBookingDetail: vi.fn(),
  updateReservation: vi.fn(),
  updateCheckout: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    location: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/services/booking-rules", () => ({
  getAllowedBookingActions: vi.fn(() => ["edit"]),
  requireBookingAction: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { getBookingDetail, updateCheckout, updateReservation } from "@/lib/services/bookings";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { PATCH } from "@/app/api/bookings/[id]/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const baseDetail = {
  id: "cm000000000000000000000001",
  kind: "CHECKOUT",
  title: "Camera checkout",
  requesterUserId: "cm000000000000000000000002",
  createdBy: "staff-1",
  locationId: "cm000000000000000000000003",
  startsAt: new Date("2026-06-01T10:00:00.000Z"),
  endsAt: new Date("2026-06-01T12:00:00.000Z"),
  updatedAt: new Date("2026-06-01T09:00:00.500Z"),
  serializedItems: [{ assetId: "cm000000000000000000000004" }],
  bulkItems: [{ bulkSkuId: "cm000000000000000000000005", plannedQuantity: 2 }],
  notes: "Original notes",
};

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/bookings/cm000000000000000000000001", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function bookingDetail(row: unknown) {
  return row as Awaited<ReturnType<typeof getBookingDetail>>;
}

function bookingActionResult(row: unknown) {
  return row as Awaited<ReturnType<typeof requireBookingAction>>;
}

function checkoutUpdateResult(row: unknown) {
  return row as Awaited<ReturnType<typeof updateCheckout>>;
}

function reservationUpdateResult(row: unknown) {
  return row as Awaited<ReturnType<typeof updateReservation>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail(baseDetail));
  vi.mocked(requireBookingAction).mockResolvedValue(bookingActionResult(baseDetail));
  vi.mocked(updateCheckout).mockResolvedValue(checkoutUpdateResult(baseDetail));
  vi.mocked(updateReservation).mockResolvedValue(reservationUpdateResult({ ...baseDetail, kind: "RESERVATION" }));
  vi.mocked(db.location.findUnique).mockResolvedValue({ active: true, name: "Camp Randall" } as never);
});

describe("booking lifecycle route contract", () => {
  it("rejects edits without an optimistic-lock header", async () => {
    const res = await PATCH(
      request({ title: "Updated checkout" }),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(428);
    expect(requireBookingAction).not.toHaveBeenCalled();
    expect(updateCheckout).not.toHaveBeenCalled();
  });

  it("rejects stale edit snapshots before dispatching update services", async () => {
    const res = await PATCH(
      request(
        { title: "Updated checkout" },
        { "if-unmodified-since": "Mon, 01 Jun 2026 08:59:59 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(409);
    expect(updateCheckout).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it("treats stale duplicate booking edits as idempotent when the change already landed", async () => {
    vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail({
      ...baseDetail,
      title: "Updated Checkout",
      updatedAt: new Date("2026-06-01T09:01:00.000Z"),
    }));

    const res = await PATCH(
      request(
        { title: "Updated checkout" },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(baseDetail.id, staffUser, "edit");
    expect(updateCheckout).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("treats stale duplicate return-date edits as idempotent when the change already landed", async () => {
    vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail({
      ...baseDetail,
      endsAt: new Date("2026-06-01T13:00:00.000Z"),
      updatedAt: new Date("2026-06-01T09:01:00.000Z"),
    }));

    const res = await PATCH(
      request(
        { endsAt: "2026-06-01T13:00:00.000Z" },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(requireBookingAction).toHaveBeenCalledWith(baseDetail.id, staffUser, "edit");
    expect(updateCheckout).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("dispatches checkout edits while leaving canonical audit ownership to the service", async () => {
    const res = await PATCH(
      request(
        {
          title: "Updated checkout",
          endsAt: "2026-06-01T13:00:00.000Z",
          notes: "Updated notes",
        },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(updateCheckout).toHaveBeenCalledWith(baseDetail.id, staffUser.id, {
      title: "Updated Checkout",
      endsAt: new Date("2026-06-01T13:00:00.000Z"),
      notes: "Updated notes",
    }, new Date("2026-06-01T09:00:00.000Z"));
    expect(updateReservation).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("rejects reservation-only fields on checkout edits instead of silently ignoring them", async () => {
    const res = await PATCH(
      request(
        { requesterUserId: "cm000000000000000000000006" },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(400);
    expect(updateCheckout).not.toHaveBeenCalled();
  });

  it("rejects active checkout equipment edits outside the kiosk boundary", async () => {
    const res = await PATCH(
      request(
        { serializedAssetIds: ["cm000000000000000000000004"] },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(403);
    expect(updateCheckout).not.toHaveBeenCalled();
  });

  it("dispatches reservation edits to updateReservation", async () => {
    vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail({ ...baseDetail, kind: "RESERVATION" }));

    const res = await PATCH(
      request(
        {
          title: "Updated reservation",
          requesterUserId: "cm000000000000000000000006",
          locationId: "cm000000000000000000000007",
          startsAt: "2026-06-01T11:00:00.000Z",
          endsAt: "2026-06-01T13:00:00.000Z",
        },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(200);
    expect(updateReservation).toHaveBeenCalledWith(baseDetail.id, staffUser.id, {
      title: "Updated Reservation",
      requesterUserId: "cm000000000000000000000006",
      locationId: "cm000000000000000000000007",
      startsAt: new Date("2026-06-01T11:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:00:00.000Z"),
      serializedAssetIds: undefined,
      bulkItems: undefined,
      notes: undefined,
    }, new Date("2026-06-01T09:00:00.000Z"));
    expect(updateCheckout).not.toHaveBeenCalled();
  });

  it("rejects Field House as a reservation pickup location before dispatching the update", async () => {
    vi.mocked(getBookingDetail).mockResolvedValue(bookingDetail({ ...baseDetail, kind: "RESERVATION" }));
    vi.mocked(db.location.findUnique).mockResolvedValue({ active: true, name: "UW Field House" } as never);

    const res = await PATCH(
      request(
        { locationId: "cm000000000000000000000007" },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: baseDetail.id }) },
    );

    expect(res.status).toBe(400);
    expect(updateReservation).not.toHaveBeenCalled();
  });
});
