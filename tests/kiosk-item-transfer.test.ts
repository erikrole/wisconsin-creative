import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  transaction: vi.fn(), audit: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    user: { findFirst: vi.fn() },
    booking: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    bookingSerializedItem: { count: vi.fn(), updateMany: vi.fn() },
    assetAllocation: { findMany: vi.fn(), updateMany: vi.fn() },
    bookingBulkItem: { upsert: vi.fn(), update: vi.fn() },
    bookingBulkUnitAllocation: { count: vi.fn(), updateMany: vi.fn() },
    bulkStockMovement: { createMany: vi.fn() },
    bulkStockBalance: { update: vi.fn() }, bulkSkuUnit: { update: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: m.audit }));
import { transferKioskItems } from "@/lib/services/kiosk-item-transfer";

const snapshot = new Date("2026-09-01T12:00:00Z");
const due = new Date("2026-09-03T12:00:00Z");
function checkout(id: string) {
  return { id, kind: "CHECKOUT", status: "OPEN", locationId: "studio", startsAt: snapshot, endsAt: due,
    updatedAt: snapshot, title: "Production", custodyScope: "PERSON", requesterUserId: "borrower",
    refNumber: "CO-0041", sourceReservationId: "reservation" as string | null,
    eventId: "event-1" as string | null, sportCode: "FB" as string | null, pickupKioskDeviceId: "pickup-kiosk",
    events: [{ eventId: "event-1", ordinal: 0 }, { eventId: "event-2", ordinal: 1 }],
    scanSessions: [] as object[], accountabilityExclusion: null as null | { restoredAt: Date | null },
    serializedItems: [{ id: "item-1", assetId: "asset-1", allocationStatus: "active" }],
    bulkItems: [] as Array<{ id: string; bulkSkuId: string; checkedOutQuantity: number; checkedInQuantity: number;
      unitAllocations: Array<{ id: string; bulkSkuUnitId: string; checkedOutAt: Date; checkedInAt: Date | null }> }>,
  };
}
let source: ReturnType<typeof checkout>;
let destination: ReturnType<typeof checkout>;
const transfer = (overrides: Partial<Parameters<typeof transferKioskItems>[0]> = {}) => transferKioskItems({
  sourceId: "source", targetBookingId: "destination", actorId: "operator", expectedUpdatedAt: snapshot,
  assetIds: ["asset-1"], bulkUnitIds: [], reason: "Handed to recipient", kioskId: "kiosk", ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(snapshot);
  source = checkout("source"); destination = checkout("destination");
  m.transaction.mockImplementation((fn: (tx: typeof m.tx) => Promise<unknown>) => fn(m.tx));
  m.tx.user.findFirst.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
    where.id === "operator" ? { id: "operator", role: Role.STAFF } : { id: where.id, name: "Recipient" },
  ));
  m.tx.$queryRaw.mockResolvedValue([{ nextval: 42n }]);
  m.tx.booking.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === "source" ? source : destination));
  m.tx.assetAllocation.findMany.mockResolvedValue([{ id: "allocation-1", bookingId: "source", endsAt: due }]);
  m.tx.bookingSerializedItem.count.mockResolvedValue(0);
  m.tx.bookingBulkUnitAllocation.count.mockResolvedValue(0);
  m.tx.bookingBulkItem.upsert.mockResolvedValue({ id: "receiving-bulk" });
});
afterEach(() => vi.useRealTimers());

describe("kiosk item custody transfer", () => {
  it.each([false, true])("moves existing custody and closes only an empty source (remaining=%s)", async (remaining) => {
    if (remaining) source.serializedItems.push({ id: "item-2", assetId: "asset-2", allocationStatus: "active" });
    await expect(transfer()).resolves.toMatchObject({ success: true, itemCount: 1, targetBookingId: "destination", sourceClosed: !remaining });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(m.tx.bookingSerializedItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["item-1"] } }, data: { bookingId: "destination", assignedUserId: null, assignedAt: null } });
    expect(m.tx.assetAllocation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["allocation-1"] } }, data: { bookingId: "destination" } });
    expect(m.tx.booking.update).toHaveBeenCalledWith({ where: { id: "source" }, data: { updatedAt: new Date(+snapshot + 1), ...(!remaining ? { status: "CANCELLED" } : {}) } });
    expect(m.audit).toHaveBeenCalledTimes(2);
    for (const [id, action] of [["source", "kiosk_items_transferred_out"], ["destination", "kiosk_items_transferred_in"]]) {
      expect(m.audit).toHaveBeenCalledWith(m.tx, expect.objectContaining({ entityId: id, action, after: expect.objectContaining({ originalEvidenceBookingId: "source", sourceClosed: !remaining, reason: "Handed to recipient" }) }));
    }
  });

  it("moves numbered-unit obligations with balanced ledger entries and no shelf restock", async () => {
    source.serializedItems = [];
    source.bulkItems = [{ id: "source-bulk", bulkSkuId: "battery", checkedOutQuantity: 3, checkedInQuantity: 0,
      unitAllocations: [1, 2, 3].map(i => ({ id: `allocation-${i}`, bulkSkuUnitId: `unit-${i}`, checkedOutAt: snapshot, checkedInAt: null })) }];
    m.tx.assetAllocation.findMany.mockResolvedValue([]);
    await expect(transfer({ assetIds: [], bulkUnitIds: ["unit-1", "unit-2"] })).resolves.toMatchObject({ itemCount: 2, sourceClosed: false });
    expect(m.tx.bookingBulkUnitAllocation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["allocation-1", "allocation-2"] } }, data: { bookingBulkItemId: "receiving-bulk" } });
    expect(m.tx.bookingBulkItem.update).toHaveBeenCalledWith({ where: { id: "source-bulk" }, data: { plannedQuantity: { decrement: 2 }, checkedOutQuantity: { decrement: 2 } } });
    expect(m.tx.bookingBulkItem.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { plannedQuantity: { increment: 2 }, checkedOutQuantity: { increment: 2 } } }));
    const movements = m.tx.bulkStockMovement.createMany.mock.calls[0]![0].data;
    expect(movements).toEqual([
      expect.objectContaining({ bookingId: "source", kind: "CHECKIN", quantity: 2, bulkSkuId: "battery", locationId: "studio" }),
      expect.objectContaining({ bookingId: "destination", kind: "CHECKOUT", quantity: 2, bulkSkuId: "battery", locationId: "studio" }),
    ]);
    expect(m.tx.bulkStockBalance.update).not.toHaveBeenCalled();
    expect(m.tx.bulkSkuUnit.update).not.toHaveBeenCalled();
  });

  it.each([
    { name: "stale snapshot", setup: () => { source.updatedAt = new Date(+snapshot + 1); }, status: 409 },
    { name: "return in progress", setup: () => { source.scanSessions = [{}]; }, status: 409 },
    { name: "unresolved accountability exclusion", setup: () => { source.accountabilityExclusion = { restoredAt: null }; }, status: 409 },
    { name: "already returned item", setup: () => { source.serializedItems[0]!.allocationStatus = "returned"; }, status: 409 },
    { name: "allocation belonging to another checkout", setup: () => { m.tx.assetAllocation.findMany.mockResolvedValue([{ id: "allocation-1", bookingId: "other", endsAt: due }]); }, status: 409 },
    { name: "different destination due time", setup: () => { destination.endsAt = new Date(+due + 1); }, status: 409 },
    { name: "shared destination", setup: () => { destination.custodyScope = "SHARED"; }, status: 409 },
    { name: "different destination purpose", setup: () => { destination.title = "Other production"; }, status: 409 },
    { name: "different primary event", setup: () => { destination.eventId = "event-2"; }, status: 409 },
    { name: "different sport", setup: () => { destination.sportCode = "MBB"; }, status: 409 },
    { name: "different source reservation", setup: () => { destination.sourceReservationId = "other-reservation"; }, status: 409 },
    { name: "missing source reservation", setup: () => { destination.sourceReservationId = null; }, status: 409 },
    { name: "missing linked event", setup: () => { destination.events.pop(); }, status: 409 },
    { name: "additional linked event", setup: () => { destination.events.push({ eventId: "event-3", ordinal: 2 }); }, status: 409 },
    { name: "different event set of the same size", setup: () => { destination.events[1]!.eventId = "event-3"; }, status: 409 },
    { name: "destination not started", setup: () => { destination.startsAt = new Date(+snapshot + 1); }, status: 409 },
    { name: "ineligible receiving checkout owner", setup: () => { m.tx.user.findFirst.mockResolvedValueOnce({ id: "operator", role: Role.STAFF }).mockResolvedValueOnce(null); }, status: 409 },
    { name: "destination history collision", setup: () => { m.tx.bookingSerializedItem.count.mockResolvedValue(1); }, status: 409 },
    { name: "unauthorized operator", setup: () => { m.tx.user.findFirst.mockResolvedValue({ id: "operator", role: Role.STUDENT }); }, status: 403 },
  ])("rejects $name before moving custody", async ({ setup, status }) => {
    setup();
    await expect(transfer()).rejects.toMatchObject({ status });
    expect(m.tx.bookingSerializedItem.updateMany).not.toHaveBeenCalled();
    expect(m.tx.assetAllocation.updateMany).not.toHaveBeenCalled();
    expect(m.tx.booking.create).not.toHaveBeenCalled();
    expect(m.tx.booking.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("reuses compatible personal custody regardless of linked-event order", async () => {
    destination.events.reverse();
    await expect(transfer()).resolves.toMatchObject({ targetBookingId: "destination" });
    expect(m.tx.booking.create).not.toHaveBeenCalled();
    expect(m.tx.user.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "borrower", active: true, hiddenFromRoster: false, OR: expect.any(Array) }),
      select: { id: true, name: true },
    });
  });

  it("reuses matching custom-purpose checkouts without event or reservation links", async () => {
    for (const booking of [source, destination]) {
      booking.events = []; booking.eventId = null; booking.sportCode = null; booking.sourceReservationId = null;
    }
    await expect(transfer()).resolves.toMatchObject({ targetBookingId: "destination" });
    expect(m.tx.booking.create).not.toHaveBeenCalled();
  });

  it("creates personal custody with the original context for an eligible recipient", async () => {
    source.custodyScope = "SHARED";
    m.tx.booking.create.mockResolvedValue({ ...destination, id: "new-checkout" });
    await expect(transfer({ targetBookingId: undefined, targetUserId: "recipient" })).resolves.toMatchObject({ targetBookingId: "new-checkout" });
    expect(m.tx.booking.create).toHaveBeenCalledWith({ data: {
      kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON", requesterUserId: "recipient",
      title: "Production", startsAt: snapshot, endsAt: due, locationId: "studio", createdBy: "operator",
      sourceReservationId: "reservation", eventId: "event-1", sportCode: "FB", pickupKioskDeviceId: "pickup-kiosk",
      refNumber: "CO-0042", notes: "Transferred from CO-0041. Original pickup evidence remains on that checkout.",
      events: { create: [{ eventId: "event-1", ordinal: 0 }, { eventId: "event-2", ordinal: 1 }] },
    } });
    expect(m.tx.assetAllocation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["allocation-1"] } }, data: { bookingId: "new-checkout" } });
  });

  it("rejects an ineligible new recipient without creating custody", async () => {
    m.tx.user.findFirst.mockResolvedValueOnce({ id: "operator", role: Role.STAFF }).mockResolvedValueOnce(null);
    await expect(transfer({ targetBookingId: undefined, targetUserId: "recipient" })).rejects.toMatchObject({ status: 400 });
    expect(m.tx.booking.create).not.toHaveBeenCalled();
    expect(m.tx.bookingSerializedItem.updateMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate item selection without moving custody", async () => {
    await expect(transfer({ assetIds: ["asset-1", "asset-1"] })).rejects.toMatchObject({ status: 400 });
    expect(m.tx.bookingSerializedItem.updateMany).not.toHaveBeenCalled();
  });
});
