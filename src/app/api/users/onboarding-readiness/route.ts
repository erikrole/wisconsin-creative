import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { getProfileCompletion } from "@/lib/profile-completion";
import { excludeHiringInvites } from "@/lib/hiring/invite-scope";
import { requirePermission } from "@/lib/rbac";

const readinessProfileSelect = {
  id: true,
  name: true,
  role: true,
  email: true,
  athleticsEmail: true,
  phone: true,
  personalPhone: true,
  workPhone: true,
  workPhoneNotApplicable: true,
  wiscardCardNumber: true,
  wiscardIssueCode: true,
  studentYearOverride: true,
  gradYear: true,
  graduationTerm: true,
  topSizeFit: true,
  topSize: true,
  shoeSizeSystem: true,
  shoeSize: true,
  avatarUrl: true,
  profilePromptSnoozedUntil: true,
} as const;

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "allowed_email", "view");

  const [invitations, accounts] = await Promise.all([
    db.allowedEmail.findMany({
      where: {
        AND: [
          {
            OR: [
              { claimedById: null },
              { claimedBy: { is: { hiddenFromRoster: false } } },
            ],
          },
          ...(excludeHiringInvites(user.role) ? [excludeHiringInvites(user.role)!] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        claimedBy: { select: { id: true, name: true } },
        collaboratorPolicy: {
          select: {
            id: true,
            status: true,
            version: true,
            affiliation: { select: { key: true, displayName: true, badgeLabel: true } },
            grants: { select: { capabilityKey: true } },
          },
        },
      },
    }),
    db.user.findMany({
      where: { active: true, hiddenFromRoster: false },
      orderBy: { name: "asc" },
      select: readinessProfileSelect,
    }),
  ]);

  return ok({
    data: {
      invitations: invitations.map((invitation) => ({
        ...invitation,
        collaboratorPolicy: invitation.collaboratorPolicy
          ? {
              ...invitation.collaboratorPolicy,
              capabilities: invitation.collaboratorPolicy.grants.map((grant) => grant.capabilityKey),
              grants: undefined,
            }
          : null,
      })),
      accounts: accounts.map((account) => {
        const completion = getProfileCompletion(account);
        return {
          id: account.id,
          name: account.name,
          email: account.email,
          role: account.role,
          avatarUrl: account.avatarUrl,
          operationalReady: completion.operationalReady,
          profileComplete: completion.profileComplete,
          missingFields: completion.missingFields,
          completedCount: completion.completedCount,
          totalCount: completion.totalCount,
        };
      }),
    },
  });
});
