import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";

/**
 * POST /api/checkin-reports/[id]/dismiss
 *
 * Hide a damage flag from the dashboard. For a serialized asset this
 * dismisses every open damage report on that asset in one transaction, so
 * the banner's single row clears atomically and an older report beyond the
 * dashboard's list cannot bring the flag straight back. Reports and their
 * evidence stay on the item's history. Dismissing an already-dismissed
 * report is a no-op so a retry from a stale dashboard is safe.
 */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "checkin_report", "dismiss");
  const { id } = params;

  const result = await db.$transaction(
    async (tx) => {
      const report = await tx.checkinItemReport.findUnique({
        where: { id },
        select: { id: true, assetId: true, bookingId: true, type: true },
      });
      if (!report) throw new HttpError(404, "Report not found");
      // Only damage flags can be dismissed; a lost item stays on the dashboard
      // until it is found or resolved.
      if (report.type !== "DAMAGED") throw new HttpError(409, "Only damage reports can be dismissed");

      // Bulk-stock reports have no asset, so they dismiss one at a time.
      const open = await tx.checkinItemReport.findMany({
        where: report.assetId
          ? { assetId: report.assetId, type: "DAMAGED", dismissedAt: null }
          : { id, dismissedAt: null },
        select: { id: true },
      });
      if (open.length === 0) return { dismissedIds: [] as string[], dismissedAt: null };

      const dismissedAt = new Date();
      const dismissedIds = open.map((r) => r.id);
      await tx.checkinItemReport.updateMany({
        where: { id: { in: dismissedIds }, dismissedAt: null },
        data: { dismissedAt, dismissedById: user.id },
      });
      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: report.assetId ? "asset" : "booking",
        entityId: report.assetId ?? report.bookingId,
        action: "dismissed_checkin_report",
        before: { reportIds: dismissedIds, type: "DAMAGED", dismissedAt: null },
        after: { reportIds: dismissedIds, type: "DAMAGED", dismissedAt },
      });
      return { dismissedIds, dismissedAt };
    },
    { isolationLevel: "Serializable" },
  );

  return ok({ data: { id, dismissedIds: result.dismissedIds, dismissedAt: result.dismissedAt } });
});
