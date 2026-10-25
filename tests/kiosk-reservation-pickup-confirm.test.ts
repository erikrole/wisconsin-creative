import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus, Role } from "@prisma/client";
import { jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireKiosk: vi.fn(),
  txUserFindFirst: vi.fn(),
  txBookingFindUnique: vi.fn(),
  bookingFindUnique: vi.fn(),
  auditFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
  createBooking: vi.fn(),
  createAuditEntry: vi.fn(),
  onCheckoutOpened: vi.fn(),
  earnedBadgesSince: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(), requireKiosk: mocks.requireKiosk }));
vi.mock("@/lib/db", () => {
  const tx = {
    user: { findFirst: mocks.txUserFindFirst },
    booking: { findUnique: mocks.txBookingFindUnique },
    auditLog: { findUnique: mocks.auditFindUnique, create: mocks.auditCreate, update: mocks.auditUpdate },
  };
  return {
    db: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      booking: { findUnique: mocks.bookingFindUnique },
      auditLog: tx.auditLog,
    },
  };
});
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.createAuditEntry, createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/services/bookings", () => ({ createBooking: mocks.createBooking }));
vi.mock("@/lib/badges", () => ({
  badges: { onCheckoutOpened: mocks.onCheckoutOpened },
  earnedBadgesSince: mocks.earnedBadgesSince,
}));

import { POST } from "@/app/api/kiosk/pickup/[id]/confirm/route";

const ctx = routeCtx({ id: "res-1" });
const ENDS_AT = new Date("2026-10-26T03:00:00.000Z");

function serialized(assetId: string, name: string, allocationStatus = "reserved") {
  return { assetId, allocationStatus, asset: { assetTag: assetId.toUpperCase(), name } };
}

function scan(assetId: string) {
  return { assetId, bulkSkuId: null, scanType: "SERIALIZED", scanValue: assetId };
}

function binScan(bulkSkuId: string, scanValue: string) {
  return { assetId: null, bulkSkuId, scanType: "BULK_BIN", scanValue };
}

const batteries = (plannedQuantity: number, checkedOutQuantity = 0) => ({
  bulkSkuId: "batt",
  plannedQuantity,
  checkedOutQuantity,
  bulkSku: { id: "batt", name: "Sony Battery", binQrCodeValue: "BATT", trackByNumber: true },
});

const gaffTape = (plannedQuantity: number, checkedOutQuantity = 0) => ({
  bulkSkuId: "gaff",
  plannedQuantity,
  checkedOutQuantity,
  bulkSku: { id: "gaff", name: "Gaff Tape", binQrCodeValue: null, trackByNumber: false },
});

function reservation(over: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    kind: BookingKind.RESERVATION,
    status: BookingStatus.BOOKED,
    title: "Volleyball vs. Nebraska",
    requesterUserId: "maya",
    custodyScope: BookingCustodyScope.PERSON,
    locationId: "cr",
    startsAt: new Date("2026-10-25T20:00:00.000Z"),
    endsAt: ENDS_AT,
    notes: null,
    eventId: "ev-legacy",
    sportCode: "WVB",
    shiftAssignmentId: "shift-1",
    kitId: null,
    serializedItems: [serialized("fx3-1", "FX3 1"), serialized("fx3-2", "FX3 2")],
    bulkItems: [] as unknown[],
    scanEvents: [scan("fx3-1"), scan("fx3-2")] as unknown[],
    derivedCheckouts: [] as unknown[],
    events: [] as Array<{ eventId: string }>,
    ...over,
  };
}

function useReservation(row: ReturnType<typeof reservation>, statusAfter: BookingStatus = BookingStatus.COMPLETED) {
  mocks.bookingFindUnique.mockReset();
  mocks.bookingFindUnique.mockResolvedValueOnce(row).mockResolvedValueOnce({ status: statusAfter });
}

const confirm = (body: Record<string, unknown> = {}) =>
  POST(jsonRequest("/api/kiosk/pickup/res-1/confirm", "POST", { actorId: "maya", ...body }), ctx);

const created = () => mocks.createBooking.mock.calls[0]![0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKiosk.mockResolvedValue({ kioskId: "k1", name: "Video Office", locationId: "cr", locationName: "Camp Randall" });
  mocks.txUserFindFirst.mockResolvedValue({ id: "maya", role: Role.STUDENT });
  mocks.txBookingFindUnique.mockResolvedValue({ id: "res-1", kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED });
  mocks.auditFindUnique.mockResolvedValue(null);
  mocks.createBooking.mockResolvedValue({ id: "co-new" });
  mocks.earnedBadgesSince.mockResolvedValue([]);
  useReservation(reservation());
});

describe("POST /api/kiosk/pickup/[id]/confirm for a reservation", () => {
  it("opens a kiosk checkout from a fully scanned reservation", async () => {
    const res = await confirm();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, bookingId: "co-new", itemCount: 2, partial: false });
    expect(created()).toMatchObject({
      kind: BookingKind.CHECKOUT,
      custodySource: "KIOSK",
      requesterUserId: "maya",
      createdBy: "maya",
      endsAt: ENDS_AT,
      sourceReservationId: "res-1",
      sourceReservationPickup: true,
      pickupKioskDeviceId: "k1",
      serializedAssetIds: ["fx3-1", "fx3-2"],
      bulkItems: [],
      bulkUnitItems: [],
      eventId: "ev-legacy",
      shiftAssignmentId: "shift-1",
    });
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "co-new",
      action: "kiosk_pickup",
      after: expect.objectContaining({ sourceReservationId: "res-1", partial: false, locationName: "Camp Randall" }),
    }));
    expect(mocks.onCheckoutOpened).toHaveBeenCalledWith({ userId: "maya", bookingId: "co-new", source: "kiosk_pickup", sourceKey: "res-1" });
  });

  it("names the first unscanned item instead of opening a short checkout", async () => {
    useReservation(reservation({ scanEvents: [scan("fx3-1")] }));

    const res = await confirm();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Scan FX3 2 before confirming pickup");
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("hands over only the scanned items on a partial pickup and lists what stays behind", async () => {
    useReservation(reservation({ scanEvents: [scan("fx3-1")] }), BookingStatus.BOOKED);

    const res = await confirm({ partial: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(created().serializedAssetIds).toEqual(["fx3-1"]);
    expect(body).toMatchObject({ itemCount: 1, partial: true, remainingItemNames: ["FX3 2"] });
  });

  it("refuses a partial pickup with nothing scanned", async () => {
    useReservation(reservation({ scanEvents: [] }));

    const res = await confirm({ partial: true });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Scan at least one item before choosing partial pickup");
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("skips items an earlier partial pickup already handed over", async () => {
    useReservation(reservation({
      serializedItems: [serialized("fx3-1", "FX3 1", "picked_up"), serialized("fx3-2", "FX3 2"), serialized("fx3-3", "FX3 3")],
      derivedCheckouts: [{ serializedItems: [{ assetId: "fx3-3" }], bulkItems: [] }],
      scanEvents: [scan("fx3-1"), scan("fx3-2"), scan("fx3-3")],
    }));

    await confirm();

    expect(created().serializedAssetIds).toEqual(["fx3-2"]);
  });

  it("says when nothing is left to pick up", async () => {
    useReservation(reservation({ serializedItems: [serialized("fx3-1", "FX3 1", "picked_up")], scanEvents: [scan("fx3-1")] }));

    const res = await confirm();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This reservation has no remaining items to pick up");
  });

  it("binds each scanned battery unit once and drops units an earlier pickup took", async () => {
    useReservation(reservation({
      serializedItems: [],
      bulkItems: [batteries(3, 1)],
      derivedCheckouts: [{ serializedItems: [], bulkItems: [{ bulkSkuId: "batt", unitAllocations: [{ bulkSkuUnit: { unitNumber: 1 } }] }] }],
      scanEvents: [binScan("batt", "BATT-1"), binScan("batt", "BATT-4"), binScan("batt", "batt-4"), binScan("batt", "BATT-7")],
    }));

    const res = await confirm();

    expect(res.status).toBe(200);
    expect(created().bulkItems).toEqual([{ bulkSkuId: "batt", quantity: 2 }]);
    expect(created().bulkUnitItems).toEqual([{ bulkSkuId: "batt", unitNumber: 4 }, { bulkSkuId: "batt", unitNumber: 7 }]);
  });

  it("requires every remaining battery unit to be scanned for a full pickup", async () => {
    useReservation(reservation({ serializedItems: [], bulkItems: [batteries(2)], scanEvents: [binScan("batt", "BATT-2")] }));

    const res = await confirm();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Scan all Sony Battery units before confirming pickup");
  });

  it("does not count the same battery unit twice toward a full pickup", async () => {
    useReservation(reservation({
      serializedItems: [],
      bulkItems: [batteries(2)],
      scanEvents: [binScan("batt", "BATT-4"), binScan("batt", "BATT-4")],
    }));

    const res = await confirm();

    expect(res.status).toBe(409);
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("caps scanned battery units at what is still owed", async () => {
    useReservation(reservation({
      serializedItems: [],
      bulkItems: [batteries(1)],
      scanEvents: [binScan("batt", "BATT-2"), binScan("batt", "BATT-5")],
    }));

    await confirm();

    expect(created().bulkUnitItems).toEqual([{ bulkSkuId: "batt", unitNumber: 2 }]);
  });

  it("includes the rest of quantity-tracked stock even on a partial pickup", async () => {
    useReservation(reservation({ bulkItems: [gaffTape(4, 1), batteries(2)], scanEvents: [scan("fx3-1"), binScan("batt", "BATT-3")] }), BookingStatus.BOOKED);

    const res = await confirm({ partial: true });
    const body = await res.json();

    expect(created().bulkItems).toEqual([{ bulkSkuId: "gaff", quantity: 3 }, { bulkSkuId: "batt", quantity: 1 }]);
    expect(body.itemCount).toBe(5);
    expect(body.remainingItemNames).toEqual(["FX3 2", "1 × Sony Battery"]);
  });

  it("carries multi-event links instead of the legacy single event", async () => {
    useReservation(reservation({ events: [{ eventId: "ev-a" }, { eventId: "ev-b" }] }));

    await confirm();

    expect(created()).toMatchObject({ eventIds: ["ev-a", "ev-b"], eventId: undefined });
  });

  it("lets anyone pick up shared gear without crediting badges or a shift", async () => {
    mocks.txUserFindFirst.mockResolvedValue({ id: "jordan", role: Role.STUDENT });
    useReservation(reservation({ custodyScope: BookingCustodyScope.SHARED, requesterUserId: "staff-1" }));

    const res = await POST(jsonRequest("/api/kiosk/pickup/res-1/confirm", "POST", { actorId: "jordan" }), ctx);

    expect(res.status).toBe(200);
    expect(created()).toMatchObject({ custodyScope: BookingCustodyScope.SHARED, createdBy: "jordan", shiftAssignmentId: undefined });
    expect(mocks.onCheckoutOpened).not.toHaveBeenCalled();
    expect(mocks.earnedBadgesSince).not.toHaveBeenCalled();
  });

  it("refuses someone else's personal reservation", async () => {
    mocks.txUserFindFirst.mockResolvedValue({ id: "jordan", role: Role.STUDENT });

    const res = await POST(jsonRequest("/api/kiosk/pickup/res-1/confirm", "POST", { actorId: "jordan" }), ctx);

    expect(res.status).toBe(403);
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it.each([
    [BookingStatus.COMPLETED, "This reservation was already picked up. You're all set."],
    [BookingStatus.CANCELLED, "This reservation was cancelled. Ask staff for help."],
    [BookingStatus.DRAFT, "Cannot confirm pickup — booking is in DRAFT state"],
  ])("explains a %s reservation instead of picking it up", async (status, message) => {
    useReservation(reservation({ status }));

    const res = await confirm();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(message);
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("returns badges the pickup just earned", async () => {
    mocks.earnedBadgesSince.mockResolvedValue([{ key: "first-pickup" }]);

    const body = await (await confirm()).json();

    expect(body.earnedBadges).toEqual([{ key: "first-pickup" }]);
  });

  it("seals a refused pickup under its request id so a retry gets the same answer", async () => {
    useReservation(reservation({ scanEvents: [] }));

    const res = await confirm({ requestId: `${Date.now()}:0b6f3c1e-7d2a-4c59-9a8e-2f1d4b6c8e90` });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: false, operationRejected: true, error: "Scan FX3 1 before confirming pickup" });
    expect(mocks.auditUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { afterJson: expect.objectContaining({ operationRejected: true }) },
    }));
  });

  it("refuses partial pickup of a pending checkout", async () => {
    mocks.txBookingFindUnique.mockResolvedValue({ id: "res-1", kind: BookingKind.CHECKOUT, status: BookingStatus.PENDING_PICKUP });

    const res = await confirm({ partial: true });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Partial pickup is only available for reservations");
  });
});
