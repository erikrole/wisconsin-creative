import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { countAssetsByEffectiveStatus, deriveAssetStatusesFromLoaded } from "@/lib/services/status";
import {
  UTILIZATION_REPORT_EXPORT_LIMIT,
  UTILIZATION_REPORT_PERIODS,
  UTILIZATION_REPORT_DEFAULT_PERIOD,
  UTILIZATION_IDLE_LIST_LIMIT,
  UTILIZATION_TOP_USED_LIMIT,
  EMPTY_EFFECTIVE_STATUS_COUNTS,
  toNumber,
  settledReportValue,
} from "./report-shared";

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

type UtilizationExportCustodyStat = {
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
