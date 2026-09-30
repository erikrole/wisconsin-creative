import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFindFirst: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  bookingBulkItemFindUnique: vi.fn(),
  bookingBulkItemUpdate: vi.fn(),
  bookingBulkItemFindMany: vi.fn(),
  bookingSerializedItemCount: vi.fn(),
  scanEventCreate: vi.fn(),
  scanEventFindMany: vi.fn(),
  scanEventUpdateMany: vi.fn(),
  createAuditEntryTx: vi.fn(),
  upsertBulkBalancesAndMovements: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: {
      params: P;
      kiosk: { kioskId: string; name: string; locationId: string; locationName: string };
    }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) => handler(req, {
    params: await ctx.params,
    kiosk: { kioskId: "kiosk-1", name: "Video Office Kiosk", locationId: "loc-1", locationName: "Camp Randall" },
  }),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: mocks.createAuditEntryTx,
  createAuditEntry: vi.fn(),
  lookupActorRole: vi.fn(),
}));

vi.mock("@/lib/services/bookings-helpers", () => ({
  upsertBulkBalancesAndMovements: mocks.upsertBulkBalancesAndMovements,
  settleBulkLedgerAtCompletion: vi.fn(),
}));

import { POST as returnCountedQuantity } from "@/app/api/kiosk/checkin/[id]/quantity/route";
import { DELETE as clearStagedPickupUnit } from "@/app/api/kiosk/pickup/[id]/scan/route";

const collaborator = (grants: string[]) => ({
  id: "collab-1",
  role: "COLLABORATOR",
  collaboratorPolicy: { status: "ACTIVE", grants: grants.map((capabilityKey) => ({ capabilityKey })) },
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((handler: (tx: unknown) => Promise<unknown>) => handler({
    user: { findFirst: mocks.userFindFirst },
    booking: { findUnique: mocks.bookingFindUnique, update: mocks.bookingUpdate },
    bookingBulkItem: {
      findUnique: mocks.bookingBulkItemFindUnique,
      update: mocks.bookingBulkItemUpdate,
      findMany: mocks.bookingBulkItemFindMany,
    },
    bookingSerializedItem: { count: mocks.bookingSerializedItemCount },
    scanEvent: {
      create: mocks.scanEventCreate,
      findMany: mocks.scanEventFindMany,
      updateMany: mocks.scanEventUpdateMany,
    },
  }));
  // Something else stays out, so maybeAutoComplete does not complete.
  mocks.bookingSerializedItemCount.mockResolvedValue(1);
  mocks.bookingBulkItemFindMany.mockResolvedValue([]);
  mocks.scanEventFindMany.mockResolvedValue([]);
});

describe("counted-quantity return (B6)", () => {
  function returnRequest() {
    return new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "collab-1", bulkSkuId: "sku-cables", quantity: 2, expectedOutstanding: 3 }),
    });
  }

  it("lets a roster-eligible collaborator return counted stock like any other return", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "collab-1", role: "COLLABORATOR" });
    mocks.bookingBulkItemFindUnique.mockResolvedValue({
      id: "bulk-item-1",
      bulkSkuId: "sku-cables",
      checkedOutQuantity: 3,
      checkedInQuantity: 0,
      bulkSku: { name: "XLR Cable", trackByNumber: false, binQrCodeValue: "bin-xlr" },
      booking: { kind: "CHECKOUT", status: "OPEN", requesterUserId: "user-1", custodyScope: "PERSON" },
    });

    const res = await returnCountedQuantity(returnRequest(), ctx("checkout-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      completed: false,
      remaining: 1,
      message: "2 XLR Cable returned",
    });
    // Resolved with the kiosk roster rule, not a role gate.
    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "collab-1", active: true, hiddenFromRoster: false }),
    }));
    expect(mocks.upsertBulkBalancesAndMovements).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: "collab-1",
      kind: "CHECKIN",
      items: [{ bulkSkuId: "sku-cables", quantity: 2 }],
    }));
  });

  it("refuses a person the kiosk roster would not offer", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(returnCountedQuantity(returnRequest(), ctx("checkout-1")))
      .rejects.toMatchObject({ status: 404, message: "Person not found" });
    expect(mocks.bookingBulkItemUpdate).not.toHaveBeenCalled();
  });
});

describe("clearing a staged reservation pickup unit (B6)", () => {
  function clearRequest() {
    return new Request("http://test", {
      method: "DELETE",
      body: JSON.stringify({ actorId: "collab-1", bulkSkuId: "sku-battery", unitNumber: 4 }),
    });
  }

  function reservation(requesterUserId: string) {
    return {
      id: "reservation-1",
      kind: "RESERVATION",
      status: "BOOKED",
      custodyScope: "PERSON",
      requesterUserId,
      bulkItems: [{ bulkSkuId: "sku-battery", bulkSku: { id: "sku-battery", binQrCodeValue: "94e068d1", trackByNumber: true } }],
      derivedCheckouts: [],
    };
  }

  it("lets a collaborator with own-reservation access clear their staged unit", async () => {
    mocks.userFindFirst.mockResolvedValue(collaborator(["KIOSK_ROSTER_ELIGIBLE", "RESERVATION_EDIT_OWN"]));
    mocks.bookingFindUnique.mockResolvedValue(reservation("collab-1"));

    const res = await clearStagedPickupUnit(clearRequest(), ctx("reservation-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "collab-1",
      action: "kiosk_pickup_scan_removed",
    }));
  });

  it("still keeps collaborators off other people's reservations", async () => {
    mocks.userFindFirst.mockResolvedValue(collaborator(["KIOSK_ROSTER_ELIGIBLE", "RESERVATION_EDIT_OWN"]));
    mocks.bookingFindUnique.mockResolvedValue(reservation("user-1"));

    await expect(clearStagedPickupUnit(clearRequest(), ctx("reservation-1")))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.scanEventUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a person the kiosk roster would not offer", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.bookingFindUnique.mockResolvedValue(reservation("collab-1"));

    await expect(clearStagedPickupUnit(clearRequest(), ctx("reservation-1")))
      .rejects.toMatchObject({ status: 404 });
    expect(mocks.scanEventUpdateMany).not.toHaveBeenCalled();
  });
});
