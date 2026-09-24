import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { updateUserRoleSchema } from "@/lib/validation";
import { createAuditEntry } from "@/lib/audit";
import { revokeCompanionUser } from "@/lib/companion-store";

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requireRole(user.role, ["ADMIN", "STAFF"]);

  const { id } = params;
  const body = updateUserRoleSchema.parse(await req.json());

  const target = await db.user.findUnique({ where: { id } });
  if (!target) {
    throw new HttpError(404, "User not found");
  }

  if (target.id === user.id && body.role !== user.role) {
    throw new HttpError(400, "You cannot change your own role");
  }

  // Only ADMIN can grant or revoke the ADMIN role
  if (user.role !== "ADMIN" && (body.role === "ADMIN" || target.role === "ADMIN")) {
    throw new HttpError(403, "Only admins can change admin roles");
  }
  if (user.role !== "ADMIN" && (body.role === "COLLABORATOR" || target.role === "COLLABORATOR")) {
    throw new HttpError(403, "Only admins can change collaborator access");
  }

  const previousRole = target.role;
  const collaboratorPolicyId = body.role === "COLLABORATOR"
    ? body.collaboratorPolicyId ?? target.collaboratorPolicyId
    : null;
  const collaboratorPolicy = collaboratorPolicyId
    ? await db.collaboratorPolicy.findUnique({
        where: { id: collaboratorPolicyId },
        include: { affiliation: true },
      })
    : null;
  if (body.role === "COLLABORATOR" && (
    !collaboratorPolicy ||
    collaboratorPolicy.status !== "ACTIVE" ||
    collaboratorPolicy.affiliation.archivedAt
  )) {
    throw new HttpError(400, "Choose an active collaborator affiliation");
  }

  const legacyBtn = collaboratorPolicy?.affiliation.key === "BIG_TEN_NETWORK";
  const updated = await db.user.update({
    where: { id },
    data: {
      role: body.role,
      affiliation: legacyBtn ? "BIG_TEN_NETWORK" : null,
      collaboratorProfile: legacyBtn ? "BTN_STANDARD" : null,
      collaboratorPolicyId,
      // A collaborator has no shift feed; restoring the role later must not
      // quietly revive a link shared under the old role.
      ...(body.role === "COLLABORATOR" ? { icsToken: null } : {}),
    }
  });

  try {
    await revokeCompanionUser(id);
  } catch (error) {
    console.error("[Companion] failed to revoke role-changed user", error);
    throw new HttpError(503, "The role changed, but companion access could not be revoked. Retry the role update.");
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: id,
    action: "role_changed",
    before: {
      role: previousRole,
      affiliation: target.affiliation,
      collaboratorProfile: target.collaboratorProfile,
      collaboratorPolicyId: target.collaboratorPolicyId,
    },
    after: {
      role: updated.role,
      affiliation: updated.affiliation,
      collaboratorProfile: updated.collaboratorProfile,
      collaboratorPolicyId: updated.collaboratorPolicyId,
    },
  });
  return ok({
    data: {
      id: updated.id,
      role: updated.role
    }
  });
});
