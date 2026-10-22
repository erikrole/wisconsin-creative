import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const counted = { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) };
  return {
    db: {
      booking: { ...counted },
      kioskDevice: { ...counted },
      asset: { ...counted },
      bulkSku: { findMany: vi.fn() },
      calendarSource: { ...counted },
      systemConfig: { findUnique: vi.fn(async () => null) },
      licenseCode: { ...counted },
    },
  };
});

import { db } from "@/lib/db";
import { batterySkuCandidateWhere } from "@/lib/bulk-batteries";
import { getAdminFixTodayQueue } from "@/lib/admin-fix-today";

const mockedDb = db as unknown as { bulkSku: { findMany: ReturnType<typeof vi.fn> } };

function family(overrides: { id: string; name: string; category?: string; minThreshold?: number; available: number }) {
  return {
    id: overrides.id,
    name: overrides.name,
    category: overrides.category ?? "Batteries",
    minThreshold: overrides.minThreshold ?? 0,
    trackByNumber: false,
    location: { name: "Camp Randall" },
    categoryRel: null,
    balances: [{ onHandQuantity: overrides.available }],
    units: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Admin Fix Today low batteries", () => {
  it("uses the shared battery detection and the Battery Ops low-stock rule", async () => {
    mockedDb.bulkSku.findMany.mockResolvedValueOnce([
      // 8 on hand is under the 10 floor, so it is low even with no minimum set.
      family({ id: "gold", name: "Gold Mount Battery", available: 8 }),
      family({ id: "fz100", name: "NP-FZ100 spare", available: 3 }),
      family({ id: "plenty", name: "Sony Battery", available: 40 }),
      // Substring false positive from the database prefilter is dropped.
      family({ id: "batteryless", name: "Batterysaver mat", category: "Mats", available: 0 }),
    ]);

    const queue = await getAdminFixTodayQueue(new Date("2026-05-25T16:00:00.000Z"));
    const section = queue.sections.find((entry) => entry.key === "low-batteries");

    expect(section?.count).toBe(2);
    expect(mockedDb.bulkSku.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true, ...batterySkuCandidateWhere() } }),
    );
  });
});
