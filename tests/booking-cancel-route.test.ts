import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus, Role } from "@prisma/client";
import { authUser, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  findBooking: vi.fn(),
  cancelBooking: vi.fn(),
  getBookingDetail: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { booking: { findUnique: mocks.findBooking } } }));
vi.mock("@/lib/services/bookings", () => ({
  cancelBooking: mocks.cancelBooking,
  getBookingDetail: mocks.getBookingDetail,
}));

import { POST } from "@/app/api/bookings/[id]/cancel/route";

const ctx = routeCtx({ id: "booking-1" });
const maya = authUser(Role.STUDENT, "maya");

function row(over: Partial<{ kind: BookingKind; status: BookingStatus; requesterUserId: string; createdBy: string }> = {}) {
  return {
    id: "booking-1",
    kind: BookingKind.RESERVATION,
    status: BookingStatus.BOOKED,
    requesterUserId: "maya",
    createdBy: "maya",
    custodyScope: BookingCustodyScope.PERSON,
    title: "Volleyball shoot",
    endsAt: new Date("2099-01-02T15:00:00Z"),
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    ...row({ status: BookingStatus.CANCELLED }),
    refNumber: 1042,
    locationId: "cr",
    startsAt: new Date("2099-01-01T15:00:00Z"),
    createdAt: new Date("2026-10-01T15:00:00Z"),
    updatedAt: new Date("2026-10-24T15:00:00Z"),
    notes: null,
    location: { id: "cr", name: "Camp Randall" },
    requester: { id: "maya", name: "Maya", avatarUrl: null, email: "maya@example.com", phone: "608-555-0100" },
    serializedItems: [],
    bulkItems: [],
    auditLogs: [{ id: "a1", action: "cancelled" }],
    ...over,
  };
}

const cancel = () => POST(jsonRequest("/api/bookings/booking-1/cancel", "POST"), ctx);

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(maya);
  mocks.findBooking.mockResolvedValue(row());
  mocks.getBookingDetail.mockResolvedValue(detail());
});

describe("POST /api/bookings/[id]/cancel", () => {
  it("lets the requester cancel their own booked reservation and returns the refreshed booking", async () => {
    const res = await cancel();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.cancelBooking).toHaveBeenCalledWith("booking-1", "maya");
    expect(body.data).toMatchObject({ id: "booking-1", status: "CANCELLED" });
    expect(Array.isArray(body.data.allowedActions)).toBe(true);
    expect(body.data.allowedActions).not.toContain("cancel");
  });

  it("refuses another student's reservation without cancelling it", async () => {
    mocks.findBooking.mockResolvedValue(row({ requesterUserId: "jordan", createdBy: "jordan" }));

    const res = await cancel();

    expect(res.status).toBe(403);
    expect(mocks.cancelBooking).not.toHaveBeenCalled();
  });

  it("lets staff cancel anyone's reservation", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF, "staff-1"));
    mocks.findBooking.mockResolvedValue(row({ requesterUserId: "jordan", createdBy: "jordan" }));

    const res = await cancel();

    expect(res.status).toBe(200);
    expect(mocks.cancelBooking).toHaveBeenCalledWith("booking-1", "staff-1");
  });

  it.each([
    ["an open checkout (gear is out; it must be returned)", BookingKind.CHECKOUT, BookingStatus.OPEN],
    ["a completed checkout", BookingKind.CHECKOUT, BookingStatus.COMPLETED],
    ["an already cancelled reservation", BookingKind.RESERVATION, BookingStatus.CANCELLED],
  ])("refuses to cancel %s", async (_label, kind, status) => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.ADMIN, "erik"));
    mocks.findBooking.mockResolvedValue(row({ kind, status }));

    const res = await cancel();

    expect(res.status).toBe(403);
    expect(mocks.cancelBooking).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing booking", async () => {
    mocks.findBooking.mockResolvedValue(null);

    const res = await cancel();

    expect(res.status).toBe(404);
    expect(mocks.cancelBooking).not.toHaveBeenCalled();
  });

  it("requires the collaborator cancel grant", async () => {
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.COLLABORATOR, "maya"), capabilities: ["RESERVATION_EDIT_OWN"] });

    const res = await cancel();

    expect(res.status).toBe(403);
    expect(mocks.findBooking).not.toHaveBeenCalled();
    expect(mocks.cancelBooking).not.toHaveBeenCalled();
  });

  it("returns a collaborator only the sanitized booking", async () => {
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.COLLABORATOR, "maya"), capabilities: ["RESERVATION_CANCEL_OWN"] });

    const res = await cancel();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.cancelBooking).toHaveBeenCalledWith("booking-1", "maya");
    expect(body.data.requester).toEqual({ id: "maya", name: "Maya", avatarUrl: null });
    expect(body.data).not.toHaveProperty("auditLogs");
  });

  it("rejects a cross-site request", async () => {
    const req = new Request("https://app.example.com/api/bookings/booking-1/cancel", {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://evil.example.net" },
    });

    const res = await POST(req, ctx);

    expect(res.status).toBe(403);
    expect(mocks.cancelBooking).not.toHaveBeenCalled();
  });
});
