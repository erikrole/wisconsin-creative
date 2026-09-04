import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  bookingFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  serializedCount: vi.fn(),
  bulkFindMany: vi.fn(),
  scanEventCreate: vi.fn(),
  createAuditEntry: vi.fn(),
  findAssetByScanValue: vi.fn(),
  kioskCheckinAsset: vi.fn(),
  scanKioskCheckinBulkUnit: vi.fn(),
  badgeOnCheckoutReturned: vi.fn(),
  badgeOnScanResult: vi.fn(),
  earnedBadgesSince: vi.fn(),
  endCheckoutReturnLiveActivities: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.bookingFindUnique },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: {
      params: P;
      kiosk: {
        kioskId: string;
        name: string;
        locationId: string;
        locationName: string;
      };
    }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) =>
    handler(req, {
      params: await ctx.params,
      kiosk: {
        kioskId: "kiosk-1",
        name: "Video Office Kiosk",
        locationId: "loc-1",
        locationName: "Camp Randall",
      },
    }),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: mocks.createAuditEntry,
  createAuditEntryTx: vi.fn(),
  lookupActorRole: vi.fn(),
}));

vi.mock("@/lib/badges", () => ({
  badges: {
    onCheckoutReturned: mocks.badgeOnCheckoutReturned,
    onScanResult: mocks.badgeOnScanResult,
  },
  earnedBadgesSince: mocks.earnedBadgesSince,
}));

vi.mock("@/lib/badges/scan", () => ({
  badgeScanSourceKey: (args: Record<string, unknown>) => `scan:${args.phase}:${args.ok}:${args.errorCode ?? "ok"}`,
}));

vi.mock("@/lib/services/kiosk-scan", () => ({
  findAssetByScanValue: mocks.findAssetByScanValue,
}));

vi.mock("@/lib/services/bulk-unit-scans", () => ({
  scanKioskCheckinBulkUnit: mocks.scanKioskCheckinBulkUnit,
}));

vi.mock("@/lib/services/kiosk-location", () => ({
  locationEvidencePayload: vi.fn(() => ({})),
}));

vi.mock("@/lib/services/live-activities", () => ({
  endCheckoutReturnLiveActivities: mocks.endCheckoutReturnLiveActivities,
}));

vi.mock("@/lib/services/bookings-checkin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/bookings-checkin")>(
    "@/lib/services/bookings-checkin",
  );
  return {
    ...actual,
    kioskCheckinAsset: mocks.kioskCheckinAsset,
  };
});

import { POST as scanKioskCheckin } from "@/app/api/kiosk/checkin/[id]/scan/route";
import { POST as completeKioskCheckin } from "@/app/api/kiosk/checkin/[id]/complete/route";
import { kioskCompleteCheckin } from "@/lib/services/bookings-checkin";

type KioskCheckinTransactionTx = {
  booking: { findUnique: typeof mocks.bookingFindUnique };
  bookingSerializedItem: { count: typeof mocks.serializedCount };
  bookingBulkItem: { findMany: typeof mocks.bulkFindMany };
  scanEvent: { create: typeof mocks.scanEventCreate };
};

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindFirst.mockResolvedValue({ id: "user-1" });
  mocks.transaction.mockImplementation((handler: (tx: KioskCheckinTransactionTx) => Promise<unknown>) =>
    handler({
      booking: { findUnique: mocks.bookingFindUnique },
      bookingSerializedItem: { count: mocks.serializedCount },
      bookingBulkItem: { findMany: mocks.bulkFindMany },
      scanEvent: { create: mocks.scanEventCreate },
    }),
  );
  mocks.scanKioskCheckinBulkUnit.mockResolvedValue({ handled: false });
  mocks.badgeOnScanResult.mockResolvedValue(undefined);
  mocks.badgeOnCheckoutReturned.mockResolvedValue(undefined);
  mocks.earnedBadgesSince.mockResolvedValue([]);
  mocks.endCheckoutReturnLiveActivities.mockResolvedValue(undefined);
});

describe("kioskCompleteCheckin counts", () => {
  it("counts battery units instead of only serialized items", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      kind: "CHECKOUT",
      status: "OPEN",
      refNumber: "CO-1001",
      locationId: "loc-1",
      requesterUserId: "user-1",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      serializedItems: [],
      bulkItems: [
        {
          bulkSkuId: "sku-1",
          bulkSku: { name: "Sony Battery" },
          plannedQuantity: 2,
          checkedOutQuantity: 2,
          checkedInQuantity: 1,
          unitAllocations: [
            {
              checkedOutAt: new Date("2026-05-05T12:00:00.000Z"),
              checkedInAt: new Date("2026-05-05T13:00:00.000Z"),
              bulkSkuUnit: { unitNumber: 7 },
            },
            {
              checkedOutAt: new Date("2026-05-05T12:05:00.000Z"),
              checkedInAt: null,
              bulkSkuUnit: { unitNumber: 8 },
            },
          ],
        },
      ],
    });
    mocks.serializedCount.mockResolvedValue(0);
    mocks.bulkFindMany.mockResolvedValue([
      { checkedInQuantity: 1, checkedOutQuantity: 2, plannedQuantity: 2 },
    ]);

    const result = await kioskCompleteCheckin({
      bookingId: "booking-1",
      actorUserId: "user-1",
    });

    expect(result.completed).toBe(false);
    expect(result.totalItems).toBe(2);
    expect(result.returnedItems).toBe(1);
    expect(result.returnedItemNames).toEqual(["Sony Battery #7"]);
    expect(mocks.badgeOnCheckoutReturned).not.toHaveBeenCalled();
  });

  it("succeeds idempotently when a prior scan already auto-completed the booking", async () => {
    // Regression: kioskCheckinAsset now auto-completes on the scan that
    // returns the last item, so the booking is frequently already
    // COMPLETED by the time "Complete Return" is tapped. This must not
    // 404 — the explicit tap follows a normal, successful return.
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      kind: "CHECKOUT",
      status: "COMPLETED",
      refNumber: "CO-1001",
      locationId: "loc-1",
      requesterUserId: "user-1",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      serializedItems: [
        {
          allocationStatus: "returned",
          asset: { name: "FX3 Camera", assetTag: "FX3 1" },
        },
      ],
      bulkItems: [],
    });

    const result = await kioskCompleteCheckin({
      bookingId: "booking-1",
      actorUserId: "user-1",
    });

    expect(result.completed).toBe(true);
    expect(result.totalItems).toBe(1);
    expect(result.returnedItems).toBe(1);
    // maybeAutoComplete must not re-run: no second badge/ledger settlement.
    expect(mocks.badgeOnCheckoutReturned).not.toHaveBeenCalled();
  });
});

describe("kiosk check-in scan route", () => {
  it("returns the serialized item after a successful return scan", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 Camera",
    });
    mocks.kioskCheckinAsset.mockResolvedValue({ ok: true });

    const res = await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        headers: { "user-agent": "vitest-kiosk" },
        body: JSON.stringify({ scanValue: "FX3-1" }),
      }),
      routeCtx("booking-1"),
    );
    const json = await res.json();

    expect(json).toEqual({
      success: true,
      item: { id: "asset-1", name: "FX3 Camera", tagName: "FX3 1" },
    });
    expect(mocks.scanEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "booking-1",
        actorUserId: "user-1",
        scanType: "SERIALIZED",
        scanValue: "FX3-1",
        success: true,
        phase: "CHECKIN",
        assetId: "asset-1",
        deviceContext: "vitest-kiosk",
      }),
    });
    expect(mocks.badgeOnScanResult).not.toHaveBeenCalled();
    expect(mocks.scanKioskCheckinBulkUnit).toHaveBeenCalledWith(expect.anything(), {
      bookingId: "booking-1",
      scanValue: "FX3-1",
      kioskLocationId: "loc-1",
      actorUserId: "user-1",
    });
  });

  it("reports when a serialized item was already returned", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 Camera",
    });
    mocks.kioskCheckinAsset.mockResolvedValue({ ok: false, reason: "already_returned" });

    const res = await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "FX3-1" }),
      }),
      routeCtx("booking-1"),
    );
    const json = await res.json();

    expect(json).toEqual({ success: false, error: "FX3 1 already returned" });
    expect(mocks.badgeOnScanResult).not.toHaveBeenCalled();
  });

  it("reports when a serialized item is not in the checkout", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 Camera",
    });
    mocks.kioskCheckinAsset.mockResolvedValue({ ok: false, reason: "not_in_booking" });

    const res = await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "FX3-1" }),
      }),
      routeCtx("booking-1"),
    );
    const json = await res.json();

    expect(json).toEqual({ success: false, error: "FX3 1 is not in this checkout" });
    expect(mocks.badgeOnScanResult).not.toHaveBeenCalled();
  });

  it("reports when the scanned item cannot be found", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue(null);

    const res = await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "missing" }),
      }),
      routeCtx("booking-1"),
    );
    const json = await res.json();

    expect(json).toEqual({ success: false, error: "Item not found" });
    expect(mocks.badgeOnScanResult).not.toHaveBeenCalled();
  });

  it("fires the return badge and ends live activities when the scan auto-completes the checkout", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 Camera",
    });
    const completedAt = new Date("2026-05-06T10:00:00.000Z");
    mocks.kioskCheckinAsset.mockResolvedValue({
      ok: true,
      completed: true,
      badgeEvent: {
        userId: "user-1",
        bookingId: "booking-1",
        completedAt,
        wasOnTime: true,
        sourceKey: "booking-1",
      },
    });

    const res = await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "FX3-1" }),
      }),
      routeCtx("booking-1"),
    );
    const json = await res.json();

    expect(json).toEqual({
      success: true,
      item: { id: "asset-1", name: "FX3 Camera", tagName: "FX3 1" },
    });
    expect(mocks.badgeOnCheckoutReturned).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      bookingId: "booking-1",
    }));
    expect(mocks.endCheckoutReturnLiveActivities).toHaveBeenCalledWith("booking-1");
  });

  it("does not fire the return badge when the scan leaves items outstanding", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 Camera",
    });
    mocks.kioskCheckinAsset.mockResolvedValue({ ok: true, completed: false, badgeEvent: null });

    await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "FX3-1" }),
      }),
      routeCtx("booking-1"),
    );

    expect(mocks.badgeOnCheckoutReturned).not.toHaveBeenCalled();
    expect(mocks.endCheckoutReturnLiveActivities).not.toHaveBeenCalled();
  });

  it("rejects return scans for a booking that is not open", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });

    await expect(scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "FX3-1" }),
      }),
      routeCtx("booking-1"),
    )).rejects.toThrow("Active checkout not found");
  });

  it("fires the return badge and ends live activities when a battery scan auto-completes the checkout", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    const completedAt = new Date("2026-05-06T10:00:00.000Z");
    mocks.scanKioskCheckinBulkUnit.mockResolvedValue({
      handled: true,
      success: true,
      item: {
        id: "unit-7",
        name: "Sony Battery #7",
        tagName: "#7",
        type: "Batteries",
        unitNumber: 7,
        bulkSkuId: "sku-1",
      },
      completed: true,
      badgeEvent: {
        userId: "user-1",
        bookingId: "booking-1",
        completedAt,
        wasOnTime: true,
        sourceKey: "booking-1",
      },
    });

    const res = await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "94e068d1-7" }),
      }),
      routeCtx("booking-1"),
    );
    const json = await res.json();

    expect(json).toEqual({
      success: true,
      item: {
        id: "unit-7",
        name: "Sony Battery #7",
        tagName: "#7",
        type: "Batteries",
        unitNumber: 7,
        bulkSkuId: "sku-1",
      },
    });
    expect(mocks.scanKioskCheckinBulkUnit).toHaveBeenCalledWith(expect.anything(), {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
      kioskLocationId: "loc-1",
      actorUserId: "user-1",
    });
    expect(mocks.badgeOnCheckoutReturned).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      bookingId: "booking-1",
    }));
    expect(mocks.endCheckoutReturnLiveActivities).toHaveBeenCalledWith("booking-1");
  });

  it("does not fire the return badge when a battery scan leaves items outstanding", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.scanKioskCheckinBulkUnit.mockResolvedValue({
      handled: true,
      success: true,
      item: {
        id: "unit-7",
        name: "Sony Battery #7",
        tagName: "#7",
        type: "Batteries",
        unitNumber: 7,
        bulkSkuId: "sku-1",
      },
      completed: false,
      badgeEvent: null,
    });

    await scanKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ scanValue: "94e068d1-7" }),
      }),
      routeCtx("booking-1"),
    );

    expect(mocks.badgeOnCheckoutReturned).not.toHaveBeenCalled();
    expect(mocks.endCheckoutReturnLiveActivities).not.toHaveBeenCalled();
  });
});

describe("kiosk check-in complete route", () => {
  it("returns completion counts and writes the kiosk audit shape", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "user-1", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      kind: "CHECKOUT",
      status: "OPEN",
      refNumber: "CO-1001",
      locationId: "loc-1",
      requesterUserId: "user-1",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      serializedItems: [],
      bulkItems: [
        {
          bulkSkuId: "sku-1",
          bulkSku: { name: "Sony Battery" },
          plannedQuantity: 2,
          checkedOutQuantity: 2,
          checkedInQuantity: 1,
          unitAllocations: [
            {
              checkedOutAt: new Date("2026-05-05T12:00:00.000Z"),
              checkedInAt: new Date("2026-05-05T13:00:00.000Z"),
              bulkSkuUnit: { unitNumber: 7 },
            },
            {
              checkedOutAt: new Date("2026-05-05T12:05:00.000Z"),
              checkedInAt: null,
              bulkSkuUnit: { unitNumber: 8 },
            },
          ],
        },
      ],
    });
    mocks.serializedCount.mockResolvedValue(0);
    mocks.bulkFindMany.mockResolvedValue([
      { checkedInQuantity: 1, checkedOutQuantity: 2, plannedQuantity: 2 },
    ]);

    const res = await completeKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ actorId: "user-1" }),
      }),
      routeCtx("booking-1"),
    );
    const json = await res.json();

    expect(json).toEqual({ returnedItems: 1, totalItems: 2, completed: false });
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      actorRole: "STUDENT",
      action: "kiosk_checkin",
      before: { returnedItems: 1, totalItems: 2 },
      after: expect.objectContaining({
        refNumber: "CO-1001",
        returnedItems: 1,
        totalItems: 2,
        itemNames: ["Sony Battery #7"],
        completed: false,
        source: "KIOSK",
        kioskDeviceId: "kiosk-1",
        kioskName: "Video Office Kiosk",
      }),
    }));
  });

  it("rejects completion when the actor is not an active user", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(completeKioskCheckin(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ actorId: "user-1" }),
      }),
      routeCtx("booking-1"),
    )).rejects.toThrow("User not found");
  });
});
