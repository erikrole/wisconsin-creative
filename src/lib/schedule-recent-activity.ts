import type { ScheduleChangeItem, ScheduleChangeKind } from "@/lib/schedule-change-history-types";
import type { ScheduleHealthSnapshot } from "@/lib/schedule-health-types";

export const SCHEDULE_ACTIVITY_FEED_LIMIT = 5;
const SCHEDULE_ACTIVITY_SHEET_LIMIT = 40;

const SCHEDULE_RECENT_ACTIVITY_KINDS = new Set<ScheduleChangeKind>([
  "assignment_assigned",
  "assignment_removed",
  "assignment_updated",
  "pickup_claimed",
  "pickup_requested",
  "published",
  "republished",
  "event_created",
  "event_updated",
]);

const SCHEDULE_SYNC_KINDS = new Set<ScheduleChangeKind>(["event_created", "event_updated"]);

const RELEVANT_SYNC_LABELS = new Set([
  "Start",
  "End",
  "All day",
  "Opponent",
  "Home/Away",
  "Site",
  "Venue",
  "Location",
  "Sport",
  "Status",
  "Title",
]);

const BROADCAST_NOISE =
  /\b(tv|television|broadcast|radio|btn|fs1|fs2|espn\+?|peacock|nbc|cbs|fox|big ten network|b1g\+|learfield|pac-?12 network)\b/i;

function stripBroadcastNoise(value: string) {
  return value
    .replace(/\s*[-–—|:]\s*(tv|television|broadcast|radio)\b.*$/i, "")
    .replace(BROADCAST_NOISE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|:]\s*$/g, "")
    .trim();
}

function partLabel(part: string) {
  if (part === "Venue changed" || part === "Location changed") return "Venue";
  if (part === "Pickup location changed") return "Pickup location";
  return part.split(":")[0]?.trim() ?? "";
}

function coreMatchup(value: string) {
  return stripBroadcastNoise(value)
    .replace(/\s*[-–—,]\s*[^-–—,]+$/g, "")
    .replace(/[-–—][^-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isCosmeticIdentityChange(part: string) {
  const label = partLabel(part);
  if (label !== "Title" && label !== "Opponent") return false;
  const value = part.replace(/^(Title|Opponent):\s*/, "");
  const [from, to] = value.split(" → ").map((side) => coreMatchup(side.trim()));
  return Boolean(from && to && from === to);
}

function titleChangeIsBroadcastOnly(part: string) {
  const value = part.replace(/^Title:\s*/, "");
  const [from, to] = value.split(" → ").map((side) => stripBroadcastNoise(side.trim()));
  if (from && to) return from === to;
  return stripBroadcastNoise(value).length === 0 || BROADCAST_NOISE.test(value);
}

function isScheduleRelevantSyncPart(part: string) {
  const label = partLabel(part);
  if (label === "Title" || label === "Opponent") {
    if (isCosmeticIdentityChange(part) || (label === "Title" && titleChangeIsBroadcastOnly(part))) {
      return false;
    }
    return true;
  }
  return RELEVANT_SYNC_LABELS.has(label);
}

export function scheduleRelevantSyncDetail(detail: string | null | undefined): string | null {
  if (!detail || detail === "Calendar listing refreshed") return null;
  const kept = detail
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && isScheduleRelevantSyncPart(part));
  const hasOpponent = kept.some((part) => partLabel(part) === "Opponent");
  const deduped = hasOpponent ? kept.filter((part) => partLabel(part) !== "Title") : kept;
  return deduped.length > 0 ? deduped.join(" · ") : null;
}

function withScheduleRelevantSyncDetail(item: ScheduleChangeItem): ScheduleChangeItem | null {
  if (item.kind === "event_created") return item;
  if (item.kind !== "event_updated") return item;
  const detail = scheduleRelevantSyncDetail(item.detail);
  if (!detail) return null;
  return { ...item, detail };
}

function rankedScheduleActivityItems(
  health: ScheduleHealthSnapshot,
  kinds: Set<ScheduleChangeKind>,
): ScheduleChangeItem[] {
  return Object.values(health.changeHistory.events)
    .flatMap((summary) => summary.items)
    .filter((item) => kinds.has(item.kind))
    .map(withScheduleRelevantSyncDetail)
    .filter((item): item is ScheduleChangeItem => item != null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function recentScheduleActivityItems(
  health: ScheduleHealthSnapshot | null,
): ScheduleChangeItem[] {
  if (!health) return [];
  return rankedScheduleActivityItems(health, SCHEDULE_RECENT_ACTIVITY_KINDS)
    .slice(0, SCHEDULE_ACTIVITY_SHEET_LIMIT);
}

export function recentScheduleSyncItems(
  health: ScheduleHealthSnapshot | null,
): ScheduleChangeItem[] {
  if (!health) return [];
  return rankedScheduleActivityItems(health, SCHEDULE_SYNC_KINDS)
    .slice(0, SCHEDULE_ACTIVITY_SHEET_LIMIT);
}
