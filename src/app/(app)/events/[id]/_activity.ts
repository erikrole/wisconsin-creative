import { AREA_LABELS } from "@/types/areas";
import type { ScheduleChangeItem, ScheduleChangeKind } from "@/lib/schedule-change-history-types";

export type ActivityFilter = "all" | "crew" | "calendar" | "gear";

export type DescribedScheduleChange = ScheduleChangeItem & {
  headline: string;
  supporting: string | null;
  actorLabel: string;
  draft: boolean;
  filter: Exclude<ActivityFilter, "all">;
  showReview: boolean;
  repeatCount?: number;
};

const CREW_KINDS = new Set<ScheduleChangeKind>([
  "assignment_assigned",
  "assignment_removed",
  "assignment_updated",
  "shift_created",
  "shift_updated",
  "shift_deleted",
  "published",
  "republished",
  "copy_forward_applied",
  "pickup_requested",
  "pickup_claimed",
  "shift_group_archived",
]);

const CALENDAR_KINDS = new Set<ScheduleChangeKind>([
  "event_created",
  "event_updated",
  "event_visibility_updated",
]);

const GEAR_KINDS = new Set<ScheduleChangeKind>(["reservation_linked"]);

const FIELD_LABELS: Record<string, string> = {
  summary: "Title",
  subtitle: "Label",
  startsAt: "Start",
  endsAt: "End",
  locationId: "Pickup location",
  callStartsAt: "Call start",
  callEndsAt: "Call end",
  callNote: "Call note",
};

export function activityFilterFor(kind: ScheduleChangeKind): Exclude<ActivityFilter, "all"> {
  if (GEAR_KINDS.has(kind)) return "gear";
  if (CALENDAR_KINDS.has(kind)) return "calendar";
  if (CREW_KINDS.has(kind)) return "crew";
  return "crew";
}

export function prettySlotLabel(value: string): string {
  return value
    .replace(/\b(VIDEO|PHOTO|GRAPHICS|COMMS|SOCIAL|LIVE_PRODUCTION)\b/g, (code) => AREA_LABELS[code] ?? code)
    .replace(/\s+slot$/i, "");
}

export function prettyChangeTarget(detail: string | null): string | null {
  if (!detail || detail === "Working copy") return null;
  const cleaned = prettySlotLabel(detail);
  const [person, slot] = cleaned.split(" · ").map((part) => part.trim());
  if (person && slot) return `${person} to ${slot}`;
  return cleaned;
}

export function prettyFieldDetail(detail: string | null): string | null {
  if (!detail || detail === "Working copy") return null;
  if (
    detail.includes(" · ")
    || detail.includes(" → ")
    || detail === "Calendar listing refreshed"
    || detail === "Venue changed"
    || detail === "Pickup location changed"
    || detail === "Location changed"
    || /^(Title|Label|Start|End|All day|Calendar start|Calendar end|Calendar all day|Opponent|Home\/Away|Site|Sport|Status|Result|Description|Venue|Pickup location):/.test(detail)
  ) {
    return detail;
  }
  const match = /^([A-Za-z]+):\s*(.+)$/.exec(detail);
  if (!match) return prettyChangeTarget(detail);
  const [, field, value] = match;
  const label = FIELD_LABELS[field ?? ""] ?? field;
  return `${label}: ${value}`;
}

export function describeScheduleChange(
  item: ScheduleChangeItem,
  sourceLabel = "Calendar",
): Omit<DescribedScheduleChange, "repeatCount"> {
  const draft = item.detail === "Working copy";
  const actorIsSystem = !item.actorId || item.actorName === "System";
  const calendarActor = actorIsSystem ? sourceLabel : item.actorName;
  const target = prettyChangeTarget(item.detail);
  const field = prettyFieldDetail(item.detail);
  const filter = activityFilterFor(item.kind);
  const showReview = item.needsReview && filter !== "calendar";
  const described = ((): Omit<DescribedScheduleChange, "repeatCount" | "showReview"> => {
    switch (item.kind) {
      case "assignment_assigned":
        return {
          ...item,
          headline: target ? `Assigned ${target}` : "Assigned a worker",
          supporting: null,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "assignment_removed":
        return {
          ...item,
          headline: target ? `Removed ${target}` : "Removed a worker",
          supporting: null,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "assignment_updated":
        return {
          ...item,
          headline: target?.includes(" to ") ? `Updated ${target}` : "Updated a call time",
          supporting: field && field !== target ? field : null,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "shift_created":
        return {
          ...item,
          headline: target ? `Added ${prettySlotLabel(target)}` : "Added a position",
          supporting: null,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "shift_updated":
        return {
          ...item,
          headline: "Updated a position",
          supporting: field,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "shift_deleted":
        return {
          ...item,
          headline: target ? `Removed ${prettySlotLabel(target)}` : "Removed a position",
          supporting: null,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "published":
        return { ...item, headline: "Published the crew", supporting: null, actorLabel: item.actorName, draft, filter };
      case "republished":
        return { ...item, headline: "Republished the crew", supporting: null, actorLabel: item.actorName, draft, filter };
      case "copy_forward_applied":
        return { ...item, headline: "Copied crew forward", supporting: field, actorLabel: item.actorName, draft, filter };
      case "pickup_requested":
        return {
          ...item,
          headline: target ? `${target} requested a shift` : "Requested a shift",
          supporting: null,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "pickup_claimed":
        return {
          ...item,
          headline: target ? `Claimed ${target}` : "Claimed an open shift",
          supporting: null,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "reservation_linked":
        return {
          ...item,
          headline: "Reserved gear",
          supporting: item.detail,
          actorLabel: item.actorName,
          draft,
          filter,
        };
      case "event_created":
        return {
          ...item,
          headline: actorIsSystem ? `Added from ${sourceLabel}` : "Created this event",
          supporting: null,
          actorLabel: calendarActor,
          draft,
          filter,
        };
      case "event_updated":
        return {
          ...item,
          headline: actorIsSystem ? `Updated from ${sourceLabel}` : "Updated event details",
          supporting: field ?? "The specific fields were not recorded.",
          actorLabel: calendarActor,
          draft,
          filter,
        };
      case "event_visibility_updated":
        return { ...item, headline: "Updated visibility", supporting: null, actorLabel: item.actorName, draft, filter };
      case "shift_group_archived":
        return { ...item, headline: "Archived the crew", supporting: null, actorLabel: item.actorName, draft, filter };
      default:
        return {
          ...item,
          headline: item.label,
          supporting: field,
          actorLabel: actorIsSystem && filter === "calendar" ? calendarActor : item.actorName,
          draft,
          filter,
        };
    }
  })();
  return { ...described, showReview };
}

export function coalesceScheduleChanges(
  items: ScheduleChangeItem[],
  sourceLabel?: string,
): DescribedScheduleChange[] {
  const out: DescribedScheduleChange[] = [];
  for (const item of items) {
    const described = describeScheduleChange(item, sourceLabel);
    const last = out[out.length - 1];
    if (
      last &&
      last.headline === described.headline &&
      last.actorId === described.actorId &&
      last.supporting === described.supporting &&
      last.draft === described.draft &&
      Math.abs(new Date(last.createdAt).getTime() - new Date(described.createdAt).getTime()) <= 5 * 60_000
    ) {
      last.repeatCount = (last.repeatCount ?? 1) + 1;
      continue;
    }
    out.push({ ...described });
  }
  return out;
}

export function activityDateGroup(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function groupActivityByDate(items: DescribedScheduleChange[], now = new Date()) {
  const groups: Array<{ label: string; items: DescribedScheduleChange[] }> = [];
  for (const item of items) {
    const label = activityDateGroup(item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}
