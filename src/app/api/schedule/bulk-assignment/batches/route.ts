import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { listBulkAssignmentBatches } from "@/lib/services/bulk-assignment-batches";

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:bulk-assignment:batches:${user.id}`, { max: 60, windowMs: 60_000 });
  return ok({ data: { batches: await listBulkAssignmentBatches() } });
});
