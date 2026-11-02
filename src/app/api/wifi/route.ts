import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { getSharedWifi } from "@/lib/wifi";

export const GET = withAuth(async (_req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "software", "view", "SOFTWARE_VAULT_VIEW");
  return ok({ data: getSharedWifi() });
});
