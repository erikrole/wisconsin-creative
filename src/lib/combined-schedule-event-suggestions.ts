import { calendarDate } from "@/lib/format";
import { normalizeOpponentName } from "@/lib/schedule-event-identity";
import { scheduleSportFamily } from "@/lib/schedule-sport-family";

export type CombineSuggestionEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  sportCode: string | null;
  opponent: string | null;
  combinedIntoId?: string | null;
  combinedEventCount?: number;
  location: { id: string; name: string } | null;
  rawLocationText: string | null;
};

export type CombinedScheduleEventSuggestion<T extends CombineSuggestionEvent = CombineSuggestionEvent> = {
  first: T;
  second: T;
  sportFamily: string;
};

export function combinedScheduleSuggestionKey(suggestion: CombinedScheduleEventSuggestion) {
  return [suggestion.first.id, suggestion.second.id].sort().join(":");
}

function venueKey(event: CombineSuggestionEvent) {
  if (event.location?.id) return `location:${event.location.id}`;
  const raw = event.rawLocationText
    ?.toLowerCase()
    .replace(/\bwis\.?\b/g, "wi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return raw ? `raw:${raw}` : null;
}

function opponentsAreCompatible(left: CombineSuggestionEvent, right: CombineSuggestionEvent) {
  const leftOpponent = normalizeOpponentName(left.opponent)?.toLowerCase() ?? null;
  const rightOpponent = normalizeOpponentName(right.opponent)?.toLowerCase() ?? null;
  return !leftOpponent || !rightOpponent || leftOpponent === rightOpponent;
}

export function suggestCombinedScheduleEventPairs<T extends CombineSuggestionEvent>(
  events: T[],
  now: Date = new Date(),
  limit = 6,
): CombinedScheduleEventSuggestion<T>[] {
  const buckets = new Map<string, { family: string; events: T[] }>();
  for (const event of events) {
    if (event.combinedIntoId || (event.combinedEventCount ?? 1) > 1) continue;
    if (new Date(event.endsAt) <= now) continue;
    const family = scheduleSportFamily(event.sportCode);
    if (!family) continue;
    const day = calendarDate(event.startsAt, event.allDay).toDateString();
    const key = `${day}:${family}`;
    const bucket = buckets.get(key) ?? { family, events: [] };
    bucket.events.push(event);
    buckets.set(key, bucket);
  }

  const suggestions: CombinedScheduleEventSuggestion<T>[] = [];
  for (const bucket of buckets.values()) {
    const sorted = [...bucket.events].sort((left, right) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() || left.id.localeCompare(right.id));
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const first = sorted[leftIndex]!;
        const second = sorted[rightIndex]!;
        const firstVenue = venueKey(first);
        const overlaps = new Date(first.startsAt) < new Date(second.endsAt)
          && new Date(second.startsAt) < new Date(first.endsAt);
        if (
          overlaps
          && firstVenue
          && firstVenue === venueKey(second)
          && opponentsAreCompatible(first, second)
        ) {
          suggestions.push({ first, second, sportFamily: bucket.family });
        }
      }
    }
  }

  return suggestions
    .sort((left, right) =>
      new Date(left.first.startsAt).getTime() - new Date(right.first.startsAt).getTime()
      || left.first.id.localeCompare(right.first.id)
      || left.second.id.localeCompare(right.second.id))
    .slice(0, limit);
}
