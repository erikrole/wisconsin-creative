import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkAvailability: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withKiosk:
    (handler: (req: Request, ctx: { kiosk: { locationId: string } }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { kiosk: { locationId: "loc-1" } }),
}));

vi.mock("@/lib/db", () => ({
  db: { marker: "db" },
}));

vi.mock("@/lib/services/availability", () => ({
  checkAvailability: mocks.checkAvailability,
}));

import { db } from "@/lib/db";
import { POST } from "@/app/api/kiosk/checkout/availability/route";

function request(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/kiosk/checkout/availability", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/kiosk/checkout/availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAvailability.mockResolvedValue({
      conflicts: [],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });
  });

  it("checks scanned serialized and numbered bulk items for the kiosk location", async () => {
    const res = await POST(request({
      locationId: "client-supplied-location",
      items: [
        { assetId: "asset-1" },
        { assetId: "bulk:sku-sony:unit:31" },
        { bulkSkuId: "sku-sony", unitNumber: 32 },
      ],
      startsAt: "2026-06-15T18:00:00.000Z",
      endsAt: "2026-06-16T22:30:00.000Z",
    }), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(mocks.checkAvailability).toHaveBeenCalledWith(db, {
      locationId: "loc-1",
      startsAt: new Date("2026-06-15T18:00:00.000Z"),
      endsAt: new Date("2026-06-16T22:30:00.000Z"),
      serializedAssetIds: ["asset-1"],
      bulkItems: [{ bulkSkuId: "sku-sony", quantity: 2 }],
      bookingKind: "CHECKOUT",
    });
  });
});
