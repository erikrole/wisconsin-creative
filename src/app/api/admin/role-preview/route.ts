import { z } from "zod";
import { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import {
  clearRolePreviewCookie,
  createRolePreviewState,
  rolePreviewInfo,
  setRolePreviewCookie,
  type RolePreviewRole,
} from "@/lib/role-preview";

const rolePreviewSchema = z.object({
  role: z.enum([Role.STAFF, Role.STUDENT, Role.COLLABORATOR]),
  collaboratorAffiliation: z.enum(["BIG_TEN_NETWORK", "LEARFIELD"]).optional(),
});

function requireAdminPreviewAccess(role: Role) {
  requirePermission(role, "role_preview", "manage");
}

export const POST = withAuth(async (req, { user }) => {
  requireAdminPreviewAccess(user.preview?.actualRole ?? user.role);
  const body = rolePreviewSchema.parse(await req.json());
  const state = body.role === Role.COLLABORATOR && body.collaboratorAffiliation
    ? createRolePreviewState(body.role as RolePreviewRole, Date.now(), body.collaboratorAffiliation as "BIG_TEN_NETWORK" | "LEARFIELD")
    : createRolePreviewState(body.role as RolePreviewRole);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.preview?.actualRole ?? user.role,
    entityType: "role_preview",
    entityId: user.id,
    action: "start",
    after: { role: state.role, readOnly: true },
  });
  await setRolePreviewCookie(state);

  return ok({ preview: rolePreviewInfo(state) });
});

export const DELETE = withAuth(async (_req, { user }) => {
  requireAdminPreviewAccess(user.preview?.actualRole ?? user.role);
  const previousRole = user.preview?.role;

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.preview?.actualRole ?? user.role,
    entityType: "role_preview",
    entityId: user.id,
    action: "stop",
    before: previousRole ? { role: previousRole, readOnly: true } : undefined,
  });
  await clearRolePreviewCookie();

  return ok({ success: true });
});
