import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus, Role } from "@prisma/client";

const mockTx = {
  bulkSku: {
    findUnique: vi.fn(),
  },
  bulkStockBalance: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  bulkStockMovement: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireKiosk: vi.fn(),
  hashPassword: vi.fn(),
  tokenHash: vi.fn(),
  createKioskSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: typeof mockTx) => Promise<unknown>)(mockTx);
    }),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    booking: {
      findUniqueOrThrow: vi.fn(),
    },
    kioskDevice: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    assetAllocation: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
  createSystemAuditEntry: vi.fn(),
}));

vi.mock("@/lib/companion-store", () => ({
  revokeCompanionUser: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("@/lib/services/bookings", () => ({
  createBooking: vi.fn(),
}));

vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(),
}));

vi.mock("@/lib/services/reports", () => ({
  getCheckoutReport: vi.fn(),
  getCheckoutReportExport: vi.fn(),
}));

vi.mock("@/lib/services/kiosk-scan", () => ({
  findAssetByScanValue: vi.fn(),
}));

vi.mock("@/lib/services/bulk-unit-scans", () => ({
  findBulkUnitByScanValue: vi.fn(),
}));

vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
  deferCompanionProjectionRefreshForCommittedMutation: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth, requireKiosk, hashPassword, tokenHash, createKioskSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntry, createSystemAuditEntry } from "@/lib/audit";
import { revokeCompanionUser } from "@/lib/companion-store";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { createBooking } from "@/lib/services/bookings";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { getCheckoutReport } from "@/lib/services/reports";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";
import { POST as adminResetPassword } from "@/app/api/users/[id]/reset-password/route";
import { POST as adjustBulkSku } from "@/app/api/bulk-skus/[id]/adjust/route";
import { GET as getCheckoutReportRoute } from "@/app/api/reports/checkouts/route";
import { GET as getBookingAuditLogs } from "@/app/api/bookings/[id]/audit-logs/route";
import { POST as duplicateReservation } from "@/app/api/reservations/[id]/duplicate/route";
import { POST as activateKiosk } from "@/app/api/kiosk/activate/route";
import { POST as scanLookup } from "@/app/api/kiosk/scan-lookup/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function userFindUniqueResult(value: { id: string; name: string }) {
  return value as unknown as Awaited<ReturnType<typeof db.user.findUnique>>;
}

function userUpdateResult(value: { id: string }) {
  return value as unknown as Awaited<ReturnType<typeof db.user.update>>;
}

function deleteManyResult(value: { count: number }) {
  return value as unknown as Awaited<ReturnType<typeof db.session.deleteMany>>;
}

function checkoutReportResult(value: { data: unknown[] }) {
  return value as unknown as Awaited<ReturnType<typeof getCheckoutReport>>;
}

function auditFindFirstResult(value: { id: string } | null) {
  return value as unknown as Awaited<ReturnType<typeof db.auditLog.findFirst>>;
}

function auditFindManyResult(value: unknown[]) {
  return value as unknown as Awaited<ReturnType<typeof db.auditLog.findMany>>;
}

function bookingActionResult(value: { id: string }) {
  return value as unknown as Awaited<ReturnType<typeof requireBookingAction>>;
}

function bookingFindUniqueResult(value: {
  id: string;
  title: string;
  status: BookingStatus;
  requesterUserId?: string;
  locationId?: string;
  startsAt?: Date;
  endsAt?: Date;
  serializedItems: unknown[];
  bulkItems: unknown[];
  notes?: string | null;
  eventId?: string | null;
  sportCode?: string | null;
}) {
  return value as unknown as Awaited<ReturnType<typeof db.booking.findUniqueOrThrow>>;
}

function createBookingResult(value: { id: string; title: string }) {
  return value as unknown as Awaited<ReturnType<typeof createBooking>>;
}

function kioskDeviceResult(value: {
  id: string;
  active: boolean;
  name: string;
  locationId: string;
  location: { id: string; name: string };
  activationCodeExpiresAt?: Date | null;
}) {
  return value as unknown as Awaited<ReturnType<typeof db.kioskDevice.findUnique>>;
}

function assetScanResult(value: {
  id: string;
  assetTag: string;
  name: string;
  status: string;
  category: { name: string };
}) {
  return value as unknown as Awaited<ReturnType<typeof findAssetByScanValue>>;
}

function authedPost(path: string, body?: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function authedGet(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(requireKiosk).mockResolvedValue({
    kioskId: "kiosk-1",
    name: "Test Kiosk",
    locationId: "loc-1",
    locationName: "Main",
  });
  vi.mocked(hashPassword).mockResolvedValue("hashed-temp");
  vi.mocked(tokenHash).mockResolvedValue("hashed-code");
  vi.mocked(createKioskSession).mockResolvedValue("session-token");
  vi.mocked(revokeCompanionUser).mockResolvedValue(undefined);
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  vi.mocked(getClientIp).mockReturnValue("203.0.113.10");
  vi.mocked(db.user.findUnique).mockResolvedValue(userFindUniqueResult({ id: "user-1", name: "User One" }));
  vi.mocked(db.user.update).mockResolvedValue(userUpdateResult({ id: "user-1" }));
  vi.mocked(db.session.deleteMany).mockResolvedValue(deleteManyResult({ count: 2 }));
  mockTx.bulkSku.findUnique.mockResolvedValue({ id: "sku-1", locationId: "loc-1" });
  mockTx.bulkStockBalance.findUnique.mockResolvedValue({ onHandQuantity: 10 });
  mockTx.bulkStockBalance.upsert.mockResolvedValue({});
  mockTx.bulkStockMovement.create.mockResolvedValue({});
  vi.mocked(getCheckoutReport).mockResolvedValue(checkoutReportResult({ data: [] }));
  vi.mocked(db.auditLog.findFirst).mockResolvedValue(auditFindFirstResult({ id: "cursor-1" }));
  vi.mocked(db.auditLog.findMany).mockResolvedValue(auditFindManyResult([]));
  vi.mocked(requireBookingAction).mockResolvedValue(bookingActionResult({ id: "booking-1" }));
  vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValue(bookingFindUniqueResult({
    id: "booking-1",
    title: "Reservation",
    status: BookingStatus.BOOKED,
    requesterUserId: "student-1",
    locationId: "loc-1",
    startsAt: new Date("2026-06-01T10:00:00.000Z"),
    endsAt: new Date("2026-06-01T12:00:00.000Z"),
    serializedItems: [],
    bulkItems: [],
    notes: null,
    eventId: null,
    sportCode: null,
  }));
  vi.mocked(createBooking).mockResolvedValue(createBookingResult({ id: "copy-1", title: "Copy of Reservation" }));
  vi.mocked(db.kioskDevice.findUnique).mockResolvedValue(kioskDeviceResult({
    id: "kiosk-1",
    active: true,
    name: "Kiosk One",
    locationId: "loc-1",
    location: { id: "loc-1", name: "Main" },
    activationCodeExpiresAt: new Date(Date.now() + 60 * 60_000),
  }));
  // Single-use redemption clears the code via a guarded updateMany; the winning
  // request sees count 1.
  vi.mocked(db.kioskDevice.updateMany).mockResolvedValue({ count: 1 } as Awaited<
    ReturnType<typeof db.kioskDevice.updateMany>
  >);
  vi.mocked(db.assetAllocation.findFirst).mockResolvedValue(null);
  vi.mocked(findAssetByScanValue).mockResolvedValue(assetScanResult({
    id: "asset-1",
    assetTag: "CAM-1",
    name: "Camera",
    status: "AVAILABLE",
    category: { name: "Camera" },
  }));
  vi.mocked(findBulkUnitByScanValue).mockResolvedValue(null);
});

describe("API hardening wave 11", () => {
  it("marks administrator-issued passwords as forced-change credentials", async () => {
    const res = await adminResetPassword(
      authedPost("/api/users/user-1/reset-password"),
      { params: Promise.resolve({ id: "user-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "hashed-temp", forcePasswordChange: true },
    });
    expect(body.data.forcePasswordChange).toBe(true);
    expect(revokeCompanionUser).toHaveBeenCalledWith("user-1");
    expect(vi.mocked(revokeCompanionUser).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(createAuditEntry).mock.invocationCallOrder[0]!);
    expect(createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "password_reset",
        after: expect.objectContaining({ forcePasswordChange: true }),
      }),
    );
  });

  it("reports when a reset cannot revoke existing companion access", async () => {
    vi.mocked(revokeCompanionUser).mockRejectedValueOnce(new Error("Redis unavailable"));

    const res = await adminResetPassword(
      authedPost("/api/users/user-1/reset-password"),
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "The password was reset, but companion access could not be revoked. Retry the reset before sharing the temporary password.",
    });
    expect(revokeCompanionUser).toHaveBeenCalledWith("user-1");
    expect(db.user.update).toHaveBeenCalled();
    expect(db.session.deleteMany).toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("rejects bulk stock adjustments above the operational cap", async () => {
    mockTx.bulkStockBalance.findUnique.mockResolvedValue({ onHandQuantity: 999_999 });

    const res = await adjustBulkSku(
      authedPost("/api/bulk-skus/sku-1/adjust", { quantityDelta: 2, reason: "count correction" }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("maximum stock quantity");
    expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
  });

  it("rejects quantity adjustments for unit-tracked item families", async () => {
    mockTx.bulkSku.findUnique.mockResolvedValue({ id: "sku-1", locationId: "loc-1", trackByNumber: true });

    const res = await adjustBulkSku(
      authedPost("/api/bulk-skus/sku-1/adjust", { quantityDelta: 2, reason: "count correction" }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Add units|unit-tracked/i);
    expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(mockTx.bulkStockMovement.create).not.toHaveBeenCalled();
  });

  it("bounds checkout report lookback before calling the service", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?days=999999"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(getCheckoutReport).not.toHaveBeenCalled();
  });

  it("rejects booking audit cursors outside the requested booking", async () => {
    vi.mocked(db.auditLog.findFirst).mockResolvedValue(null);

    const res = await getBookingAuditLogs(
      authedGet("/api/bookings/booking-1/audit-logs?cursor=other-log"),
      { params: Promise.resolve({ id: "booking-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid audit cursor");
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("blocks duplicating a terminal reservation after the source reload", async () => {
    vi.mocked(db.booking.findUniqueOrThrow).mockResolvedValueOnce(bookingFindUniqueResult({
      id: "booking-1",
      title: "Reservation",
      status: BookingStatus.CANCELLED,
      serializedItems: [],
      bulkItems: [],
    }));

    const res = await duplicateReservation(
      authedPost("/api/reservations/booking-1/duplicate"),
      { params: Promise.resolve({ id: "booking-1" }) },
    );

    expect(res.status).toBe(409);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("rate limits kiosk activation by IP and activation code", async () => {
    const res = await activateKiosk(
      authedPost("/api/kiosk/activate", { code: "123456" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:activate:203.0.113.10", { max: 5, windowMs: 15 * 60_000 });
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:activate:code:hashed-code", { max: 5, windowMs: 60 * 60_000 });
    expect(createSystemAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: "kiosk_activated" }),
    );
    expect(deferCompanionProjectionRefreshForCommittedMutation).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rate limits kiosk scan lookup by device before item lookup", async () => {
    const res = await scanLookup(
      authedPost("/api/kiosk/scan-lookup", { scanValue: "CAM-1" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:scan-lookup:kiosk-1", { max: 120, windowMs: 60_000 });
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:scan-lookup:kiosk-1:hour", { max: 1_000, windowMs: 60 * 60_000 });
    expect(findAssetByScanValue).toHaveBeenCalledWith(
      "CAM-1",
      expect.any(Object),
    );
  });
});
