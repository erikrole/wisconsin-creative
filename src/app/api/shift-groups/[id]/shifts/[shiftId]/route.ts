import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { rejectRetiredLiveScheduleMutation } from "@/lib/schedule-working-copy-guard";

export const DELETE = withAuth<{ id: string; shiftId: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift", "delete");
  rejectRetiredLiveScheduleMutation();
});
