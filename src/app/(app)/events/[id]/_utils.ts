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
  site: "HOME" | "AWAY" | "NEUTRAL" | null;
  subtitle: string | null;
  isHidden: boolean;
  summaryLocked: boolean;
  isHomeLocked: boolean;
  locationLocked: boolean;
  timingLocked: boolean;
  location: { id: string; name: string } | null;
  source: { id: string; name: string; url?: string | null } | null;
  createdByName?: string | null;
  combinedInto: { id: string; summary: string } | null;
  combinedEvents: Array<{ id: string; summary: string; startsAt: string; endsAt: string; allDay: boolean; sportCode: string | null }>;
};

export type ShiftGroupSummary = {
  id: string;
  hasWorkingCopy?: boolean;
  claimsPaused?: boolean;
  /** Server verdict: false when the crew is unreleased, archived, hidden or cancelled. */
  claimsOpen?: boolean;
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
      crewLabel?: string | null;
      crewHalf?: "FIRST" | "SECOND" | null;
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
      crewLabel: string | null;
      crewHalf: "FIRST" | "SECOND" | null;
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
