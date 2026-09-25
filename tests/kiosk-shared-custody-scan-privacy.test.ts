import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allocationFindFirst: vi.fn(),
  findAsset: vi.fn(),
  findUnit: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { assetAllocation: { findFirst: mocks.allocationFindFirst } },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (request: Request, context: { kiosk: { kioskId: string } }) => unknown) =>
    (request: Request) => handler(request, { kiosk: { kioskId: "kiosk-1" } }),
}));

vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: mocks.findAsset }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: mocks.findUnit }));

import { POST as scanLookup } from "@/app/api/kiosk/scan-lookup/route";
import { POST as checkoutScan } from "@/app/api/kiosk/checkout/scan/route";

function request(path: string) {
  return new Request(`http://test${path}`, {
    method: "POST",
    body: JSON.stringify({ scanValue: "CAM-1" }),
  });
}

const ctx = { params: Promise.resolve({}) };
const endsAt = new Date(Date.now() + 2 * 60 * 60_000);

function heldBy(custodyScope: "PERSON" | "SHARED") {
  return {
    endsAt,
    booking: {
      title: "Football Travel Case",
      custodyScope,
      requester: { name: "Bucky Badger" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.findUnit.mockResolvedValue(null);
  mocks.findAsset.mockResolvedValue({
    id: "asset-1",
    assetTag: "CAM-1",
    name: "FX3",
    imageUrl: null,
    status: "AVAILABLE",
    category: { name: "Camera" },
  });
});

describe("shared custody never discloses the requester at kiosk scan surfaces (B5/A11)", () => {
  it("scan lookup omits the holder for shared custody", async () => {
    mocks.allocationFindFirst.mockResolvedValue(heldBy("SHARED"));

    const body = await (await scanLookup(request("/api/kiosk/scan-lookup"), ctx)).json();

    expect(body.item.status).toBe("Checked Out");
    expect(body.item).not.toHaveProperty("holder");
    expect(JSON.stringify(body)).not.toContain("Bucky Badger");
    expect(mocks.allocationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        booking: { select: expect.objectContaining({ custodyScope: true }) },
      }),
    }));
  });

  it("scan lookup still names the holder of a personal checkout", async () => {
    mocks.allocationFindFirst.mockResolvedValue(heldBy("PERSON"));

    const body = await (await scanLookup(request("/api/kiosk/scan-lookup"), ctx)).json();

    expect(body.item.holder).toBe("Bucky Badger");
  });

  it("checkout scan rejects shared-custody gear without naming the requester", async () => {
    mocks.allocationFindFirst.mockResolvedValue(heldBy("SHARED"));

    const body = await (await checkoutScan(request("/api/kiosk/checkout/scan"), ctx)).json();

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/^The FX3 is checked out until /);
    expect(body.error).not.toContain("Bucky Badger");
  });

  it("checkout scan still names the holder of a personal checkout", async () => {
    mocks.allocationFindFirst.mockResolvedValue(heldBy("PERSON"));

    const body = await (await checkoutScan(request("/api/kiosk/checkout/scan"), ctx)).json();

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/^Bucky Badger has checked out the FX3 until /);
  });
});
