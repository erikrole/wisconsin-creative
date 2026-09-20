import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";

const MS_PER_DAY = 86_400_000;
const MAX_APPLIED_HIDDEN_USER_CLEANUP = 3;

type HiddenUsersCleanupInput = {
  actor: {
    id: string;
    role: Role;
  };
  dryRun?: boolean;
  maxAgeDays?: number;
  limit?: number;
  now?: Date;
};

type HiddenUserCandidate = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
};

type HiddenUsersCleanupResult = {
  dryRun: boolean;
  cutoff: string;
  scanned: number;
  deactivated: Array<HiddenUserCandidate & {
    cancelledBookingIds: string[];
    directReportsCleared: number;
  }>;
  failed: Array<HiddenUserCandidate & { error: string }>;
};

export async function cleanupHiddenUsers(args: HiddenUsersCleanupInput): Promise<HiddenUsersCleanupResult> {
  const dryRun = args.dryRun ?? true;
  const maxAgeDays = args.maxAgeDays ?? 14;
  const requestedLimit = args.limit ?? 25;
  const limit = dryRun
    ? requestedLimit
    : Math.min(requestedLimit, MAX_APPLIED_HIDDEN_USER_CLEANUP);
  const now = args.now ?? new Date();
  const cutoff = new Date(now.getTime() - maxAgeDays * MS_PER_DAY);

  const candidates = await db.user.findMany({
    where: {
      active: true,
      hiddenFromRoster: true,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      lastActiveAt: true,
    },
  });

  if (dryRun) {
    return {
      dryRun,
      cutoff: cutoff.toISOString(),
      scanned: candidates.length,
      deactivated: candidates.map((candidate) => ({
        ...candidate,
        cancelledBookingIds: [],
        directReportsCleared: 0,
      })),
      failed: [],
    };
  }

  const deactivated: HiddenUsersCleanupResult["deactivated"] = [];
  const failed: HiddenUsersCleanupResult["failed"] = [];

  for (const candidate of candidates) {
    try {
      const result = await deactivateUserWithCleanup({
        targetUserId: candidate.id,
        actorId: args.actor.id,
        actorRole: args.actor.role,
        audit: {
          action: "hidden_smoke_user_cleanup_deactivated",
          before: { active: true, hiddenFromRoster: true },
          after: {
            active: false,
            hiddenFromRoster: true,
            maxAgeDays,
            cutoff: cutoff.toISOString(),
          },
        },
      });
      deactivated.push({
        ...candidate,
        cancelledBookingIds: result.cancelledIds,
        directReportsCleared: result.directReportsCleared,
      });
    } catch (error) {
      failed.push({
        ...candidate,
        error: error instanceof Error ? error.message : "Unknown cleanup failure",
      });
    }
  }

  return {
    dryRun,
    cutoff: cutoff.toISOString(),
    scanned: candidates.length,
    deactivated,
    failed,
  };
}
