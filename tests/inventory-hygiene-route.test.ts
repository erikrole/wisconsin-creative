import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    asset: { count: vi.fn(), findMany: vi.fn() },
    bulkSku: { count: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  requireAuth: vi.fn(),
  counts: vi.fn(),
  queue: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/item-cleanup-wizard", () => ({
  getCleanupWizardCounts: mocks.counts,
  listCleanupWizardQueue: mocks.queue,
}));

import { GET } from "@/app/api/inventory-hygiene/route";

const staff = { id: "staff-1", role: "STAFF" as const, email: "staff@example.com", name: "Staff" };

type Issue = { key: string; count: number; samples: Array<{ id: string; label: string; detail: string; href: string }> };

function asset(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    assetTag: id.toUpperCase(),
    name: null,
    brand: "Sony",
    model: "FX6",
    category: { name: "Cameras" },
    department: null,
    location: { name: "Cage" },
    ...overrides,
  };
}

function family(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Family ${id}`,
    category: "Batteries",
    location: { name: "Shelf A" },
    categoryRel: null,
    department: null,
    ...overrides,
  };
}

function bulkSku(id: string, onHand: number, minThreshold: number) {
  return {
    id,
    name: `Stock ${id}`,
    category: "Tape",
    trackByNumber: false,
    minThreshold,
    location: { name: "Shelf B" },
    categoryRel: null,
    balances: [{ onHandQuantity: onHand }],
    units: [],
  };
}

async function load() {
  const response = await GET(new Request("https://app.example.com/api/inventory-hygiene"), { params: Promise.resolve({}) });
  const body = await response.json() as { data: { totals: Record<string, number>; issues: Issue[]; partialFailures: string[] } };
  return { response, data: body.data, issue: (key: string) => body.data.issues.find((item) => item.key === key)! };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  // Counts are read in route order: category, department, scan code, image, retired in kit, camera.
  mocks.db.asset.count
    .mockResolvedValueOnce(9)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(4);
  mocks.db.asset.findMany
    .mockResolvedValueOnce([asset("cam-1", { name: "  " }), asset("cam-2", { name: "A-cam", brand: "", model: "" })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([asset("cam-3", { name: null, brand: "", model: "", category: null, location: null })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([asset("cam-4", { kitMemberships: [{ kit: { id: "k1", name: "Kit A" } }, { kit: { id: "k2", name: "Kit B" } }] })])
    .mockResolvedValueOnce([asset("cam-5")]);
  mocks.db.bulkSku.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
  mocks.db.bulkSku.findMany
    .mockResolvedValueOnce([family("f1", { categoryRel: { name: "Power" }, department: { name: "Video" } })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([bulkSku("low", 0, 0), bulkSku("ok", 5, 2), bulkSku("edge", 3, 3), bulkSku("thin", 2, 3)]);
  mocks.db.$queryRaw
    .mockResolvedValueOnce([{ count: 3n }])
    .mockResolvedValueOnce([{
      scan_value: "roam2",
      occurrences: 2n,
      examples: [
        { id: "a", label: "ROAM2", source: "asset tag" },
        { id: "b", label: "Batteries", source: "family bin QR" },
      ],
    }]);
  mocks.counts.mockResolvedValue({
    legacy_qr: 5,
    missing_serial: 7,
    attachment_candidate: 1,
    deferred: { legacy_qr: 0, missing_serial: 0, attachment_candidate: 0 },
  });
  mocks.queue.mockImplementation(async (kind: string) => kind === "legacy_qr"
    ? [{ id: "q1", assetTag: "OLD1", primaryScanCode: "", qrCodeValue: "CHQ-123" }]
    : [{ id: "p1", assetTag: "CAGE1", brand: "", model: "", name: null }]);
});

describe("GET /api/inventory-hygiene", () => {
  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role: "STUDENT" });

    const { response } = await load();

    expect(response.status).toBe(403);
    expect(mocks.db.asset.count).not.toHaveBeenCalled();
  });

  it("totals every check and counts the checks that need work", async () => {
    const { data } = await load();

    // 9 + 2 + 1 + 4 asset counts, 1 family, 3 duplicates, 5 + 7 + 1 wizard, 2 low stock.
    expect(data.totals).toEqual({ openIssues: 35, activeChecks: 14, checksNeedingWork: 10 });
    expect(data.partialFailures).toEqual([]);
  });

  it("labels samples by tag and builds a readable detail line", async () => {
    const { issue } = await load();

    expect(issue("missing-category").samples).toEqual([
      { id: "cam-1", label: "CAM-1", detail: "Sony FX6 / Cameras / Cage", href: "/items/cam-1" },
      { id: "cam-2", label: "CAM-2", detail: "A-cam / Cameras / Cage", href: "/items/cam-2" },
    ]);
    expect(issue("missing-primary-scan").samples[0]?.detail).toBe("No supporting metadata");
    expect(issue("retired-in-kits").samples[0]?.detail).toBe("Sony FX6 / Cameras / Cage / Kit A, Kit B");
    expect(issue("camera-missing-attachments").samples[0]?.href).toBe("/items/cam-5?tab=attachments");
    expect(issue("family-missing-category").samples).toEqual([
      { id: "f1", label: "Family f1", detail: "Power / Video / Shelf A", href: "/bulk-inventory/f1" },
    ]);
  });

  it("explains duplicate scan values and links to a search", async () => {
    const { issue } = await load();

    expect(issue("duplicate-scan-identity")).toEqual(expect.objectContaining({
      count: 3,
      samples: [{
        id: "roam2",
        label: "roam2",
        detail: "2 appearances / ROAM2 asset tag, Batteries family bin QR",
        href: "/items?q=roam2",
      }],
    }));
  });

  it("uses the cleanup wizard's counts and samples", async () => {
    const { issue } = await load();

    expect(issue("legacy-qr-labels")).toEqual(expect.objectContaining({
      count: 5,
      samples: [{ id: "q1", label: "OLD1", detail: "CHQ-123", href: "/items/q1" }],
    }));
    expect(issue("missing-serial")).toEqual(expect.objectContaining({ count: 7, samples: [] }));
    expect(issue("attachment-candidates").samples).toEqual([
      { id: "p1", label: "CAGE1", detail: "Accessory candidate", href: "/items/p1?tab=attachments" },
    ]);
    expect(mocks.queue).toHaveBeenCalledWith("legacy_qr", 6);
  });

  it("flags families below their threshold, with a floor of one", async () => {
    const { issue } = await load();

    expect(issue("low-bulk-stock")).toEqual(expect.objectContaining({
      count: 2,
      samples: [
        expect.objectContaining({ id: "low", detail: "0 available / 1 threshold / Tape / Shelf B" }),
        expect.objectContaining({ id: "thin", detail: "2 available / 3 threshold / Tape / Shelf B" }),
      ],
    }));
  });

  it("keeps the other checks when one query fails and names the failed one", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.$queryRaw.mockReset();
    mocks.db.$queryRaw.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce([]);
    mocks.counts.mockRejectedValue(new Error("wizard down"));

    const { response, data, issue } = await load();

    expect(response.status).toBe(200);
    expect(data.partialFailures).toEqual(["duplicateCount", "cleanupWizardCounts"]);
    expect(issue("duplicate-scan-identity").count).toBe(0);
    expect(issue("legacy-qr-labels").count).toBe(0);
    expect(issue("missing-category").count).toBe(9);
    consoleError.mockRestore();
  });
});
