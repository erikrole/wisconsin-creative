export const QUARTER_HOUR_MINUTES = 15;

const QUARTER_HOUR_MS = QUARTER_HOUR_MINUTES * 60 * 1000;

/** Round forward so a suggested return never promises an earlier handoff. */
export function roundUpToQuarterHour(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS);
}

/** Return the first quarter-hour strictly after the supplied instant. */
export function nextQuarterHourAfter(date: Date): Date {
  return roundUpToQuarterHour(new Date(date.getTime() + 1));
}

/** Normalize an operator choice and keep it at or after an optional minimum. */
export function clampToQuarterHour(date: Date, minimum?: Date): Date {
  const rounded = roundUpToQuarterHour(date);
  if (!minimum) return rounded;
  const roundedMinimum = roundUpToQuarterHour(minimum);
  return rounded < roundedMinimum ? roundedMinimum : rounded;
}

/** A booking end must be future-facing and strictly later than its start. */
export function minimumBookingEndDate(startsAt: Date, now: Date = new Date()): Date {
  return nextQuarterHourAfter(new Date(Math.max(startsAt.getTime(), now.getTime())));
}
