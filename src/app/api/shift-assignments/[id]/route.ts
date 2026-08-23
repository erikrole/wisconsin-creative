import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { rejectRetiredLiveScheduleMutation } from "@/lib/schedule-working-copy-guard";

export const PATCH = withAuth<{ id: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift_assignment", "assign");
  rejectRetiredLiveScheduleMutation();
});

export const DELETE = withAuth<{ id: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift_assignment", "assign");
  rejectRetiredLiveScheduleMutation();
});
