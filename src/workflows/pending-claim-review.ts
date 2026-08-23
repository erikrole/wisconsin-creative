import { sleep } from "workflow";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { approveTrade } from "@/lib/services/shift-trades";
import { approveRequest } from "@/lib/services/shift-assignments";
import {
  escalatePendingClaim,
  reportPendingClaimAutoApproval,
} from "@/lib/services/claim-review-notifications";

/** Which review queue a pending claim sits in. */
export type PendingClaimKind = "trade" | "request";

/**
 * Carry an unreviewed student claim to a decision.
 *
 * Modelled on `pendingScheduleReleaseWorkflow`: sleep to a deadline, re-read the
 * row, and act only if it is still the row we were started for. Every step is
 * safe to run against a claim staff already resolved — it reports `superseded`
 * and stops.
 *
 * A nightly cron cannot do this job: a claim filed at 9 AM on a shift that
 * starts at 6 PM would never be looked at before the shift.
 */
export async function pendingClaimReviewWorkflow(
  kind: PendingClaimKind,
  claimId: string,
  escalateAtIso: string,
  autoApproveAtIso: string,
) {
  "use workflow";

  const escalateAt = new Date(escalateAtIso);
  if (escalateAt.getTime() > Date.now()) await sleep(escalateAt);
  const escalated = await escalatePendingClaimStep(kind, claimId);
  if (escalated.status === "superseded") return escalated;

  const autoApproveAt = new Date(autoApproveAtIso);
  if (autoApproveAt.getTime() > Date.now()) await sleep(autoApproveAt);
  return autoApprovePendingClaimStep(kind, claimId);
}

/** Is this claim still waiting on a human? */
async function isStillPending(kind: PendingClaimKind, claimId: string): Promise<boolean> {
  if (kind === "trade") {
    const trade = await db.shiftTrade.findUnique({
      where: { id: claimId },
      select: { status: true },
    });
    return trade?.status === "CLAIMED";
  }
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: claimId },
    select: { status: true },
  });
  return assignment?.status === "REQUESTED";
}

export async function escalatePendingClaimStep(kind: PendingClaimKind, claimId: string) {
  "use step";

  if (!await isStillPending(kind, claimId)) {
    return { status: "superseded" as const, kind, claimId };
  }
  await escalatePendingClaim(kind, claimId);
  return { status: "escalated" as const, kind, claimId };
}

export async function autoApprovePendingClaimStep(kind: PendingClaimKind, claimId: string) {
  "use step";

  if (!await isStillPending(kind, claimId)) {
    return { status: "superseded" as const, kind, claimId };
  }

  try {
    if (kind === "trade") await approveTrade(claimId);
    else await approveRequest(claimId);
    await reportPendingClaimAutoApproval(kind, claimId, null);
    return { status: "approved" as const, kind, claimId };
  } catch (error) {
    // A 4xx means the world changed under the claim — a conflict appeared, the
    // slot was refilled, time off was approved. Forcing it through would be
    // worse than leaving it: tell staff what stopped it and let a human decide.
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
      await reportPendingClaimAutoApproval(kind, claimId, error.message);
      return { status: "blocked" as const, kind, claimId, error: error.message };
    }
    throw error;
  }
}
