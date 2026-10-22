import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { listDamageCases } from "@/lib/services/damage-cases";

/** GET /api/damage-cases?view=open|closed — the staff triage queue for damaged and missing gear. */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "checkin_report", "dismiss");
  const view = new URL(req.url).searchParams.get("view") === "closed" ? "closed" : "open";
  return ok({ data: await listDamageCases(view) });
});
