import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  transaction: vi.fn(),
  userFindFirst: vi.fn(),
  transactionUserFindFirst: vi.fn(),
  bookingCreate: vi.fn(),
  bookingCount: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  bookingSerializedItemCreateMany: vi.fn(),
  assetAllocationCreateMany: vi.fn(),
  assetUpdateMany: vi.fn(),
  bulkSkuUnitFindMany: vi.fn(),
  bulkSkuUnitUpdateMany: vi.fn(),
  bookingBulkItemCreateMany: vi.fn(),
  bookingBulkItemFindMany: vi.fn(),
  bookingBulkUnitAllocationCreateMany: vi.fn(),
  calendarEventFindFirst: vi.fn(),
  bookingEventCreate: vi.fn(),
  createAuditEntryTx: vi.fn(),
  nextBookingRef: vi.fn(),
  upsertBulkBalancesAndMovements: vi.fn(),
  badgeOnCheckoutOpened: vi.fn(),
  earnedBadgesSince: vi.fn(),
  checkAvailability: vi.fn(),
  scheduleCheckoutReturnLiveActivity: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

type KioskTestHandler = (
  req: Request,
  ctx: {
    kiosk: {
      kioskId: string;
      locationId: string;
      locationName: string;
    };
  },
) => Promise<Response>;

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    user: { findFirst: mocks.userFindFirst },
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: (handler: KioskTestHandler) => (req: Request) =>
    handler(req, {
      kiosk: {
        kioskId: "kiosk-1",
        locationId: "loc-1",
        locationName: "Camp Randall",
      },
    }),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: mocks.createAuditEntryTx,
}));

vi.mock("@/lib/services/booking-ref", () => ({
  nextBookingRef: mocks.nextBookingRef,
}));

vi.mock("@/lib/services/bookings-helpers", () => ({
  upsertBulkBalancesAndMovements: mocks.upsertBulkBalancesAndMovements,
}));

vi.mock("@/lib/services/availability", () => ({
  checkAvailability: mocks.checkAvailability,
}));

vi.mock("@/lib/badges", () => ({
  badges: {
    onCheckoutOpened: mocks.badgeOnCheckoutOpened,
  },
  earnedBadgesSince: mocks.earnedBadgesSince,
}));

vi.mock("@/lib/live-activity-workflow", () => ({
  scheduleCheckoutReturnLiveActivity: mocks.scheduleCheckoutReturnLiveActivity,
}));

import { POST as completeKioskCheckout } from "@/app/api/kiosk/checkout/complete/route";
import { normalizeCheckoutCompleteItems } from "@/lib/services/kiosk-checkout-complete";

const runCompleteKioskCheckout = completeKioskCheckout as unknown as (req: Request) => Promise<Response>;

function completeRequest(items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify({
      actorId: "user-1",
      locationId: "loc-1",
      items,
      endsAt: tomorrow,
      customPurpose: "Practice checkout",
      ...extra,
    }),
  });
}

function transactionClient() {
  return {
    user: { findFirst: mocks.transactionUserFindFirst },
    booking: { create: mocks.bookingCreate, count: mocks.bookingCount },
    systemConfig: { findUnique: mocks.systemConfigFindUnique },
    bookingSerializedItem: { createMany: mocks.bookingSerializedItemCreateMany },
    assetAllocation: { createMany: mocks.assetAllocationCreateMany },
    asset: { updateMany: mocks.assetUpdateMany },
    bulkSkuUnit: {
      findMany: mocks.bulkSkuUnitFindMany,
      updateMany: mocks.bulkSkuUnitUpdateMany,
    },
    bookingBulkItem: {
      createMany: mocks.bookingBulkItemCreateMany,
      findMany: mocks.bookingBulkItemFindMany,
    },
    bookingBulkUnitAllocation: { createMany: mocks.bookingBulkUnitAllocationCreateMany },
    calendarEvent: { findFirst: mocks.calendarEventFindFirst },
    bookingEvent: { create: mocks.bookingEventCreate },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.after.mockImplementation((callback: () => Promise<void>) => {
    void callback();
  });
  mocks.userFindFirst.mockResolvedValue({ id: "user-1", name: "Bucky Badger", role: "STUDENT" });
  mocks.transactionUserFindFirst.mockResolvedValue({ id: "user-1", role: "STUDENT" });
  mocks.nextBookingRef.mockResolvedValue("CO-1001");
  mocks.systemConfigFindUnique.mockResolvedValue(null);
  mocks.bookingCount.mockResolvedValue(0);
  mocks.bookingCreate.mockImplementation(({ data }) => Promise.resolve({
    id: "booking-1",
    title: data.title,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
  }));
  mocks.assetAllocationCreateMany.mockResolvedValue(undefined);
  mocks.bulkSkuUnitFindMany.mockResolvedValue([
    {
      id: "unit-31",
      bulkSkuId: "sku-sony",
      unitNumber: 31,
      status: "AVAILABLE",
      bulkSku: { id: "sku-sony", name: "Sony Battery", active: true },
      allocations: [],
    },
  ]);
  mocks.bulkSkuUnitUpdateMany.mockResolvedValue({ count: 1 });
  mocks.bookingBulkItemCreateMany.mockResolvedValue({ count: 1 });
  mocks.bookingBulkItemFindMany.mockResolvedValue([{ id: "bulk-item-1", bulkSkuId: "sku-sony" }]);
  mocks.calendarEventFindFirst.mockResolvedValue(null);
  mocks.checkAvailability.mockResolvedValue({
    conflicts: [],
    shortages: [],
    unavailableAssets: [],
    upcomingCommitments: [],
    turnaroundRisks: [],
    bulkTurnaroundRisks: [],
  });
  mocks.createAuditEntryTx.mockResolvedValue(undefined);
  mocks.scheduleCheckoutReturnLiveActivity.mockResolvedValue(undefined);
  mocks.earnedBadgesSince.mockResolvedValue([]);
  mocks.transaction.mockImplementation((handler) => handler(transactionClient()));
});

describe("kiosk checkout complete bulk units", () => {
  it("normalizes old cart IDs and new typed battery unit items the same way", () => {
    expect(normalizeCheckoutCompleteItems([
      { assetId: "asset-1" },
      { assetId: "bulk:sku-sony:unit:31" },
      { bulkSkuId: "sku-sony", unitNumber: 32 },
    ])).toEqual({
      assetIds: ["asset-1"],
      bulkUnitItems: [
        { bulkSkuId: "sku-sony", unitNumber: 31 },
        { bulkSkuId: "sku-sony", unitNumber: 32 },
      ],
    });
  });

  it("persists a legacy battery cart item as a numbered bulk checkout", async () => {
    const res = await runCompleteKioskCheckout(completeRequest([
      { assetId: "bulk:sku-sony:unit:31" },
    ]));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.itemCount).toBe(1);
    expect(mocks.bookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Practice Checkout",
        eventId: undefined,
      }),
    });
    expect(mocks.bookingEventCreate).not.toHaveBeenCalled();
    expect(mocks.bookingSerializedItemCreateMany).not.toHaveBeenCalled();
    expect(mocks.assetAllocationCreateMany).not.toHaveBeenCalled();
    expect(mocks.assetUpdateMany).not.toHaveBeenCalled();
    expect(mocks.bulkSkuUnitFindMany).toHaveBeenCalledWith({
      where: {
        OR: [{ bulkSkuId: "sku-sony", unitNumber: 31 }],
      },
      include: {
        bulkSku: {
          select: {
            id: true,
            name: true,
            active: true,
          },
        },
        allocations: {
          where: { checkedOutAt: { not: null }, checkedInAt: null },
          take: 1,
          select: { id: true },
        },
      },
    });
    expect(mocks.bookingBulkItemCreateMany).toHaveBeenCalledWith({
      data: [{
        bookingId: "booking-1",
        bulkSkuId: "sku-sony",
        plannedQuantity: 1,
        checkedOutQuantity: 1,
      }],
    });
    expect(mocks.bookingBulkItemFindMany).toHaveBeenCalledWith({
      where: {
        bookingId: "booking-1",
        bulkSkuId: { in: ["sku-sony"] },
      },
      select: { id: true, bulkSkuId: true },
    });
    expect(mocks.bookingBulkUnitAllocationCreateMany).toHaveBeenCalledWith({
      data: [{
        bookingBulkItemId: "bulk-item-1",
        bulkSkuUnitId: "unit-31",
        checkedOutAt: expect.any(Date),
      }],
    });
    expect(mocks.upsertBulkBalancesAndMovements).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      bookingId: "booking-1",
      actorUserId: "user-1",
      items: [{ bulkSkuId: "sku-sony", quantity: 1 }],
    }));
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "kiosk_checkout",
        after: expect.objectContaining({ itemCount: 1 }),
      }),
    );
    expect(mocks.badgeOnCheckoutOpened).toHaveBeenCalledWith({
      userId: "user-1",
      bookingId: "booking-1",
      source: "kiosk_checkout",
      sourceKey: "booking-1",
    });
    expect(mocks.scheduleCheckoutReturnLiveActivity).toHaveBeenCalledWith({
      bookingId: "booking-1",
      endsAt: expect.any(Date),
    });
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("BUG: batches distinct battery SKUs instead of issuing writes per SKU", async () => {
    mocks.bulkSkuUnitFindMany.mockResolvedValue([
      {
        id: "unit-31",
        bulkSkuId: "sku-sony",
        unitNumber: 31,
        status: "AVAILABLE",
        bulkSku: { id: "sku-sony", name: "Sony Battery", active: true },
        allocations: [],
      },
      {
        id: "unit-4",
        bulkSkuId: "sku-canon",
        unitNumber: 4,
        status: "AVAILABLE",
        bulkSku: { id: "sku-canon", name: "Canon Battery", active: true },
        allocations: [],
      },
    ]);
    mocks.bulkSkuUnitUpdateMany.mockResolvedValue({ count: 2 });
    mocks.bookingBulkItemCreateMany.mockResolvedValue({ count: 2 });
    mocks.bookingBulkItemFindMany.mockResolvedValue([
      { id: "bulk-item-sony", bulkSkuId: "sku-sony" },
      { id: "bulk-item-canon", bulkSkuId: "sku-canon" },
    ]);

    const res = await runCompleteKioskCheckout(completeRequest([
      { bulkSkuId: "sku-sony", unitNumber: 31 },
      { bulkSkuId: "sku-canon", unitNumber: 4 },
    ]));

    expect(res.status).toBe(200);
    expect(mocks.bookingBulkItemCreateMany).toHaveBeenCalledOnce();
    expect(mocks.bookingBulkItemCreateMany).toHaveBeenCalledWith({
      data: [
        {
          bookingId: "booking-1",
          bulkSkuId: "sku-sony",
          plannedQuantity: 1,
          checkedOutQuantity: 1,
        },
        {
          bookingId: "booking-1",
          bulkSkuId: "sku-canon",
          plannedQuantity: 1,
          checkedOutQuantity: 1,
        },
      ],
    });
    expect(mocks.bookingBulkUnitAllocationCreateMany).toHaveBeenCalledOnce();
    expect(mocks.bookingBulkUnitAllocationCreateMany).toHaveBeenCalledWith({
      data: [
        {
          bookingBulkItemId: "bulk-item-sony",
          bulkSkuUnitId: "unit-31",
          checkedOutAt: expect.any(Date),
        },
        {
          bookingBulkItemId: "bulk-item-canon",
          bulkSkuUnitId: "unit-4",
          checkedOutAt: expect.any(Date),
        },
      ],
    });
  });

  it("links a selected event and uses the event summary as the booking title", async () => {
    mocks.calendarEventFindFirst.mockResolvedValue({
      id: "event-1",
      summary: "Volleyball vs Iowa",
      sportCode: "VB",
      endsAt: new Date("2026-06-16T21:00:00.000Z"),
    });

    const res = await runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { eventId: "event-1", customPurpose: "Broadcast camera" },
    ));

    expect(res.status).toBe(200);
    expect(mocks.calendarEventFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "event-1",
        isHidden: false,
        archivedAt: null,
      }),
      select: { id: true, summary: true, sportCode: true, endsAt: true },
    }));
    expect(mocks.bookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Volleyball vs Iowa",
        eventId: "event-1",
        sportCode: "VB",
        notes: expect.stringContaining("Purpose: Broadcast camera"),
      }),
    });
    expect(mocks.bookingEventCreate).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        eventId: "event-1",
        ordinal: 0,
      },
    });
  });

  it("requires an event or custom purpose", async () => {
    await expect(runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { customPurpose: undefined },
    ))).rejects.toThrow("Select an event or enter what this checkout is for");
  });

  it("uses the selected return time for checkout allocations and conflict checks", async () => {
    const endsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const res = await runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { endsAt },
    ));

    expect(res.status).toBe(200);
    expect(mocks.checkAvailability).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      serializedAssetIds: ["asset-1"],
      bulkItems: [],
      bookingKind: "CHECKOUT",
      includeBulkTurnaroundRisks: false,
      startsAt: expect.any(Date),
      endsAt: new Date(endsAt),
    }));
    expect(mocks.bookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startsAt: expect.any(Date),
        endsAt: new Date(endsAt),
      }),
    });
    expect(mocks.assetAllocationCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        assetId: "asset-1",
        startsAt: expect.any(Date),
        endsAt: new Date(endsAt),
      })],
    });
  });

  it("BUG: uses the configured default loan duration when no return time or event end is supplied", async () => {
    mocks.systemConfigFindUnique.mockResolvedValue({
      value: { defaultLoanDays: 5, gracePeriodHours: 0, maxItemsPerUser: null },
    });
    const startedAt = Date.now();

    const res = await runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { endsAt: undefined },
    ));

    expect(res.status).toBe(200);
    expect(mocks.systemConfigFindUnique).toHaveBeenCalledWith({
      where: { key: "checkout_policies" },
      select: { value: true },
    });
    const createdEndsAt = mocks.bookingCreate.mock.calls[0]![0].data.endsAt as Date;
    expect(createdEndsAt.getTime()).toBeGreaterThanOrEqual(startedAt + 5 * 24 * 60 * 60 * 1000);
    expect(createdEndsAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 24 * 60 * 60 * 1000);
  });

  it("defaults linked-event return time to 90 minutes after the event ends", async () => {
    const eventEndsAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    mocks.calendarEventFindFirst.mockResolvedValue({
      id: "event-1",
      summary: "Men's Soccer vs Iowa",
      sportCode: "MSO",
      endsAt: eventEndsAt,
    });

    const res = await runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { eventId: "event-1", endsAt: undefined, customPurpose: undefined },
    ));

    expect(res.status).toBe(200);
    const expectedEndsAt = new Date(eventEndsAt.getTime() + 90 * 60 * 1000);
    expect(mocks.bookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        endsAt: expectedEndsAt,
      }),
    });
    expect(mocks.checkAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endsAt: expectedEndsAt }),
    );
  });

  it("BUG: rejects at the configured active-checkout cap inside the Serializable transaction", async () => {
    mocks.systemConfigFindUnique.mockResolvedValue({
      value: { defaultLoanDays: 3, gracePeriodHours: 0, maxItemsPerUser: 2 },
    });
    mocks.bookingCount.mockResolvedValue(2);

    await expect(runCompleteKioskCheckout(completeRequest([
      { assetId: "asset-1" },
    ]))).rejects.toThrow("maximum number of active checkouts");

    expect(mocks.bookingCount).toHaveBeenCalledWith({
      where: {
        kind: "CHECKOUT",
        requesterUserId: "user-1",
        status: { in: ["OPEN", "PENDING_PICKUP"] },
      },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
  });

  it("rejects an actor deactivated before the transaction without checkout writes or effects", async () => {
    mocks.transactionUserFindFirst.mockResolvedValue(null);

    await expect(runCompleteKioskCheckout(completeRequest([
      { assetId: "asset-1" },
    ]))).rejects.toThrow("User not found");

    expect(mocks.transactionUserFindFirst).toHaveBeenCalledWith({
      where: { id: "user-1", active: true },
      select: { id: true, role: true },
    });
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.nextBookingRef).not.toHaveBeenCalled();
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.bookingSerializedItemCreateMany).not.toHaveBeenCalled();
    expect(mocks.assetAllocationCreateMany).not.toHaveBeenCalled();
    expect(mocks.bulkSkuUnitUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
    expect(mocks.scheduleCheckoutReturnLiveActivity).not.toHaveBeenCalled();
  });

  it("allows the checkout immediately below the configured active-checkout cap", async () => {
    mocks.systemConfigFindUnique.mockResolvedValue({
      value: { defaultLoanDays: 3, gracePeriodHours: 0, maxItemsPerUser: 2 },
    });
    mocks.bookingCount.mockResolvedValue(1);

    const res = await runCompleteKioskCheckout(completeRequest([
      { assetId: "asset-1" },
    ]));

    expect(res.status).toBe(200);
    expect(mocks.bookingCreate).toHaveBeenCalledOnce();
  });

  it("BUG: retries one serialization race before publishing post-commit effects", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" });

    const res = await runCompleteKioskCheckout(completeRequest([
      { assetId: "asset-1" },
    ]));

    expect(res.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.badgeOnCheckoutOpened).toHaveBeenCalledOnce();
    expect(mocks.scheduleCheckoutReturnLiveActivity).toHaveBeenCalledOnce();
  });

  it("maps a persistent serialization race to a retryable conflict without post-commit effects", async () => {
    mocks.transaction.mockRejectedValue({ code: "40001" });

    await expect(runCompleteKioskCheckout(completeRequest([
      { assetId: "asset-1" },
    ]))).rejects.toThrow("Please retry");

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
    expect(mocks.scheduleCheckoutReturnLiveActivity).not.toHaveBeenCalled();
  });

  it("ignores client-supplied location and records the authenticated kiosk location", async () => {
    const res = await runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { locationId: "client-supplied-location" },
    ));

    expect(res.status).toBe(200);
    expect(mocks.checkAvailability).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      includeBulkTurnaroundRisks: false,
    }));
    expect(mocks.bookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        locationId: "loc-1",
        pickupKioskDeviceId: "kiosk-1",
      }),
    });
    expect(mocks.assetUpdateMany).not.toHaveBeenCalled();
  });

  it("uses the kiosk location when the request omits a location", async () => {
    const res = await runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { locationId: undefined },
    ));

    expect(res.status).toBe(200);
    expect(mocks.checkAvailability).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      includeBulkTurnaroundRisks: false,
      serializedAssetIds: ["asset-1"],
    }));
    expect(mocks.bookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        locationId: "loc-1",
      }),
    });
  });

  it("rejects checkout completion when availability finds a blocking conflict", async () => {
    const endsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    mocks.checkAvailability.mockResolvedValue({
      conflicts: [{
        assetId: "asset-1",
        conflictingBookingId: "booking-2",
        conflictingBookingTitle: "Practice",
        startsAt: new Date("2026-06-16T20:00:00.000Z"),
        endsAt: new Date("2026-06-16T22:00:00.000Z"),
      }],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });

    await expect(runCompleteKioskCheckout(completeRequest(
      [{ assetId: "asset-1" }],
      { endsAt },
    ))).rejects.toThrow("One or more items are not available for the selected return time");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  // ── REGRESSION: orphaned CHECKED_OUT flags self-heal on claim ────────────
  it("claims a unit with an orphaned CHECKED_OUT flag and no active allocation", async () => {
    mocks.bulkSkuUnitFindMany.mockResolvedValue([
      {
        id: "unit-19",
        bulkSkuId: "sku-sony",
        unitNumber: 19,
        // Stale raw flag: every read path (Battery Ops, kiosk scan) already
        // reports this unit as available via effectiveBulkUnitStatus.
        status: "CHECKED_OUT",
        bulkSku: { id: "sku-sony", name: "Sony Battery", active: true },
        allocations: [],
      },
    ]);

    const res = await runCompleteKioskCheckout(completeRequest([
      { bulkSkuId: "sku-sony", unitNumber: 19 },
    ]));

    expect(res.status).toBe(200);
    // The guarded claim accepts AVAILABLE or orphaned CHECKED_OUT, but never
    // a unit an active allocation holds.
    expect(mocks.bulkSkuUnitUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["unit-19"] },
        status: { in: ["AVAILABLE", "CHECKED_OUT"] },
        allocations: { none: { checkedOutAt: { not: null }, checkedInAt: null } },
      },
      data: { status: "CHECKED_OUT" },
    });
  });

  it("still rejects a unit genuinely held by an active allocation", async () => {
    mocks.bulkSkuUnitFindMany.mockResolvedValue([
      {
        id: "unit-27",
        bulkSkuId: "sku-sony",
        unitNumber: 27,
        status: "CHECKED_OUT",
        bulkSku: { id: "sku-sony", name: "Sony Battery", active: true },
        allocations: [{ id: "alloc-active" }],
      },
    ]);

    await expect(runCompleteKioskCheckout(completeRequest([
      { bulkSkuId: "sku-sony", unitNumber: 27 },
    ]))).rejects.toThrow("Sony Battery #27 is no longer available");
    expect(mocks.bulkSkuUnitUpdateMany).not.toHaveBeenCalled();
  });

  it("maps a last-second allocation constraint race to a friendly conflict", async () => {
    mocks.assetAllocationCreateMany.mockRejectedValue({
      code: "23P01",
      message: "violates exclusion constraint asset_allocations_no_overlap",
    });

    await expect(runCompleteKioskCheckout(completeRequest([
      { assetId: "asset-1" },
    ]))).rejects.toThrow("One or more items are no longer available");
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
  });

  it("BUG: audit failure rejects the transaction before badge or Live Activity success", async () => {
    const tx = transactionClient();
    mocks.transaction.mockImplementationOnce((handler) => handler(tx));
    mocks.createAuditEntryTx.mockRejectedValueOnce(new Error("audit write failed"));

    await expect(runCompleteKioskCheckout(completeRequest([
      { assetId: "asset-1" },
    ]))).rejects.toThrow("audit write failed");

    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "kiosk_checkout",
        entityId: "booking-1",
      }),
    );
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
    expect(mocks.scheduleCheckoutReturnLiveActivity).not.toHaveBeenCalled();
  });
});
