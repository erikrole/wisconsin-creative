import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { getProfileCompletion } from "@/lib/profile-completion";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { sendInviteEmail } from "@/lib/services/invite-email";
import { readinessProfileSelect } from "@/lib/services/onboarding-readiness";

/** Per person, so someone still setting up is not mailed repeatedly by mistake. */
const REMINDER_LIMIT = { max: 1, windowMs: 24 * 60 * 60 * 1000 };

/** Email a signed-in person who has not finished their profile a nudge to finish it. */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "allowed_email", "edit");
  await enforceRateLimit(`allowed-emails:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const target = await db.user.findUnique({
    where: { id: params.id },
    select: { ...readinessProfileSelect, active: true, hiddenFromRoster: true },
  });
  if (!target || !target.active || target.hiddenFromRoster) throw new HttpError(404, "Account not found");
  if (getProfileCompletion(target).profileComplete) {
    throw new HttpError(409, "This person already finished setup, so there is nothing to remind them about.");
  }

  await enforceRateLimit(`users:setup-reminder:${target.id}`, REMINDER_LIMIT);
  const emailStatus = await sendInviteEmail({ email: target.email, name: target.name, kind: "reminder" });

  // The audit entry records that a send was attempted and how it ended, never the address.
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: target.id,
    action: "setup_reminder_sent",
    after: { emailStatus },
  });

  if (emailStatus === "failed") throw new HttpError(502, "The email could not be sent. Try again later.");
  return ok({ data: { emailStatus } });
});
