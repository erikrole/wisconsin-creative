import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { connectionStatus, disconnect } from "@/lib/youtube/connection";

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "youtube", "view");
  return ok(await connectionStatus());
});

/** Revokes the grant at Google (best effort) and deletes the stored token. */
export const DELETE = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "youtube", "connect");
  return ok(await disconnect(user));
});
