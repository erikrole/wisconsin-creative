import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Item scans live in scan_events, not audit_logs, so a timeline built only
 * from audit rows never shows "ROAM2 went out" or "ROAM2 came back". These
 * helpers fold successful scans into an audit page as timeline rows.
 *
 * Paging stays keyed on audit rows: the scans shown are the ones between the
 * page's cursor row and its last row, so every scan appears exactly once.
 */
export async function scanRowsForAuditPage(
  where: Prisma.ScanEventWhereInput,
  window: { before: Date | null; atOrAfter: Date | null },
) {
  const scans = await db.scanEvent.findMany({
    where: {
      ...where,
      success: true,
      createdAt: {
        ...(window.before ? { lt: window.before } : {}),
        ...(window.atOrAfter ? { gte: window.atOrAfter } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      phase: true,
      quantity: true,
      createdAt: true,
      bookingId: true,
      booking: { select: { title: true, kind: true } },
      asset: { select: { id: true, assetTag: true, name: true } },
      bulkSku: { select: { name: true } },
      actor: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  return scans.map((scan) => ({
    id: `scan_${scan.id}`,
    action: scan.phase === "CHECKOUT" ? "scan_checkout" : "scan_checkin",
    entityType: "booking",
    entityId: scan.bookingId,
    createdAt: scan.createdAt,
    beforeJson: null,
    afterJson: {
      itemName: scan.asset?.assetTag ?? scan.bulkSku?.name ?? null,
      ...(scan.asset ? { assetId: scan.asset.id } : {}),
      ...(scan.quantity && scan.quantity > 1 ? { quantity: scan.quantity } : {}),
    },
    actor: scan.actor,
    entity: { label: scan.booking.title, kind: scan.booking.kind },
  }));
}

/** Newest first, scans placed among the audit rows by time. */
export function mergeByTime<A extends { createdAt: Date }, B extends { createdAt: Date }>(a: A[], b: B[]): (A | B)[] {
  return [...a, ...b].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
}
