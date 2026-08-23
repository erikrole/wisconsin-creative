import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { rejectRetiredLiveScheduleMutation } from "@/lib/schedule-working-copy-guard";

export const POST = withAuth<{ id: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift", "create");
  rejectRetiredLiveScheduleMutation();
});
