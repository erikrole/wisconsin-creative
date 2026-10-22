import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    bulkSku: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { createManyAndReturn: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { batteryLowThreshold, shouldNotifyBatteryLow } from "@/lib/bulk-batteries";
import { processBatteryLowStock } from "@/lib/services/battery-low-stock";

const mocked = db as unknown as {
  bulkSku: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  notification: { createManyAndReturn: ReturnType<typeof vi.fn> };
};

function numberedFamily(id: string, name: string, available: number, checkedOut: number) {
  const units = [
    ...Array.from({ length: available }, (_, i) => ({ id: `${id}-a${i}`, status: "AVAILABLE", allocations: [] })),
    ...Array.from({ length: checkedOut }, (_, i) => ({
      id: `${id}-c${i}`,
      status: "CHECKED_OUT",
      allocations: [{ id: `alloc-${id}-${i}` }],
    })),
  ];
  return {
    id,
    name,
    category: "Batteries",
    minThreshold: 0,
    trackByNumber: true,
    categoryRel: null,
    balances: [],
    units,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.user.findMany.mockResolvedValue([{ id: "staff-1" }, { id: "admin-1" }]);
  mocked.notification.createManyAndReturn.mockImplementation(async ({ data }: { data: unknown[] }) =>
    data.map((_, i) => ({ id: `n-${i}` })),
  );
});

describe("relative battery low-stock rule", () => {
  it("scales the line with family size", () => {
    expect(batteryLowThreshold(0, 53)).toBe(11);
    expect(batteryLowThreshold(0, 8)).toBe(2);
    expect(batteryLowThreshold(15, 20)).toBe(15);
  });

  it("never notifies for a small family", () => {
    expect(shouldNotifyBatteryLow({ minThreshold: 0, ownedQuantity: 12, availableQuantity: 0 })).toBe(false);
    expect(shouldNotifyBatteryLow({ minThreshold: 5, ownedQuantity: 19, availableQuantity: 0 })).toBe(false);
  });

  it("notifies for a large family below 20% available", () => {
    expect(shouldNotifyBatteryLow({ minThreshold: 0, ownedQuantity: 53, availableQuantity: 10 })).toBe(true);
    expect(shouldNotifyBatteryLow({ minThreshold: 0, ownedQuantity: 53, availableQuantity: 11 })).toBe(false);
  });
});

describe("processBatteryLowStock", () => {
  it("notifies staff and admins once per family per week, for big low families only", async () => {
    mocked.bulkSku.findMany.mockResolvedValue([
      numberedFamily("sony", "Sony Battery", 6, 44), // 6 of 50 available: low
      numberedFamily("fx6", "FX6 Battery", 2, 10), // small family: ignored
      numberedFamily("mon", "Monitor Battery", 30, 20), // plenty: ignored
    ]);

    const result = await processBatteryLowStock(new Date("2026-10-22T09:00:00.000Z"));

    expect(result).toEqual({ families: 1, created: 2 });
    const { data, skipDuplicates } = mocked.notification.createManyAndReturn.mock.calls[0]![0];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual(
      expect.objectContaining({
        type: "low_stock",
        channel: "IN_APP",
        dedupeKey: "battery-low-sony-2026-W43-staff-1",
        title: "Sony Battery running low",
        body: expect.stringContaining("6 of 50"),
      }),
    );
  });

  it("writes nothing when no big family is low", async () => {
    mocked.bulkSku.findMany.mockResolvedValue([numberedFamily("fx6", "FX6 Battery", 0, 12)]);
    expect(await processBatteryLowStock()).toEqual({ families: 0, created: 0 });
    expect(mocked.notification.createManyAndReturn).not.toHaveBeenCalled();
  });
});
