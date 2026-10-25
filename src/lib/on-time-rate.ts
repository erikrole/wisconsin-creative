import { BookingCustodyScope, type Prisma } from "@prisma/client";

/**
 * The one on-time rule for the app. A return is on time unless it came back after the due time
 * plus the checkout policy grace period. A checkout still out past that point counts as not on
 * time. The rate only shows once someone has this many completed or overdue checkouts.
 */
export const MIN_CHECKOUTS_FOR_RATE = 3;
export const HOUR_MS = 3_600_000;

/** Checkouts that count toward a person's record: their own custody, not excluded. */
export const accountableCheckoutWhere: Prisma.BookingWhereInput = {
  kind: "CHECKOUT",
  custodyScope: BookingCustodyScope.PERSON,
  OR: [
    { accountabilityExclusion: { is: null } },
    { accountabilityExclusion: { restoredAt: { not: null } } },
  ],
};

/** True when `at` (the return time, or now for a checkout still out) is past due plus grace. */
export function isPastGrace(dueAt: Date, at: Date, gracePeriodHours: number) {
  return at.getTime() > dueAt.getTime() + gracePeriodHours * HOUR_MS;
}

export function onTimeRate(counts: {
  completed: number;
  lateCompleted: number;
  activeLate: number;
}) {
  const total = counts.completed + counts.activeLate;
  if (total < MIN_CHECKOUTS_FOR_RATE) return null;
  const onTime = Math.max(0, counts.completed - counts.lateCompleted);
  return Math.round((onTime / total) * 100);
}
