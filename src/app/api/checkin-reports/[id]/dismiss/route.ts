import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";

/**
 * POST /api/checkin-reports/[id]/dismiss
 *
 * Hide a damage report from the dashboard flags list. The report and its
 * evidence stay on the item's history. Dismissing an already-dismissed
 * report is a no-op so a retry from a stale dashboard is safe.
 */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "checkin_report", "dismiss");
  const { id } = params;

  const report = await db.$transaction(
    async (tx) => {
      const before = await tx.checkinItemReport.findUnique({
        where: { id },
        select: { id: true, assetId: true, type: true, dismissedAt: true },
      });
      if (!before) throw new HttpError(404, "Report not found");
      if (before.dismissedAt) return before;

      const updated = await tx.checkinItemReport.update({
        where: { id },
        data: { dismissedAt: new Date(), dismissedById: user.id },
        select: { id: true, assetId: true, type: true, dismissedAt: true },
      });
      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: "asset",
        entityId: updated.assetId,
        action: "dismissed_checkin_report",
        before: { reportId: id, type: before.type, dismissedAt: null },
        after: {
          reportId: id,
          type: updated.type,
          dismissedAt: updated.dismissedAt,
        },
      });
      return updated;
    },
    { isolationLevel: "Serializable" },
  );

  return ok({ data: { id: report.id, dismissedAt: report.dismissedAt } });
});
