import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { ISSUE_STATUSES, listIssues, type IssueStatus } from "@/lib/services/error-reports";

/** GET /api/issues — grouped crash and error reports for triage (ADMIN). */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "diagnostics", "view");
  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  return ok({
    data: await listIssues({
      status: status === "all" || ISSUE_STATUSES.includes(status as IssueStatus) ? (status as IssueStatus | "all") : "open",
      platform: params.get("platform") || undefined,
      q: params.get("q")?.trim().slice(0, 100) || undefined,
    }),
  });
});
