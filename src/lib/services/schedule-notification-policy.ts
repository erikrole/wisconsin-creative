import type { NotificationCategory } from "@/lib/services/notification-prefs";

export type WorkerScheduleNotificationEvent =
  | "assigned"
  | "requested"
  | "approved"
  | "declined"
  | "removed"
  | "shift_time_changed"
  | "personal_call_time_changed";

export type GearPrepNotificationSource = "assignment" | "manual_nudge";

export type ScheduleDigestQueue =
  | "needs-staffing"
  | "conflicts"
  | "unacknowledged"
  | "gear-gaps"
  | "trade-approval"
  | "stale-source";

export type StaffScheduleDigestInput = {
  openSlots?: number;
  conflictedAssignments?: number;
  unacknowledgedWorkers?: number;
  missingGear?: number;
  claimedTrades?: number;
  staleSources?: number;
};

export type StaffScheduleDigestCandidate = {
  queue: ScheduleDigestQueue;
  count: number;
  title: string;
  href: string;
};

const ACTIVE_WORKER_SCHEDULE_EVENTS = new Set<WorkerScheduleNotificationEvent>([
  "assigned",
  "requested",
  "approved",
  "declined",
  "removed",
  "shift_time_changed",
  "personal_call_time_changed",
]);

export function categoryForScheduleNotificationType(type: string): NotificationCategory | null {
  if (type === "shift_gear_up") return "gearPrep";
  if (type.startsWith("trade_")) return "trade";
  if (type.startsWith("shift_")) return "schedule";
  // Claim review spans both queues, so it carries neither prefix. It still has
  // to map: `sendPushToUser` skips the category gate when no category is given,
  // so an unmapped type is delivered to people who muted the category.
  if (type.startsWith("claim_review_")) return "schedule";
  return null;
}

export function shouldNotifyWorkerForScheduleEvent(args: {
  event: WorkerScheduleNotificationEvent;
  publishedAt?: Date | string | null;
}) {
  if (!ACTIVE_WORKER_SCHEDULE_EVENTS.has(args.event)) return false;
  return Boolean(args.publishedAt);
}

export function shouldNotifyGearPrep(args: {
  source: GearPrepNotificationSource;
  publishedAt?: Date | string | null;
}) {
  if (args.source === "manual_nudge") return true;
  return Boolean(args.publishedAt);
}

export function scheduleNotificationPayload(args: {
  eventId: string;
  shiftId?: string | null;
  assignmentId?: string | null;
  tradeId?: string | null;
  extra?: Record<string, unknown>;
}) {
  return {
    ...(args.extra ?? {}),
    target: "event",
    href: `/events/${args.eventId}`,
    eventId: args.eventId,
    ...(args.shiftId ? { shiftId: args.shiftId } : {}),
    ...(args.assignmentId ? { assignmentId: args.assignmentId } : {}),
    ...(args.tradeId ? { tradeId: args.tradeId } : {}),
  };
}

export function scheduleMyShiftsNotificationPayload(args: {
  rangeStartsAt: Date | string;
  rangeEndsAt: Date | string;
  sportCode?: string | null;
  extra?: Record<string, unknown>;
}) {
  const params = new URLSearchParams({
    myShifts: "true",
    startDate: new Date(args.rangeStartsAt).toISOString(),
    endDate: new Date(args.rangeEndsAt).toISOString(),
  });
  if (args.sportCode) params.set("sportCode", args.sportCode);

  return {
    ...(args.extra ?? {}),
    target: "schedule",
    href: `/schedule?${params.toString()}`,
    myShiftsOnly: true,
    ...(args.sportCode ? { sportCode: args.sportCode } : {}),
    startDate: new Date(args.rangeStartsAt).toISOString(),
    endDate: new Date(args.rangeEndsAt).toISOString(),
  };
}

export function scheduleQueueHref(queue: ScheduleDigestQueue) {
  return `/schedule?queue=${queue}`;
}

export function buildStaffScheduleDigestCandidates(
  input: StaffScheduleDigestInput,
): StaffScheduleDigestCandidate[] {
  const rows: Array<[ScheduleDigestQueue, number | undefined, string]> = [
    ["needs-staffing", input.openSlots, "Open schedule slots"],
    ["conflicts", input.conflictedAssignments, "Assignment conflicts"],
    ["unacknowledged", input.unacknowledgedWorkers, "Unacknowledged workers"],
    ["gear-gaps", input.missingGear, "Gear gaps"],
    ["trade-approval", input.claimedTrades, "Claimed trades"],
    ["stale-source", input.staleSources, "Stale calendar sources"],
  ];

  return rows.flatMap(([queue, count, title]) => {
    if (!count || count < 1) return [];
    return [{ queue, count, title, href: scheduleQueueHref(queue) }];
  });
}
