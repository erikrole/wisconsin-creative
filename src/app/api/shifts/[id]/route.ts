import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { rejectRetiredLiveScheduleMutation } from "@/lib/schedule-working-copy-guard";

export const PATCH = withAuth<{ id: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift", "edit");
  rejectRetiredLiveScheduleMutation();
});

export const DELETE = withAuth<{ id: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift", "delete");
  rejectRetiredLiveScheduleMutation();
});
