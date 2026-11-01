import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { getSharedWifi } from "@/lib/wifi";

export const GET = withAuth(async (_req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "software", "view", "SOFTWARE_VAULT_VIEW");
  const wifi = getSharedWifi();
  if (!wifi) throw new HttpError(404, "Wi-Fi is not set up");
  return ok({ data: wifi });
});
