import { AssetStatus, CheckinReportType, Prisma, ReportResolution, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { put } from "@vercel/blob";
import { deleteImage, imageExtensionForType, isBlobUrl, publicBlobAuth, validateImage } from "@/lib/blob";
import { deferPush, notifyItemReport } from "@/lib/services/notifications";
import { deriveAssetStatus } from "@/lib/services/status";

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

/** A report targets a serialized asset, a numbered unit, or counted stock. */
const ANY_TARGET: Prisma.CheckinItemReportWhereInput = {
  OR: [{ assetId: { not: null } }, { bulkSkuUnitId: { not: null } }, { bulkSkuId: { not: null } }],
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
  quantity: true,
  asset: { select: { id: true, assetTag: true, name: true, brand: true, model: true, status: true, imageUrl: true } },
  bulkSkuUnit: { select: { id: true, unitNumber: true, status: true, bulkSku: { select: { id: true, name: true, imageUrl: true } } } },
  bulkSku: { select: { id: true, name: true, imageUrl: true } },
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
  /** What the report is about. Serialized items link to their page; batteries and counted stock to their family. */
  item: {
    kind: "asset" | "unit" | "counted";
    id: string;
    /** Title line: the item's name or the family name. */
    label: string;
    /** Tag line: asset tag, unit number, or quantity. */
    tag: string;
    imageUrl: string | null;
    href: string;
    /** Stored status, serialized items only. */
    status: AssetStatus | null;
  };
  /** Null when the report was filed from the item page. */
  booking: { id: string; title: string } | null;
  /** The borrower on the checkout, who had the item when it was reported. */
  responsible: { id: string; name: string } | null;
  reportedBy: string;
  /** A missing item that is still listed as available can be booked again. */
  stillBookable: boolean;
  resolution: ReportResolution | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  allowedResolutions: ReportResolution[];
};

function toItem(row: CaseRow): DamageCase["item"] | null {
  if (row.asset) {
    const a = row.asset;
    return { kind: "asset", id: a.id, label: a.name || `${a.brand} ${a.model}`, tag: a.assetTag, imageUrl: a.imageUrl, href: `/items/${a.id}`, status: a.status };
  }
  if (row.bulkSkuUnit) {
    const u = row.bulkSkuUnit;
    return { kind: "unit", id: u.id, label: u.bulkSku.name, tag: `#${u.unitNumber}`, imageUrl: u.bulkSku.imageUrl, href: `/bulk-inventory/${u.bulkSku.id}`, status: null };
  }
  if (row.bulkSku) {
    const s = row.bulkSku;
    return { kind: "counted", id: s.id, label: s.name, tag: `× ${row.quantity ?? 1}`, imageUrl: s.imageUrl, href: `/bulk-inventory/${s.id}`, status: null };
  }
  return null;
}

function toCase(row: CaseRow): DamageCase | null {
  const item = toItem(row);
  if (!item) return null;
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    imageUrl: row.imageUrl,
    reportedAt: row.lastReportedAt.toISOString(),
    item,
    booking: row.booking ? { id: row.booking.id, title: displayBookingTitle(row.booking.title) } : null,
    responsible: row.booking?.requester ?? null,
    reportedBy: row.reportedBy.name,
    stillBookable: item.kind === "asset" && row.type === "LOST" && !row.resolution && item.status === "AVAILABLE",
    resolution: row.resolution,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy?.name ?? null,
    resolutionNote: row.resolutionNote,
    allowedResolutions: RESOLUTIONS_BY_TYPE[row.type],
  };
}

export async function listDamageCases(view: "open" | "closed") {
  const where: Prisma.CheckinItemReportWhereInput = {
    ...ANY_TARGET,
    resolution: view === "open" ? null : { not: null },
  };
  const [rows, openCount, missingCount, closedCount] = await Promise.all([
    db.checkinItemReport.findMany({
      where,
      orderBy: view === "open" ? { lastReportedAt: "desc" } : { resolvedAt: "desc" },
      take: 200,
      select: caseSelect,
    }),
    db.checkinItemReport.count({ where: { ...ANY_TARGET, resolution: null } }),
    db.checkinItemReport.count({ where: { ...ANY_TARGET, resolution: null, type: "LOST" } }),
    db.checkinItemReport.count({ where: { ...ANY_TARGET, resolution: { not: null } } }),
  ]);
  return {
    counts: { open: openCount, missing: missingCount, closed: closedCount },
    cases: rows.map(toCase).filter((c): c is DamageCase => c !== null),
  };
}

/** Which of these held items are open missing-item cases, so the catalog can say "Missing" instead of "Maintenance". */
export async function missingAssetIds(assetIds: string[]): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();
  const rows = await db.checkinItemReport.findMany({
    where: { assetId: { in: assetIds }, type: "LOST", resolution: null },
    select: { assetId: true },
  });
  return new Set(rows.flatMap((r) => (r.assetId ? [r.assetId] : [])));
}

/** Open cases, for the sidebar badge. */
export function countOpenDamageCases() {
  return db.checkinItemReport.count({ where: { ...ANY_TARGET, resolution: null } });
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
        select: { id: true, assetId: true, bulkSkuUnitId: true, bulkSkuId: true, type: true, resolution: true, bookingId: true },
      });
      if (!report || !(report.assetId || report.bulkSkuUnitId || report.bulkSkuId)) throw new HttpError(404, "Report not found");
      if (report.resolution) throw new HttpError(409, "This case was already closed. Refresh to see the outcome.");
      if (!RESOLUTIONS_BY_TYPE[report.type].includes(args.resolution)) {
        throw new HttpError(400, "That outcome doesn't fit this kind of report.");
      }

      const now = new Date();
      const closeData = { resolution: args.resolution, resolvedAt: now, resolvedById: args.actor.id, resolutionNote: note };

      if (!report.assetId) {
        // Batteries and counted stock: the outcome is recorded on the case only.
        // Unit status and stock balances keep their existing, audited paths
        // (Battery inventory), so closing a case never moves inventory counts.
        const siblings = await tx.checkinItemReport.findMany({
          where: report.bulkSkuUnitId
            ? { bulkSkuUnitId: report.bulkSkuUnitId, resolution: null }
            : { id: report.id },
          select: { id: true },
        });
        const bulkIds = siblings.map((r) => r.id);
        await tx.checkinItemReport.updateMany({ where: { id: { in: bulkIds } }, data: closeData });
        await createAuditEntryTx(tx, {
          actorId: args.actor.id,
          actorRole: args.actor.role,
          entityType: report.bulkSkuUnitId ? "bulk_sku_unit" : "bulk_sku",
          entityId: (report.bulkSkuUnitId ?? report.bulkSkuId)!,
          action: `damage_case_${args.resolution.toLowerCase()}`,
          before: { reportIds: bulkIds },
          after: { reportIds: bulkIds, resolution: args.resolution, note },
        });
        return { reportIds: bulkIds, assetStatus: null };
      }

      // Closing a case closes every other open report on the same item with
      // the same outcome: one repair settles them all.
      const open = await tx.checkinItemReport.findMany({
        where: { assetId: report.assetId, resolution: null },
        select: { id: true },
      });
      const ids = open.map((r) => r.id);
      await tx.checkinItemReport.updateMany({ where: { id: { in: ids } }, data: closeData });

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

/**
 * A report filed from the item page, outside any return: "this is damaged" or
 * "I can't find it". It opens a case on the Damage and loss page. The item is
 * held right away unless it is out or reserved, so a borrower's report never
 * pulls gear out from under a booking; staff see it in the queue either way.
 */
export async function reportAssetProblem(args: {
  assetId: string;
  type: CheckinReportType;
  description?: string;
  file: File | null;
  reporter: { id: string; role: Role; name: string };
}) {
  const description = args.description?.trim() || undefined;
  if (args.type === "DAMAGED" && !description && !args.file) {
    throw new HttpError(400, "Describe the damage or add a photo.");
  }
  const asset = await db.asset.findUnique({
    where: { id: args.assetId },
    select: { id: true, assetTag: true, brand: true, model: true, status: true },
  });
  if (!asset) throw new HttpError(404, "Item not found");
  if (asset.status === AssetStatus.RETIRED) throw new HttpError(409, "This item is retired.");

  let imageUrl: string | null = null;
  if (args.file) {
    const invalid = await validateImage(args.file);
    if (invalid) throw new HttpError(400, invalid);
    const blob = await put(
      `checkin-reports/item/${asset.id}/${Date.now()}.${imageExtensionForType(args.file.type)}`,
      args.file.stream(),
      { ...publicBlobAuth(), access: "public", contentType: args.file.type },
    );
    imageUrl = blob.url;
  }

  let report;
  try {
    report = await db.$transaction(
      async (tx) => {
        const duplicate = await tx.checkinItemReport.findFirst({
          where: { assetId: asset.id, bookingId: null, resolution: null, reportedById: args.reporter.id, type: args.type },
          select: { id: true },
        });
        if (duplicate) throw new HttpError(409, "You already reported this item. Staff will follow up.");
        const saved = await tx.checkinItemReport.create({
          data: { assetId: asset.id, type: args.type, description, imageUrl, reportedById: args.reporter.id },
        });
        const derived = await deriveAssetStatus(asset.id, tx);
        const held = derived === "AVAILABLE" && asset.status === AssetStatus.AVAILABLE;
        if (held) await tx.asset.update({ where: { id: asset.id }, data: { status: AssetStatus.MAINTENANCE } });
        await createAuditEntryTx(tx, {
          actorId: args.reporter.id,
          actorRole: args.reporter.role,
          entityType: "asset",
          entityId: asset.id,
          action: args.type === "DAMAGED" ? "item_damage_reported" : "item_missing_reported",
          before: { status: asset.status },
          after: { status: held ? AssetStatus.MAINTENANCE : asset.status, reportId: saved.id, description, imageUrl, source: "ITEM_PAGE" },
        });
        return saved;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (imageUrl && isBlobUrl(imageUrl)) await deleteImage(imageUrl).catch(() => {});
    throw err;
  }

  deferPush(
    notifyItemReport({
      reportId: report.id,
      assetId: asset.id,
      assetTag: asset.assetTag,
      itemDescription: `${asset.brand} ${asset.model}`,
      reportType: args.type,
      damageDescription: description,
      evidenceImageUrl: imageUrl ?? undefined,
      reporterName: args.reporter.name,
    }).catch((err) => console.error("[REPORT] Failed to send supervisor notifications:", err)),
  );
  return report;
}

export type BookingReport = {
  id: string;
  type: CheckinReportType;
  /** What the report is about: an item tag, a numbered unit, or a counted quantity. */
  label: string;
  /** Staff outcome; null while the case is open. */
  resolution: ReportResolution | null;
  open: boolean;
  reportedAt: string;
};

/** Reports filed on one checkout, for the borrower and staff. */
export async function listBookingReports(bookingId: string): Promise<BookingReport[]> {
  const rows = await db.checkinItemReport.findMany({
    where: { bookingId },
    orderBy: { lastReportedAt: "desc" },
    select: {
      id: true,
      type: true,
      quantity: true,
      resolution: true,
      lastReportedAt: true,
      asset: { select: { assetTag: true, name: true } },
      bulkSkuUnit: { select: { unitNumber: true, bulkSku: { select: { name: true } } } },
      bulkSku: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    label: r.asset
      ? r.asset.name ? `${r.asset.name} (${r.asset.assetTag})` : r.asset.assetTag
      : r.bulkSkuUnit
        ? `${r.bulkSkuUnit.bulkSku.name} #${r.bulkSkuUnit.unitNumber}`
        : `${r.bulkSku?.name ?? "Supplies"} × ${r.quantity ?? 1}`,
    resolution: r.resolution,
    open: !r.resolution,
    reportedAt: r.lastReportedAt.toISOString(),
  }));
}
