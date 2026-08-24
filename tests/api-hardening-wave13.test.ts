import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, CheckinReportType, Role } from "@prisma/client";

declare global {
  var __wave13TransactionOptions: unknown;
}

const mockShiftTx = {
  shiftGroup: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shift: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireKiosk: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockShiftTx) => Promise<unknown>, options?: unknown) => {
      globalThis.__wave13TransactionOptions = options;
      return fn(mockShiftTx);
    }),
    bookingSerializedItem: {
      findUnique: vi.fn(),
    },
    scanEvent: {
      findFirst: vi.fn(),
    },
    checkinItemReport: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    calendarSource: {
      findMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    licenseCodeClaim: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/blob", () => ({
  validateImage: vi.fn(() => null),
  deleteImage: vi.fn(async () => undefined),
  isBlobUrl: vi.fn(() => true),
  imageExtensionForType: vi.fn(() => "jpg"),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(),
  getAllowedBookingActions: vi.fn(() => ["edit"]),
}));

vi.mock("@/lib/services/bookings", () => ({
  getBookingDetail: vi.fn(),
  updateReservation: vi.fn(),
  updateCheckout: vi.fn(),
}));

vi.mock("@/lib/services/notifications", () => ({
  notifyItemReport: vi.fn(async () => undefined),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth, requireKiosk } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { deleteImage } from "@/lib/blob";
import { put } from "@vercel/blob";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { getBookingDetail, updateCheckout } from "@/lib/services/bookings";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { PATCH as patchBooking } from "@/app/api/bookings/[id]/route";
import { POST as checkinReport } from "@/app/api/checkouts/[id]/checkin-report/route";
import { GET as kioskHeartbeat } from "@/app/api/kiosk/heartbeat/route";
import { GET as kioskStudent } from "@/app/api/kiosk/student/[userId]/route";
import { GET as calendar } from "@/app/api/calendar/route";
import { GET as calendarSources } from "@/app/api/calendar-sources/route";
import { POST as addShift } from "@/app/api/shift-groups/[id]/shifts/route";
import { getClaimHistory } from "@/lib/services/licenses";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const kiosk = {
  kioskId: "kiosk-1",
  name: "Test Kiosk",
  locationId: "loc-1",
  locationName: "Main",
};

function get(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function post(path: string, body: Record<string, unknown>, headers?: Record<string, string>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function bookingDetailResult(value: {
  id: string;
  kind: BookingKind;
  title: string;
  requesterUserId: string;
  createdBy: string;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  updatedAt: Date;
  serializedItems: Array<{ assetId: string }>;
  bulkItems: Array<{ bulkSkuId: string; plannedQuantity: number }>;
  notes: string | null;
}) {
  return value as unknown as Awaited<ReturnType<typeof getBookingDetail>>;
}

function bookingActionResult(value: { id: string; title: string }) {
  return value as unknown as Awaited<ReturnType<typeof requireBookingAction>>;
}

function checkoutUpdateResult(value: { id: string }) {
  return value as unknown as Awaited<ReturnType<typeof updateCheckout>>;
}

function bookingSerializedItemResult(value: { asset: { assetTag: string; brand: string; model: string } }) {
  return value as unknown as Awaited<ReturnType<typeof db.bookingSerializedItem.findUnique>>;
}

function scanEventResult(value: { id: string }) {
  return value as unknown as Awaited<ReturnType<typeof db.scanEvent.findFirst>>;
}

function checkinReportResult(value: {
  id?: string;
  type?: CheckinReportType;
  description?: string;
  imageUrl: string | null;
  createdAt?: Date;
}) {
  return value as unknown as Awaited<ReturnType<typeof db.checkinItemReport.findUnique>>;
}

function checkinReportUpsertResult(value: {
  id: string;
  type: CheckinReportType;
  description: string;
  imageUrl: string | null;
}) {
  return value as unknown as Awaited<ReturnType<typeof db.checkinItemReport.upsert>>;
}

function blobPutResult(value: { url: string }) {
  return value as unknown as Awaited<ReturnType<typeof put>>;
}

function userFindUniqueResult(value: { id: string; active: boolean; locationId: string }) {
  return value as unknown as Awaited<ReturnType<typeof db.user.findUnique>>;
}

function shiftGroupResult(value: {
  id: string;
  event: {
    startsAt: Date;
    endsAt: Date;
  };
}) {
  return value as unknown as Awaited<ReturnType<typeof mockShiftTx.shiftGroup.findUnique>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__wave13TransactionOptions = undefined;
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(requireKiosk).mockResolvedValue(kiosk);
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  vi.mocked(getClientIp).mockReturnValue("203.0.113.10");
  vi.mocked(getBookingDetail).mockResolvedValue(bookingDetailResult({
    id: "booking-1",
    kind: BookingKind.CHECKOUT,
    title: "Checkout",
    requesterUserId: "student-1",
    createdBy: "staff-1",
    locationId: "loc-1",
    startsAt: new Date("2026-06-01T10:00:00.000Z"),
    endsAt: new Date("2026-06-01T12:00:00.000Z"),
    updatedAt: new Date("2026-06-01T09:00:00.500Z"),
    serializedItems: [{ assetId: "asset-1" }],
    bulkItems: [{ bulkSkuId: "sku-1", plannedQuantity: 2 }],
    notes: null,
  }));
  vi.mocked(requireBookingAction).mockResolvedValue(bookingActionResult({ id: "booking-1", title: "Checkout" }));
  vi.mocked(updateCheckout).mockResolvedValue(checkoutUpdateResult({ id: "booking-1" }));
  vi.mocked(db.bookingSerializedItem.findUnique).mockResolvedValue(bookingSerializedItemResult({
    asset: { assetTag: "CAM-1", brand: "Sony", model: "FX3" },
  }));
  vi.mocked(db.scanEvent.findFirst).mockResolvedValue(scanEventResult({ id: "scan-1" }));
  vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue(null);
  vi.mocked(db.checkinItemReport.upsert).mockResolvedValue(checkinReportUpsertResult({
    id: "report-1",
    type: CheckinReportType.DAMAGED,
    description: "Scratched",
    imageUrl: null,
  }));
  vi.mocked(put).mockResolvedValue(blobPutResult({ url: "https://blob.example.com/new.jpg" }));
  vi.mocked(db.calendarSource.findMany).mockResolvedValue([]);
  vi.mocked(db.booking.findMany).mockResolvedValue([]);
  vi.mocked(db.user.findUnique).mockResolvedValue(userFindUniqueResult({
    id: "student-1",
    active: true,
    locationId: "loc-1",
  }));
  vi.mocked(db.licenseCodeClaim.findMany).mockResolvedValue([]);
  mockShiftTx.shiftGroup.findUnique.mockResolvedValue(shiftGroupResult({
    id: "group-1",
    event: {
      startsAt: new Date("2026-06-01T10:00:00.000Z"),
      endsAt: new Date("2026-06-01T12:00:00.000Z"),
    },
  }));
  mockShiftTx.shift.create.mockResolvedValue({ id: "shift-1", area: "VIDEO", workerType: "ST" });
  mockShiftTx.shiftGroup.update.mockResolvedValue({});
});

describe("API hardening wave 13", () => {
  it("requires optimistic-lock headers on booking edits", async () => {
    const res = await patchBooking(
      post("/api/bookings/booking-1", { title: "Updated" }),
      { params: Promise.resolve({ id: "booking-1" }) },
    );

    expect(res.status).toBe(428);
    expect(updateCheckout).not.toHaveBeenCalled();
  });

  it("accepts second-precision If-Unmodified-Since headers and delegates canonical audit writes", async () => {
    const res = await patchBooking(
      post(
        "/api/bookings/booking-1",
        { title: "Updated" },
        { "if-unmodified-since": "Mon, 01 Jun 2026 09:00:00 GMT" },
      ),
      { params: Promise.resolve({ id: "booking-1" }) },
    );

    expect(res.status).toBe(200);
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("rejects duplicate check-in reports inside the five-second window", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue(checkinReportResult({
      imageUrl: null,
      createdAt: new Date(),
    }));

    const res = await checkinReport(
      post("/api/checkouts/booking-1/checkin-report", {
        assetId: "cm111111111111111111111111",
        type: "DAMAGED",
        description: "Scratched",
      }),
      { params: Promise.resolve({ id: "booking-1" }) },
    );

    expect(res.status).toBe(409);
    expect(db.checkinItemReport.upsert).not.toHaveBeenCalled();
  });

  it("deletes newly uploaded report images when report persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.checkinItemReport.upsert).mockRejectedValue(new Error("db down"));
    const file = new File(["image"], "damage.jpg", { type: "image/jpeg" });
    const form = new FormData();
    form.set("assetId", "cm111111111111111111111111");
    form.set("type", "DAMAGED");
    form.set("description", "Scratched");
    form.set("file", file);
    const req = new Request("https://app.example.com/api/checkouts/booking-1/checkin-report", {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com" },
      body: form,
    });

    const res = await checkinReport(req, { params: Promise.resolve({ id: "booking-1" }) });

    expect(res.status).toBe(500);
    expect(deleteImage).toHaveBeenCalledWith("https://blob.example.com/new.jpg");
    consoleError.mockRestore();
  });

  it("rate limits kiosk heartbeat and student lookups", async () => {
    await kioskHeartbeat(get("/api/kiosk/heartbeat"), { params: Promise.resolve({}) });
    await kioskStudent(get("/api/kiosk/student/student-1"), { params: Promise.resolve({ userId: "student-1" }) });

    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:heartbeat:kiosk-1", { max: 1, windowMs: 60_000 });
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:student:kiosk-1:203.0.113.10", { max: 120, windowMs: 60_000 });
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:student:kiosk-1:203.0.113.10:student-1", { max: 30, windowMs: 60_000 });
  });

  it("caps calendar and calendar-source read sizes", async () => {
    await calendar(get("/api/calendar?from=2026-06-01&to=2026-06-30"), { params: Promise.resolve({}) });
    await calendarSources(get("/api/calendar-sources"), { params: Promise.resolve({}) });

    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(db.calendarSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("rejects retired live shift creation in favor of working-copy editing", async () => {
    const res = await addShift(
      post("/api/shift-groups/group-1/shifts", { area: "VIDEO", workerType: "ST" }),
      { params: Promise.resolve({ id: "group-1" }) },
    );

    expect(res.status).toBe(410);
    expect(globalThis.__wave13TransactionOptions).toBeUndefined();
  });

  it("bounds license claim history service queries", async () => {
    await getClaimHistory("code-1", 100);

    expect(db.licenseCodeClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
