import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    bulkSku: { findMany: vi.fn() },
    bulkSkuUnit: { findUnique: vi.fn() },
    bookingBulkUnitAllocation: { findFirst: vi.fn() },
  },
  autoComplete: vi.fn(),
  restock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/bookings-helpers", () => ({ upsertBulkBalancesAndMovements: mocks.restock }));
vi.mock("@/lib/services/bookings-checkin", () => ({
  maybeAutoComplete: mocks.autoComplete,
  wasReturnedOnTime: (endsAt: Date, completedAt: Date) => completedAt <= endsAt,
}));

import {
  findBulkUnitByScanValue,
  scanKioskCheckinBulkUnit,
  scanKioskPickupBulkUnit,
  stageKioskReservationPickupBulkUnit,
} from "@/lib/services/bulk-unit-scans";

const sony = { id: "sku-1", name: "Sony Battery", category: "Batteries", binQrCodeValue: "94e068d1", trackByNumber: true };
const canon = { id: "sku-2", name: "Canon Battery", category: "Batteries", binQrCodeValue: "c4n0n", trackByNumber: true };
const bulkItem = { id: "item-1", bulkSkuId: "sku-1", plannedQuantity: 2, checkedOutQuantity: 0, bulkSku: sony };
const endsAt = new Date("2026-10-31T23:00:00.000Z");

function makeTx() {
  return {
    booking: { findUnique: vi.fn() },
    bulkSku: { findMany: vi.fn().mockResolvedValue([sony, canon]) },
    bulkSkuUnit: { findUnique: vi.fn(), update: vi.fn() },
    bookingBulkUnitAllocation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    bookingBulkItem: { update: vi.fn() },
    scanEvent: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  };
}

type Tx = ReturnType<typeof makeTx>;
let tx: Tx;

function unit(status = "AVAILABLE", holder?: { custodyScope: string; requester: { name: string } }) {
  return {
    id: "unit-7",
    bulkSkuId: "sku-1",
    unitNumber: 7,
    status,
    allocations: holder ? [{ bookingBulkItem: { booking: { title: "Volleyball", kind: "CHECKOUT", status: "OPEN", endsAt, ...holder } } }] : [],
  };
}

function pickup(scanValue = "94e068d1-7") {
  return scanKioskPickupBulkUnit(tx as never, { bookingId: "b1", scanValue });
}

function stage(scanValue = "94e068d1-7") {
  return stageKioskReservationPickupBulkUnit(tx as never, { bookingId: "r1", scanValue });
}

function checkin(scanValue = "94e068d1-7") {
  return scanKioskCheckinBulkUnit(tx as never, { bookingId: "b1", scanValue, kioskLocationId: "loc-1", actorUserId: "ada" });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx = makeTx();
  tx.bulkSkuUnit.findUnique.mockResolvedValue(unit());
});

describe("scanKioskPickupBulkUnit", () => {
  beforeEach(() => {
    tx.booking.findUnique.mockResolvedValue({ id: "b1", kind: "CHECKOUT", status: "PENDING_PICKUP", bulkItems: [bulkItem] });
  });

  it("returns 404 unless the booking is a checkout waiting for pickup", async () => {
    tx.booking.findUnique.mockResolvedValue({ id: "b1", kind: "CHECKOUT", status: "OPEN", bulkItems: [] });

    await expect(pickup()).rejects.toMatchObject({ status: 404, message: "Pending pickup not found" });
  });

  it("leaves scans that are not numbered units to the caller", async () => {
    expect(await pickup("ROAM2")).toEqual({ handled: false });
  });

  it("names the battery type that was scanned instead", async () => {
    expect(await pickup("c4n0n-3")).toEqual(expect.objectContaining({
      success: false,
      errorCode: "not_in_booking",
      error: "Wrong battery type: scanned Canon Battery #3, but this pickup expects Sony Battery",
    }));
  });

  it("reports a missing unit and a repeat scan", async () => {
    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(null);
    expect(await pickup()).toEqual(expect.objectContaining({ errorCode: "not_found", error: "Sony Battery #7 does not exist" }));

    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValueOnce({ checkedOutAt: new Date() });
    expect(await pickup()).toEqual(expect.objectContaining({ errorCode: "duplicate", error: "Sony Battery #7 already scanned" }));
  });

  it("names the holder of a unit someone else has, but not for a shared travel case", async () => {
    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(unit("AVAILABLE", { custodyScope: "PERSON", requester: { name: "Grace" } }));
    const personal = await pickup();
    expect(personal).toEqual(expect.objectContaining({ errorCode: "already_checked_out" }));
    expect((personal as { error: string }).error).toContain("Grace");

    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(unit("AVAILABLE", { custodyScope: "SHARED", requester: { name: "Grace" } }));
    const shared = await pickup();
    expect((shared as { error: string }).error).not.toContain("Grace");
  });

  it("stops at the planned quantity and refuses a lost unit", async () => {
    tx.booking.findUnique.mockResolvedValueOnce({ id: "b1", kind: "CHECKOUT", status: "PENDING_PICKUP", bulkItems: [{ ...bulkItem, checkedOutQuantity: 2 }] });
    expect(await pickup()).toEqual(expect.objectContaining({ errorCode: "quantity_exceeded", error: "Sony Battery already has 2 of 2 units scanned" }));

    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(unit("LOST"));
    expect(await pickup()).toEqual(expect.objectContaining({ errorCode: "wrong_status", error: "Sony Battery #7 is marked lost and cannot be picked up" }));
    expect(tx.bookingBulkUnitAllocation.create).not.toHaveBeenCalled();
  });
});

describe("stageKioskReservationPickupBulkUnit", () => {
  function reservation(overrides: Record<string, unknown> = {}) {
    return { id: "r1", kind: "RESERVATION", status: "BOOKED", requesterUserId: "ada", bulkItems: [bulkItem], derivedCheckouts: [], ...overrides };
  }

  beforeEach(() => {
    tx.booking.findUnique.mockResolvedValue(reservation());
  });

  it("returns 404 unless the reservation is booked", async () => {
    tx.booking.findUnique.mockResolvedValue(reservation({ status: "CANCELLED" }));

    await expect(stage()).rejects.toMatchObject({ status: 404 });
  });

  it("leaves other scans to the caller and names a wrong battery type", async () => {
    expect(await stage("ROAM2")).toEqual({ handled: false });
    expect(await stage("c4n0n-3")).toEqual(expect.objectContaining({ errorCode: "not_in_booking", error: expect.stringMatching(/^Wrong battery type: scanned Canon Battery #3/) }));
  });

  it("reports a missing unit", async () => {
    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(null);

    expect(await stage()).toEqual(expect.objectContaining({ errorCode: "not_found" }));
  });

  it("refuses a unit already picked up on an earlier trip", async () => {
    tx.booking.findUnique.mockResolvedValue(reservation({
      derivedCheckouts: [{ bulkItems: [{ bulkSkuId: "sku-1", unitAllocations: [{ bulkSkuUnitId: "unit-7", bulkSkuUnit: { unitNumber: 7 } }] }] }],
    }));

    expect(await stage()).toEqual(expect.objectContaining({ errorCode: "duplicate", error: "Sony Battery #7 already picked up" }));
  });

  it("refuses a unit already scanned in this session", async () => {
    tx.scanEvent.findMany.mockResolvedValue([{ scanValue: "94e068d1-7" }]);

    expect(await stage()).toEqual(expect.objectContaining({ errorCode: "duplicate", error: "Sony Battery #7 already scanned" }));
  });

  it("counts earlier pickups and staged scans against the plan", async () => {
    tx.booking.findUnique.mockResolvedValue(reservation({
      bulkItems: [{ ...bulkItem, checkedOutQuantity: 1 }],
      derivedCheckouts: [{ bulkItems: [{ bulkSkuId: "sku-1", unitAllocations: [{ bulkSkuUnitId: "unit-1", bulkSkuUnit: { unitNumber: 1 } }] }] }],
    }));
    tx.scanEvent.findMany.mockResolvedValue([{ scanValue: "94e068d1-2" }, { scanValue: "not-a-unit" }]);

    expect(await stage()).toEqual(expect.objectContaining({ errorCode: "quantity_exceeded", error: "Sony Battery already has 2 of 2 units picked up or scanned" }));
  });

  it("doesn't count a staged scan twice once that unit was picked up", async () => {
    tx.booking.findUnique.mockResolvedValue(reservation({
      bulkItems: [{ ...bulkItem, checkedOutQuantity: 1 }],
      derivedCheckouts: [{ bulkItems: [{ bulkSkuId: "sku-1", unitAllocations: [{ bulkSkuUnitId: "unit-1", bulkSkuUnit: { unitNumber: 1 } }] }] }],
    }));
    tx.scanEvent.findMany.mockResolvedValue([{ scanValue: "94e068d1-1" }]);

    expect(await stage()).toEqual(expect.objectContaining({ success: true, item: expect.objectContaining({ id: "item-1:slot:1" }) }));
  });

  it("refuses a held or retired unit", async () => {
    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(unit("AVAILABLE", { custodyScope: "PERSON", requester: { name: "Grace" } }));
    expect(await stage()).toEqual(expect.objectContaining({ errorCode: "already_checked_out" }));

    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(unit("RETIRED"));
    expect(await stage()).toEqual(expect.objectContaining({ errorCode: "wrong_status", error: "Sony Battery #7 is marked retired and cannot be picked up" }));
    expect(tx.scanEvent.create).not.toHaveBeenCalled();
  });

  it("stages a scan for the requester in the next slot", async () => {
    tx.scanEvent.findMany.mockResolvedValue([{ scanValue: "94e068d1-2" }]);

    const result = await stage();

    expect(result).toEqual(expect.objectContaining({ success: true, item: expect.objectContaining({ id: "item-1:slot:2", name: "Sony Battery #7", tagName: "#7" }) }));
    expect(tx.scanEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: "ada", phase: "CHECKOUT", deviceContext: "kiosk", quantity: 1 }) });
  });
});

describe("scanKioskCheckinBulkUnit", () => {
  const openCheckout = { id: "b1", kind: "CHECKOUT", status: "OPEN", locationId: "loc-2", requesterUserId: "ada", custodyScope: "PERSON", endsAt, bulkItems: [bulkItem] };

  beforeEach(() => {
    tx.booking.findUnique.mockResolvedValue(openCheckout);
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue({ id: "alloc-1", checkedOutAt: new Date(), checkedInAt: null });
    mocks.autoComplete.mockResolvedValue(null);
  });

  it("returns 404 unless the checkout is open", async () => {
    tx.booking.findUnique.mockResolvedValue({ ...openCheckout, status: "COMPLETED" });

    await expect(checkin()).rejects.toMatchObject({ status: 404, message: "Active checkout not found" });
  });

  it("leaves other scans to the caller, names a wrong type and a missing unit", async () => {
    expect(await checkin("ROAM2")).toEqual({ handled: false });
    expect(await checkin("c4n0n-3")).toEqual(expect.objectContaining({ error: expect.stringMatching(/but this return expects Sony Battery$/) }));

    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(null);
    expect(await checkin()).toEqual(expect.objectContaining({ errorCode: "not_found" }));
  });

  it("explains why a unit not on this checkout can't be returned here", async () => {
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(unit("AVAILABLE", { custodyScope: "PERSON", requester: { name: "Grace" } }));
    expect(await checkin()).toEqual(expect.objectContaining({ errorCode: "wrong_status", error: expect.stringContaining("Grace") }));

    tx.bulkSkuUnit.findUnique.mockResolvedValueOnce(unit("LOST"));
    expect(await checkin()).toEqual(expect.objectContaining({ errorCode: "wrong_status", error: "Sony Battery #7 is marked lost" }));

    expect(await checkin()).toEqual(expect.objectContaining({ errorCode: "not_checked_out", error: "Sony Battery #7 is not checked out on this booking" }));
  });

  it("refuses a unit already returned, including one another kiosk just claimed", async () => {
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValueOnce({ id: "alloc-1", checkedOutAt: new Date(), checkedInAt: new Date() });
    expect(await checkin()).toEqual(expect.objectContaining({ errorCode: "already_returned" }));

    tx.bookingBulkUnitAllocation.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await checkin()).toEqual(expect.objectContaining({ errorCode: "already_returned" }));
    expect(tx.bulkSkuUnit.update).not.toHaveBeenCalled();
  });

  it("returns the unit, restocks it at this kiosk and flags a different return location", async () => {
    const result = await checkin();

    expect(result).toEqual(expect.objectContaining({ success: true, completed: false, badgeEvent: null }));
    expect(tx.bulkSkuUnit.update).toHaveBeenCalledWith({ where: { id: "unit-7" }, data: { status: "AVAILABLE" } });
    expect(mocks.restock).toHaveBeenCalledWith(tx, expect.objectContaining({ locationId: "loc-1", kind: "CHECKIN", items: [{ bulkSkuId: "sku-1", quantity: 1 }] }));
    expect(tx.scanEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ phase: "CHECKIN", expectedLocationId: "loc-2", locationMismatch: true }) });
  });

  it("earns a badge event when the last return completes a personal checkout", async () => {
    const completedAt = new Date("2026-10-31T20:00:00.000Z");
    mocks.autoComplete.mockResolvedValue(completedAt);

    expect(await checkin()).toEqual(expect.objectContaining({
      completed: true,
      badgeEvent: { userId: "ada", bookingId: "b1", completedAt, wasOnTime: true, sourceKey: "b1" },
    }));

    tx.booking.findUnique.mockResolvedValue({ ...openCheckout, custodyScope: "SHARED" });
    expect(await checkin()).toEqual(expect.objectContaining({ completed: true, badgeEvent: null }));
  });
});

describe("findBulkUnitByScanValue", () => {
  beforeEach(() => {
    mocks.db.bulkSku.findMany.mockResolvedValue([sony]);
    mocks.db.bulkSkuUnit.findUnique.mockResolvedValue({ id: "unit-7", unitNumber: 7, status: "AVAILABLE", bulkSku: { ...sony, imageUrl: null, active: true } });
    mocks.db.bookingBulkUnitAllocation.findFirst.mockResolvedValue(null);
  });

  it("finds nothing for another code, an unknown unit or an archived family", async () => {
    expect(await findBulkUnitByScanValue("ROAM2")).toBeNull();

    mocks.db.bulkSkuUnit.findUnique.mockResolvedValueOnce(null);
    expect(await findBulkUnitByScanValue("94e068d1-7")).toBeNull();

    mocks.db.bulkSkuUnit.findUnique.mockResolvedValueOnce({ id: "unit-7", unitNumber: 7, status: "AVAILABLE", bulkSku: { ...sony, active: false } });
    expect(await findBulkUnitByScanValue("94e068d1-7")).toBeNull();
  });

  it("describes a free unit", async () => {
    expect(await findBulkUnitByScanValue("94e068d1-7")).toEqual(expect.objectContaining({
      name: "Sony Battery #7",
      tagName: "#7",
      status: "AVAILABLE",
      holder: null,
      dueAt: undefined,
      bookingTitle: undefined,
    }));
  });

  it("describes a held unit with its holder and due time", async () => {
    mocks.db.bookingBulkUnitAllocation.findFirst.mockResolvedValue({
      bookingBulkItem: { booking: { title: "Volleyball", custodyScope: "PERSON", endsAt, requester: { name: "Grace" } } },
    });

    expect(await findBulkUnitByScanValue("94e068d1-7")).toEqual(expect.objectContaining({
      status: "CHECKED_OUT",
      holder: "Grace",
      dueAt: endsAt.toISOString(),
      bookingTitle: "Volleyball",
    }));
  });
});
