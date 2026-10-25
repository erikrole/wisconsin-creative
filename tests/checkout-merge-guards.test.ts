import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus } from "@prisma/client";

vi.mock("@/lib/db", () => ({ db: { booking: { findMany: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/services/availability", () => ({ checkAvailability: vi.fn() }));

import { db } from "@/lib/db";
import { previewCheckoutMerge } from "@/lib/services/checkout-consolidation";

const ids = ["cm000000000000000000000001", "cm000000000000000000000002"];
const eventId = "cm000000000000000000000003";
const requesterId = "cm000000000000000000000004";
const locationId = "cm000000000000000000000005";
const batterySkuId = "cm000000000000000000000006";
const reservationA = "cm000000000000000000000009";
const reservationB = "cm000000000000000000000010";

function checkout(id: string, overrides: Record<string, unknown> = {}) {
  const assetId = `${id}-asset`;
  const unitId = `${id}-unit`;
  const bulkItemId = `${id}-bulk-item`;
  return {
    id,
    kind: BookingKind.CHECKOUT,
    status: BookingStatus.OPEN,
    title: "Volleyball Photo",
    requesterUserId: requesterId,
    locationId,
    startsAt: new Date("2026-09-04T15:00:00.000Z"),
    endsAt: new Date("2026-09-05T04:00:00.000Z"),
    createdAt: new Date(id === ids[0] ? "2026-09-04T10:00:00.000Z" : "2026-09-04T10:05:00.000Z"),
    refNumber: id === ids[0] ? "CO-1001" : "CO-1002",
    notes: null,
    sourceReservationId: null,
    eventId,
    custodyScope: BookingCustodyScope.PERSON,
    events: [{ eventId }],
    serializedItems: [{ id: `${id}-serialized-item`, assetId, allocationStatus: "active" }],
    allocations: [{ assetId }],
    bulkItems: [{
      id: bulkItemId,
      bulkSkuId: batterySkuId,
      plannedQuantity: id === ids[0] ? 1 : 2,
      checkedOutQuantity: id === ids[0] ? 1 : 2,
      checkedInQuantity: 0,
      unitAllocations: [{
        id: `${id}-unit-allocation`,
        bulkSkuUnitId: unitId,
        checkedOutAt: new Date("2026-09-04T15:01:00.000Z"),
        checkedInAt: null,
      }],
    }],
    accountabilityExclusion: null,
    ...overrides,
  };
}

const second = ids[1]!;
const first = ids[0]!;

function preview(secondOverrides: Record<string, unknown>, options?: { allowContextOverrides?: boolean }) {
  vi.mocked(db.booking.findMany).mockResolvedValue([checkout(first), checkout(second, secondOverrides)] as never);
  return previewCheckoutMerge(ids, options);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkout merge guards", () => {
  it("needs between 2 and 25 different checkouts", async () => {
    await expect(previewCheckoutMerge([first, first])).rejects.toMatchObject({ status: 400 });
    const many = Array.from({ length: 26 }, (_, index) => `cm${String(index).padStart(24, "0")}`);
    await expect(previewCheckoutMerge(many)).rejects.toMatchObject({ status: 400 });
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when a checkout is missing", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([checkout(first)] as never);

    await expect(previewCheckoutMerge(ids)).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ["a reservation", { kind: BookingKind.RESERVATION }, "Only open checkouts can be merged"],
    ["a closed checkout", { status: BookingStatus.COMPLETED }, "Only open checkouts can be merged"],
    ["another person", { requesterUserId: "someone-else" }, "Checkouts for different people cannot be merged"],
    ["shared custody", { custodyScope: BookingCustodyScope.SHARED }, "Personal and shared checkouts cannot be merged"],
    ["another title", { title: "Soccer Video" }, "Checkout titles must match before merging"],
    ["another location", { locationId: "elsewhere" }, "Checkouts at different locations cannot be merged"],
    ["another reservation", { sourceReservationId: reservationA }, "Checkouts must come from the same reservation or both be direct event checkouts"],
    ["an accountability exclusion", { accountabilityExclusion: { id: "x" } }, "Accountability-excluded checkouts cannot be merged"],
    ["a returned item", { serializedItems: [{ id: "si", assetId: `${second}-asset`, allocationStatus: "returned" }] }, "Checkout custody records are not in a mergeable active state"],
    ["a missing allocation", { allocations: [] }, "Checkout custody records are not in a mergeable active state"],
    ["the same item", { serializedItems: [{ id: "si", assetId: `${first}-asset`, allocationStatus: "active" }], allocations: [{ assetId: `${first}-asset` }] }, "The selected checkouts contain the same serialized item"],
  ])("refuses %s", async (_label, overrides, message) => {
    await expect(preview(overrides)).rejects.toMatchObject({ status: 409, message });
  });

  it("matches titles ignoring case", async () => {
    await expect(preview({ title: "volleyball photo" })).resolves.toMatchObject({ targetCheckoutId: first });
  });

  it("refuses the same numbered unit and returned battery stock", async () => {
    const shared = checkout(first).bulkItems[0]!;
    await expect(preview({ bulkItems: [{ ...shared, id: "other-bulk" }] })).rejects.toMatchObject({ message: "The selected checkouts contain the same numbered unit" });
    await expect(preview({ bulkItems: [{ ...checkout(second).bulkItems[0]!, checkedInQuantity: 1 }] })).rejects.toMatchObject({ message: "A checkout with returned bulk items cannot be merged" });
  });

  it("lets the merge modal surface different reservations and return times as options", async () => {
    const laterReturn = new Date("2026-09-05T06:00:00.000Z");
    vi.mocked(db.booking.findMany).mockResolvedValue([
      checkout(first, { sourceReservationId: reservationA }),
      checkout(second, { sourceReservationId: reservationB, endsAt: laterReturn }),
    ] as never);

    const result = await previewCheckoutMerge(ids, { allowContextOverrides: true });

    expect(result.conflicts).toEqual({ returnWindow: true, sourceReservation: true });
    expect(result.sourceReservationOptions).toEqual([
      { sourceReservationId: reservationA, checkoutIds: [first], checkoutRefs: ["CO-1001"] },
      { sourceReservationId: reservationB, checkoutIds: [second], checkoutRefs: ["CO-1002"] },
    ]);
    expect(result.returnWindowOptions.map((option) => option.endsAt)).toEqual(["2026-09-05T04:00:00.000Z", laterReturn.toISOString()]);
  });

  it("groups checkouts that share a reservation or return time", async () => {
    const result = await preview({});

    expect(result.sourceReservationOptions).toEqual([{ sourceReservationId: null, checkoutIds: [first, second], checkoutRefs: ["CO-1001", "CO-1002"] }]);
    expect(result.returnWindowOptions).toEqual([{ endsAt: "2026-09-05T04:00:00.000Z", checkoutIds: [first, second], checkoutRefs: ["CO-1001", "CO-1002"] }]);
    expect(result.conflicts).toEqual({ returnWindow: false, sourceReservation: false });
  });
});
