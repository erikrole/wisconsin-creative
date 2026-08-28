import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { cancelBulkAssignmentBatch } from "@/lib/services/bulk-assignment-batches";

export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:bulk-assignment:cancel:${user.id}`, { max: 20, windowMs: 60_000 });
  return ok({ data: await cancelBulkAssignmentBatch(params.id, user) });
});
