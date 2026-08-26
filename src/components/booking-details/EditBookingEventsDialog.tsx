"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BOOKING_CHANGE_SYNC_EVENT } from "@/hooks/use-booking-change-sync";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { BOOKING_MUTATION_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { BOOKING_SNAPSHOT_HEADER } from "@/lib/booking-concurrency";
import { formatDateTime } from "@/lib/format";
import { MAX_LINKED_EVENTS_PER_BOOKING } from "@/lib/request-limits";
import type { BookingDetail } from "./types";

type CalendarEventOption = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
};

type Props = {
  open: boolean;
  booking: BookingDetail;
  onOpenChange: (open: boolean) => void;
  onUpdated: (booking: BookingDetail) => void;
};

function currentBookingEvents(booking: BookingDetail): CalendarEventOption[] {
  if (booking.events && booking.events.length > 0) {
    return booking.events.map((event) => ({
      id: event.id,
      summary: event.summary,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      sportCode: event.sportCode,
      opponent: event.opponent,
      isHome: event.isHome,
    }));
  }
  if (!booking.event) return [];
  return [{
    id: booking.event.id,
    summary: booking.event.summary,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    sportCode: booking.event.sportCode,
    opponent: booking.event.opponent,
    isHome: booking.event.isHome,
  }];
}

function mergeEvents(primary: CalendarEventOption[], fallback: CalendarEventOption[]) {
  const seen = new Set<string>();
  const merged: CalendarEventOption[] = [];
  for (const event of [...primary, ...fallback]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    merged.push(event);
  }
  return merged;
}

export function EditBookingEventsDialog({
  open,
  booking,
  onOpenChange,
  onUpdated,
}: Props) {
  const existingEvents = useMemo(() => currentBookingEvents(booking), [booking]);
  const [events, setEvents] = useState<CalendarEventOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(existingEvents.map((event) => event.id));
  }, [existingEvents, open]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const now = new Date();
    const endDate = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      includePast: "false",
      limit: "200",
    });

    setLoadingEvents(true);
    setEventsError(false);
    fetchWithTimeout(`/api/calendar-events?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          setEventsError(true);
          return;
        }
        const json = await parseJsonSafely<ApiEnvelope<CalendarEventOption[]>>(res);
        setEvents(mergeEvents(json?.data ?? [], existingEvents));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEventsError(true);
        setEvents(existingEvents);
      })
      .finally(() => setLoadingEvents(false));

    return () => controller.abort();
  }, [existingEvents, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEventsError(false);
      setSaving(false);
      busyRef.current = false;
    }
  }, [open]);

  const selectedEvents = useMemo(
    () => selectedIds
      .map((id) => mergeEvents(events, existingEvents).find((event) => event.id === id))
      .filter((event): event is CalendarEventOption => Boolean(event)),
    [events, existingEvents, selectedIds],
  );

  const filteredEvents = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const source = mergeEvents(events, existingEvents);
    if (!lower) return source;
    return source.filter((event) => {
      const haystack = [
        event.summary,
        event.sportCode ?? "",
        event.opponent ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(lower);
    });
  }, [events, existingEvents, query]);

  function toggleEvent(eventId: string) {
    setSelectedIds((current) => {
      if (current.includes(eventId)) return current.filter((id) => id !== eventId);
      if (current.length >= MAX_LINKED_EVENTS_PER_BOOKING) {
        toast.error(`A booking may link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events.`);
        return current;
      }
      return [...current, eventId];
    });
  }

  async function handleSave() {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);

    let updated: BookingDetail;
    try {
      const res = await fetchWithTimeout(`/api/bookings/${booking.id}/events`, {
        method: "POST",
        timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          [BOOKING_SNAPSHOT_HEADER]: new Date(booking.updatedAt).toISOString(),
        },
        body: JSON.stringify({ eventIds: selectedIds }),
      });

      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const fallback = res.status === 409
          ? "This booking changed. Refresh before editing linked events."
          : "Could not update linked events. Refresh and try again.";
        const msg = await parseErrorMessage(res, fallback);
        toast.error(msg);
        return;
      }

      const json = await parseJsonSafely<ApiEnvelope<BookingDetail>>(res);
      if (!json?.data) {
        toast.error("Events changed, but the refreshed booking did not load.");
        return;
      }

      updated = json.data;
    } catch {
      toast.error("Could not reach the server. Linked events were not updated.");
      return;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }

    toast.success(selectedIds.length > 0 ? "Linked events updated" : "Linked events cleared");
    window.dispatchEvent(new CustomEvent(BOOKING_CHANGE_SYNC_EVENT, {
      detail: { changedBookingIds: [booking.id] },
    }));
    onUpdated(updated);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (saving) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <CalendarDays className="size-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <DialogTitle>Linked events</DialogTitle>
              <DialogDescription>
                Link this booking to up to {MAX_LINKED_EVENTS_PER_BOOKING} scheduled events. The gear window and custody state stay unchanged.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {eventsError && (
            <Alert variant="destructive">
              <AlertDescription>Events could not load. Current links are still available below.</AlertDescription>
            </Alert>
          )}

          {selectedEvents.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedEvents.map((event) => (
                <Badge key={event.id} variant="secondary" className="gap-1">
                  <span className="max-w-[220px] truncate">{event.summary}</span>
                  <button
                    type="button"
                    onClick={() => toggleEvent(event.id)}
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={`Remove ${event.summary}`}
                    disabled={saving}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No scheduled events linked.
            </p>
          )}

          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={loadingEvents ? "Loading events..." : "Search scheduled events"}
            disabled={saving}
          />

          <div className="max-h-[320px] overflow-y-auto rounded-md border">
            {filteredEvents.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {loadingEvents ? "Loading events..." : "No events found."}
              </div>
            ) : (
              <div className="divide-y">
                {filteredEvents.map((event) => {
                  const checked = selectedIds.includes(event.id);
                  const disabled = saving || (!checked && selectedIds.length >= MAX_LINKED_EVENTS_PER_BOOKING);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => toggleEvent(event.id)}
                      disabled={disabled}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Checkbox checked={checked} className="mt-0.5 pointer-events-none" tabIndex={-1} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{event.summary}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{formatDateTime(event.startsAt)}</span>
                          {event.sportCode && <Badge variant="outline" size="sm">{event.sportCode}</Badge>}
                          {event.opponent && <span className="truncate">{event.opponent}</span>}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => setSelectedIds([])}
            disabled={saving || selectedIds.length === 0}
          >
            Clear links
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={saving || eventsError && events.length === 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
