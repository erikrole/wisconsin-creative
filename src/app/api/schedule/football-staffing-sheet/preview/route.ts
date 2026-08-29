import { withAuth } from "@/lib/api";
import { footballStaffingSheetPreviewRequestSchema } from "@/lib/football-staffing-sheet";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { previewFootballStaffingSheet } from "@/lib/services/football-staffing-sheet-preview";

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift_assignment", "manage_roles");
  await enforceRateLimit(`schedule:football-sheet-preview:${user.id}`, { max: 12, windowMs: 60_000 });
  const input = footballStaffingSheetPreviewRequestSchema.parse(await req.json());
  return ok({ data: await previewFootballStaffingSheet(input) });
});
