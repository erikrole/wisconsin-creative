import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getAuditActors } from "@/lib/services/reports";

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "report", "audit");
  return ok({ data: await getAuditActors() });
});
