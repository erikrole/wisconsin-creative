import type { ScheduleChangeItem } from "@/lib/schedule-change-history-types";

export type CalendarEvent = {
  id: string;
  summary: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  rawSummary: string | null;
  rawLocationText: string | null;
  rawDescription: string | null;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  subtitle: string | null;
  summaryLocked: boolean;
  isHomeLocked: boolean;
  locationLocked: boolean;
  location: { id: string; name: string } | null;
  source: { id: string; name: string } | null;
};

export type ShiftGroupSummary = {
  id: string;
  hasWorkingCopy?: boolean;
  coverage?: { total: number; filled: number; percentage: number };
  publication?: {
    status: "draft" | "published" | "changed";
    publishedAt: string | null;
    publishedById: string | null;
    changedAfterPublish: boolean;
    activeAssignmentCount: number;
    acknowledgedCount: number;
    unacknowledgedCount: number;
  } | null;
  autoReleaseAt?: string | null;
  autoReleaseError?: string | null;
  shifts: Array<{
    id: string;
    area: string;
    workerType: string;
    workerLabel?: string;
    startsAt: string;
    endsAt: string;
    callStartsAt?: string | null;
    callEndsAt?: string | null;
    viewerRequest?: {
      id: string;
      status: string;
      hasConflict?: boolean;
      conflictNote?: string | null;
    } | null;
    assignments: Array<{
      id: string;
      status: string;
      callStartsAt?: string | null;
      callEndsAt?: string | null;
      callNote?: string | null;
      hasConflict?: boolean;
      conflictNote?: string | null;
      acknowledgedAt?: string | null;
      acknowledgedById?: string | null;
      user: { id: string; name: string; role: string; staffingType?: string | null; avatarUrl: string | null };
    }>;
  }>;
};

export type CommandCenterData = {
  shifts: Array<{
    id: string;
    area: string;
    workerType: string;
    workerLabel: string;
    startsAt: string;
    endsAt: string;
    callStartsAt: string;
    callEndsAt: string;
    assignment: {
      id: string;
      userId: string;
      userName: string;
      status: string;
      callStartsAt: string;
      callEndsAt: string;
      callNote: string | null;
      linkedBookingId: string | null;
      linkedBookingStatus: string | null;
    } | null;
    pendingRequests: number;
  }>;
  gearSummary: {
    total: number;
    byStatus: { draft: number; reserved: number; pendingPickup: number; checkedOut: number; completed: number };
  };
  gearPlans: Array<{
    requesterUserId: string;
    requesterName: string;
    bookingIds: string[];
    title: string;
    state: "draft" | "reserved" | "ready_for_pickup" | "partially_picked_up" | "checked_out" | "returned";
    itemCount: number;
  }>;
  missingGear: Array<{
    userId: string;
    userName: string;
    area: string;
    shiftId: string;
    assignmentId: string;
  }>;
  recentChanges: ScheduleChangeItem[];
};

export { AREA_LABELS } from "@/types/areas";

export const WORKER_LABELS: Record<string, string> = {
  FT: "Staff",
  ST: "Student",
};

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatDate(iso: string, allDay = false) {
  const d = allDay
    ? (() => { const u = new Date(iso); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); })()
    : new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}
