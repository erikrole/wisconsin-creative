import { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";

/** DELETE /api/me/api-tokens/[id] — revoke one of the caller's tokens. */
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF]);

  const deleted = await db.apiToken.deleteMany({ where: { id: params.id, userId: user.id } });
  if (deleted.count === 0) throw new HttpError(404, "Token not found.");

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "api_token",
    entityId: params.id,
    action: "api_token_revoked",
  });

  return ok({ success: true });
});
