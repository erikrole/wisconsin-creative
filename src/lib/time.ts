import { HttpError } from "@/lib/http";

/** Clock-skew tolerance: allow dates up to 15 minutes in the past */
const SKEW_MS = 15 * 60 * 1000;

/**
 * Longest a booking may run. Real bookings top out around six weeks; this
 * only catches a mistyped year ("2062" for "2026") that would otherwise hold
 * gear for decades.
 */
export const MAX_BOOKING_DURATION_MS = 366 * 24 * 60 * 60 * 1000;
export const MAX_BOOKING_DURATION_MESSAGE = "A booking can't run longer than a year. Check the end date.";

export function assertBookingDuration(start: Date, end: Date) {
  if (end.getTime() - start.getTime() > MAX_BOOKING_DURATION_MS) {
    throw new HttpError(400, MAX_BOOKING_DURATION_MESSAGE);
  }
}

export function parseDateRange(
  startsAt: string,
  endsAt: string,
  { requireFutureStart = false }: { requireFutureStart?: boolean } = {},
) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new HttpError(400, "Invalid startsAt or endsAt");
  }

  if (end <= start) {
    throw new HttpError(400, "endsAt must be later than startsAt");
  }
  assertBookingDuration(start, end);

  if (requireFutureStart && start.getTime() < Date.now() - SKEW_MS) {
    throw new HttpError(400, "Start date must not be in the past");
  }

  return { start, end };
}
