/**
 * When an unreviewed student claim escalates to staff, and when it resolves
 * itself if they still have not acted.
 *
 * Claims fail toward approval. Both students have already agreed to the swap,
 * so an unresolved claim reaching the shift is the one outcome nobody wants:
 * the poster believes they are off, the claimer believes they are on, and the
 * slot is covered by whoever guesses right.
 */

/** Normal lead time: staff hear about a waiting claim two days out. */
export const CLAIM_ESCALATE_LEAD_MS = 48 * 60 * 60_000;

/** Normal lead time: an unreviewed claim approves itself a day out. */
export const CLAIM_AUTO_APPROVE_LEAD_MS = 24 * 60 * 60_000;

/**
 * A claim filed inside the normal leads has no room for them. Split whatever
 * time is left instead — escalate a third of the way to the shift, resolve two
 * thirds of the way — so staff always get a window and the claim always
 * settles before anyone has to show up.
 */
const ESCALATE_FRACTION = 1 / 3;
const AUTO_APPROVE_FRACTION = 2 / 3;

export type ClaimReviewDeadlines = {
  escalateAt: Date;
  autoApproveAt: Date;
};

/**
 * @param shiftStartsAt the claim's *effective* window start (personal call
 *   window, then shift call window, then shift start) — not the raw shift start,
 *   which can be hours off a Student call time.
 */
export function claimReviewDeadlines(shiftStartsAt: Date, now: Date = new Date()): ClaimReviewDeadlines | null {
  const remaining = shiftStartsAt.getTime() - now.getTime();
  if (remaining <= 0) return null;

  let escalateAt = new Date(shiftStartsAt.getTime() - CLAIM_ESCALATE_LEAD_MS);
  if (escalateAt.getTime() <= now.getTime()) {
    escalateAt = new Date(now.getTime() + remaining * ESCALATE_FRACTION);
  }

  let autoApproveAt = new Date(shiftStartsAt.getTime() - CLAIM_AUTO_APPROVE_LEAD_MS);
  if (autoApproveAt.getTime() <= escalateAt.getTime()) {
    autoApproveAt = new Date(now.getTime() + remaining * AUTO_APPROVE_FRACTION);
  }

  return { escalateAt, autoApproveAt };
}
