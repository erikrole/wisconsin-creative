import { start } from "workflow/api";
import { claimReviewDeadlines } from "@/lib/claim-review-deadlines";
import { pendingClaimReviewWorkflow, type PendingClaimKind } from "@/workflows/pending-claim-review";

/**
 * Start the review clock for a student claim.
 *
 * Deliberately best-effort, unlike `enqueuePendingScheduleRelease`, which fails
 * its request when the timer will not start. The difference is what a missing
 * run costs: there, staff edits stay invisible forever; here, the claim is
 * already recorded and visible in the Admin queue, and the only loss is the
 * automatic nudge. Rejecting the claim would be the worse outcome.
 */
export async function enqueuePendingClaimReview(args: {
  kind: PendingClaimKind;
  claimId: string;
  /** The claim's effective window start, not the raw shift start. */
  shiftStartsAt: Date;
  now?: Date;
}): Promise<string | null> {
  const deadlines = claimReviewDeadlines(args.shiftStartsAt, args.now);
  if (!deadlines) return null;

  try {
    const run = await start(pendingClaimReviewWorkflow, [
      args.kind,
      args.claimId,
      deadlines.escalateAt.toISOString(),
      deadlines.autoApproveAt.toISOString(),
    ]);
    return run.runId;
  } catch (error) {
    console.error("[Schedule] failed to enqueue claim review", {
      kind: args.kind,
      claimId: args.claimId,
      error,
    });
    return null;
  }
}
