"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClockIcon, XIcon } from "lucide-react";
import { SPORT_CODES, sportLabel } from "@/lib/sports";
import { formatChipTime, formatDateTime } from "@/lib/format";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import { cn } from "@/lib/utils";
import { MAX_LINKED_EVENTS_PER_BOOKING } from "@/lib/request-limits";
import { VENUE_TONES, venueBadgeVariant, venueToneFromIsHome } from "@/lib/venue-tone";
import {
  toLocalDateTimeValue,
  type FormUser,
  type Location,
  type CalendarEvent,
} from "@/components/booking-list/types";
import { MAX_SCROLL_HEIGHT } from "./constants";
import type { FormState, FormAction, ShiftInfo } from "@/components/create-booking/types";

type WizardConfig = {
  kind: "RESERVATION";
  label: string;
  requesterLabel: string;
  startLabel: string;
  endLabel: string;
  defaultTieToEvent: boolean;
};

type Props = {
  form: FormState;
  dispatch: Dispatch<FormAction>;
  config: WizardConfig;
  users: FormUser[];
  locations: Location[];
  kits: { id: string; name: string }[];
  kitsLoading: boolean;
  kitsLoadError: false | "network" | "server";
  kitId: string;
  setKitId: Dispatch<SetStateAction<string>>;
  onRetryKits: () => void;
  events: CalendarEvent[];
  eventsLoading: boolean;
  eventsLoadError: false | "network" | "server";
  onRetryEvents: () => void;
  myShiftForEvent: ShiftInfo | null;
  toggleEvent: (ev: CalendarEvent) => { ok: boolean; reason?: string };
};

function eventDateLabel(ev: CalendarEvent, includeYear = false) {
  return ev.allDay
    ? formatCalendarEventDateRange(ev, { includeYear })
    : includeYear
      ? formatDateTime(ev.startsAt)
      : formatChipTime(ev.startsAt);
}

function eventSummaryLabel(ev: CalendarEvent) {
  if (ev.opponent) {
    return `${ev.sportCode ? `${sportLabel(ev.sportCode)} ` : ""}${ev.isHome === false ? "at" : "vs"} ${ev.opponent}`;
  }
  return ev.summary;
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const labelContent = (
    <>
      {label}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {labelContent}
        </Label>
      ) : (
        <span className="text-sm font-medium">{labelContent}</span>
      )}
      {children}
    </div>
  );
}

export function WizardStep1({
  form,
  dispatch,
  config,
  users,
  locations,
  kits,
  kitsLoading,
  kitsLoadError,
  kitId,
  setKitId,
  onRetryKits,
  events,
  eventsLoading,
  eventsLoadError,
  onRetryEvents,
  myShiftForEvent,
  toggleEvent,
}: Props) {
  const selectedEventIds = new Set(form.selectedEvents.map((e) => e.id));
  const atCap = form.selectedEvents.length >= MAX_LINKED_EVENTS_PER_BOOKING;
  const contextBadgeLabel = form.tieToEvent
    ? form.selectedEvents.length > 0
      ? `${form.selectedEvents.length}/${MAX_LINKED_EVENTS_PER_BOOKING} linked`
      : "Event linked"
    : "Ad hoc";
  const contextBadgeVariant: "green" | "blue" | "secondary" = form.tieToEvent
    ? form.selectedEvents.length > 0
      ? "green"
      : "blue"
    : "secondary";
  return (
    <div className="flex flex-col gap-8">

      {/* ═══ Event Section ═══ */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Context</h2>
            <Badge variant={contextBadgeVariant} size="sm">
              {contextBadgeLabel}
            </Badge>
          </div>
          <div className="flex h-9 items-center gap-2 rounded-md border border-border/70 bg-background px-3">
            <Switch
              id="booking-link-to-event"
              aria-label="Link to event"
              checked={form.tieToEvent}
              onCheckedChange={(value) => dispatch({ type: "SET_TIE_TO_EVENT", value })}
            />
            <Label htmlFor="booking-link-to-event" className="cursor-pointer whitespace-nowrap text-xs text-muted-foreground">
              Link to event
            </Label>
          </div>
        </div>

        {form.tieToEvent && (
          <div className="flex flex-col gap-3 rounded-xl border border-border/50 bg-background/90 p-3 shadow-xs">
            {/* Sport filter */}
            <div className="flex flex-col gap-1.5">
              <Select
                name="booking-sport-filter"
                value={form.sport || "__all__"}
                onValueChange={(v) => dispatch({ type: "SET_SPORT", value: v === "__all__" ? "" : v })}
              >
                <SelectTrigger id="booking-sport-filter-trigger">
                  <SelectValue placeholder="All sports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sports</SelectItem>
                  {SPORT_CODES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Selected-event chips */}
            {form.selectedEvents.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.selectedEvents.map((ev) => (
                  <Button
                    key={ev.id}
                    type="button"
                    variant="secondary"
                    onClick={() => toggleEvent(ev)}
                    className="h-10 rounded-full"
                    aria-label={`Remove ${ev.opponent ?? ev.summary}`}
                  >
                    <span className="font-medium">
                      {eventDateLabel(ev)}
                      {" · "}
                      {eventSummaryLabel(ev)}
                    </span>
                    <XIcon />
                  </Button>
                ))}
              </div>
            )}

            {/* Events list */}
            <div className="flex flex-col gap-1.5">
              {eventsLoading ? (
                <div
                  className="flex flex-col gap-0.5 rounded-md border border-border/60 p-1"
                  aria-label="Loading events"
                  aria-busy="true"
                >
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex min-h-11 items-center gap-3 px-3 py-2.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <Skeleton className="h-3.5 w-44 max-w-[70%]" />
                        <Skeleton className="h-3 w-56 max-w-[85%]" />
                      </div>
                      <Skeleton className="h-5 w-12 shrink-0 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : eventsLoadError ? (
                <Alert variant="destructive">
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {eventsLoadError === "network"
                        ? "Calendar unavailable."
                        : "Events failed to load."}
                    </span>
                    <span className="flex shrink-0 flex-wrap gap-2">
                      <Button className="h-10" type="button" variant="outline" onClick={onRetryEvents}>
                        Retry
                      </Button>
                      <Button className="h-10"
                        type="button"
                        variant="ghost"
                        onClick={() => dispatch({ type: "SET_TIE_TO_EVENT", value: false })}
                      >
                        Ad hoc
                      </Button>
                    </span>
                  </AlertDescription>
                </Alert>
              ) : events.length === 0 ? (
                <div className="flex flex-col items-start gap-3 rounded-sm border border-dashed p-4 text-sm text-muted-foreground">
                  <p className="leading-relaxed">
                    No upcoming events{form.sport ? ` for ${sportLabel(form.sport)}` : ""}.
                  </p>
                  <Button className="h-10"
                    type="button"
                    variant="outline"
                    onClick={() => dispatch({ type: "SET_TIE_TO_EVENT", value: false })}
                  >
                    Ad hoc
                  </Button>
                </div>
              ) : (
                <div
                  className="flex flex-col gap-0.5 overflow-y-auto rounded-md border border-border/60 p-1"
                  style={{ maxHeight: MAX_SCROLL_HEIGHT }}
                >
                  {events.map((ev) => {
                    const selected = selectedEventIds.has(ev.id);
                    // At cap, unselected rows stay focusable and clickable so
                    // toggleEvent can surface the cap toast — never hard-disabled.
                    const capped = !selected && atCap;
                    const eventLabel = `${eventDateLabel(ev, true)} ${eventSummaryLabel(ev)}`;
                    return (
                      <div
                        key={ev.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleEvent(ev)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleEvent(ev);
                          }
                        }}
                        aria-pressed={selected}
                        aria-disabled={capped || undefined}
                        aria-label={`${selected ? "Unlink" : "Link"} ${eventLabel}`}
                        className={cn(
                          "group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-left outline-none",
                          "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                          selected
                            ? "bg-muted text-foreground hover:bg-muted"
                            : capped
                              ? "opacity-40 hover:bg-transparent"
                              : "hover:bg-muted/60",
                        )}
                      >
                        {/* Explicit selection affordance */}
                        <Checkbox
                          checked={selected}
                          tabIndex={-1}
                          aria-hidden="true"
                          className="pointer-events-none shrink-0"
                        />

                        {/* Match info — sport name inline, no chip */}
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "text-sm font-semibold truncate",
                              "text-foreground",
                            )}
                          >
                            {ev.sportCode && ev.opponent && (
                              <span
                                className={cn(
                                  "font-normal",
                                  "text-muted-foreground",
                                )}
                              >
                                {sportLabel(ev.sportCode)}
                                {ev.opponent ? " \u00b7 " : ""}
                              </span>
                            )}
                            {ev.opponent ? (
                              <>{ev.isHome === false ? "at " : "vs "}{ev.opponent}</>
                            ) : (
                              ev.summary
                            )}
                          </div>
                          <div
                            className={cn(
                              "text-xs mt-0.5 truncate",
                              "text-muted-foreground",
                            )}
                          >
                            {eventDateLabel(ev, true)}
                            {ev.rawLocationText ? ` \u00b7 ${ev.rawLocationText}` : ""}
                            {ev.location ? ` \u00b7 ${ev.location.name}` : ""}
                          </div>
                        </div>

                        {/* Venue badge */}
                        <div className="shrink-0 flex items-center gap-1.5">
                          {ev.opponent && (
                            <Badge variant={venueBadgeVariant(ev.isHome)} size="sm">
                              {VENUE_TONES[venueToneFromIsHome(ev.isHome)].label}
                            </Badge>
                          )}
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shift context banner (primary event) */}
        {myShiftForEvent && form.selectedEvents.length > 0 && (
          <div
            className="flex items-center gap-3 rounded-r-sm border-l-[3px] border-l-primary bg-muted/40 px-3 py-2.5"
          >
            <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-bold">Your shift</span>
              <span className="text-xs text-muted-foreground ml-1.5">
                {myShiftForEvent.area} &middot;{" "}
                {new Date(myShiftForEvent.startsAt)
                  .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                  .toLowerCase()}
                {" \u2013 "}
                {new Date(myShiftForEvent.endsAt)
                  .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                  .toLowerCase()}
              </span>
            </div>
            {myShiftForEvent.gearStatus !== "none" && (
              <Badge
                variant={
                  myShiftForEvent.gearStatus === "checked_out"
                    ? "green"
                    : myShiftForEvent.gearStatus === "reserved"
                      ? "orange"
                      : "gray"
                }
                size="sm"
              >
                {myShiftForEvent.gearStatus === "checked_out"
                  ? "Gear out"
                  : myShiftForEvent.gearStatus === "reserved"
                    ? "Gear reserved"
                    : "Draft"}
              </Badge>
            )}
          </div>
        )}
      </section>

      {/* ═══ Booking Details Section ═══ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Details</h2>

        <div className="flex flex-col gap-4 rounded-xl border border-border/50 bg-background/90 p-4 shadow-xs">
          {/* Title */}
          <Field label="Booking name" required htmlFor="booking-title">
            <Input
              id="booking-title"
              name="booking-title"
              value={form.title}
              onChange={(e) => dispatch({ type: "SET_TITLE", value: e.target.value })}
              placeholder={form.tieToEvent ? "Select an event..." : "Game day equipment"}
              required
            />
          </Field>

          {/* Sport (when not tied to event) */}
          {!form.tieToEvent && (
            <Field label="Sport" htmlFor="booking-sport-trigger">
              <Select
                name="booking-sport"
                value={form.sport || "__none__"}
                onValueChange={(v) => dispatch({ type: "SET_SPORT", value: v === "__none__" ? "" : v })}
              >
                <SelectTrigger id="booking-sport-trigger">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {SPORT_CODES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {/* Requester + Location (2-col on sm+) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={config.requesterLabel} required htmlFor="booking-requester-trigger">
              <Select
                name="booking-requester"
                value={form.requester}
                onValueChange={(v) => dispatch({ type: "SET_REQUESTER", value: v })}
                required
              >
                <SelectTrigger id="booking-requester-trigger">
                  {/* JSX attributes don't process \u escapes \u2014 use the literal character */}
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Location" required htmlFor="booking-location-trigger">
              <Select
                name="booking-location"
                value={form.locationId}
                onValueChange={(v) => dispatch({ type: "SET_LOCATION_ID", value: v })}
                required
              >
                <SelectTrigger id="booking-location-trigger">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Kit (optional) */}
          {(kits.length > 0 || kitsLoading || kitsLoadError) && (
            <Field label="Kit" htmlFor="booking-kit-trigger">
              {kitsLoadError ? (
                <Alert variant="destructive">
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>Kits failed to load.</span>
                    <Button type="button" variant="outline" onClick={onRetryKits} className="h-10 shrink-0">
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : kitsLoading && kits.length === 0 ? (
                <div className="rounded-sm border border-dashed p-3 text-sm text-muted-foreground">
                  Loading kits...
                </div>
              ) : (
                <Select
                  name="booking-kit"
                  value={kitId || "__none__"}
                  onValueChange={(v) => setKitId(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger id="booking-kit-trigger">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {kits.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}

          {/* Dates (2-col) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={config.startLabel} required htmlFor="booking-starts-at">
              <DateTimePicker
                id="booking-starts-at"
                value={form.startsAt ? new Date(form.startsAt) : undefined}
                onChange={(d) => dispatch({ type: "SET_STARTS_AT", value: toLocalDateTimeValue(d) })}
                placeholder="Start date & time"
              />
            </Field>
            <Field label={config.endLabel} required htmlFor="booking-ends-at">
              <DateTimePicker
                id="booking-ends-at"
                value={form.endsAt ? new Date(form.endsAt) : undefined}
                onChange={(d) => dispatch({ type: "SET_ENDS_AT", value: toLocalDateTimeValue(d) })}
                placeholder="End date & time"
              />
            </Field>
          </div>

          {/* Notes (optional) */}
          <Field label="Notes" htmlFor="booking-notes">
            <Textarea
              id="booking-notes"
              name="booking-notes"
              value={form.notes}
              onChange={(e) => dispatch({ type: "SET_NOTES", value: e.target.value })}
              placeholder="Optional"
              rows={3}
              maxLength={10000}
            />
          </Field>
        </div>
      </section>

    </div>
  );
}
