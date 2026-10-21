import { AssetStatus, CheckinReportType, Prisma, ReportResolution, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { displayBookingTitle } from "@/lib/booking-display-title";

/** Outcomes staff can pick, by what was reported. */
export const RESOLUTIONS_BY_TYPE: Record<CheckinReportType, ReportResolution[]> = {
  DAMAGED: ["REPAIRED", "REPLACED", "WRITTEN_OFF", "NO_ISSUE"],
  LOST: ["FOUND", "REPLACED", "WRITTEN_OFF"],
};

/** Outcomes that take the item out of service for good. */
const RETIRING: ReportResolution[] = ["REPLACED", "WRITTEN_OFF"];

export const RESOLUTION_LABELS: Record<ReportResolution, string> = {
  REPAIRED: "Repaired",
  REPLACED: "Replaced",
  WRITTEN_OFF: "Written off",
  FOUND: "Found",
  NO_ISSUE: "No issue found",
};

const caseSelect = {
  id: true,
  type: true,
  description: true,
  imageUrl: true,
  createdAt: true,
  lastReportedAt: true,
  resolution: true,
  resolvedAt: true,
  resolutionNote: true,
  asset: { select: { id: true, assetTag: true, name: true, brand: true, model: true, status: true, imageUrl: true } },
  booking: { select: { id: true, title: true, requester: { select: { id: true, name: true } } } },
  reportedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
} satisfies Prisma.CheckinItemReportSelect;

type CaseRow = Prisma.CheckinItemReportGetPayload<{ select: typeof caseSelect }>;

export type DamageCase = {
  id: string;
  type: CheckinReportType;
  description: string | null;
  imageUrl: string | null;
  reportedAt: string;
  asset: { id: string; assetTag: string; name: string | null; brand: string; model: string; imageUrl: string | null; status: AssetStatus };
  booking: { id: string; title: string };
  /** The borrower on the checkout, who had the item when it was reported. */
  responsible: { id: string; name: string };
  reportedBy: string;
  /** A missing item that is still listed as available can be booked again. */
  stillBookable: boolean;
  resolution: ReportResolution | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  allowedResolutions: ReportResolution[];
};

function toCase(row: CaseRow): DamageCase | null {
  if (!row.asset) return null;
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    imageUrl: row.imageUrl,
    reportedAt: row.lastReportedAt.toISOString(),
    asset: row.asset,
    booking: { id: row.booking.id, title: displayBookingTitle(row.booking.title) },
    responsible: row.booking.requester,
    reportedBy: row.reportedBy.name,
    stillBookable: row.type === "LOST" && !row.resolution && row.asset.status === "AVAILABLE",
    resolution: row.resolution,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy?.name ?? null,
    resolutionNote: row.resolutionNote,
    allowedResolutions: RESOLUTIONS_BY_TYPE[row.type],
  };
}

export async function listDamageCases(view: "open" | "closed") {
  const where: Prisma.CheckinItemReportWhereInput = {
    assetId: { not: null },
    resolution: view === "open" ? null : { not: null },
  };
  const [rows, openCount, missingCount, closedCount] = await Promise.all([
    db.checkinItemReport.findMany({
      where,
      orderBy: view === "open" ? { lastReportedAt: "desc" } : { resolvedAt: "desc" },
      take: 200,
      select: caseSelect,
    }),
    db.checkinItemReport.count({ where: { assetId: { not: null }, resolution: null } }),
    db.checkinItemReport.count({ where: { assetId: { not: null }, resolution: null, type: "LOST" } }),
    db.checkinItemReport.count({ where: { assetId: { not: null }, resolution: { not: null } } }),
  ]);
  return {
    counts: { open: openCount, missing: missingCount, closed: closedCount },
    cases: rows.map(toCase).filter((c): c is DamageCase => c !== null),
  };
}

/** Open serialized cases, for the sidebar badge. */
export function countOpenDamageCases() {
  return db.checkinItemReport.count({ where: { assetId: { not: null }, resolution: null } });
}

export async function resolveDamageCase(args: {
  reportId: string;
  resolution: ReportResolution;
  note?: string;
  actor: { id: string; role: Role };
}) {
  const note = args.note?.trim() || null;
  return db.$transaction(
    async (tx) => {
      const report = await tx.checkinItemReport.findUnique({
        where: { id: args.reportId },
        select: { id: true, assetId: true, type: true, resolution: true, bookingId: true },
      });
      if (!report || !report.assetId) throw new HttpError(404, "Report not found");
      if (report.resolution) throw new HttpError(409, "This case was already closed. Refresh to see the outcome.");
      if (!RESOLUTIONS_BY_TYPE[report.type].includes(args.resolution)) {
        throw new HttpError(400, "That outcome doesn't fit this kind of report.");
      }

      const now = new Date();
      // Closing a case closes every other open report on the same item with
      // the same outcome: one repair settles them all.
      const open = await tx.checkinItemReport.findMany({
        where: { assetId: report.assetId, resolution: null },
        select: { id: true },
      });
      const ids = open.map((r) => r.id);
      await tx.checkinItemReport.updateMany({
        where: { id: { in: ids } },
        data: { resolution: args.resolution, resolvedAt: now, resolvedById: args.actor.id, resolutionNote: note },
      });

      const asset = await tx.asset.findUnique({ where: { id: report.assetId }, select: { status: true } });
      let nextStatus = asset?.status;
      if (asset && asset.status !== AssetStatus.RETIRED) {
        nextStatus = RETIRING.includes(args.resolution) ? AssetStatus.RETIRED : AssetStatus.AVAILABLE;
        if (nextStatus !== asset.status) {
          await tx.asset.update({ where: { id: report.assetId }, data: { status: nextStatus } });
        }
      }
      await createAuditEntryTx(tx, {
        actorId: args.actor.id,
        actorRole: args.actor.role,
        entityType: "asset",
        entityId: report.assetId,
        action: `damage_case_${args.resolution.toLowerCase()}`,
        before: { status: asset?.status, reportIds: ids },
        after: { status: nextStatus, reportIds: ids, resolution: args.resolution, note },
      });
      return { reportIds: ids, assetStatus: nextStatus ?? null };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
