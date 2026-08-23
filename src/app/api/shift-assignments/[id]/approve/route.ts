import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { approveRequest } from "@/lib/services/shift-assignments";

export const PATCH = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift_assignment", "approve");
  const { id } = params;

  const assignment = await approveRequest(id, { id: user.id, role: user.role });

  return ok({ data: assignment });
});
