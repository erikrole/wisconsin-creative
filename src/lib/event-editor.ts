import { QUARTER_HOUR_MINUTES, roundUpToQuarterHour } from "@/lib/quarter-hour";
import type { VenueTone } from "@/lib/venue-tone";

export type EventTypeDraft = VenueTone;
export const NONE_LOCATION_VALUE = "__none__";
export const NONE_SPORT_VALUE = "__none__";

export type EventEditorDraft = {
  title: string;
  subtitle: string;
  allDay: boolean;
  startDate: Date | undefined;
  startTime: string;
  endDate: Date | undefined;
  endTime: string;
  locationId: string;
  sportCode: string;
  eventType: EventTypeDraft;
  opponent: string;
};

export function emptyEventEditorDraft(): EventEditorDraft {
  return {
    title: "",
    subtitle: "",
    allDay: false,
    startDate: undefined,
    startTime: "09:00",
    endDate: undefined,
    endTime: "17:00",
    locationId: NONE_LOCATION_VALUE,
    sportCode: NONE_SPORT_VALUE,
    eventType: "non-game",
    opponent: "",
  };
}

export function eventDraftDate(value: string, allDay: boolean, isEnd: boolean) {
  const date = new Date(value);
  if (!allDay) return date;
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - (isEnd ? 1 : 0),
  );
}

export function eventDraftTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function buildEventDraftDateTime(
  date: Date | undefined,
  time: string,
  allDay: boolean,
  isEnd: boolean,
) {
  if (!date) return null;
  if (allDay) {
    return new Date(Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + (isEnd ? 1 : 0),
    )).toISOString();
  }
  const [hours = "0", minutes = "0"] = time.split(":");
  const value = new Date(date);
  value.setHours(Number(hours), Number(minutes), 0, 0);
  return value.toISOString();
}

export function buildCreatedEventWindow(draft: EventEditorDraft) {
  const startsAt = buildEventDraftDateTime(draft.startDate, draft.startTime, draft.allDay, false);
  const endsAt = buildEventDraftDateTime(draft.endDate, draft.endTime, draft.allDay, true);
  if (!startsAt || !endsAt) return { startsAt: null, endsAt: null };
  if (draft.allDay) return { startsAt, endsAt };
  return {
    startsAt: roundUpToQuarterHour(new Date(startsAt)).toISOString(),
    endsAt: roundUpToQuarterHour(new Date(endsAt)).toISOString(),
  };
}

export { QUARTER_HOUR_MINUTES };
