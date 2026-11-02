import type { AvailabilityBlockLike } from "./student-availability";
/** Prisma availability dates encode a calendar date at UTC midnight, not an instant. */
export function availabilityDateKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

const dateOnly = (value: Date | string | null | undefined) => value instanceof Date ? availabilityDateKey(value) : value?.slice(0, 10);

/** Availability is entered in Madison time, including when the worker travels. */
export function availabilityToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Keep completed terms/dates and denied requests accessible without counting them as current guidance. */
export function isAvailabilityHistory(block: AvailabilityBlockLike, today = availabilityToday()): boolean {
  if (block.intent === "TIME_OFF" && block.status === "DENIED") return true;
  const end = block.kind === "AD_HOC"
    ? dateOnly(block.dateEndsOn) ?? dateOnly(block.date)
    : dateOnly(block.semesterEndsOn);
  return Boolean(end && end < today);
}
