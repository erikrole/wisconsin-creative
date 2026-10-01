import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { assertNotHiringInvite } from "@/lib/hiring/invite-scope";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { updateAllowedEmailProfileSchema } from "@/lib/validation";
import { updatePendingAllowedEmailProfile } from "@/lib/services/onboarding-lifecycle";

/** Replace the preloaded profile for an unclaimed student invitation. */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "allowed_email", "edit");
  await enforceRateLimit(`allowed-emails:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  await assertNotHiringInvite(user.role, params.id);
  const profile = updateAllowedEmailProfileSchema.parse(await req.json());
  const result = await updatePendingAllowedEmailProfile({
    actor: { id: user.id, role: user.role },
    id: params.id,
    ...profile,
  });

  return ok(result.entry);
});

/** Delete an allowed email entry (only if unclaimed) */
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "allowed_email", "delete");
  await enforceRateLimit(`allowed-emails:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  await assertNotHiringInvite(user.role, params.id);
  const entry = await db.allowedEmail.findUnique({
    where: { id: params.id },
  });

  if (!entry) {
    throw new HttpError(404, "Allowed email not found");
  }

  if (entry.claimedAt) {
    throw new HttpError(
      400,
      "Cannot delete an allowlist entry that has already been claimed"
    );
  }

  // Atomic: only delete if still unclaimed (guards against race with concurrent registration)
  const deleted = await db.allowedEmail.deleteMany({
    where: { id: params.id, claimedAt: null },
  });

  if (deleted.count === 0) {
    throw new HttpError(400, "This invitation was just claimed and can no longer be deleted");
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "allowed_email",
    entityId: entry.id,
    action: "deleted",
    before: { email: entry.email, role: entry.role },
  });

  return ok({ success: true });
});
