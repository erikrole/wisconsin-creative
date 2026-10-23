import { isBatterySku } from "@/lib/bulk-batteries";
import { db } from "@/lib/db";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { BULK_LOSS_REPORT_EXPORT_LIMIT, daysBetween } from "./report-shared";

async function getBatteryAuditReport(filters: BulkLossReportFilters = {}) {
  const now = new Date();
  const [batterySkuResult, allocationHistoryResult] = await Promise.allSettled([
    db.bulkSku.findMany({
      where: {
        active: true,
        trackByNumber: true,
        ...bulkSkuScopeWhere(filters),
      },
      select: {
        id: true,
        name: true,
        category: true,
        categoryRel: { select: { name: true } },
        location: { select: { id: true, name: true } },
        units: {
          orderBy: { unitNumber: "asc" },
          select: {
            id: true,
            unitNumber: true,
            status: true,
            notes: true,
            updatedAt: true,
            allocations: {
              orderBy: [{ checkedOutAt: "desc" }, { createdAt: "desc" }],
              take: 1,
              select: {
                checkedOutAt: true,
                checkedInAt: true,
                createdAt: true,
                bookingBulkItem: {
                  select: {
                    booking: {
                      select: {
                        id: true,
                        refNumber: true,
                        title: true,
                        requester: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ locationId: "asc" }, { name: "asc" }],
    }),
    db.bookingBulkUnitAllocation.findMany({
      where: {
        checkedOutAt: { not: null },
        bulkSkuUnit: {
          bulkSku: {
            active: true,
            trackByNumber: true,
          },
        },
      },
      orderBy: [{ checkedOutAt: "desc" }, { createdAt: "desc" }],
      take: 300,
      select: {
        id: true,
        checkedOutAt: true,
        checkedInAt: true,
        createdAt: true,
        bulkSkuUnit: {
          select: {
            id: true,
            unitNumber: true,
            status: true,
            bulkSku: {
              select: {
                id: true,
                name: true,
                category: true,
                categoryRel: { select: { name: true } },
              },
            },
          },
        },
        bookingBulkItem: {
          select: {
            booking: {
              select: {
                id: true,
                refNumber: true,
                title: true,
                requester: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const batterySkus = batterySkuResult.status === "fulfilled"
    ? batterySkuResult.value.filter(isBatterySku)
    : [];
  const batterySkuIds = new Set(batterySkus.map((sku) => sku.id));
  const bySku = batterySkus.map((sku) => {
    const activeAllocationByUnitId = new Map(
      sku.units.flatMap((unit) =>
        unit.allocations
          .filter((allocation) => allocation.checkedOutAt && !allocation.checkedInAt)
          .map((allocation) => [unit.id, allocation] as const)
      ),
    );
    const state = summarizeItemFamilyState({ ...sku, trackByNumber: true, balances: [] }, activeAllocationByUnitId);
    const total = state.onHandQuantity;
    const available = state.availableQuantity;
    const checkedOut = state.checkedOutQuantity;
    const lost = sku.units.filter((unit) => unit.status === "LOST").length;
    const retired = sku.units.filter((unit) => unit.status === "RETIRED").length;
    const missingUnits = sku.units.filter((unit) => unit.status === "LOST");
    const lastMissingAt = missingUnits
      .map((unit) => unit.updatedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      bulkSkuId: sku.id,
      skuName: sku.name,
      category: sku.categoryRel?.name ?? sku.category,
      location: sku.location.name,
      total,
      available,
      checkedOut,
      lost,
      retired,
      lossRate: total > 0 ? lost / total : 0,
      missingUnitNumbers: missingUnits.map((unit) => unit.unitNumber),
      lastMissingAt: lastMissingAt?.toISOString() ?? null,
    };
  }).sort((a, b) => b.lost - a.lost || b.lossRate - a.lossRate || a.skuName.localeCompare(b.skuName));

  const missingUnits = batterySkus.flatMap((sku) =>
    sku.units
      .filter((unit) => unit.status === "LOST")
      .map((unit) => {
        const allocation = unit.allocations[0];
        const booking = allocation?.bookingBulkItem.booking;
        return {
          id: unit.id,
          bulkSkuId: sku.id,
          skuName: sku.name,
          unitNumber: unit.unitNumber,
          notes: unit.notes,
          markedMissingAt: unit.updatedAt.toISOString(),
          lastCheckoutAt: allocation?.checkedOutAt?.toISOString() ?? allocation?.createdAt?.toISOString() ?? null,
          lastRequesterId: booking?.requester.id ?? null,
          lastRequesterName: booking?.requester.name ?? null,
          lastBookingId: booking?.id ?? null,
          lastBookingRef: booking?.refNumber ?? null,
          lastBookingTitle: (booking ? displayBookingTitle(booking.title) : null),
        };
      }),
  ).sort((a, b) => b.markedMissingAt.localeCompare(a.markedMissingAt));

  const requesterLossCounts = new Map<string, { requesterId: string; requesterName: string; lost: number }>();
  for (const unit of missingUnits) {
    if (!unit.lastRequesterId || !unit.lastRequesterName) continue;
    const existing = requesterLossCounts.get(unit.lastRequesterId);
    if (existing) {
      existing.lost++;
    } else {
      requesterLossCounts.set(unit.lastRequesterId, {
        requesterId: unit.lastRequesterId,
        requesterName: unit.lastRequesterName,
        lost: 1,
      });
    }
  }

  const repeatPatterns = [
    ...bySku
      .filter((sku) => sku.lost >= 2)
      .map((sku) => ({
        type: "sku" as const,
        label: sku.skuName,
        count: sku.lost,
        detail: `${sku.missingUnitNumbers.length} missing units`,
      })),
    ...Array.from(requesterLossCounts.values())
      .filter((requester) => requester.lost >= 2)
      .map((requester) => ({
        type: "requester" as const,
        label: requester.requesterName,
        count: requester.lost,
        detail: "Last holder on missing units",
      })),
  ].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const rawHistory = allocationHistoryResult.status === "fulfilled" ? allocationHistoryResult.value : [];
  const checkoutHistory = rawHistory
    .filter((allocation) => batterySkuIds.has(allocation.bulkSkuUnit.bulkSku.id))
    .map((allocation) => {
      const checkedOutAt = allocation.checkedOutAt ?? allocation.createdAt;
      const checkedInAt = allocation.checkedInAt ?? null;
      const booking = allocation.bookingBulkItem.booking;

      return {
        id: allocation.id,
        bulkSkuUnitId: allocation.bulkSkuUnit.id,
        bulkSkuId: allocation.bulkSkuUnit.bulkSku.id,
        skuName: allocation.bulkSkuUnit.bulkSku.name,
        unitNumber: allocation.bulkSkuUnit.unitNumber,
        status: allocation.bulkSkuUnit.status,
        checkedOutAt: checkedOutAt.toISOString(),
        checkedInAt: checkedInAt?.toISOString() ?? null,
        durationDays: daysBetween(checkedOutAt, checkedInAt ?? now),
        bookingId: booking.id,
        bookingRef: booking.refNumber,
        bookingTitle: displayBookingTitle(booking.title),
        requesterId: booking.requester.id,
        requesterName: booking.requester.name,
      };
    })
    .slice(0, 50);

  const totals = bySku.reduce(
    (acc, sku) => {
      acc.totalUnits += sku.total;
      acc.available += sku.available;
      acc.checkedOut += sku.checkedOut;
      acc.lost += sku.lost;
      acc.retired += sku.retired;
      return acc;
    },
    { skuCount: bySku.length, totalUnits: 0, available: 0, checkedOut: 0, lost: 0, retired: 0 },
  );

  return {
    totals: {
      ...totals,
      lossRate: totals.totalUnits > 0 ? totals.lost / totals.totalUnits : 0,
      repeatPatternCount: repeatPatterns.length,
    },
    bySku,
    missingUnits,
    checkoutHistory,
    repeatPatterns,
  };
}

type BulkLossReportFilters = {
  categoryId?: string | null;
  locationId?: string | null;
};

/**
 * Missing-unit filtering is by stable SKU attributes, not by date: a unit only
 * carries `status: LOST`, and its `updatedAt` moves on any later edit, so there
 * is no trustworthy "went missing on" timestamp to range over.
 */
function bulkSkuScopeWhere({ categoryId, locationId }: BulkLossReportFilters) {
  return {
    ...(locationId ? { locationId } : {}),
    ...(categoryId ? { categoryId } : {}),
  };
}

function bulkUnitScopeWhere(filters: BulkLossReportFilters) {
  const skuWhere = bulkSkuScopeWhere(filters);
  return Object.keys(skuWhere).length > 0 ? { bulkSku: skuWhere } : {};
}

/** Only offers families that actually have missing units to inspect. */
async function getBulkLossFilterOptions() {
  const skus = await db.bulkSku.findMany({
    where: { units: { some: { status: "LOST" } } },
    select: {
      locationId: true,
      location: { select: { id: true, name: true } },
      categoryId: true,
      categoryRel: { select: { id: true, name: true } },
    },
  });

  const locations = new Map<string, { id: string; name: string }>();
  const categories = new Map<string, { id: string; name: string }>();
  for (const sku of skus) {
    locations.set(sku.location.id, { id: sku.location.id, name: sku.location.name });
    if (sku.categoryRel) {
      categories.set(sku.categoryRel.id, { id: sku.categoryRel.id, name: sku.categoryRel.name });
    }
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    categories: Array.from(categories.values()).sort(byName),
    locations: Array.from(locations.values()).sort(byName),
  };
}

export async function getBulkLossReport(filters: BulkLossReportFilters = {}) {
  const unitScope = bulkUnitScopeWhere(filters);
  const [
    lostBySkuResult,
    lostByUserResult,
    recentLossesResult,
    batteryAuditResult,
    filterOptionsResult,
  ] = await Promise.allSettled([
    db.bulkSkuUnit.groupBy({
      by: ["bulkSkuId"],
      where: { status: "LOST", ...unitScope },
      _count: { id: true },
    }),
    db.bulkSkuUnit.findMany({
      where: { status: "LOST", ...unitScope },
      select: {
        id: true,
        unitNumber: true,
        notes: true,
        updatedAt: true,
        bulkSku: { select: { id: true, name: true } },
        allocations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            bookingBulkItem: {
              select: {
                booking: {
                  select: {
                    id: true,
                    refNumber: true,
                    title: true,
                    requester: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.auditLog.findMany({
      where: { action: "bulk_units_auto_lost" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        entityId: true,
        afterJson: true,
        createdAt: true,
        actor: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
    getBatteryAuditReport(filters),
    getBulkLossFilterOptions(),
  ]);

  const lostBySku = lostBySkuResult.status === "fulfilled" ? lostBySkuResult.value : [];
  const skuIds = lostBySku.map((r) => r.bulkSkuId);
  const skuNames = skuIds.length > 0
    ? await db.bulkSku.findMany({ where: { id: { in: skuIds } }, select: { id: true, name: true } })
    : [];
  const skuNameMap = new Map(skuNames.map((s) => [s.id, s.name]));

  const bySkuSummary = lostBySku.map((r) => ({
    skuName: skuNameMap.get(r.bulkSkuId) ?? "Unknown",
    bulkSkuId: r.bulkSkuId,
    count: r._count.id,
  })).sort((a, b) => b.count - a.count);

  const lostUnits = lostByUserResult.status === "fulfilled" ? lostByUserResult.value : [];
  const userLossCounts = new Map<string, { name: string; count: number }>();
  for (const unit of lostUnits) {
    const alloc = unit.allocations[0];
    const requester = alloc?.bookingBulkItem?.booking?.requester;
    if (!requester) continue;
    const existing = userLossCounts.get(requester.id);
    if (existing) {
      existing.count++;
    } else {
      userLossCounts.set(requester.id, { name: requester.name, count: 1 });
    }
  }
  const byUserLeaderboard = Array.from(userLossCounts.values())
    .sort((a, b) => b.count - a.count);

  const totalLost = lostBySku.reduce((sum, r) => sum + r._count.id, 0);

  const recentLosses = recentLossesResult.status === "fulfilled"
    ? recentLossesResult.value.map((log) => ({
        id: log.id,
        bookingId: log.entityId,
        lostUnits: log.afterJson as unknown,
        createdAt: log.createdAt.toISOString(),
        actor: log.actor,
      }))
    : [];

  const filterOptions = filterOptionsResult.status === "fulfilled"
    ? filterOptionsResult.value
    : { categories: [], locations: [] };

  return {
    totalLost,
    categoryId: filters.categoryId ?? null,
    locationId: filters.locationId ?? null,
    filterOptions,
    bySku: bySkuSummary,
    byUser: byUserLeaderboard,
    recentLosses,
    batteryAudit: batteryAuditResult.status === "fulfilled"
      ? batteryAuditResult.value
      : {
          totals: {
            skuCount: 0,
            totalUnits: 0,
            available: 0,
            checkedOut: 0,
            lost: 0,
            retired: 0,
            lossRate: 0,
            repeatPatternCount: 0,
          },
          bySku: [],
          missingUnits: [],
          checkoutHistory: [],
          repeatPatterns: [],
        },
  };
}

type BulkLossReportData = Awaited<ReturnType<typeof getBulkLossReport>>;

type BulkLossReportExportRow = {
  section: string;
  itemFamily: string;
  category: string;
  location: string;
  unitNumber: number | string;
  person: string;
  booking: string;
  timestamp: string;
  count: number | string;
  status: string;
  detail: string;
  notes: string;
};

function bookingExportLabel({
  id,
  ref,
  title,
}: {
  id?: string | null;
  ref?: string | null;
  title?: string | null;
}) {
  return ref ?? title ?? id ?? "";
}

function jsonExportDetail(value: unknown) {
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildBulkLossReportExportRows(report: BulkLossReportData): BulkLossReportExportRow[] {
  const rows: BulkLossReportExportRow[] = [];

  for (const sku of report.bySku) {
    rows.push({
      section: "Missing units by family",
      itemFamily: sku.skuName,
      category: "",
      location: "",
      unitNumber: "",
      person: "",
      booking: "",
      timestamp: "",
      count: sku.count,
      status: "LOST",
      detail: "Current missing numbered units by family",
      notes: "",
    });
  }

  for (const user of report.byUser) {
    rows.push({
      section: "Missing units by requester",
      itemFamily: "",
      category: "",
      location: "",
      unitNumber: "",
      person: user.name,
      booking: "",
      timestamp: "",
      count: user.count,
      status: "LOST",
      detail: "Last requester attributed from unit allocation history",
      notes: "",
    });
  }

  for (const event of report.recentLosses) {
    rows.push({
      section: "Recent missing-unit events",
      itemFamily: "",
      category: "",
      location: "",
      unitNumber: "",
      person: event.actor?.name ?? "System",
      booking: event.bookingId,
      timestamp: event.createdAt,
      count: "",
      status: "",
      detail: "Check-in completed with missing units",
      notes: jsonExportDetail(event.lostUnits),
    });
  }

  for (const sku of report.batteryAudit.bySku) {
    rows.push({
      section: "Battery family summary",
      itemFamily: sku.skuName,
      category: sku.category,
      location: sku.location,
      unitNumber: "",
      person: "",
      booking: "",
      timestamp: sku.lastMissingAt ?? "",
      count: sku.lost,
      status: `${sku.available} available; ${sku.checkedOut} checked out; ${sku.retired} retired; ${sku.total} total`,
      detail: sku.missingUnitNumbers.length > 0
        ? `Missing units: ${sku.missingUnitNumbers.join(", ")}`
        : "No missing units",
      notes: "",
    });
  }

  for (const unit of report.batteryAudit.missingUnits) {
    rows.push({
      section: "Battery missing units",
      itemFamily: unit.skuName,
      category: "",
      location: "",
      unitNumber: unit.unitNumber,
      person: unit.lastRequesterName ?? "Unknown",
      booking: bookingExportLabel({
        id: unit.lastBookingId,
        ref: unit.lastBookingRef,
        title: unit.lastBookingTitle,
      }),
      timestamp: unit.markedMissingAt,
      count: 1,
      status: "LOST",
      detail: unit.lastCheckoutAt ? `Last checkout ${unit.lastCheckoutAt}` : "",
      notes: unit.notes ?? "",
    });
  }

  for (const entry of report.batteryAudit.checkoutHistory) {
    rows.push({
      section: "Battery checkout history",
      itemFamily: entry.skuName,
      category: "",
      location: "",
      unitNumber: entry.unitNumber,
      person: entry.requesterName,
      booking: bookingExportLabel({
        id: entry.bookingId,
        ref: entry.bookingRef,
        title: entry.bookingTitle,
      }),
      timestamp: entry.checkedOutAt,
      count: entry.durationDays ?? "",
      status: entry.checkedInAt ? `Returned ${entry.checkedInAt}` : "Still out",
      detail: `Unit status: ${entry.status}`,
      notes: "",
    });
  }

  for (const pattern of report.batteryAudit.repeatPatterns) {
    rows.push({
      section: "Battery repeat missing patterns",
      itemFamily: pattern.type === "sku" ? pattern.label : "",
      category: "",
      location: "",
      unitNumber: "",
      person: pattern.type === "requester" ? pattern.label : "",
      booking: "",
      timestamp: "",
      count: pattern.count,
      status: pattern.type,
      detail: pattern.detail,
      notes: "",
    });
  }

  return rows;
}

export async function getBulkLossReportExport(filters: BulkLossReportFilters = {}) {
  const report = await getBulkLossReport(filters);
  const rows = buildBulkLossReportExportRows(report);

  return {
    data: rows.slice(0, BULK_LOSS_REPORT_EXPORT_LIMIT),
    total: rows.length,
    truncated: rows.length > BULK_LOSS_REPORT_EXPORT_LIMIT,
    limit: BULK_LOSS_REPORT_EXPORT_LIMIT,
  };
}
