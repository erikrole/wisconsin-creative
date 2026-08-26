"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { generateEventTitle } from "@/lib/sports";
import { toast } from "sonner";
import {
  toLocalDateTimeValue,
  type CalendarEvent,
} from "../booking-list/types";
import type { FormAction } from "./types";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { MAX_LINKED_EVENTS_PER_BOOKING } from "@/lib/request-limits";
import { roundUpToQuarterHour } from "@/lib/quarter-hour";

const BOOKING_EVENT_LOOKAHEAD_DAYS = 30;

/** Derive auto-fill fields from the chronologically-first event in the list. */
export function deriveFromPrimary(events: CalendarEvent[], sport: string) {
  if (events.length === 0) return {};
  const primary = events[0]!; // guarded by events.length === 0 early return above
  const title = primary.opponent && (primary.sportCode || sport)
    ? generateEventTitle(primary.sportCode || sport, primary.opponent, primary.isHome)
    : primary.summary;
  // endsAt derives from the LAST event — multi-event span covers the whole window.
  const last = events[events.length - 1]!; // same guard: length > 0
  const allDaySpan = primary.allDay && last.allDay;
  const start = allDaySpan
    ? new Date(primary.startsAt)
    : new Date(new Date(primary.startsAt).getTime() - 2 * 60 * 60 * 1000);
  const returnBuffer = last.isHome === false ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
  const end = allDaySpan
    ? new Date(last.endsAt)
    : roundUpToQuarterHour(new Date(new Date(last.endsAt).getTime() + returnBuffer));
  return {
    title,
    startsAt: toLocalDateTimeValue(start),
    endsAt: toLocalDateTimeValue(end),
    locationId: primary.location?.id,
  };
}

export function useEventContext({
  sport,
  tieToEvent,
  open,
  selectedEvents,
  initialEventId,
  dispatch,
}: {
  sport: string;
  tieToEvent: boolean;
  open: boolean;
  selectedEvents: CalendarEvent[];
  initialEventId?: string;
  dispatch: Dispatch<FormAction>;
}) {

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLoadError, setEventsLoadError] = useState<false | "network" | "server">(false);
  const [eventsReloadKey, setEventsReloadKey] = useState(0);
  const [myShiftForEvent, setMyShiftForEvent] = useState<{
    area: string;
    startsAt: string;
    endsAt: string;
    gearStatus: string;
  } | null>(null);
  const autoSelectedEventRef = useRef(false);

  // ── Fetch events (all sports by default, filtered when sport selected) ──
  useEffect(() => {
    if (!tieToEvent || !open) {
      setEvents([]);
      setEventsLoadError(false);
      return;
    }
    setEventsLoading(true);
    setEventsLoadError(false);
    const controller = new AbortController();
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + BOOKING_EVENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      startDate: now.toISOString(),
      endDate: rangeEnd.toISOString(),
      limit: "30",
    });
    if (sport) params.set("sportCode", sport);
    fetch(`/api/calendar-events?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load events"));
        return parseJsonSafely<{ data?: CalendarEvent[] }>(res);
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        setEvents(json?.data || []);
        setEventsLoadError(false);
        setEventsLoading(false);
      })
      .catch((err) => {
        if (!isAbortError(err)) {
          setEventsLoading(false);
          setEventsLoadError(err instanceof TypeError ? "network" : "server");
          toast.error("Couldn’t load events — try again");
        }
      });
    return () => controller.abort();
  }, [sport, tieToEvent, open, eventsReloadKey]);

  const retryEvents = useCallback(() => {
    setEventsReloadKey((key) => key + 1);
  }, []);

  // ── Toggle an event in/out of the selection, enforcing cap and chronological order ──
  const toggleEvent = useCallback(
    (ev: CalendarEvent): { ok: boolean; reason?: string } => {
      const isSelected = selectedEvents.some((e) => e.id === ev.id);
      let next: CalendarEvent[];
      if (isSelected) {
        next = selectedEvents.filter((e) => e.id !== ev.id);
      } else {
        if (selectedEvents.length >= MAX_LINKED_EVENTS_PER_BOOKING) {
          toast.error(`You can link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events to a booking`);
          return { ok: false, reason: "cap" };
        }
        next = [...selectedEvents, ev].sort(
          (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        );
      }
      dispatch({
        type: "SET_SELECTED_EVENTS",
        events: next,
        ...deriveFromPrimary(next, sport),
      });
      return { ok: true };
    },
    [selectedEvents, sport, dispatch],
  );

  // ── Auto-select event when initialEventId matches a loaded event (URL deep link, single-event V0 compat) ──
  useEffect(() => {
    if (!initialEventId || autoSelectedEventRef.current || events.length === 0) return;
    const match = events.find((e) => e.id === initialEventId);
    if (match) {
      autoSelectedEventRef.current = true;
      toggleEvent(match);
    }
  }, [events, initialEventId, toggleEvent]);

  // ── Fetch shift context for the PRIMARY (first) selected event ──
  useEffect(() => {
    const primary = selectedEvents[0];
    if (!primary) {
      setMyShiftForEvent(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/my-shifts?eventId=${primary.id}`, { signal: controller.signal })
      .then(async (res) => {
        if (handleAuthRedirect(res)) return null;
        if (!res.ok) return null;
        return parseJsonSafely<{ data?: Array<{ area: string; startsAt: string; endsAt: string; gear: { status: string } }> }>(res);
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        const shifts = json?.data ?? [];
        if (shifts.length > 0) {
          const s = shifts[0];
          if (!s) return;
          setMyShiftForEvent({ area: s.area, startsAt: s.startsAt, endsAt: s.endsAt, gearStatus: s.gear.status });
        } else {
          setMyShiftForEvent(null);
        }
      })
      .catch((err) => {
        if (!isAbortError(err)) setMyShiftForEvent(null);
      });
    return () => controller.abort();
  // Primary id is what matters — track it explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvents[0]?.id]);

  return { events, eventsLoading, eventsLoadError, retryEvents, myShiftForEvent, toggleEvent };
}
