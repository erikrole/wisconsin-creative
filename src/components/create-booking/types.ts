"use client";

import type { CalendarEvent } from "../booking-list/types";

/* ───── Form reducer types (shared across hooks & sub-components) ───── */

export type FormState = {
  custodyScope: "PERSON" | "SHARED";
  tieToEvent: boolean;
  sport: string;
  /** Linked events, sorted by startsAt ascending. First = primary. Max 3. */
  selectedEvents: CalendarEvent[];
  title: string;
  requester: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  notes: string;
};

export type FormAction =
  | { type: "SET_CUSTODY_SCOPE"; value: "PERSON" | "SHARED" }
  | { type: "SET_TIE_TO_EVENT"; value: boolean }
  | { type: "SET_SPORT"; value: string }
  /** Set the full selected-events list (already sorted chronologically by caller).
   *  Also auto-derives title/startsAt/endsAt from the first event when events
   *  is non-empty; noop for those fields when events is empty. */
  | { type: "SET_SELECTED_EVENTS"; events: CalendarEvent[]; title?: string; startsAt?: string; endsAt?: string }
  | { type: "SET_TITLE"; value: string }
  | { type: "SET_REQUESTER"; value: string }
  | { type: "SET_LOCATION_ID"; value: string }
  | { type: "SET_STARTS_AT"; value: string }
  | { type: "SET_ENDS_AT"; value: string }
  | { type: "SET_NOTES"; value: string }
  | { type: "RESET"; defaults: Partial<FormState> }
  | { type: "LOAD_DRAFT"; draft: Partial<FormState> };

export type Section = "event" | "details" | "equipment";

export type ShiftInfo = {
  area: string;
  startsAt: string;
  endsAt: string;
  gearStatus: string;
};
