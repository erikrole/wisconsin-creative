import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { issueUpdateSchema } from "@/lib/schemas/error-reports";
import { getIssueDetail, updateIssue } from "@/lib/services/error-reports";

/** GET /api/issues/:id — one issue with its recent occurrences (ADMIN). */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "diagnostics", "view");
  return ok({ data: await getIssueDetail(params.id) });
});

/** PATCH /api/issues/:id — resolve, ignore, reopen, or annotate an issue (ADMIN). */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "diagnostics", "manage");
  await enforceRateLimit(`issues:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = issueUpdateSchema.parse(await req.json());
  return ok({ data: await updateIssue(params.id, body, { id: user.id, role: user.role }) });
});
