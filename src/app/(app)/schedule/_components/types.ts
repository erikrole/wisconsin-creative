import type { BadgeProps } from "@/components/ui/badge";
import { cleanSourceSummary, normalizeOpponentName } from "@/lib/schedule-event-identity";
import { sportLabel } from "@/lib/sports";
import { venueToneFromEvent } from "@/lib/venue-tone";

/* ───── Types ───── */

export type CalendarEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  rawLocationText: string | null;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  site: "HOME" | "AWAY" | "NEUTRAL" | null;
  subtitle: string | null;
  archivedAt?: string | null;
  location: { id: string; name: string } | null;
  source: { id: string; name: string } | null;
};

export type ShiftUser = {
  id: string;
  name: string;
  role: string;
  staffingType?: string | null;
  primaryArea: string | null;
  avatarUrl?: string | null;
};

export type ShiftAssignment = {
  id: string;
  status: string;
  user: ShiftUser;
  activeTrade?: { id: string; status: string } | null;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  callNote?: string | null;
  hasConflict?: boolean;
  conflictNote?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedById?: string | null;
};

export type ShiftViewerRequest = {
  id: string;
  status: string;
  hasConflict?: boolean;
  conflictNote?: string | null;
};

export type Shift = {
  id: string;
  area: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  notes: string | null;
  assignments: ShiftAssignment[];
  viewerRequest?: ShiftViewerRequest | null;
};

export type ShiftGroup = {
  id: string;
  eventId: string;
  notes: string | null;
  archivedAt?: string | null;
  publication?: SchedulePublicationState | null;
  hasWorkingCopy?: boolean;
  event: { id: string; startsAt: string };
  shifts: Shift[];
  coverage: { total: number; filled: number; percentage: number };
};

export type SchedulePublicationState = {
  status: "draft" | "published" | "changed";
  publishedAt: string | null;
  publishedById: string | null;
  changedAfterPublish: boolean;
  activeAssignmentCount: number;
  acknowledgedCount: number;
  unacknowledgedCount: number;
  workingVersion?: number;
};

/** Merged entry for display */
export type CalendarEntry = CalendarEvent & {
  /** CalendarEvent archive state: older records hidden unless explicitly loaded. */
  eventArchivedAt?: string | null;
  shiftGroupId: string | null;
  coverage: { total: number; filled: number; percentage: number } | null;
  shifts: Shift[];
  /** Crew-group archive state: ended staffing work, not the older-record filter. */
  archivedAt?: string | null;
  publication?: SchedulePublicationState | null;
  hasWorkingCopy?: boolean;
};

/* ───── Constants ───── */

export { AREAS, AREA_LABELS } from "@/types/areas";
export type { Area } from "@/types/areas";

export const ACTIVE_STATUSES = ["DIRECT_ASSIGNED", "APPROVED"];

export const LS_VIEW_MODE = "schedule-view-mode";
export const LS_MY_SHIFTS = "schedule-my-shifts";

/* ───── Helpers ───── */

export function coverageVariant(pct: number): BadgeProps["variant"] {
  if (pct >= 100) return "green";
  if (pct > 0) return "orange";
  return "red";
}

export function coverageDot(pct: number): string {
  if (pct >= 100) return "var(--badge-green-bg, #22c55e)";
  if (pct > 0) return "var(--badge-orange-bg, #f59e0b)";
  return "var(--badge-red-bg, #ef4444)";
}

/** Get Monday of the week containing the given date. */
export function getMonday(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay(); // 0=Sun
  result.setDate(result.getDate() - ((day + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
}

function cleanTitleText(value: string): string {
  return cleanSourceSummary(value);
}

function splitTitleQualifier(value: string): { primary: string; qualifier: string | null } {
  const cleaned = cleanTitleText(value);
  const [primary = cleaned, ...rest] = cleaned.split(/\s*[-–—]\s+/);
  const qualifier = rest.join(" - ").trim();
  return {
    primary: primary.trim() || cleaned,
    qualifier: qualifier || null,
  };
}

type ScheduleEventTitleInput = Pick<CalendarEntry, "summary" | "sportCode" | "opponent" | "isHome"> & {
  site?: CalendarEntry["site"];
  location?: CalendarEntry["location"];
};

export function scheduleEventTitleParts(entry: ScheduleEventTitleInput): {
  title: string;
  detail: string | null;
} {
  if (entry.sportCode && entry.opponent) {
    const opponent = splitTitleQualifier(normalizeOpponentName(entry.opponent) ?? entry.opponent);
    const venueTone = venueToneFromEvent(entry);
    const venueWord = venueTone === "away" ? "at" : "vs";
    const neutralLocation = venueTone === "neutral" ? entry.location?.name ?? null : null;
    return {
      title: `${sportLabel(entry.sportCode)} ${venueWord} ${opponent.primary}`,
      detail: opponent.qualifier ?? neutralLocation,
    };
  }

  const summary = splitTitleQualifier(entry.summary);
  return {
    title: summary.primary,
    detail: summary.qualifier,
  };
}

/** Check if user has an active assignment on any shift in this entry */
export function userHasShift(entry: CalendarEntry, userId: string): boolean {
  return entry.shifts.some((s) =>
    s.assignments.some(
      (a) => a.user.id === userId && ACTIVE_STATUSES.includes(a.status),
    ),
  );
}

/** Get user's pending assignment status label for display */
export function userShiftStatus(
  entry: CalendarEntry,
  userId: string,
): string | null {
  for (const s of entry.shifts) {
    for (const a of s.assignments) {
      if (a.user.id !== userId) continue;
      if (a.status === "REQUESTED") return "Pending";
    }
  }
  return null;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
