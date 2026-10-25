import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    asset: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    assetAllocation: {
      findMany: vi.fn(),
    },
    booking: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    bulkSkuUnit: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    bulkSku: {
      findMany: vi.fn(),
    },
    bookingBulkUnitAllocation: {
      findMany: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import { parseCheckoutFocusDate } from "@/lib/services/checkout-reports";
import {
  getBulkLossReport,
  getBulkLossReportExport,
  getCheckoutReport,
  getOverdueReport,
  getOverdueReportExport,
  getUtilizationReportExport,
} from "@/lib/services/reports";

function assetRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.asset.findMany>>;
}

function assetAllocationRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.assetAllocation.findMany>>;
}

function bookingRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.booking.findMany>>;
}

function bulkSkuUnitGroups(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.bulkSkuUnit.groupBy>>;
}

function bulkSkuUnitRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.bulkSkuUnit.findMany>>;
}

function bulkSkuRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.bulkSku.findMany>>;
}

function bookingBulkUnitAllocationRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.bookingBulkUnitAllocation.findMany>>;
}

function auditLogRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.auditLog.findMany>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reports service", () => {
  it("exports utilization inventory rows with derived status evidence", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue(assetRows([
      {
        id: "asset-1",
        assetTag: "CAM-001",
        name: "Camera Kit",
        type: "Camera",
        brand: "Sony",
        model: "FX6",
        status: "AVAILABLE",
        availableForReservation: true,
        availableForCheckout: true,
        availableForCustody: false,
        updatedAt: new Date("2026-05-10T10:00:00.000Z"),
        location: { name: "Main Cage" },
        department: { name: "Creative" },
        category: { name: "Cinema Cameras" },
      },
      {
        id: "asset-2",
        assetTag: "MIC-001",
        name: null,
        type: "Audio",
        brand: "Sennheiser",
        model: "MKH 416",
        status: "MAINTENANCE",
        availableForReservation: false,
        availableForCheckout: false,
        availableForCustody: true,
        updatedAt: new Date("2026-05-10T11:00:00.000Z"),
        location: { name: "Main Cage" },
        department: null,
        category: null,
      },
    ]));
    vi.mocked(db.asset.count).mockResolvedValue(2);
    vi.mocked(db.assetAllocation.findMany).mockResolvedValue(assetAllocationRows([
      {
        assetId: "asset-1",
        startsAt: new Date("2026-05-10T09:00:00.000Z"),
        endsAt: new Date("2026-05-10T12:00:00.000Z"),
        booking: {
          kind: "CHECKOUT",
          status: "OPEN",
        },
      },
    ]));

    const report = await getUtilizationReportExport();

    expect(db.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { assetTag: "asc" },
      take: 5000,
    }));
    expect(db.assetAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        assetId: { in: ["asset-1"] },
        active: true,
      }),
    }));
    expect(report).toMatchObject({
      total: 2,
      truncated: false,
      limit: 5000,
    });
    expect(report.data).toEqual([
      expect.objectContaining({
        assetTag: "CAM-001",
        computedStatus: "CHECKED_OUT",
        storedStatus: "AVAILABLE",
        location: "Main Cage",
        department: "Creative",
        category: "Cinema Cameras",
        updatedAt: "2026-05-10T10:00:00.000Z",
      }),
      expect.objectContaining({
        assetTag: "MIC-001",
        name: "",
        computedStatus: "MAINTENANCE",
        storedStatus: "MAINTENANCE",
        department: "",
        category: "",
      }),
    ]);
  });

  it("counts only custody checkouts in checkout activity analytics", async () => {
    vi.mocked(db.booking.count)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2);
    vi.mocked(db.booking.findMany).mockResolvedValue([]);
    vi.mocked(db.booking.groupBy).mockResolvedValue([]);
    vi.mocked(db.$queryRaw).mockResolvedValue([]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    const report = await getCheckoutReport(30);

    expect(report.totalCheckouts).toBe(7);
    expect(report.partialFailures).toEqual([]);
    expect(db.booking.count).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        kind: "CHECKOUT",
        status: { in: [BookingStatus.OPEN, BookingStatus.COMPLETED] },
        createdAt: { gte: expect.any(Date) },
      }),
    });
    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [BookingStatus.OPEN, BookingStatus.COMPLETED] },
        }),
      }),
    );
    expect(db.booking.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [BookingStatus.OPEN, BookingStatus.COMPLETED] },
        }),
      }),
    );
    const rawSql = vi.mocked(db.$queryRaw).mock.calls[0]?.[0] as unknown;
    const rawSqlText = Array.isArray(rawSql) ? rawSql.join("") : String(rawSql);
    expect(rawSqlText).toContain("\"status\" IN ('OPEN', 'COMPLETED')");
  });

  it("keeps one Madison day on the checkout chart across daylight saving time", async () => {
    vi.mocked(db.booking.count).mockResolvedValue(0);
    vi.mocked(db.booking.findMany).mockResolvedValue([]);
    vi.mocked(db.booking.groupBy).mockResolvedValue([]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    // The window starts late on March 7. A one-day step that keeps that clock
    // time drops March 9 here, and the same step in UTC drops March 8.
    vi.setSystemTime(new Date("2026-03-09T05:30:00.000Z"));
    vi.mocked(db.$queryRaw).mockResolvedValue([{ date: "2026-03-08", count: 4n }]);
    const spring = await getCheckoutReport(1);
    expect(spring.dailyTrend).toEqual([
      { date: "2026-03-07", count: 0 },
      { date: "2026-03-08", count: 4 },
      { date: "2026-03-09", count: 0 },
    ]);

    // A 24-hour window that stays on November 1 in Chicago. UTC +24h repeats that day.
    vi.setSystemTime(new Date("2026-11-02T05:30:00.000Z"));
    vi.mocked(db.$queryRaw).mockResolvedValue([]);
    const fall = await getCheckoutReport(1);
    expect(fall.dailyTrend.map((point) => point.date)).toEqual(["2026-11-01"]);
  });

  it("lists a clicked day's checkouts from Central midnight to midnight, with names and the prior period", async () => {
    vi.mocked(db.booking.count).mockResolvedValue(0);
    vi.mocked(db.booking.findMany).mockResolvedValue([]);
    vi.mocked(db.booking.groupBy).mockResolvedValue([{ requesterUserId: "u1", _count: 3 }, { requesterUserId: "gone", _count: 1 }] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: "u1", name: "Ada" }] as never);
    // For a 7-day report on May 10 the previous period is Apr 26 to May 2.
    vi.mocked(db.$queryRaw).mockResolvedValue([{ date: "2026-04-20", count: 5n }, { date: "2026-04-28", count: 2n }, { date: "2026-05-05", count: 4n }]);

    const report = await getCheckoutReport(7, "2026-05-01");

    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50,
      where: expect.objectContaining({ createdAt: { gte: new Date("2026-05-01T05:00:00.000Z"), lt: new Date("2026-05-02T05:00:00.000Z") } }),
    }));
    expect(report.focusDate).toBe("2026-05-01");
    expect(report.previousTotalCheckouts).toBe(2);
    expect(report.topRequesters).toEqual([{ name: "Ada", count: 3 }, { name: "Unknown", count: 1 }]);
  });

  it("accepts only a real YYYY-MM-DD focus day", () => {
    expect(parseCheckoutFocusDate("2026-05-01")).toBe("2026-05-01");
    expect(parseCheckoutFocusDate("2026-13-01")).toBeNull();
    expect(parseCheckoutFocusDate("May 1")).toBeNull();
    expect(parseCheckoutFocusDate(null)).toBeNull();
  });

  it("counts only outstanding gear in the overdue report", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue(bookingRows([
      {
        id: "booking-1",
        title: "Camera checkout",
        endsAt: new Date("2026-05-10T09:00:00.000Z"),
        requester: { id: "user-1", name: "Alex Student" },
        location: { id: "loc-1", name: "Main" },
        serializedItems: [
          { asset: { id: "asset-1", assetTag: "CAM-1", name: "Camera" } },
        ],
        bulkItems: [
          {
            checkedOutQuantity: 5,
            checkedInQuantity: 2,
            plannedQuantity: 5,
            bulkSku: { id: "sku-1", name: "AA Batteries" },
          },
          {
            checkedOutQuantity: 2,
            checkedInQuantity: 2,
            plannedQuantity: 2,
            bulkSku: { id: "sku-2", name: "SD Cards" },
          },
        ],
      },
    ]));

    const report = await getOverdueReport();
    const requester = report.leaderboard[0];
    expect(requester).toBeDefined();
    const booking = requester!.bookings[0];
    expect(booking).toBeDefined();

    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          serializedItems: expect.objectContaining({
            where: { allocationStatus: "active" },
          }),
        }),
      }),
    );
    expect(booking!.itemCount).toBe(4);
    expect(booking!.items).toEqual(["CAM-1", "AA Batteries x3"]);
  });

  it("exports overdue rows with complete outstanding item summaries", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue(bookingRows([
      {
        id: "booking-1",
        title: "Camera checkout",
        endsAt: new Date("2026-05-10T09:00:00.000Z"),
        requester: { id: "user-1", name: "Alex Student" },
        location: { id: "loc-1", name: "Main" },
        serializedItems: [
          { asset: { id: "asset-1", assetTag: "CAM-1", name: "Camera" } },
        ],
        bulkItems: [
          {
            checkedOutQuantity: 5,
            checkedInQuantity: 2,
            plannedQuantity: 5,
            bulkSku: { id: "sku-1", name: "AA Batteries" },
          },
          {
            checkedOutQuantity: 2,
            checkedInQuantity: 2,
            plannedQuantity: 2,
            bulkSku: { id: "sku-2", name: "SD Cards" },
          },
        ],
      },
    ]));
    vi.mocked(db.booking.count).mockResolvedValue(1);

    const report = await getOverdueReportExport();

    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { endsAt: "asc" },
        take: 5000,
        where: expect.objectContaining({
          kind: "CHECKOUT",
          status: "OPEN",
          endsAt: { lt: expect.any(Date) },
        }),
      }),
    );
    expect(report).toMatchObject({
      total: 1,
      truncated: false,
      limit: 5000,
    });
    expect(report.data[0]).toMatchObject({
      bookingId: "booking-1",
      requester: "Alex Student",
      title: "Camera checkout",
      overdueHours: 3,
      location: "Main",
      itemCount: 4,
      itemSummary: "CAM-1; AA Batteries x3",
    });
  });

  it("adds numbered battery audit details to the bulk loss report", async () => {
    vi.mocked(db.bulkSkuUnit.groupBy).mockResolvedValue(bulkSkuUnitGroups([
      { bulkSkuId: "battery-sku-1", _count: { id: 2 } },
    ]));
    vi.mocked(db.bulkSkuUnit.findMany).mockResolvedValue(bulkSkuUnitRows([
      {
        id: "unit-1",
        unitNumber: 1,
        notes: "Missing after event",
        updatedAt: new Date("2026-05-09T12:00:00.000Z"),
        bulkSku: { id: "battery-sku-1", name: "Sony NP-FZ100 Battery" },
        allocations: [
          {
            bookingBulkItem: {
              booking: {
                id: "booking-1",
                refNumber: "CO-1001",
                title: "Softball",
                requester: { id: "user-1", name: "Alex Student" },
              },
            },
          },
        ],
      },
      {
        id: "unit-2",
        unitNumber: 2,
        notes: null,
        updatedAt: new Date("2026-05-10T12:00:00.000Z"),
        bulkSku: { id: "battery-sku-1", name: "Sony NP-FZ100 Battery" },
        allocations: [
          {
            bookingBulkItem: {
              booking: {
                id: "booking-2",
                refNumber: "CO-1002",
                title: "Baseball",
                requester: { id: "user-1", name: "Alex Student" },
              },
            },
          },
        ],
      },
    ]));
    vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(db.bulkSku.findMany)
      .mockResolvedValueOnce(bulkSkuRows([
        {
          id: "battery-sku-1",
          name: "Sony NP-FZ100 Battery",
          category: "Batteries",
          categoryRel: { name: "Camera Batteries" },
          location: { id: "loc-1", name: "Main Cage" },
          units: [
            {
              id: "unit-1",
              unitNumber: 1,
              status: "LOST",
              notes: "Missing after event",
              updatedAt: new Date("2026-05-09T12:00:00.000Z"),
              allocations: [
                {
                  checkedOutAt: new Date("2026-05-01T12:00:00.000Z"),
                  checkedInAt: null,
                  createdAt: new Date("2026-05-01T12:00:00.000Z"),
                  bookingBulkItem: {
                    booking: {
                      id: "booking-1",
                      refNumber: "CO-1001",
                      title: "Softball",
                      requester: { id: "user-1", name: "Alex Student" },
                    },
                  },
                },
              ],
            },
            {
              id: "unit-2",
              unitNumber: 2,
              status: "LOST",
              notes: null,
              updatedAt: new Date("2026-05-10T12:00:00.000Z"),
              allocations: [
                {
                  checkedOutAt: new Date("2026-05-02T12:00:00.000Z"),
                  checkedInAt: null,
                  createdAt: new Date("2026-05-02T12:00:00.000Z"),
                  bookingBulkItem: {
                    booking: {
                      id: "booking-2",
                      refNumber: "CO-1002",
                      title: "Baseball",
                      requester: { id: "user-1", name: "Alex Student" },
                    },
                  },
                },
              ],
            },
            {
              id: "unit-3",
              unitNumber: 3,
              status: "AVAILABLE",
              notes: null,
              updatedAt: new Date("2026-05-03T12:00:00.000Z"),
              allocations: [],
            },
            {
              id: "unit-4",
              unitNumber: 4,
              status: "CHECKED_OUT",
              notes: null,
              updatedAt: new Date("2026-05-04T12:00:00.000Z"),
              allocations: [],
            },
          ],
        },
        {
          id: "media-sku-1",
          name: "CFexpress Cards",
          category: "Media",
          categoryRel: { name: "Media" },
          location: { id: "loc-1", name: "Main Cage" },
          units: [
            {
              id: "media-unit-1",
              unitNumber: 1,
              status: "LOST",
              notes: null,
              updatedAt: new Date("2026-05-10T12:00:00.000Z"),
              allocations: [],
            },
          ],
        },
      ]))
      // getBulkLossFilterOptions runs between the battery audit and the
      // sku-name lookup, so it needs its own slot in this ordered chain.
      .mockResolvedValueOnce(bulkSkuRows([]))
      .mockResolvedValueOnce(bulkSkuRows([
        { id: "battery-sku-1", name: "Sony NP-FZ100 Battery" },
      ]));
    vi.mocked(db.bookingBulkUnitAllocation.findMany).mockResolvedValue(bookingBulkUnitAllocationRows([
      {
        id: "alloc-1",
        checkedOutAt: new Date("2026-05-02T12:00:00.000Z"),
        checkedInAt: new Date("2026-05-04T12:00:00.000Z"),
        createdAt: new Date("2026-05-02T12:00:00.000Z"),
        bulkSkuUnit: {
          id: "unit-2",
          unitNumber: 2,
          status: "LOST",
          bulkSku: {
            id: "battery-sku-1",
            name: "Sony NP-FZ100 Battery",
            category: "Batteries",
            categoryRel: { name: "Camera Batteries" },
          },
        },
        bookingBulkItem: {
          booking: {
            id: "booking-2",
            refNumber: "CO-1002",
            title: "Baseball",
            requester: { id: "user-1", name: "Alex Student" },
          },
        },
      },
      {
        id: "alloc-media",
        checkedOutAt: new Date("2026-05-02T12:00:00.000Z"),
        checkedInAt: null,
        createdAt: new Date("2026-05-02T12:00:00.000Z"),
        bulkSkuUnit: {
          id: "media-unit-1",
          unitNumber: 1,
          status: "LOST",
          bulkSku: {
            id: "media-sku-1",
            name: "CFexpress Cards",
            category: "Media",
            categoryRel: { name: "Media" },
          },
        },
        bookingBulkItem: {
          booking: {
            id: "booking-media",
            refNumber: "CO-2001",
            title: "Media",
            requester: { id: "user-2", name: "Sam Student" },
          },
        },
      },
    ]));

    const report = await getBulkLossReport();

    expect(report.batteryAudit.totals).toMatchObject({
      skuCount: 1,
      totalUnits: 4,
      lost: 2,
      available: 2,
      checkedOut: 0,
      repeatPatternCount: 2,
    });
    expect(report.batteryAudit.totals.lossRate).toBe(0.5);
    expect(report.batteryAudit.bySku[0]).toMatchObject({
      bulkSkuId: "battery-sku-1",
      lost: 2,
      lossRate: 0.5,
      missingUnitNumbers: [1, 2],
    });
    expect(report.batteryAudit.missingUnits.map((unit) => unit.unitNumber)).toEqual([2, 1]);
    expect(report.batteryAudit.repeatPatterns.map((pattern) => pattern.type)).toEqual(["requester", "sku"]);
    expect(report.batteryAudit.checkoutHistory).toHaveLength(1);
    expect(report.batteryAudit.checkoutHistory[0]).toMatchObject({
      id: "alloc-1",
      skuName: "Sony NP-FZ100 Battery",
      durationDays: 2,
    });
  });

  it("exports missing-unit report evidence across grouped and battery sections", async () => {
    vi.mocked(db.bulkSkuUnit.groupBy).mockResolvedValue(bulkSkuUnitGroups([
      { bulkSkuId: "battery-sku-1", _count: { id: 1 } },
    ]));
    vi.mocked(db.bulkSkuUnit.findMany).mockResolvedValue(bulkSkuUnitRows([
      {
        id: "unit-1",
        unitNumber: 7,
        notes: "Missing after event",
        updatedAt: new Date("2026-05-09T12:00:00.000Z"),
        bulkSku: { id: "battery-sku-1", name: "Sony NP-FZ100 Battery" },
        allocations: [
          {
            bookingBulkItem: {
              booking: {
                id: "booking-1",
                refNumber: "CO-1001",
                title: "Softball",
                requester: { id: "user-1", name: "=Formula User" },
              },
            },
          },
        ],
      },
    ]));
    vi.mocked(db.auditLog.findMany).mockResolvedValue(auditLogRows([
      {
        id: "audit-1",
        entityId: "booking-1",
        afterJson: { lostUnits: [{ skuName: "Sony NP-FZ100 Battery", unitNumber: 7 }] },
        createdAt: new Date("2026-05-09T13:00:00.000Z"),
        actor: { id: "staff-1", name: "Creative Staff", avatarUrl: null },
      },
    ]));
    vi.mocked(db.bulkSku.findMany)
      .mockResolvedValueOnce(bulkSkuRows([
        {
          id: "battery-sku-1",
          name: "Sony NP-FZ100 Battery",
          category: "Batteries",
          categoryRel: { name: "Camera Batteries" },
          location: { id: "loc-1", name: "Main Cage" },
          units: [
            {
              id: "unit-1",
              unitNumber: 7,
              status: "LOST",
              notes: "Missing after event",
              updatedAt: new Date("2026-05-09T12:00:00.000Z"),
              allocations: [
                {
                  checkedOutAt: new Date("2026-05-01T12:00:00.000Z"),
                  checkedInAt: null,
                  createdAt: new Date("2026-05-01T12:00:00.000Z"),
                  bookingBulkItem: {
                    booking: {
                      id: "booking-1",
                      refNumber: "CO-1001",
                      title: "Softball",
                      requester: { id: "user-1", name: "=Formula User" },
                    },
                  },
                },
              ],
            },
          ],
        },
      ]))
      // getBulkLossFilterOptions runs between the battery audit and the
      // sku-name lookup, so it needs its own slot in this ordered chain.
      .mockResolvedValueOnce(bulkSkuRows([]))
      .mockResolvedValueOnce(bulkSkuRows([
        { id: "battery-sku-1", name: "Sony NP-FZ100 Battery" },
      ]));
    vi.mocked(db.bookingBulkUnitAllocation.findMany).mockResolvedValue(bookingBulkUnitAllocationRows([
      {
        id: "alloc-1",
        checkedOutAt: new Date("2026-05-01T12:00:00.000Z"),
        checkedInAt: null,
        createdAt: new Date("2026-05-01T12:00:00.000Z"),
        bulkSkuUnit: {
          id: "unit-1",
          unitNumber: 7,
          status: "LOST",
          bulkSku: {
            id: "battery-sku-1",
            name: "Sony NP-FZ100 Battery",
            category: "Batteries",
            categoryRel: { name: "Camera Batteries" },
          },
        },
        bookingBulkItem: {
          booking: {
            id: "booking-1",
            refNumber: "CO-1001",
            title: "Softball",
            requester: { id: "user-1", name: "=Formula User" },
          },
        },
      },
    ]));

    const report = await getBulkLossReportExport();

    expect(report).toMatchObject({
      total: 6,
      truncated: false,
      limit: 5000,
    });
    expect(report.data.map((row) => row.section)).toEqual([
      "Missing units by family",
      "Missing units by requester",
      "Recent missing-unit events",
      "Battery family summary",
      "Battery missing units",
      "Battery checkout history",
    ]);
    expect(report.data).toContainEqual(expect.objectContaining({
      section: "Battery missing units",
      itemFamily: "Sony NP-FZ100 Battery",
      unitNumber: 7,
      person: "=Formula User",
      booking: "CO-1001",
      status: "LOST",
      notes: "Missing after event",
    }));
    expect(report.data).toContainEqual(expect.objectContaining({
      section: "Battery family summary",
      category: "Camera Batteries",
      location: "Main Cage",
      detail: "Missing units: 7",
    }));
  });
});
