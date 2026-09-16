import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  updateReservation: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.bookingFindUnique },
    user: { findFirst: mocks.userFindFirst },
    bulkSku: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: {
      params: P;
      kiosk: { kioskId: string; locationId: string; locationName: string };
    }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) =>
    handler(req, {
      params: await ctx.params,
      kiosk: { kioskId: "kiosk-1", locationId: "loc-1", locationName: "Camp Randall" },
    }),
}));

vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: vi.fn() }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: vi.fn() }));
vi.mock("@/lib/services/bookings-lifecycle", () => ({
  updateReservation: mocks.updateReservation,
}));

import { POST as updateReservationItems } from "@/app/api/kiosk/reservation/[id]/items/route";

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function reservation(over: Record<string, unknown> = {}) {
  return {
    id: "rv-1",
    kind: "RESERVATION",
    status: "BOOKED",
    title: "David leftover",
    custodyScope: "PERSON",
    requesterUserId: "david",
    updatedAt: new Date("2026-09-16T18:00:00.123Z"),
    serializedItems: [{
      id: "si-leftover",
      assetId: "asset-1",
      allocationStatus: "active",
      asset: { id: "asset-1", name: "Sony FX3", assetTag: "FX3 1" },
    }],
    bulkItems: [],
    derivedCheckouts: [{ id: "co-1" }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindFirst.mockResolvedValue({ id: "david", role: Role.STUDENT, collaboratorPolicy: null });
  mocks.updateReservation.mockResolvedValue({ updatedAt: new Date("2026-09-16T18:01:00.000Z") });
});

describe("kiosk reservation remaining-item edits", () => {
  it("accepts a snapshot that dropped fractional milliseconds", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation());
    const res = await updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "david",
        expectedUpdatedAt: "2026-09-16T18:00:00Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"));

    expect(res.status).toBe(200);
    expect(mocks.updateReservation).toHaveBeenCalledWith(
      "rv-1",
      "david",
      { serializedAssetIds: [], bulkItems: [] },
      new Date("2026-09-16T18:00:00Z"),
    );
  });

  it("completes leftover pickup when the last remaining item is removed", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation());
    const res = await updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "david",
        expectedUpdatedAt: "2026-09-16T18:00:00.123Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mocks.updateReservation).toHaveBeenCalled();
  });

  it("lets an identified shared operator remove remaining gear", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation({
      custodyScope: "SHARED",
      requesterUserId: "creator",
    }));
    mocks.userFindFirst.mockResolvedValue({ id: "operator", role: Role.STUDENT, collaboratorPolicy: null });

    const res = await updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "operator",
        expectedUpdatedAt: "2026-09-16T18:00:00.123Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"));

    expect(res.status).toBe(200);
  });

  it("keeps an empty unpicked reservation from deleting its last item", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation({ derivedCheckouts: [] }));
    await expect(updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "david",
        expectedUpdatedAt: "2026-09-16T18:00:00.123Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"))).rejects.toThrow("Keep at least one reserved item");
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });
});
