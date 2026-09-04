import {
  SERIALIZED_TURNAROUND_BUFFER_MINUTES,
  TURNAROUND_CRITICAL_WINDOW_MINUTES,
  TURNAROUND_WARNING_WINDOW_MINUTES,
  serializedTurnaroundBufferMs,
} from "@/lib/booking-availability-window";
import { env } from "@/lib/env";

type UpcomingCommitment = {
  startsAt: string;
  bookingTitle?: string;
};

export type AvailabilityConflictLike = {
  conflictingBookingTitle?: string | null;
  conflictingBookingRequesterName?: string | null;
  conflictingBookingKind?: string | null;
  conflictingBookingStatus?: string | null;
  startsAt: string | Date;
  endsAt: string | Date;
};

export type AvailabilityRiskLike = {
  code?: string | null;
  severity?: string | null;
  message?: string | null;
  startsAt?: string | Date | null;
  gapMinutes?: number | null;
  plannedQuantity?: number | null;
  nextLocationName?: string | null;
  reportType?: string | null;
  bookingTitle?: string | null;
};

function dateTimeFormatter() {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatAvailabilityDateTime(value: string | Date) {
  return dateTimeFormatter().format(value instanceof Date ? value : new Date(value));
}

export function formatAvailabilityDeadline(value: string | Date) {
  const date = validDate(value);
  if (!date) return "the scheduled end time";

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: env.appTimezone,
    month: "short",
    day: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: env.appTimezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${dateLabel} at ${timeLabel}`;
}

export function formatAvailabilityDuration(minutes: number) {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function validDate(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Gives a conflict a useful next action. The server applies the same one-hour
 * serialized turnaround buffer, so the suggested return/available-after time
 * is deliberately derived from the conflicting booking rather than guessed
 * from the current UI state.
 */
export function availabilityConflictMessage(
  conflict: AvailabilityConflictLike,
  window?: { currentStartsAt?: string | Date | null; currentEndsAt?: string | Date | null },
) {
  const booking = conflict.conflictingBookingTitle || "another booking";
  const conflictStart = validDate(conflict.startsAt);
  const conflictEnd = validDate(conflict.endsAt);
  const currentStart = validDate(window?.currentStartsAt);
  const currentEnd = validDate(window?.currentEndsAt);
  const prefix = `Conflict with ${booking}`;

  if (!conflictStart || !conflictEnd) {
    return `${prefix}. Choose another item or change the dates.`;
  }

  const conflictWindow = `${formatAvailabilityDateTime(conflictStart)}–${formatAvailabilityDateTime(conflictEnd)}`;
  if (currentEnd && conflictStart >= currentEnd) {
    const returnBy = new Date(conflictStart.getTime() - serializedTurnaroundBufferMs());
    return `${prefix} (${conflictWindow}); return by ${formatAvailabilityDateTime(returnBy)}.`;
  }
  if (currentStart && conflictEnd <= currentStart) {
    const availableAfter = new Date(conflictEnd.getTime() + serializedTurnaroundBufferMs());
    return `${prefix} (${conflictWindow}); available after ${formatAvailabilityDateTime(availableAfter)}.`;
  }
  return `${prefix} (${conflictWindow}); choose another item or change the dates.`;
}

/**
 * Copy for the kiosk's rejected add-item action. A scan is blocked by the
 * booking that owns the overlapping allocation, so name that person and the
 * allocation's end time instead of making the operator infer what "unavailable"
 * means from a generic error.
 */
export function availabilityBlockedItemMessage(
  conflict: AvailabilityConflictLike,
  itemName: string,
) {
  const requester = conflict.conflictingBookingRequesterName?.trim();
  const item = itemName.trim() || "this item";
  const endsAt = validDate(conflict.endsAt);
  if (!requester || !endsAt) return availabilityConflictMessage(conflict);

  const status = conflict.conflictingBookingStatus?.toUpperCase();
  const kind = conflict.conflictingBookingKind?.toUpperCase();
  const isCheckedOut = status === "OPEN" || (kind === "CHECKOUT" && status !== "PENDING_PICKUP");
  const verb = isCheckedOut ? "has checked out" : "has reserved";
  return `${requester} ${verb} the ${item} until ${formatAvailabilityDeadline(endsAt)}`;
}

/**
 * Normalizes timing, transfer, and condition notices into one action-oriented
 * sentence. This keeps the web picker, selected shelf, and detail surfaces
 * from reducing every risk to the vague label "Turnaround".
 */
export function availabilityRiskMessage(risk: AvailabilityRiskLike) {
  const startsAt = validDate(risk.startsAt);
  const returnBy = startsAt
    ? new Date(startsAt.getTime() - serializedTurnaroundBufferMs())
    : null;
  const gap = typeof risk.gapMinutes === "number"
    ? ` (${formatAvailabilityDuration(risk.gapMinutes)} gap)`
    : "";

  switch (risk.code) {
    case "SHORT_TURNAROUND":
      if (startsAt && returnBy) {
        return `Needed next at ${formatAvailabilityDateTime(startsAt)} · return by ${formatAvailabilityDateTime(returnBy)}${risk.gapMinutes !== undefined && risk.gapMinutes !== null && risk.gapMinutes <= TURNAROUND_CRITICAL_WINDOW_MINUTES ? gap : ""}`;
      }
      return risk.message || "Tight timing — confirm the return time.";
    case "BULK_SHORT_TURNAROUND":
      if (startsAt && returnBy) {
        const quantity = risk.plannedQuantity == null ? "the next quantity" : `${risk.plannedQuantity}`;
        return `Next booking needs ${quantity} at ${formatAvailabilityDateTime(startsAt)} · return by ${formatAvailabilityDateTime(returnBy)}${risk.gapMinutes !== undefined && risk.gapMinutes !== null && risk.gapMinutes <= TURNAROUND_CRITICAL_WINDOW_MINUTES ? gap : ""}`;
      }
      return risk.message || "Tight timing — confirm the return time.";
    case "LOCATION_TRANSFER":
      return risk.message || (risk.nextLocationName
        ? `Needed next at ${risk.nextLocationName}; confirm transfer time.`
        : "Needed next at another location; confirm transfer time.");
    case "RECENT_CHECKIN_REPORT":
      if (risk.reportType === "LOST") return "Recent lost report — verify item status before reserving.";
      if (risk.reportType === "DAMAGED") return "Recent damage report — inspect before reserving.";
      return risk.message || "Recent condition report — inspect before reserving.";
    default:
      return risk.message || "Availability notice — confirm the handoff timing.";
  }
}

export function availabilityRiskBadgeLabel(risk: AvailabilityRiskLike) {
  switch (risk.code) {
    case "LOCATION_TRANSFER": return "Transfer";
    case "RECENT_CHECKIN_REPORT": return risk.reportType === "LOST" ? "Lost report" : "Condition";
    case "SHORT_TURNAROUND":
    case "BULK_SHORT_TURNAROUND":
      return risk.severity === "critical" ? "Tight timing" : "Turnaround";
    default:
      return risk.severity === "critical" ? "Tight timing" : "Notice";
  }
}

export function availabilityRiskTitle(risks: AvailabilityRiskLike[] | undefined) {
  return risks?.map(availabilityRiskMessage).join(" · ") || "Availability notice";
}

/**
 * Names the next commitment and, when the requested window is close to it,
 * states the return-by time implied by the serialized turnaround buffer.
 */
export function upcomingCommitmentLabel(
  commitment: UpcomingCommitment,
  currentEndsAt?: string,
) {
  const nextStartsAt = new Date(commitment.startsAt);
  if (!Number.isFinite(nextStartsAt.getTime())) return "Needed next";

  const nextLabel = formatAvailabilityDateTime(nextStartsAt);
  if (!currentEndsAt) return `Needed next at ${nextLabel}`;

  const currentEnd = new Date(currentEndsAt);
  if (!Number.isFinite(currentEnd.getTime())) return `Needed next at ${nextLabel}`;

  const gapMinutes = Math.max(
    0,
    Math.round((nextStartsAt.getTime() - currentEnd.getTime()) / 60_000),
  );
  if (gapMinutes > TURNAROUND_WARNING_WINDOW_MINUTES) {
    return `Next scheduled use at ${nextLabel}`;
  }
  const returnBy = new Date(nextStartsAt.getTime() - serializedTurnaroundBufferMs());
  const returnByLabel = formatAvailabilityDateTime(returnBy);

  if (gapMinutes <= TURNAROUND_CRITICAL_WINDOW_MINUTES) {
    return `Needed next at ${nextLabel} · return by ${returnByLabel} (${formatAvailabilityDuration(gapMinutes)} gap)`;
  }
  return `Needed next at ${nextLabel} · return by ${returnByLabel}`;
}

export function upcomingCommitmentTitle(commitment: UpcomingCommitment) {
  return commitment.bookingTitle
    ? `Needed next for ${commitment.bookingTitle}`
    : "Needed next by another booking";
}

export function turnaroundBadgeLabel(severity: "warning" | "critical") {
  return severity === "critical" ? "Tight timing" : "Turnaround";
}

export { SERIALIZED_TURNAROUND_BUFFER_MINUTES };
