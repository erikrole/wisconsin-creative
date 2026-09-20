import type { ScheduleChangeHistorySnapshot } from "@/lib/schedule-change-history-types";
import type { ScheduleDataQualityIssue } from "@/lib/schedule-data-quality";

type ScheduleHealthQueue = {
  count: number;
  eventCount?: number;
  eventIds?: string[];
};

type ScheduleHealthNextCall = {
  eventId: string | null;
  summary: string | null;
  startsAt: string | null;
  label: string;
};

export type ScheduleGearAssignmentStatus =
  | "reserved"
  | "awaiting_pickup"
  | "checked_out"
  | "missing";

type ScheduleGearAssignmentReadiness = {
  eventId: string;
  assignmentId: string;
  userId: string;
  bookingId: string | null;
  status: ScheduleGearAssignmentStatus;
  linkType: "assignment" | "event" | "missing";
};

type ScheduleGearEventReadiness = {
  eventId: string;
  counts: {
    ready: number;
    reserved: number;
    awaitingPickup: number;
    checkedOut: number;
    missing: number;
    notLinked: number;
  };
  assignmentIds: string[];
};

type ScheduleGearReadinessSnapshot = {
  events: Record<string, ScheduleGearEventReadiness>;
  assignments: Record<string, ScheduleGearAssignmentReadiness>;
  queues: {
    missingGear: ScheduleHealthQueue;
    unlinkedAssignmentGear: ScheduleHealthQueue;
  };
};

export type ScheduleHealthSnapshot = {
  window: {
    startsAt: string | null;
    endsAt: string | null;
    includePast: boolean;
    includeArchived: boolean;
    sportCode: string | null;
  };
  nextCall: ScheduleHealthNextCall;
  queues: {
    openSlots: ScheduleHealthQueue;
    eventsWithoutCrew: ScheduleHealthQueue;
    /** Visible events held behind an open private working copy. */
    unpublishedDrafts: ScheduleHealthQueue;
    coveredEvents: ScheduleHealthQueue & { totalVisibleEvents: number };
    myShifts: ScheduleHealthQueue;
    pendingRequests: ScheduleHealthQueue;
    conflicts: ScheduleHealthQueue;
    openTrades: ScheduleHealthQueue;
    tradeApprovals: ScheduleHealthQueue;
    gearGaps: ScheduleHealthQueue;
    dataQuality: ScheduleHealthQueue & { issues: ScheduleDataQualityIssue[] };
    hiddenEvents: ScheduleHealthQueue;
    archivedEvents: ScheduleHealthQueue;
  };
  gearReadiness: ScheduleGearReadinessSnapshot;
  changeHistory: ScheduleChangeHistorySnapshot;
  partialFailures: string[];
};
