const TZ = process.env.INSTITUTION_TZ ?? "America/Chicago";

export type AvailabilityKind = "WEEKLY" | "AD_HOC";
export type AvailabilityIntent = "CANNOT_WORK" | "PREFER" | "DISLIKE" | "TIME_OFF";
export type AvailabilityStatus = "APPROVED" | "PENDING" | "DENIED";

export type AvailabilityBlockLike = {
  id?: string;
  userId?: string;
  kind?: AvailabilityKind | string | null;
  intent?: AvailabilityIntent | string | null;
  status?: AvailabilityStatus | string | null;
  dayOfWeek?: number | null;
  date?: Date | string | null;
  dateEndsOn?: Date | string | null;
  allDay?: boolean | null;
  startsAt: string;
  endsAt: string;
  label?: string | null;
  semesterLabel?: string | null;
  semesterStartsOn?: Date | string | null;
  semesterEndsOn?: Date | string | null;
};

export type AvailabilityWindow = {
  startsAt: Date;
  endsAt: Date;
};

export type AvailabilityConflict = {
  block: AvailabilityBlockLike;
  note: string;
  intent: AvailabilityIntent;
  status: AvailabilityStatus;
  blocking: boolean;
};

export type AvailabilityPreferenceEvaluation = {
  conflicts: AvailabilityConflict[];
  blocking: AvailabilityConflict | null;
  advisory: AvailabilityConflict | null;
  preferred: AvailabilityConflict | null;
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// The institution timezone is fixed for this module; reuse ICU setup across candidates.
const localPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function toLocalParts(dt: Date): { dayOfWeek: number; date: string; hhmm: string } {
  const parts = localPartsFormatter.formatToParts(dt);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const month = get("month").padStart(2, "0");
  const day = get("day").padStart(2, "0");
  const year = get("year");
  const hour = get("hour").padStart(2, "0");
  const minute = get("minute").padStart(2, "0");

  return {
    dayOfWeek: WEEKDAY_MAP[weekday] ?? 1,
    date: `${year}-${month}-${day}`,
    hhmm: `${hour}:${minute}`,
  };
}

export function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

export function timeOverlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && endA > startB;
}

function isWithinDateBounds(localDate: string, block: AvailabilityBlockLike): boolean {
  const startsOn = dateOnly(block.semesterStartsOn);
  const endsOn = dateOnly(block.semesterEndsOn);
  if (startsOn && localDate < startsOn) return false;
  if (endsOn && localDate > endsOn) return false;
  return true;
}

function blockIntent(block: AvailabilityBlockLike): AvailabilityIntent {
  if (block.intent === "PREFER" || block.intent === "DISLIKE" || block.intent === "TIME_OFF") return block.intent;
  return "CANNOT_WORK";
}

function blockStatus(block: AvailabilityBlockLike): AvailabilityStatus {
  if (block.status === "PENDING" || block.status === "DENIED") return block.status;
  return "APPROVED";
}

function formatConflictNote(block: AvailabilityBlockLike, intent = blockIntent(block), status = blockStatus(block)): string {
  const label = block.label?.trim();
  const range = `${block.startsAt}-${block.endsAt}`;
  const dateStart = dateOnly(block.date);
  const dateEnd = dateOnly(block.dateEndsOn) ?? dateStart;
  const hasDateRange = Boolean(dateStart && dateEnd && dateStart !== dateEnd);
  const detail = block.allDay
    ? hasDateRange ? `all day, ${dateStart} to ${dateEnd}` : `all day, ${dateStart ?? "this date"}`
    : hasDateRange ? `${range}, ${dateStart} to ${dateEnd}` : range;
  if (intent === "PREFER") {
    return label ? `Prefers ${label} (${detail})` : `Prefers this window ${detail}`;
  }
  if (intent === "DISLIKE") {
    return label ? `Dislikes ${label} (${detail})` : `Dislikes this window ${detail}`;
  }
  if (intent === "TIME_OFF") {
    if (status === "APPROVED") {
      return label ? `Approved time off: ${label} (${detail})` : `Approved time off ${detail}`;
    }
    if (status === "PENDING") {
      return label ? `Pending time off: ${label} (${detail})` : `Pending time off ${detail}`;
    }
    return label ? `Denied time off: ${label} (${detail})` : `Denied time off ${detail}`;
  }
  const fallback = block.kind === "AD_HOC" ? "conflict" : "class";
  return label ? `Conflicts with ${label} (${detail})` : `Conflicts with ${fallback} ${detail}`;
}

function overlapsAvailabilityBlock(block: AvailabilityBlockLike, start: ReturnType<typeof toLocalParts>, end: ReturnType<typeof toLocalParts>) {
  if (block.kind === "AD_HOC") {
    const blockStart = dateOnly(block.date);
    const blockEnd = dateOnly(block.dateEndsOn) ?? blockStart;
    if (!blockStart || !blockEnd) return false;

    // A dated range is inclusive. All-day ranges intentionally ignore the
    // stored canonical 00:00–23:59 wall-clock values so a full-day trip still
    // conflicts with any call window on any covered date.
    const datesOverlap = start.date <= blockEnd && end.date >= blockStart;
    if (!datesOverlap) return false;
    if (block.allDay) return true;
    return timeOverlaps(start.hhmm, end.hhmm, block.startsAt, block.endsAt);
  }

  if (!timeOverlaps(start.hhmm, end.hhmm, block.startsAt, block.endsAt)) return false;
  if (block.dayOfWeek !== start.dayOfWeek) return false;
  return isWithinDateBounds(start.date, block);
}

export function evaluateAvailabilityPreferences(
  blocks: AvailabilityBlockLike[],
  window: AvailabilityWindow,
): AvailabilityPreferenceEvaluation {
  const start = toLocalParts(window.startsAt);
  const end = toLocalParts(window.endsAt);
  const conflicts: AvailabilityConflict[] = [];

  for (const block of blocks) {
    if (!overlapsAvailabilityBlock(block, start, end)) continue;
    const intent = blockIntent(block);
    const status = blockStatus(block);
    if (status === "DENIED") continue;
    conflicts.push({
      block,
      intent,
      status,
      note: formatConflictNote(block, intent, status),
      blocking: intent === "TIME_OFF" && status === "APPROVED",
    });
  }

  return {
    conflicts,
    blocking: conflicts.find((conflict) => conflict.blocking) ?? null,
    advisory: conflicts.find((conflict) =>
      !conflict.blocking && (conflict.intent === "CANNOT_WORK" || conflict.intent === "DISLIKE" || conflict.intent === "TIME_OFF")
    ) ?? null,
    preferred: conflicts.find((conflict) => conflict.intent === "PREFER") ?? null,
  };
}

export function findAvailabilityConflict(
  blocks: AvailabilityBlockLike[],
  window: AvailabilityWindow,
): AvailabilityConflict | null {
  const evaluation = evaluateAvailabilityPreferences(blocks, window);
  return evaluation.blocking ?? evaluation.advisory;
}

export function availabilityConflictNote(
  blocks: AvailabilityBlockLike[],
  window: AvailabilityWindow,
): string | null {
  return findAvailabilityConflict(blocks, window)?.note ?? null;
}
