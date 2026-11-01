import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser, CUID_A } from "./_helpers/route-request";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireBookingAction: vi.fn(),
  getAllowedBookingActions: vi.fn(),
  getBookingDetail: vi.fn(),
  maybeAutoComplete: vi.fn(),
  endLive: vi.fn(),
  audit: vi.fn(),
  checkAvailability: vi.fn(),
  hasBlocking: vi.fn(),
  blockMessage: vi.fn(),
  upsertBulk: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: mocks.requireBookingAction,
  getAllowedBookingActions: mocks.getAllowedBookingActions,
}));
vi.mock("@/lib/services/bookings", () => ({ getBookingDetail: mocks.getBookingDetail }));
vi.mock("@/lib/services/bookings-checkin", () => ({ maybeAutoComplete: mocks.maybeAutoComplete }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: mocks.endLive }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/services/availability", () => ({
  checkAvailability: mocks.checkAvailability,
  hasBlockingAvailabilityIssue: mocks.hasBlocking,
}));
vi.mock("@/lib/availability-copy", () => ({
  kioskAvailabilityBlockMessage: mocks.blockMessage,
  kioskHeldItemMessage: vi.fn(() => "held"),
}));
vi.mock("@/lib/services/bookings-helpers", () => ({ upsertBulkBalancesAndMovements: mocks.upsertBulk }));

const { models, db, transactionCalls } = vi.hoisted(() => {
  const models = {
    booking: { findFirst: vi.fn() },
    asset: { findUnique: vi.fn() },
    bookingSerializedItem: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    assetAllocation: { create: vi.fn(), updateMany: vi.fn() },
    bookingBulkUnitAllocation: { findFirst: vi.fn(), update: vi.fn() },
    bulkSkuUnit: { update: vi.fn() },
    bookingBulkItem: { update: vi.fn() },
  };
  const transactionCalls: Array<{ options: unknown }> = [];
  const db = {
    ...models,
    $transaction: vi.fn(async (fn: (tx: typeof models) => Promise<unknown>, options?: unknown) => {
      transactionCalls.push({ options });
      return fn(models);
    }),
  };
  return { models, db, transactionCalls };
});
vi.mock("@/lib/db", () => ({ db }));

import { POST, DELETE } from "@/app/api/bookings/[id]/items/route";

const admin = authUser(Role.ADMIN);
const ctx = routeCtx({ id: CUID_A });
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);
const openCheckout = (endsAt = inAnHour()) => ({
  id: CUID_A,
  title: "Field kit",
  startsAt: new Date(Date.now() - 60 * 60 * 1000),
  endsAt,
  locationId: "loc-1",
  requesterUserId: "student-1",
  custodyScope: "PERSON" as const,
});
const camera = {
  id: "asset-1",
  assetTag: "ROAM2",
  name: "Sony FX3",
  imageUrl: null,
  status: "AVAILABLE",
  category: { name: "Cameras" },
};

beforeEach(() => {
  transactionCalls.length = 0;
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.requireBookingAction.mockResolvedValue({ id: CUID_A });
  mocks.getAllowedBookingActions.mockReturnValue(["edit-items"]);
  mocks.getBookingDetail.mockResolvedValue({ id: CUID_A, kind: BookingKind.CHECKOUT, status: "OPEN" });
  mocks.maybeAutoComplete.mockResolvedValue(null);
  mocks.checkAvailability.mockResolvedValue({ conflicts: [] });
  mocks.hasBlocking.mockReturnValue(false);
  mocks.blockMessage.mockReturnValue("Sony FX3 is booked by someone else");
  models.booking.findFirst.mockResolvedValue(openCheckout());
  models.asset.findUnique.mockResolvedValue(camera);
  models.bookingSerializedItem.findUnique.mockResolvedValue(null);
  models.bookingSerializedItem.create.mockResolvedValue({});
  models.bookingSerializedItem.update.mockResolvedValue({});
  models.assetAllocation.create.mockResolvedValue({});
  models.assetAllocation.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/bookings/[id]/items (admin adds an item from the web)", () => {
  const add = (body: unknown = { assetId: "asset-1" }) => POST(jsonRequest(`/api/bookings/${CUID_A}/items`, "POST", body), ctx);

  it("checks the edit-items action, opens custody from now to the return time and audits it", async () => {
    const checkout = openCheckout();
    models.booking.findFirst.mockResolvedValue(checkout);
    const res = await add();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.requireBookingAction).toHaveBeenCalledWith(CUID_A, admin, "edit-items", BookingKind.CHECKOUT);
    expectSerializableIsolation(transactionCalls);
    expect(models.bookingSerializedItem.create).toHaveBeenCalledWith({
      data: { bookingId: CUID_A, assetId: "asset-1", allocationStatus: "active" },
    });
    const allocation = models.assetAllocation.create.mock.calls[0]![0].data;
    expect(allocation).toMatchObject({ assetId: "asset-1", bookingId: CUID_A, active: true, kind: "CHECKOUT" });
    expect(allocation.startsAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(allocation.endsAt).toBe(checkout.endsAt);
    expect(mocks.checkAvailability).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      serializedAssetIds: ["asset-1"],
      bookingKind: BookingKind.CHECKOUT,
      excludeBookingId: CUID_A,
      locationId: "loc-1",
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "checkout_item_added",
      entityId: CUID_A,
      after: expect.objectContaining({ assetId: "asset-1", tagName: "ROAM2", addedFrom: "web" }),
    }));
    expect(body.data.allowedActions).toEqual(["edit-items"]);
  });

  it("reactivates a returned row instead of creating a duplicate item", async () => {
    models.bookingSerializedItem.findUnique.mockResolvedValue({ allocationStatus: "returned" });

    const res = await add();

    expect(res.status).toBe(200);
    expect(models.bookingSerializedItem.create).not.toHaveBeenCalled();
    expect(models.bookingSerializedItem.update).toHaveBeenCalledWith({
      where: { bookingId_assetId: { bookingId: CUID_A, assetId: "asset-1" } },
      data: { allocationStatus: "active" },
    });
  });

  it("refuses an item that is already active on this checkout", async () => {
    models.bookingSerializedItem.findUnique.mockResolvedValue({ allocationStatus: "active" });

    const res = await add();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ROAM2 is already on this checkout");
    expect(models.assetAllocation.create).not.toHaveBeenCalled();
  });

  it("refuses an overdue checkout before touching the item", async () => {
    models.booking.findFirst.mockResolvedValue(openCheckout(new Date(Date.now() - 1000)));

    const res = await add();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/overdue/);
    expect(models.asset.findUnique).not.toHaveBeenCalled();
  });

  it("404s when the checkout is not open or the item does not exist", async () => {
    models.booking.findFirst.mockResolvedValue(null);
    expect((await add()).status).toBe(404);

    models.booking.findFirst.mockResolvedValue(openCheckout());
    models.asset.findUnique.mockResolvedValue(null);
    const res = await add();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Item not found");
  });

  it.each([
    ["RETIRED", "ROAM2 is retired"],
    ["MAINTENANCE", "ROAM2 is in maintenance"],
  ])("refuses a %s item", async (status, message) => {
    models.asset.findUnique.mockResolvedValue({ ...camera, status });

    const res = await add();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(message);
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
  });

  it("refuses when the item is booked by someone else before the return time", async () => {
    mocks.hasBlocking.mockReturnValue(true);

    const res = await add();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Sony FX3 is booked by someone else");
    expect(models.bookingSerializedItem.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("validates the body before any permission or database work", async () => {
    const res = await add({ assetId: "" });

    expect(res.status).toBe(400);
    expect(mocks.requireBookingAction).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("stops at the booking-rules gate for users without edit-items", async () => {
    const { HttpError } = await import("@/lib/http");
    mocks.requireBookingAction.mockRejectedValue(new HttpError(403, "Only admins can edit items"));

    const res = await add();

    expect(res.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/bookings/[id]/items (admin removes an item from the web)", () => {
  const remove = (body: unknown = { assetId: "asset-1" }) => DELETE(jsonRequest(`/api/bookings/${CUID_A}/items`, "DELETE", body), ctx);

  beforeEach(() => {
    models.bookingSerializedItem.findUnique.mockResolvedValue({
      id: "bsi-1",
      allocationStatus: "active",
      asset: { assetTag: "ROAM2", name: "Sony FX3" },
    });
  });

  it("returns the item's custody, audits it and asks whether the checkout is now empty", async () => {
    const res = await remove();

    expect(res.status).toBe(200);
    expectSerializableIsolation(transactionCalls);
    expect(models.bookingSerializedItem.update).toHaveBeenCalledWith({ where: { id: "bsi-1" }, data: { allocationStatus: "returned" } });
    expect(models.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: CUID_A, assetId: "asset-1", active: true },
      data: { active: false },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "checkout_item_removed",
      before: expect.objectContaining({ assetId: "asset-1", tagName: "ROAM2", removedFrom: "web" }),
    }));
    expect(mocks.maybeAutoComplete).toHaveBeenCalledWith(expect.anything(), CUID_A, "loc-1", admin.id, {
      auditAction: "auto_completed_by_item_removal",
      returnedFor: expect.objectContaining({ requesterUserId: "student-1", custodyScope: "PERSON" }),
    });
    expect(mocks.endLive).not.toHaveBeenCalled();
  });

  it("ends the return live activity when removing the last item closes the checkout", async () => {
    mocks.maybeAutoComplete.mockResolvedValue(new Date());

    const res = await remove();

    expect(res.status).toBe(200);
    expect(mocks.endLive).toHaveBeenCalledWith(CUID_A);
  });

  it("refuses an item that is not active on the checkout", async () => {
    models.bookingSerializedItem.findUnique.mockResolvedValue({ id: "bsi-1", allocationStatus: "returned", asset: { assetTag: "ROAM2", name: null } });

    const res = await remove();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Item is not active on this checkout");
    expect(mocks.maybeAutoComplete).not.toHaveBeenCalled();
  });

  it("returns a numbered battery unit: allocation closed, unit available, ledger moved", async () => {
    models.bookingBulkUnitAllocation.findFirst.mockResolvedValue({
      id: "alloc-1",
      bulkSkuUnit: { id: "unit-7", unitNumber: 7, bulkSkuId: "sku-np", bulkSku: { name: "NP-F970" } },
      bookingBulkItem: { id: "bbi-1", plannedQuantity: 2, checkedOutQuantity: 2, checkedInQuantity: 0 },
    });

    const res = await remove({ bulkSkuId: "sku-np", unitNumber: 7 });

    expect(res.status).toBe(200);
    expect(models.bookingBulkUnitAllocation.update).toHaveBeenCalledWith({
      where: { id: "alloc-1" },
      data: { checkedInAt: expect.any(Date) },
    });
    expect(models.bulkSkuUnit.update).toHaveBeenCalledWith({ where: { id: "unit-7" }, data: { status: "AVAILABLE" } });
    expect(models.bookingBulkItem.update).toHaveBeenCalledWith({ where: { id: "bbi-1" }, data: { checkedInQuantity: { increment: 1 } } });
    expect(mocks.upsertBulk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      kind: "CHECKIN",
      items: [{ bulkSkuId: "sku-np", quantity: 1 }],
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "checkout_item_removed",
      before: expect.objectContaining({ unitNumber: 7, itemName: "NP-F970 #7", removedFrom: "web" }),
    }));
  });

  it("refuses a battery unit that is not out on this checkout", async () => {
    models.bookingBulkUnitAllocation.findFirst.mockResolvedValue(null);

    const res = await remove({ bulkSkuId: "sku-np", unitNumber: 7 });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Battery unit is not active on this checkout");
  });

  it("refuses when battery counts disagree with active custody", async () => {
    models.bookingBulkUnitAllocation.findFirst.mockResolvedValue({
      id: "alloc-1",
      bulkSkuUnit: { id: "unit-7", unitNumber: 7, bulkSkuId: "sku-np", bulkSku: { name: "NP-F970" } },
      bookingBulkItem: { id: "bbi-1", plannedQuantity: 1, checkedOutQuantity: 1, checkedInQuantity: 1 },
    });

    const res = await remove({ bulkSkuId: "sku-np", unitNumber: 7 });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Battery counts do not match/);
    expect(models.bulkSkuUnit.update).not.toHaveBeenCalled();
  });

  it("rejects a body that names neither an asset nor a numbered unit", async () => {
    const res = await remove({ bulkSkuId: "sku-np" });

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
