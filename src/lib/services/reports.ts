import { BookingStatus, Prisma } from "@prisma/client";
import { appTzDateKey, appTzDayRange } from "@/lib/app-time";
import { isBatterySku } from "@/lib/bulk-batteries";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { countAssetsByEffectiveStatus, deriveAssetStatusesFromLoaded } from "@/lib/services/status";

const AUDIT_REPORT_EXPORT_LIMIT = 5000;
const CHECKOUT_REPORT_EXPORT_LIMIT = 5000;
const OVERDUE_REPORT_EXPORT_LIMIT = 5000;
const SCAN_REPORT_EXPORT_LIMIT = 5000;
const BULK_LOSS_REPORT_EXPORT_LIMIT = 5000;
const UTILIZATION_REPORT_EXPORT_LIMIT = 5000;
const CHECKOUT_CUSTODY_REPORT_STATUSES = [BookingStatus.OPEN, BookingStatus.COMPLETED] as const;

export const UTILIZATION_REPORT_PERIODS = [30, 90, 365] as const;
export const UTILIZATION_REPORT_DEFAULT_PERIOD = 90;
const UTILIZATION_IDLE_LIST_LIMIT = 25;
const UTILIZATION_TOP_USED_LIMIT = 10;
const EMPTY_EFFECTIVE_STATUS_COUNTS = {
  AVAILABLE: 0,
  CHECKED_OUT: 0,
  PENDING_PICKUP: 0,
  RESERVED: 0,
  MAINTENANCE: 0,
  RETIRED: 0,
};

export function parseUtilizationReportPeriod(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return UTILIZATION_REPORT_PERIODS.includes(parsed as (typeof UTILIZATION_REPORT_PERIODS)[number])
    ? parsed
    : UTILIZATION_REPORT_DEFAULT_PERIOD;
}

/**
 * Custody windows are derived from the booking, not from `AssetAllocation`:
 * check-in flips allocations to `active: false` without stamping the actual
 * return time, so the allocation's `endsAt` stays at the planned date. Using
 * `completedAt` for finished checkouts and "now" for open ones matches how
 * accountability measures lateness, so the two reports agree.
 */
const UTILIZATION_CUSTODY_END_SQL = Prisma.sql`
  CASE WHEN b.status = 'COMPLETED' THEN COALESCE(b.completed_at, b.ends_at) ELSE w.win_end END
`;

function utilizationCustodyCte(days: number) {
  return Prisma.sql`
    WITH w AS (
      SELECT (now() - (${days}::int * interval '1 day')) AS win_start, now() AS win_end
    ),
    custody AS (
      SELECT
        bsi.asset_id,
        GREATEST(b.starts_at, w.win_start) AS c_start,
        LEAST(${UTILIZATION_CUSTODY_END_SQL}, w.win_end) AS c_end
      FROM booking_serialized_items bsi
      JOIN bookings b ON b.id = bsi.booking_id
      CROSS JOIN w
      WHERE b.kind = 'CHECKOUT'
        AND b.status IN ('OPEN', 'COMPLETED')
        AND b.starts_at < w.win_end
        AND ${UTILIZATION_CUSTODY_END_SQL} > w.win_start
    )
  `;
}

type UtilizationCustodyTotalsRow = {
  custody_days: number | null;
  assets_used: number;
  checkout_count: number;
};

type UtilizationTopUsedRow = {
  asset_id: string;
  asset_tag: string;
  name: string | null;
  checkouts: number;
  custody_days: number | null;
};

type UtilizationIdleRow = {
  asset_id: string;
  asset_tag: string;
  name: string | null;
  category: string | null;
  purchase_price: string | number | null;
  last_checked_out_at: Date | null;
};

type UtilizationIdleTotalsRow = {
  idle_count: number;
  idle_priced_count: number;
  never_count: number;
  idle_value: string | number | null;
};

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function settledReportValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  failure: string,
  partialFailures: string[]
) {
  if (result.status === "fulfilled") return result.value;

  partialFailures.push(failure);
  console.error(`[reports] ${failure} query failed`, result.reason);
  return fallback;
}

async function getUtilizationCustodyMetrics(days: number, activeAssets: number) {
  const cte = utilizationCustodyCte(days);
  const partialFailures: string[] = [];

  const results = await Promise.allSettled([
    db.$queryRaw<UtilizationCustodyTotalsRow[]>`
      ${cte}
      SELECT
        SUM(GREATEST(EXTRACT(EPOCH FROM (c_end - c_start)) / 86400.0, 0))::float8 AS custody_days,
        COUNT(DISTINCT asset_id)::int AS assets_used,
        COUNT(*)::int AS checkout_count
      FROM custody
    `,
    db.$queryRaw<UtilizationTopUsedRow[]>`
      ${cte}
      SELECT
        a.id AS asset_id,
        a.asset_tag,
        a.name,
        COUNT(*)::int AS checkouts,
        SUM(GREATEST(EXTRACT(EPOCH FROM (c.c_end - c.c_start)) / 86400.0, 0))::float8 AS custody_days
      FROM custody c
      JOIN assets a ON a.id = c.asset_id
      GROUP BY a.id, a.asset_tag, a.name
      ORDER BY custody_days DESC NULLS LAST
      LIMIT ${UTILIZATION_TOP_USED_LIMIT}
    `,
    db.$queryRaw<UtilizationIdleTotalsRow[]>`
      ${cte},
      idle AS (
        SELECT a.id, a.purchase_price
        FROM assets a
        WHERE a.status <> 'RETIRED'
          AND NOT EXISTS (SELECT 1 FROM custody c WHERE c.asset_id = a.id)
      )
      SELECT
        (SELECT COUNT(*)::int FROM idle) AS idle_count,
        (SELECT COUNT(*)::int FROM idle WHERE purchase_price IS NOT NULL) AS idle_priced_count,
        (SELECT COALESCE(SUM(purchase_price), 0)::float8 FROM idle) AS idle_value,
        (
          SELECT COUNT(*)::int
          FROM assets a
          WHERE a.status <> 'RETIRED'
            AND NOT EXISTS (
              SELECT 1
              FROM booking_serialized_items bsi
              JOIN bookings b2 ON b2.id = bsi.booking_id
              WHERE bsi.asset_id = a.id
                AND b2.kind = 'CHECKOUT'
                AND b2.status IN ('OPEN', 'COMPLETED')
            )
        ) AS never_count
    `,
    db.$queryRaw<UtilizationIdleRow[]>`
      ${cte}
      SELECT
        a.id AS asset_id,
        a.asset_tag,
        a.name,
        cat.name AS category,
        a.purchase_price::float8 AS purchase_price,
        (
          SELECT MAX(b2.starts_at)
          FROM booking_serialized_items bsi
          JOIN bookings b2 ON b2.id = bsi.booking_id
          WHERE bsi.asset_id = a.id
            AND b2.kind = 'CHECKOUT'
            AND b2.status IN ('OPEN', 'COMPLETED')
        ) AS last_checked_out_at
      FROM assets a
      LEFT JOIN categories cat ON cat.id = a.category_id
      WHERE a.status <> 'RETIRED'
        AND NOT EXISTS (SELECT 1 FROM custody c WHERE c.asset_id = a.id)
      ORDER BY a.purchase_price DESC NULLS LAST, a.asset_tag ASC
      LIMIT ${UTILIZATION_IDLE_LIST_LIMIT}
    `,
  ]);

  const totals = settledReportValue(
    results[0],
    [],
    "custody totals",
    partialFailures
  )[0];
  const topUsedRows = settledReportValue(
    results[1],
    [],
    "most-used gear",
    partialFailures
  );
  const idleTotals = settledReportValue(
    results[2],
    [],
    "idle gear totals",
    partialFailures
  )[0];
  const idleRows = settledReportValue(
    results[3],
    [],
    "idle gear list",
    partialFailures
  );

  const custodyDays = toNumber(totals?.custody_days);
  const availableAssetDays = activeAssets * days;

  return {
    assetsUsed: totals?.assets_used ?? 0,
    checkoutCount: totals?.checkout_count ?? 0,
    custodyDays,
    idleAssets: idleRows.map((row) => ({
      assetId: row.asset_id,
      assetTag: row.asset_tag,
      category: row.category ?? "",
      lastCheckedOutAt: row.last_checked_out_at ? row.last_checked_out_at.toISOString() : null,
      name: row.name ?? "",
      purchasePrice: row.purchase_price === null ? null : toNumber(row.purchase_price),
    })),
    idleCount: idleTotals?.idle_count ?? 0,
    // Purchase price is sparsely recorded, so the value total is only as
    // complete as `idlePricedCount` says it is.
    idlePricedCount: idleTotals?.idle_priced_count ?? 0,
    idleValue: toNumber(idleTotals?.idle_value),
    neverCheckedOutCount: idleTotals?.never_count ?? 0,
    topUsed: topUsedRows.map((row) => ({
      assetId: row.asset_id,
      assetTag: row.asset_tag,
      checkouts: row.checkouts,
      custodyDays: toNumber(row.custody_days),
      name: row.name ?? "",
      // Share of the window this one asset spent in someone's hands.
      utilizationRate: days > 0 ? Math.min(toNumber(row.custody_days) / days, 1) : 0,
    })),
    partialFailures,
    // Share of all available asset-days actually spent in custody.
    utilizationRate: availableAssetDays > 0 ? custodyDays / availableAssetDays : 0,
  };
}

export async function getUtilizationReport(days: number = UTILIZATION_REPORT_DEFAULT_PERIOD) {
  const partialFailures: string[] = [];
  const results = await Promise.allSettled([
    countAssetsByEffectiveStatus(),
    db.asset.count(),
    db.asset.groupBy({ by: ["locationId"], _count: true }),
    db.asset.groupBy({ by: ["type"], _count: true, orderBy: { _count: { type: "desc" } } }),
    db.asset.groupBy({ by: ["departmentId"], _count: true }),
    db.asset.groupBy({ by: ["categoryId"], _count: true }),
    db.asset.count({ where: { status: { not: "RETIRED" } } }),
  ]);

  const statusCounts = settledReportValue(
    results[0],
    EMPTY_EFFECTIVE_STATUS_COUNTS,
    "status counts",
    partialFailures
  );
  const totalAssets = settledReportValue(results[1], 0, "asset total", partialFailures);
  const byLocation = settledReportValue(results[2], [], "location breakdown", partialFailures);
  const byType = settledReportValue(results[3], [], "type breakdown", partialFailures);
  const byDepartment = settledReportValue(results[4], [], "department breakdown", partialFailures);
  const byCategory = settledReportValue(results[5], [], "category breakdown", partialFailures);
  const activeAssets = settledReportValue(results[6], 0, "active asset count", partialFailures);

  const locationIds = byLocation.map((g) => g.locationId);
  const deptIds = byDepartment
    .map((g) => g.departmentId)
    .filter((id): id is string => id !== null);
  const categoryIds = byCategory
    .map((g) => g.categoryId)
    .filter((id): id is string => id !== null);

  const [metadataResults, custody] = await Promise.all([
    Promise.allSettled([
      locationIds.length > 0
        ? db.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      deptIds.length > 0
        ? db.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      categoryIds.length > 0
        ? db.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]),
    getUtilizationCustodyMetrics(days, activeAssets),
  ]);

  const locations = settledReportValue(metadataResults[0], [], "location names", partialFailures);
  const departments = settledReportValue(metadataResults[1], [], "department names", partialFailures);
  const categories = settledReportValue(metadataResults[2], [], "category names", partialFailures);
  const { partialFailures: custodyFailures, ...custodyData } = custody;
  partialFailures.push(...custodyFailures);

  const locMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const deptMap = Object.fromEntries(departments.map((d) => [d.id, d.name]));
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  return {
    activeAssets,
    custody: custodyData,
    days,
    partialFailures,
    totalAssets,
    statusCounts,
    byLocation: byLocation.map((g) => ({
      location: locMap[g.locationId] || "Unknown",
      locationId: g.locationId,
      count: g._count
    })),
    byType: byType.map((g) => ({ type: g.type, count: g._count })),
    byCategory: byCategory
      .filter((g) => g.categoryId)
      .map((g) => ({
        category: categoryMap[g.categoryId!] || "Unknown",
        categoryId: g.categoryId!,
        count: g._count
      })),
    byDepartment: byDepartment
      .filter((g) => g.departmentId)
      .map((g) => ({
        department: deptMap[g.departmentId!] || "Unknown",
        departmentId: g.departmentId!,
        count: g._count
      }))
  };
}

const utilizationReportExportAssetSelect = {
  id: true,
  assetTag: true,
  name: true,
  type: true,
  brand: true,
  model: true,
  status: true,
  availableForReservation: true,
  availableForCheckout: true,
  availableForCustody: true,
  updatedAt: true,
  location: { select: { name: true } },
  department: { select: { name: true } },
  category: { select: { name: true } },
} satisfies Prisma.AssetSelect;

type UtilizationReportExportAsset = Prisma.AssetGetPayload<{
  select: typeof utilizationReportExportAssetSelect;
}>;

export type UtilizationExportCustodyStat = {
  checkouts: number;
  custodyDays: number;
  lastCheckedOutAt: string;
  utilizationRate: number;
};

function mapUtilizationReportExportAsset(
  asset: UtilizationReportExportAsset,
  computedStatus: string,
  custody: UtilizationExportCustodyStat | undefined,
) {
  return {
    assetTag: asset.assetTag,
    name: asset.name ?? "",
    type: asset.type,
    brand: asset.brand,
    model: asset.model,
    computedStatus,
    storedStatus: asset.status,
    location: asset.location.name,
    department: asset.department?.name ?? "",
    category: asset.category?.name ?? "",
    availableForReservation: asset.availableForReservation,
    availableForCheckout: asset.availableForCheckout,
    availableForCustody: asset.availableForCustody,
    periodCheckouts: custody?.checkouts ?? 0,
    periodCustodyDays: custody ? custody.custodyDays.toFixed(2) : "0.00",
    periodUtilizationRate: custody ? `${(custody.utilizationRate * 100).toFixed(1)}%` : "0.0%",
    lastCheckedOutAt: custody?.lastCheckedOutAt ?? "",
    updatedAt: asset.updatedAt.toISOString(),
  };
}

type UtilizationExportCustodyRow = {
  asset_id: string;
  checkouts: number;
  custody_days: number | null;
  last_checked_out_at: Date | null;
};

/** Per-asset custody stats for the window, keyed by asset id. */
async function getUtilizationExportCustodyStats(days: number) {
  const rows = await db.$queryRaw<UtilizationExportCustodyRow[]>`
    ${utilizationCustodyCte(days)},
    stats AS (
      SELECT
        c.asset_id,
        COUNT(*)::int AS checkouts,
        SUM(GREATEST(EXTRACT(EPOCH FROM (c.c_end - c.c_start)) / 86400.0, 0))::float8 AS custody_days
      FROM custody c
      GROUP BY c.asset_id
    )
    SELECT
      s.asset_id,
      s.checkouts,
      s.custody_days,
      (
        SELECT MAX(b2.starts_at)
        FROM booking_serialized_items bsi
        JOIN bookings b2 ON b2.id = bsi.booking_id
        WHERE bsi.asset_id = s.asset_id
          AND b2.kind = 'CHECKOUT'
          AND b2.status IN ('OPEN', 'COMPLETED')
      ) AS last_checked_out_at
    FROM stats s
  `;

  return new Map<string, UtilizationExportCustodyStat>(
    rows.map((row) => {
      const custodyDays = toNumber(row.custody_days);
      return [
        row.asset_id,
        {
          checkouts: row.checkouts,
          custodyDays,
          lastCheckedOutAt: row.last_checked_out_at ? row.last_checked_out_at.toISOString() : "",
          utilizationRate: days > 0 ? Math.min(custodyDays / days, 1) : 0,
        },
      ];
    }),
  );
}

export async function getUtilizationReportExport(
  days: number = UTILIZATION_REPORT_DEFAULT_PERIOD,
) {
  const [assets, total, custodyStats] = await Promise.all([
    db.asset.findMany({
      orderBy: { assetTag: "asc" },
      take: UTILIZATION_REPORT_EXPORT_LIMIT,
      select: utilizationReportExportAssetSelect,
    }),
    db.asset.count(),
    getUtilizationExportCustodyStats(days).catch(() => new Map<string, UtilizationExportCustodyStat>()),
  ]);
  const statusMap = await deriveAssetStatusesFromLoaded(assets);

  return {
    data: assets.map((asset) =>
      mapUtilizationReportExportAsset(
        asset,
        statusMap.get(asset.id) ?? "AVAILABLE",
        custodyStats.get(asset.id),
      ),
    ),
    days,
    total,
    truncated: total > UTILIZATION_REPORT_EXPORT_LIMIT,
    limit: UTILIZATION_REPORT_EXPORT_LIMIT,
  };
}

/** `YYYY-MM-DD`, interpreted as a UTC day to match the daily aggregates. */
export function parseCheckoutFocusDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function checkoutFocusDateRange(focusDate: string) {
  // The clicked heatmap cell is an app-timezone calendar day, so its row list
  // must span Central midnight to Central midnight. A UTC window instead starts
  // the day at 7pm the evening before.
  return appTzDayRange(focusDate);
}

export async function getCheckoutReport(days: number, focusDate?: string | null) {
  const partialFailures: string[] = [];
  const since = checkoutReportSince(days);
  const now = new Date();
  const heatmapSince = new Date(Date.now() - 365 * 86_400_000);
  const checkoutActivityWhere = buildCheckoutReportWhere(days);
  // A focused day narrows only the row list; metrics and charts stay on the
  // selected period so the day keeps its context.
  const recentWhere = focusDate
    ? {
        kind: "CHECKOUT" as const,
        status: { in: [...CHECKOUT_CUSTODY_REPORT_STATUSES] },
        createdAt: checkoutFocusDateRange(focusDate),
      }
    : checkoutActivityWhere;

  const checkoutResults = await Promise.allSettled([
    db.booking.count({
      where: checkoutActivityWhere
    }),
    db.booking.count({
      where: {
        kind: "CHECKOUT",
        status: "OPEN",
        endsAt: { lt: now }
      }
    }),
    db.booking.findMany({
      where: recentWhere,
      orderBy: { createdAt: "desc" },
      take: focusDate ? 50 : 20,
      include: checkoutReportInclude,
    }),
    db.booking.groupBy({
      by: ["requesterUserId"],
      where: checkoutActivityWhere,
      _count: true,
      orderBy: { _count: { requesterUserId: "desc" } },
      take: 10
    }),
    // Single 365-day daily aggregation (period series is sliced in JS).
    // Using date_trunc keeps the work in Postgres regardless of row count.
    db.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT to_char(date_trunc('day', "created_at" AT TIME ZONE 'UTC' AT TIME ZONE ${env.appTimezone}::text), 'YYYY-MM-DD') AS date,
             COUNT(*)::bigint AS count
      FROM bookings
      WHERE kind = 'CHECKOUT'
        AND "status" IN ('OPEN', 'COMPLETED')
        AND "created_at" >= ${heatmapSince}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const totalCheckouts = settledReportValue(checkoutResults[0], 0, "checkout total", partialFailures);
  const overdueCheckouts = settledReportValue(checkoutResults[1], 0, "overdue total", partialFailures);
  const recentCheckouts = settledReportValue(checkoutResults[2], [], "recent checkouts", partialFailures);
  const topRequesters = settledReportValue(checkoutResults[3], [], "top requesters", partialFailures);
  const heatmapRaw = settledReportValue(checkoutResults[4], [], "checkout activity", partialFailures);

  const requesterIds = topRequesters.map((r) => r.requesterUserId);
  const userResults = await Promise.allSettled([
    requesterIds.length > 0
      ? db.user.findMany({
          where: { id: { in: requesterIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
  ]);
  const users = settledReportValue(userResults[0], [], "requester names", partialFailures);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  // Build day → count map from the 365-day aggregate, then derive both series.
  const dayMap = new Map<string, number>();
  for (const row of heatmapRaw) dayMap.set(row.date, Number(row.count));

  // Day keys are app-timezone calendar days on both sides -- the SQL buckets
  // and this cursor must agree, or the trend line reads one day off the cells.
  const sinceKey = appTzDateKey(since);
  const dailyTrend: { date: string; count: number }[] = [];
  const cursor = new Date(since);
  while (cursor <= now) {
    const key = appTzDateKey(cursor);
    if (key >= sinceKey) {
      dailyTrend.push({ date: key, count: dayMap.get(key) ?? 0 });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const heatmap = Array.from(dayMap.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // The 365-day aggregate already covers the window before this one, so the
  // comparison costs no extra query for any supported period.
  const previousSince = checkoutReportSince(days * 2);
  const previousSinceKey = appTzDateKey(previousSince);
  let previousTotalCheckouts = 0;
  for (const [date, count] of dayMap) {
    if (date >= previousSinceKey && date < sinceKey) previousTotalCheckouts += count;
  }

  return {
    days,
    focusDate: focusDate ?? null,
    totalCheckouts,
    previousTotalCheckouts,
    overdueCheckouts,
    partialFailures,
    dailyTrend,
    heatmap,
    recentCheckouts: recentCheckouts.map((checkout) => mapCheckoutReportEntry(checkout, now)),
    topRequesters: topRequesters.map((r) => ({
      name: userMap[r.requesterUserId] || "Unknown",
      count: r._count
    }))
  };
}

function checkoutReportSince(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

function buildCheckoutReportWhere(days: number): Prisma.BookingWhereInput {
  return {
    kind: "CHECKOUT",
    status: { in: [...CHECKOUT_CUSTODY_REPORT_STATUSES] },
    createdAt: { gte: checkoutReportSince(days) },
  };
}

const checkoutReportInclude = {
  requester: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  _count: { select: { serializedItems: true, bulkItems: true } },
} satisfies Prisma.BookingInclude;

function mapCheckoutReportEntry(checkout: Prisma.BookingGetPayload<{
  include: typeof checkoutReportInclude;
}>, now: Date) {
  return {
    id: checkout.id,
    title: checkout.title,
    status: checkout.status,
    startsAt: checkout.startsAt,
    endsAt: checkout.endsAt,
    createdAt: checkout.createdAt,
    requester: checkout.requester.name,
    location: checkout.location.name,
    itemCount: checkout._count.serializedItems + checkout._count.bulkItems,
    isOverdue: checkout.status === "OPEN" && checkout.endsAt < now,
  };
}

export async function getCheckoutReportExport(days: number) {
  const where = buildCheckoutReportWhere(days);
  const now = new Date();
  const [data, total] = await Promise.all([
    db.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: CHECKOUT_REPORT_EXPORT_LIMIT,
      include: checkoutReportInclude,
    }),
    db.booking.count({ where }),
  ]);

  return {
    data: data.map((checkout) => mapCheckoutReportEntry(checkout, now)),
    total,
    truncated: total > CHECKOUT_REPORT_EXPORT_LIMIT,
    limit: CHECKOUT_REPORT_EXPORT_LIMIT,
  };
}

export async function getOverdueReport(locationId?: string | null) {
  const now = new Date();

  const [overdueBookings, locations] = await Promise.all([
    db.booking.findMany({
      where: buildOverdueReportWhere(now, locationId),
      include: overdueReportInclude,
      orderBy: { endsAt: "asc" },
    }),
    // Options come from bookings that are actually overdue, so the filter
    // never offers a choice that yields an empty report.
    db.booking.findMany({
      where: buildOverdueReportWhere(now),
      distinct: ["locationId"],
      select: { location: { select: { id: true, name: true } } },
      orderBy: { locationId: "asc" },
    }),
  ]);

  const byRequester = new Map<
    string,
    {
      userId: string;
      name: string;
      overdueCount: number;
      totalOverdueHours: number;
      bookings: {
        id: string;
        title: string;
        endsAt: string;
        overdueHours: number;
        location: string;
        itemCount: number;
        items: string[];
      }[];
    }
  >();

  for (const b of overdueBookings) {
    const existing = byRequester.get(b.requester.id);
    const booking = mapOverdueReportBooking(b, now, 5);

    if (existing) {
      existing.overdueCount++;
      existing.totalOverdueHours += booking.overdueHours;
      existing.bookings.push(booking);
    } else {
      byRequester.set(b.requester.id, {
        userId: b.requester.id,
        name: b.requester.name,
        overdueCount: 1,
        totalOverdueHours: booking.overdueHours,
        bookings: [booking],
      });
    }
  }

  const leaderboard = Array.from(byRequester.values()).sort(
    (a, b) => b.totalOverdueHours - a.totalOverdueHours
  );

  return {
    totalOverdueBookings: overdueBookings.length,
    leaderboard,
    locationId: locationId ?? null,
    locationOptions: locations
      .map((row) => ({ id: row.location.id, name: row.location.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function buildOverdueReportWhere(now: Date, locationId?: string | null): Prisma.BookingWhereInput {
  return {
    kind: "CHECKOUT",
    status: "OPEN",
    endsAt: { lt: now },
    ...(locationId ? { locationId } : {}),
  };
}

const overdueReportInclude = {
  requester: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  serializedItems: {
    where: { allocationStatus: "active" },
    include: { asset: { select: { id: true, assetTag: true, name: true } } },
  },
  bulkItems: {
    include: { bulkSku: { select: { id: true, name: true } } },
  },
} satisfies Prisma.BookingInclude;

type OverdueReportBooking = Prisma.BookingGetPayload<{
  include: typeof overdueReportInclude;
}>;

function getOverdueOutstandingItems(booking: OverdueReportBooking) {
  const items: string[] = [];
  for (const si of booking.serializedItems) {
    items.push(si.asset.assetTag || si.asset.name || "Unknown item");
  }

  let itemCount = booking.serializedItems.length;
  for (const bi of booking.bulkItems) {
    const checkedOutQuantity = bi.checkedOutQuantity > 0
      ? bi.checkedOutQuantity
      : bi.plannedQuantity;
    const outstandingQuantity = Math.max(0, checkedOutQuantity - bi.checkedInQuantity);
    if (outstandingQuantity > 0) {
      itemCount += outstandingQuantity;
      items.push(`${bi.bulkSku.name} x${outstandingQuantity}`);
    }
  }

  return { itemCount, items };
}

function mapOverdueReportBooking(
  booking: OverdueReportBooking,
  now: Date,
  itemLimit?: number,
) {
  const hours = Math.round((now.getTime() - booking.endsAt.getTime()) / 3_600_000);
  const outstanding = getOverdueOutstandingItems(booking);

  return {
    id: booking.id,
    title: booking.title,
    endsAt: booking.endsAt.toISOString(),
    overdueHours: hours,
    location: booking.location.name,
    itemCount: outstanding.itemCount,
    items: typeof itemLimit === "number" ? outstanding.items.slice(0, itemLimit) : outstanding.items,
  };
}

export async function getOverdueReportExport(locationId?: string | null) {
  const now = new Date();
  const where = buildOverdueReportWhere(now, locationId);
  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: overdueReportInclude,
      orderBy: { endsAt: "asc" },
      take: OVERDUE_REPORT_EXPORT_LIMIT,
    }),
    db.booking.count({ where }),
  ]);

  return {
    data: bookings.map((booking) => {
      const row = mapOverdueReportBooking(booking, now);
      return {
        bookingId: booking.id,
        requester: booking.requester.name,
        title: row.title,
        endsAt: row.endsAt,
        overdueHours: row.overdueHours,
        location: row.location,
        itemCount: row.itemCount,
        itemSummary: row.items.join("; "),
      };
    }),
    total,
    truncated: total > OVERDUE_REPORT_EXPORT_LIMIT,
    limit: OVERDUE_REPORT_EXPORT_LIMIT,
  };
}

export async function getScanHistoryReport(
  limit: number,
  offset: number,
  startDate?: string | null,
  endDate?: string | null,
  phase?: string | null,
) {
  const where = buildScanHistoryWhere({ startDate, endDate, phase });
  const whereSql = buildScanHistoryWhereSql({ startDate, endDate, phase });

  const scanResults = await Promise.allSettled([
    db.scanEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: scanReportInclude,
    }),
    db.scanEvent.count({ where }),
    db.scanEvent.count({ where: { ...where, success: true } }),
    db.$queryRaw<{ date: string; success: bigint; fail: bigint }[]>`
      SELECT to_char(date_trunc('day', "created_at" AT TIME ZONE 'UTC' AT TIME ZONE ${env.appTimezone}::text), 'YYYY-MM-DD') AS date,
             COUNT(*) FILTER (WHERE success = true)::bigint AS success,
             COUNT(*) FILTER (WHERE success = false)::bigint AS fail
      FROM scan_events
      ${whereSql}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const data = scanResults[0].status === "fulfilled" ? scanResults[0].value : [];
  const total = scanResults[1].status === "fulfilled" ? scanResults[1].value : 0;
  const successCount = scanResults[2].status === "fulfilled" ? scanResults[2].value : 0;
  const dailyRaw = scanResults[3].status === "fulfilled" ? scanResults[3].value : [];

  const dailyScans = dailyRaw.map((r) => ({
    date: r.date,
    success: Number(r.success),
    fail: Number(r.fail),
  }));

  const previous = await getScanHistoryPreviousWindow({ endDate, phase, startDate });

  return {
    data: data.map(mapScanReportEntry),
    total,
    previousTotal: previous?.total ?? null,
    previousSuccessRate: previous?.successRate ?? null,
    successCount,
    successRate: total > 0 ? Math.round((successCount / total) * 100) : 100,
    dailyScans,
    limit,
    offset,
  };
}

/**
 * Counts for the window immediately preceding the requested one, so the report
 * can say whether scan health is improving. Returns null for an unbounded
 * range, which has no prior window to compare against.
 */
async function getScanHistoryPreviousWindow({
  endDate,
  phase,
  startDate,
}: ScanHistoryFilters) {
  if (!startDate) return null;

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const span = end.getTime() - start.getTime();
  if (!Number.isFinite(span) || span <= 0) return null;

  const previousWhere = buildScanHistoryWhere({
    endDate: new Date(start.getTime() - 1).toISOString(),
    phase,
    startDate: new Date(start.getTime() - span).toISOString(),
  });

  const results = await Promise.allSettled([
    db.scanEvent.count({ where: previousWhere }),
    db.scanEvent.count({ where: { ...previousWhere, success: true } }),
  ]);

  if (results[0].status !== "fulfilled") return null;
  const total = results[0].value;
  const success = results[1].status === "fulfilled" ? results[1].value : 0;

  return {
    successRate: total > 0 ? Math.round((success / total) * 100) : null,
    total,
  };
}

type ScanHistoryFilters = {
  startDate?: string | null;
  endDate?: string | null;
  phase?: string | null;
};

const scanReportInclude = {
  actor: { select: { id: true, name: true, avatarUrl: true } },
  asset: { select: { id: true, assetTag: true, name: true } },
  bulkSku: { select: { id: true, name: true } },
  booking: { select: { id: true, title: true } },
} satisfies Prisma.ScanEventInclude;

function buildScanHistoryWhere({
  endDate,
  phase,
  startDate,
}: ScanHistoryFilters) {
  const where: Prisma.ScanEventWhereInput = {};
  const dateFilter: Prisma.DateTimeFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);
  if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
  if (phase === "CHECKOUT" || phase === "CHECKIN") where.phase = phase;

  return where;
}

function buildScanHistoryWhereSql({
  endDate,
  phase,
  startDate,
}: ScanHistoryFilters) {
  // Build SQL fragments mirroring the Prisma where for the raw aggregation.
  const conditions: Prisma.Sql[] = [];
  if (startDate) conditions.push(Prisma.sql`"created_at" >= ${new Date(startDate)}`);
  if (endDate) conditions.push(Prisma.sql`"created_at" <= ${new Date(endDate)}`);
  if (phase === "CHECKOUT" || phase === "CHECKIN") {
    conditions.push(Prisma.sql`phase::text = ${phase}`);
  }
  const whereSql = conditions.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;

  return whereSql;
}

function mapScanReportEntry(scan: Prisma.ScanEventGetPayload<{
  include: typeof scanReportInclude;
}>) {
  return {
    id: scan.id,
    actor: scan.actor.name,
    scanType: scan.scanType,
    scanValue: scan.scanValue,
    success: scan.success,
    phase: scan.phase,
    item: scan.asset
      ? scan.asset.assetTag || scan.asset.name
      : scan.bulkSku
        ? scan.bulkSku.name
        : scan.scanValue,
    bookingId: scan.booking.id,
    bookingTitle: scan.booking.title,
    createdAt: scan.createdAt,
  };
}

export async function getScanHistoryReportExport(
  startDate?: string | null,
  endDate?: string | null,
  phase?: string | null,
) {
  const where = buildScanHistoryWhere({ startDate, endDate, phase });
  const [data, total] = await Promise.all([
    db.scanEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: SCAN_REPORT_EXPORT_LIMIT,
      include: scanReportInclude,
    }),
    db.scanEvent.count({ where }),
  ]);

  return {
    data: data.map(mapScanReportEntry),
    total,
    truncated: total > SCAN_REPORT_EXPORT_LIMIT,
    limit: SCAN_REPORT_EXPORT_LIMIT,
  };
}

type AuditReportFilters = {
  startDate?: string | null,
  endDate?: string | null,
  action?: string | null,
};

function buildAuditReportWhere({
  action,
  endDate,
  startDate,
}: AuditReportFilters) {
  const where: Prisma.AuditLogWhereInput = {};
  const dateFilter: Prisma.DateTimeFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);
  if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
  if (action) where.action = action;

  return where;
}

function mapAuditReportEntry(entry: Prisma.AuditLogGetPayload<{
  include: { actor: { select: { id: true; name: true; avatarUrl: true } } };
}>) {
  return {
    id: entry.id,
    actor: entry.actor?.name || "System",
    actorId: entry.actor?.id ?? null,
    actorAvatarUrl: entry.actor?.avatarUrl ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    createdAt: entry.createdAt,
    beforeJson: entry.beforeJson,
    afterJson: entry.afterJson,
  };
}

export async function getAuditReport(
  limit: number,
  offset: number,
  startDate?: string | null,
  endDate?: string | null,
  action?: string | null,
) {
  const where = buildAuditReportWhere({ startDate, endDate, action });

  const auditResults = await Promise.allSettled([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        actor: { select: { id: true, name: true, avatarUrl: true } }
      }
    }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({
      by: ["action"],
      where,
      _count: true,
      orderBy: { _count: { action: "desc" } },
      take: 15,
    }),
    db.auditLog.groupBy({
      by: ["entityType"],
      where,
      _count: true,
      orderBy: { _count: { entityType: "desc" } },
      take: 10,
    }),
  ]);

  const data = auditResults[0].status === "fulfilled" ? auditResults[0].value : [];
  const total = auditResults[1].status === "fulfilled" ? auditResults[1].value : 0;
  const byAction = auditResults[2].status === "fulfilled"
    ? auditResults[2].value.map((g) => ({ action: g.action, count: g._count }))
    : [];
  const byEntityType = auditResults[3].status === "fulfilled"
    ? auditResults[3].value.map((g) => ({ entityType: g.entityType, count: g._count }))
    : [];

  const previousTotal = await getAuditReportPreviousTotal({ action, endDate, startDate });

  return {
    data: data.map(mapAuditReportEntry),
    total,
    previousTotal,
    byAction,
    byEntityType,
    limit,
    offset
  };
}

/** Event count for the window before this one; null for an unbounded range. */
async function getAuditReportPreviousTotal({
  action,
  endDate,
  startDate,
}: {
  action?: string | null;
  endDate?: string | null;
  startDate?: string | null;
}) {
  if (!startDate) return null;

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const span = end.getTime() - start.getTime();
  if (!Number.isFinite(span) || span <= 0) return null;

  const result = await Promise.allSettled([
    db.auditLog.count({
      where: buildAuditReportWhere({
        action,
        endDate: new Date(start.getTime() - 1).toISOString(),
        startDate: new Date(start.getTime() - span).toISOString(),
      }),
    }),
  ]);

  return result[0].status === "fulfilled" ? result[0].value : null;
}

export async function getAuditReportExport(
  startDate?: string | null,
  endDate?: string | null,
  action?: string | null,
) {
  const where = buildAuditReportWhere({ startDate, endDate, action });
  const [data, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: AUDIT_REPORT_EXPORT_LIMIT,
      include: {
        actor: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    data: data.map(mapAuditReportEntry),
    total,
    truncated: total > AUDIT_REPORT_EXPORT_LIMIT,
    limit: AUDIT_REPORT_EXPORT_LIMIT,
  };
}

/**
 * Bulk loss report: lost units grouped by SKU and by last requester.
 */
function daysBetween(start: Date | null | undefined, end: Date | null | undefined) {
  if (!start || !end) return null;
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

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
          lastBookingTitle: booking?.title ?? null,
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
        bookingTitle: booking.title,
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

export type BulkLossReportFilters = {
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

export const BADGE_REPORT_PERIODS = [30, 90, 365] as const;
export const BADGE_REPORT_DEFAULT_PERIOD = 30;

export function parseBadgeReportPeriod(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return BADGE_REPORT_PERIODS.includes(parsed as (typeof BADGE_REPORT_PERIODS)[number])
    ? parsed
    : BADGE_REPORT_DEFAULT_PERIOD;
}

export async function getBadgeReport(days: number = BADGE_REPORT_DEFAULT_PERIOD) {
  const since = new Date(Date.now() - days * 86_400_000);
  const previousSince = new Date(Date.now() - days * 2 * 86_400_000);

  const [
    totalAwards,
    manualAwards,
    recentAwardCount,
    previousRecentAwardCount,
    activeDefinitions,
    leaderboard,
    distribution,
    recentAwards,
  ] = await Promise.all([
    db.studentBadge.count(),
    db.studentBadge.count({ where: { source: "MANUAL" } }),
    db.studentBadge.count({ where: { awardedAt: { gte: since } } }),
    db.studentBadge.count({ where: { awardedAt: { gte: previousSince, lt: since } } }),
    db.badgeDefinition.findMany({
      where: { active: true },
      select: { id: true, key: true, name: true, category: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.studentBadge.groupBy({
      by: ["userId"],
      _count: true,
      orderBy: { _count: { userId: "desc" } },
      take: 10,
    }),
    db.studentBadge.groupBy({
      by: ["definitionId"],
      _count: true,
      orderBy: { _count: { definitionId: "desc" } },
      take: 12,
    }),
    db.studentBadge.findMany({
      orderBy: { awardedAt: "desc" },
      take: 20,
      include: {
        user: { select: { id: true, name: true, email: true } },
        definition: {
          select: {
            id: true,
            key: true,
            name: true,
            category: true,
            icon: true,
            active: true,
          },
        },
        awardedBy: { select: { id: true, name: true } },
      },
    }),
  ]);

  const userIds = leaderboard.map((row) => row.userId);
  const definitionIds = distribution.map((row) => row.definitionId);
  const [users, definitions] = await Promise.all([
    userIds.length > 0
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [],
    definitionIds.length > 0
      ? db.badgeDefinition.findMany({
          where: { id: { in: definitionIds } },
          select: { id: true, key: true, name: true, category: true, active: true },
        })
      : [],
  ]);
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const definitionMap = Object.fromEntries(definitions.map((definition) => [definition.id, definition]));
  const distributionCountMap = new Map(distribution.map((row) => [row.definitionId, row._count]));
  const underusedDefinitions = activeDefinitions
    .map((definition) => ({
      definitionId: definition.id,
      key: definition.key,
      name: definition.name,
      category: definition.category,
      count: distributionCountMap.get(definition.id) ?? 0,
    }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name))
    .slice(0, 8);

  return {
    totalAwards,
    manualAwards,
    automaticAwards: totalAwards - manualAwards,
    manualAwardRate: totalAwards > 0 ? manualAwards / totalAwards : 0,
    days,
    recentAwardCount,
    previousRecentAwardCount,
    activeDefinitionCount: activeDefinitions.length,
    leaderboard: leaderboard.map((row) => {
      const user = userMap[row.userId];
      return {
        userId: row.userId,
        name: user?.name ?? "Unknown user",
        email: user?.email ?? null,
        count: row._count,
      };
    }),
    distribution: distribution.map((row) => {
      const definition = definitionMap[row.definitionId];
      return {
        definitionId: row.definitionId,
        key: definition?.key ?? "unknown",
        name: definition?.name ?? "Unknown badge",
        category: definition?.category ?? "MILESTONE",
        active: definition?.active ?? false,
        count: row._count,
      };
    }),
    recentAwards: recentAwards.map((award) => ({
      id: award.id,
      awardedAt: award.awardedAt.toISOString(),
      source: award.source,
      note: award.note,
      user: award.user,
      definition: award.definition,
      awardedBy: award.awardedBy,
    })),
    underusedDefinitions,
  };
}
