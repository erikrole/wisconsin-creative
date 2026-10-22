import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { AUDIT_REPORT_EXPORT_LIMIT, SCAN_REPORT_EXPORT_LIMIT } from "./report-shared";

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
    bookingTitle: displayBookingTitle(scan.booking.title),
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
  entityType?: string | null,
};

function buildAuditReportWhere({
  action,
  endDate,
  entityType,
  startDate,
}: AuditReportFilters) {
  const where: Prisma.AuditLogWhereInput = {};
  const dateFilter: Prisma.DateTimeFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);
  if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;

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
  entityType?: string | null,
) {
  const where = buildAuditReportWhere({ startDate, endDate, action, entityType });

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
  entityType?: string | null,
) {
  const where = buildAuditReportWhere({ startDate, endDate, action, entityType });
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
