import { BookingStatus } from "@prisma/client";

export const AUDIT_REPORT_EXPORT_LIMIT = 5000;

export const CHECKOUT_REPORT_EXPORT_LIMIT = 5000;

export const OVERDUE_REPORT_EXPORT_LIMIT = 5000;

export const SCAN_REPORT_EXPORT_LIMIT = 5000;

export const BULK_LOSS_REPORT_EXPORT_LIMIT = 5000;

export const UTILIZATION_REPORT_EXPORT_LIMIT = 5000;

export const CHECKOUT_CUSTODY_REPORT_STATUSES = [BookingStatus.OPEN, BookingStatus.COMPLETED] as const;

export const UTILIZATION_REPORT_PERIODS = [30, 90, 365] as const;

export const UTILIZATION_REPORT_DEFAULT_PERIOD = 90;

export const UTILIZATION_IDLE_LIST_LIMIT = 25;

export const UTILIZATION_TOP_USED_LIMIT = 10;

export const EMPTY_EFFECTIVE_STATUS_COUNTS = {
  AVAILABLE: 0,
  CHECKED_OUT: 0,
  PENDING_PICKUP: 0,
  RESERVED: 0,
  MAINTENANCE: 0,
  RETIRED: 0,
};

export function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function settledReportValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  failure: string,
  partialFailures: string[]
) {
  if (result.status === "fulfilled") return result.value;

  partialFailures.push(failure);
  console.error(`[reports] ${failure} query failed`, result.reason);
  return fallback;
}

/**
 * Bulk loss report: lost units grouped by SKU and by last requester.
 */
export function daysBetween(start: Date | null | undefined, end: Date | null | undefined) {
  if (!start || !end) return null;
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}
