import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { supportReportUpdateSchema } from "@/lib/schemas/error-reports";
import { updateSupportReport } from "@/lib/services/error-reports";

/** PATCH /api/support-reports/:id — close or reopen a problem report (ADMIN). */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "diagnostics", "manage");
  await enforceRateLimit(`support-reports-admin:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = supportReportUpdateSchema.parse(await req.json());
  return ok({ data: await updateSupportReport(params.id, body.status, { id: user.id, role: user.role }) });
});
