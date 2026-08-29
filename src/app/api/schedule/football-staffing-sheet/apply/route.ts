import { withAuth } from "@/lib/api";
import { footballStaffingSheetApplyRequestSchema } from "@/lib/football-staffing-sheet";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { applyReviewedFootballStaffingSheet } from "@/lib/services/football-staffing-sheet-apply";

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift_assignment", "manage_roles");
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`schedule:football-sheet-apply:${user.id}`, { max: 12, windowMs: 60_000 });
  const input = footballStaffingSheetApplyRequestSchema.parse(await req.json());
  return ok({ data: await applyReviewedFootballStaffingSheet(input, user) });
});
