import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { GEAR_PICK_CYCLE_ID } from "@/lib/gear-picks/catalog";
import { buildEquipmentSheet, planEquipmentSheet } from "@/lib/gear-picks/equipment-sheet";
import { getGearPicksAdmin } from "@/lib/services/gear-picks";

export const runtime = "nodejs";

const EXPORT_LIMIT = { max: 10, windowMs: 60_000 };

/** The equipment department's budget workbook with this cycle's tab filled from submitted picks. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "manage");
  const { allowed } = await checkRateLimit(`gear-picks:export:${user.id}`, EXPORT_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const overview = await getGearPicksAdmin();
  const plan = planEquipmentSheet(overview.participants);
  const sheet = await buildEquipmentSheet(plan, GEAR_PICK_CYCLE_ID);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "gear_pick_cycle",
    entityId: GEAR_PICK_CYCLE_ID,
    action: "export",
    after: {
      format: "equipment_sheet",
      rowCount: sheet.rowCount,
      movedRowCount: sheet.movedCount,
      submittedCount: plan.submittedCount,
    },
  });

  return new NextResponse(new Uint8Array(sheet.buffer), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="equipment-sheet-${GEAR_PICK_CYCLE_ID}.xlsx"`,
    },
  });
});
