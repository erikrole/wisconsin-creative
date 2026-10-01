import { describe, expect, it, vi } from "vitest";
import { kioskExtendWindow } from "@/lib/services/kiosk-extend-window";

const now = new Date("2026-09-25T18:00:00.000Z");
const endsAt = new Date("2026-09-25T22:00:00.000Z");
const hour = 60 * 60 * 1000;
const at = (h: number) => new Date(endsAt.getTime() + h * hour);

function client(opts: {
  serialized?: Array<{ assetId: string; assetTag: string; name: string }>;
  allocations?: Array<{ assetId: string; startsAt: Date; endsAt: Date; custodyScope: "PERSON" | "SHARED"; requester: string }>;
  bulk?: Array<{ bulkSkuId: string; name: string; out: number }>;
  onHand?: number;
  reservations?: Array<{ startsAt: Date; endsAt: Date; bulkSkuId: string; quantity: number }>;
}) {
  const reservations = opts.reservations ?? [];
  return {
    booking: {
      findFirst: vi.fn().mockResolvedValue({
        id: "co-1",
        endsAt,
        locationId: "loc-1",
        serializedItems: (opts.serialized ?? []).map((s) => ({ assetId: s.assetId, asset: { assetTag: s.assetTag, name: s.name } })),
        bulkItems: (opts.bulk ?? []).map((b) => ({ bulkSkuId: b.bulkSkuId, checkedOutQuantity: b.out, checkedInQuantity: 0, bulkSku: { name: b.name } })),
      }),
      findMany: vi.fn().mockImplementation(async () =>
        [...new Set(reservations.map((r) => r.startsAt.getTime()))].sort((a, b) => a - b).map((t) => ({ startsAt: new Date(t) }))),
    },
    assetAllocation: {
      findMany: vi.fn().mockResolvedValue((opts.allocations ?? []).map((a) => ({
        assetId: a.assetId, bookingId: "other", startsAt: a.startsAt, endsAt: a.endsAt,
        booking: { title: "Other", kind: "RESERVATION", status: "BOOKED", custodyScope: a.custodyScope, requester: { name: a.requester } },
      }))),
    },
    bulkStockBalance: {
      findMany: vi.fn().mockResolvedValue((opts.bulk ?? []).map((b) => ({ bulkSkuId: b.bulkSkuId, onHandQuantity: opts.onHand ?? 0 }))),
    },
    bookingBulkItem: {
      findMany: vi.fn().mockImplementation(async (args: { where: { booking: { startsAt: { lt: Date }; endsAt: { gt: Date } } } }) =>
        reservations
          .filter((r) => r.startsAt < args.where.booking.startsAt.lt && r.endsAt > args.where.booking.endsAt.gt)
          .map((r) => ({ bulkSkuId: r.bulkSkuId, plannedQuantity: r.quantity, checkedOutQuantity: 0 }))),
    },
  };
}

describe("kiosk extend window", () => {
  it("at pickup, keeps the turnaround buffer before the next claim", async () => {
    const tx = client({
      serialized: [{ assetId: "a1", assetTag: "CAM-1", name: "FX3" }],
      allocations: [{ assetId: "a1", startsAt: at(5), endsAt: at(9), custodyScope: "PERSON", requester: "Erik Role" }],
    });
    const base = await tx.booking.findFirst();
    tx.booking.findFirst.mockResolvedValue({ ...base, kind: "RESERVATION", status: "BOOKED" });
    const window = await kioskExtendWindow(tx as never, "rv-1", now);
    expect(window.maxEndsAt).toEqual(at(4));
    expect(tx.booking.findFirst.mock.calls[1]![0].where.OR).toContainEqual({ kind: "RESERVATION", status: "BOOKED" });
  });

  it("returns null when nothing claims the gear", async () => {
    const tx = client({ serialized: [{ assetId: "a1", assetTag: "CAM-1", name: "FX3" }] });
    await expect(kioskExtendWindow(tx as never, "co-1", now)).resolves.toEqual({ currentEndsAt: endsAt, maxEndsAt: null });
  });

  it("stops at the earliest next claim and names its holder", async () => {
    const tx = client({
      serialized: [{ assetId: "a1", assetTag: "CAM-1", name: "FX3" }, { assetId: "a2", assetTag: "MIC-2", name: "Wireless mic" }],
      allocations: [
        { assetId: "a1", startsAt: at(5), endsAt: at(9), custodyScope: "PERSON", requester: "Erik Role" },
        { assetId: "a2", startsAt: at(2), endsAt: at(4), custodyScope: "PERSON", requester: "Bucky Badger" },
      ],
    });
    const window = await kioskExtendWindow(tx as never, "co-1", now);
    expect(window).toEqual({
      currentEndsAt: endsAt,
      maxEndsAt: at(2),
      limitingItem: { assetTag: "MIC-2", name: "Wireless mic", holderName: "Bucky Badger", startsAt: at(2) },
    });
    // Same overlap-only rule the extend PATCH uses, from the current due time.
    expect(tx.assetAllocation.findMany.mock.calls[0]![0].where.endsAt).toEqual({ gt: endsAt });
  });

  it("never names a SHARED holder", async () => {
    const tx = client({
      serialized: [{ assetId: "a1", assetTag: "CAM-1", name: "FX3" }],
      allocations: [{ assetId: "a1", startsAt: at(3), endsAt: at(9), custodyScope: "SHARED", requester: "Hidden Person" }],
    });
    const window = await kioskExtendWindow(tx as never, "co-1", now);
    expect(window.limitingItem).toEqual({ assetTag: "CAM-1", name: "FX3", startsAt: at(3) });
    expect(JSON.stringify(window)).not.toContain("Hidden Person");
  });

  it("finds the reservation start where held batteries stop fitting", async () => {
    const tx = client({
      bulk: [{ bulkSkuId: "sku-1", name: "Sony battery", out: 2 }],
      onHand: 3,
      reservations: [
        { startsAt: at(1), endsAt: at(3), bulkSkuId: "sku-1", quantity: 2 },
        { startsAt: at(2), endsAt: at(6), bulkSkuId: "sku-1", quantity: 2 },
        { startsAt: at(8), endsAt: at(9), bulkSkuId: "sku-1", quantity: 5 },
      ],
    });
    // Shelf 3 plus the 2 held: 2 reserved from +1h still fits; +2h adds 2 more (4 > 3 on the shelf).
    const window = await kioskExtendWindow(tx as never, "co-1", now);
    expect(window.maxEndsAt).toEqual(at(2));
    expect(window.limitingItem).toEqual({ assetTag: "Sony battery", name: "Sony battery", startsAt: at(2) });
  });

  it("refuses a checkout that isn't open", async () => {
    const tx = client({});
    tx.booking.findFirst.mockResolvedValue(null);
    await expect(kioskExtendWindow(tx as never, "co-1", now)).rejects.toMatchObject({ status: 404 });
  });
});
