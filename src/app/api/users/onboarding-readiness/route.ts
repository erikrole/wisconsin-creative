import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { getProfileCompletion } from "@/lib/profile-completion";
import { excludeHiringInvites } from "@/lib/hiring/invite-scope";
import { requirePermission } from "@/lib/rbac";
import { readinessProfileSelect } from "@/lib/services/onboarding-readiness";

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "allowed_email", "view");

  const [invitations, accounts, classBlocks] = await Promise.all([
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
      select: { ...readinessProfileSelect, createdAt: true },
    }),
    // Students with at least one weekly class block, so staff can see who hasn't added class times.
    db.studentAvailabilityBlock.groupBy({
      by: ["userId"],
      where: { kind: "WEEKLY", intent: "CANNOT_WORK" },
      _count: { _all: true },
    }),
  ]);
  const withClassTimes = new Set(classBlocks.map((row) => row.userId));

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
          createdAt: account.createdAt,
          hasClassTimes: account.role === "STUDENT" ? withClassTimes.has(account.id) : null,
        };
      }),
    },
  });
});
