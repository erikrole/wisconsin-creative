import type { ScheduleChangeItem, ScheduleChangeKind } from "@/lib/schedule-change-history-types";
import type { ScheduleHealthSnapshot } from "@/lib/schedule-health-types";

export const SCHEDULE_ACTIVITY_FEED_LIMIT = 5;
export const SCHEDULE_ACTIVITY_RELEASE_LIMIT = 2;
export const SCHEDULE_ACTIVITY_SHEET_LIMIT = 40;

export const SCHEDULE_RECENT_ACTIVITY_KINDS = new Set<ScheduleChangeKind>([
  "assignment_assigned",
  "assignment_removed",
  "assignment_updated",
  "pickup_claimed",
  "pickup_requested",
  "published",
  "republished",
  "event_created",
  "event_updated",
  "event_visibility_updated",
]);

export function recentScheduleActivityItems(
  health: ScheduleHealthSnapshot | null,
): ScheduleChangeItem[] {
  if (!health) return [];
  return Object.values(health.changeHistory.events)
    .flatMap((summary) => summary.items)
    .filter((item) => SCHEDULE_RECENT_ACTIVITY_KINDS.has(item.kind))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, SCHEDULE_ACTIVITY_SHEET_LIMIT);
}
