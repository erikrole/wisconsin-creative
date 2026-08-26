"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SPORT_CODES } from "@/lib/sports";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import { QUARTER_HOUR_MINUTES, roundUpToQuarterHour } from "@/lib/quarter-hour";

type Location = { id: string; name: string };
type CreatedEvent = { id: string; summary: string };
type EventTypeDraft = "home" | "away" | "neutral" | "non-game";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

const NONE_LOCATION_VALUE = "__none";

function DateTimeField({
  label,
  fieldId,
  date,
  time,
  allDay,
  onDateChange,
  onTimeChange,
  disabled = false,
}: {
  label: string;
  fieldId: string;
  date: Date | undefined;
  time: string;
  allDay: boolean;
  onDateChange: (d: Date | undefined) => void;
  onTimeChange: (t: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${fieldId}-time`}>{label}</Label>
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="flex-1 justify-start font-normal gap-2" disabled={disabled}>
              <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
              {date ? format(date, "MMM d, yyyy") : <span className="text-muted-foreground">Pick a date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={date} onSelect={onDateChange} initialFocus />
          </PopoverContent>
        </Popover>
        {!allDay && (
          <Input
            id={`${fieldId}-time`}
            name={`${fieldId}Time`}
            type="time"
            step={QUARTER_HOUR_MINUTES * 60}
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="w-[120px] shrink-0"
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function buildDateTime(date: Date | undefined, time: string, allDay: boolean): string | null {
  if (!date) return null;
  if (allDay) {
    // All-day events are dates, not instants — emit UTC midnight of the picked
    // calendar day so the value is timezone-independent (the server stores it
    // as-is). Timed events keep their real local clock time.
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
  }
  const [h = "0", m = "0"] = time.split(":");
  const d = new Date(date);
  d.setHours(parseInt(h), parseInt(m), 0, 0);
  return roundUpToQuarterHour(d).toISOString();
}

function buildAllDayEndDate(date: Date | undefined): string | null {
  if (!date) return null;
  // Exclusive end = UTC midnight of the day *after* the last selected day.
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1)).toISOString();
}

export function NewEventSheet({ open, onOpenChange, onCreated }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsError, setLocationsError] = useState("");
  const [createdEvent, setCreatedEvent] = useState<CreatedEvent | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState("17:00");
  const [allDay, setAllDay] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [sportCode, setSportCode] = useState("");
  const [eventType, setEventType] = useState<EventTypeDraft>("non-game");
  const [opponent, setOpponent] = useState("");
  const [error, setError] = useState("");

  // Fetch locations when sheet opens
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLocationsError("");

    async function loadLocations() {
      try {
        const res = await fetch("/api/locations", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          setLocationsError("Locations could not be loaded.");
          return;
        }
        const json = await parseJsonSafely<{ data?: Location[] }>(res);
        if (!Array.isArray(json?.data)) {
          setLocationsError("Locations could not be loaded.");
          return;
        }
        setLocations(json.data ?? []);
      } catch (err) {
        if (isAbortError(err)) return;
        setLocationsError("Locations could not be loaded.");
      }
    }

    loadLocations();
    return () => controller.abort();
  }, [open]);

  function reset() {
    setTitle("");
    setStartDate(undefined);
    setStartTime("09:00");
    setEndDate(undefined);
    setEndTime("17:00");
    setAllDay(false);
    setLocationId("");
    setSportCode("");
    setEventType("non-game");
    setOpponent("");
    setError("");
    setLocationsError("");
    setCreatedEvent(null);
  }

  function finishCreatedEvent(mode: "another" | "open" | "list") {
    const eventId = createdEvent?.id;
    if (mode === "another") {
      reset();
      return;
    }
    reset();
    onOpenChange(false);
    if (mode === "open" && eventId) {
      router.push(`/events/${eventId}`);
    }
  }

  const allDayPreview = (() => {
    if (!allDay || !startDate || !endDate) return null;
    const startsAt = buildDateTime(startDate, startTime, true);
    const endsAt = buildAllDayEndDate(endDate);
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) return null;
    return formatCalendarEventDateRange({ startsAt, endsAt, allDay: true });
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    setError("");

    const startsAt = buildDateTime(startDate, startTime, allDay);
    const endsAt = allDay
      ? buildAllDayEndDate(endDate)
      : buildDateTime(endDate, endTime, allDay);

    if (!title.trim()) { setError("Title is required"); return; }
    if (!startsAt) { setError("Start date is required"); return; }
    if (!endsAt) { setError("End date is required"); return; }
    if (new Date(endsAt) <= new Date(startsAt)) { setError("End must be after start"); return; }
    if (eventType !== "non-game" && !sportCode) { setError("Sport is required for a game event"); return; }
    if (eventType !== "non-game" && !opponent.trim()) { setError("Opponent is required for a game event"); return; }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch("/api/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: title.trim(),
          startsAt,
          endsAt,
          allDay,
          locationId: locationId || null,
          sportCode: sportCode || null,
          eventType,
          opponent: eventType === "non-game" ? null : opponent.trim(),
        }),
      });

      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to create event");
        setError(msg);
        return;
      }

      const json = await parseJsonSafely<{ data?: CreatedEvent }>(res);
      const event = json?.data;
      if (!event?.id || !event.summary) {
        setError("The event was created, but the response could not be read. Refresh the schedule before adding another.");
        onCreated();
        return;
      }
      toast.success(`"${event.summary}" added to schedule`);
      onCreated();
      reset();
      setCreatedEvent(event);
    } catch {
      setError("Network error - check your connection");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (submitting) return; onOpenChange(v); if (!v) reset(); }}>
      <SheetContent className="sm:inset-y-auto sm:bottom-auto sm:top-4 sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-xl sm:rounded-lg sm:border">
        <SheetHeader>
          <SheetTitle>New event</SheetTitle>
          <SheetDescription>Add an event directly to the schedule.</SheetDescription>
        </SheetHeader>

        <SheetBody className="px-6 py-5">
          {createdEvent ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertDescription>
                  Event {createdEvent.summary} was added. Return to the refreshed schedule to choose its crew template.
                </AlertDescription>
              </Alert>
              <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
                <p className="font-medium">Next step</p>
                <p className="mt-1 text-muted-foreground">
                  Use the event row menu for Home, Away, or empty crew setup. Open Event detail to assign staff, manage slots, and set call windows.
                </p>
              </div>
            </div>
          ) : (
          <form id="new-event-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                placeholder="e.g. Men's Basketball vs Duke"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>

            {/* All-day toggle */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="all-day"
                checked={allDay}
                onCheckedChange={(v) => setAllDay(!!v)}
                disabled={submitting}
              />
              <Label htmlFor="all-day" className="cursor-pointer">All-day event</Label>
            </div>

            {/* Start / End */}
            <DateTimeField
              label={allDay ? "Start date" : "Start"}
              fieldId="event-start"
              date={startDate}
              time={startTime}
              allDay={allDay}
              onDateChange={(d) => {
                setStartDate(d);
                // Auto-set end date if not yet set
                if (d && !endDate) setEndDate(d);
              }}
              onTimeChange={setStartTime}
              disabled={submitting}
            />
            <DateTimeField
              label={allDay ? "End date" : "End"}
              fieldId="event-end"
              date={endDate}
              time={endTime}
              allDay={allDay}
              onDateChange={setEndDate}
              onTimeChange={setEndTime}
              disabled={submitting}
            />

            {allDay && (
              <Alert>
                <AlertDescription>
                  {allDayPreview
                    ? `Creates one all-day event covering ${allDayPreview}. Crew, coverage, and bookings stay attached to this event.`
                    : "Choose inclusive start and end dates for one all-day event."}
                </AlertDescription>
              </Alert>
            )}

            {/* Pickup location */}
            <div className="flex flex-col gap-1.5">
              <Label>Pickup location</Label>
              <Select
                value={locationId || NONE_LOCATION_VALUE}
                onValueChange={(v) => setLocationId(v === NONE_LOCATION_VALUE ? "" : v)}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No pickup location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_LOCATION_VALUE}>No pickup location</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {locationsError && (
                <p className="text-xs text-muted-foreground">{locationsError}</p>
              )}
            </div>

            {/* Event classification */}
            <div className="flex flex-col gap-1.5">
              <Label>Event type</Label>
              <Select
                value={eventType}
                onValueChange={(value) => {
                  const nextType = value as EventTypeDraft;
                  setEventType(nextType);
                  if (nextType === "non-game") setOpponent("");
                }}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home game</SelectItem>
                  <SelectItem value="away">Away game</SelectItem>
                  <SelectItem value="neutral">Neutral-site game</SelectItem>
                  <SelectItem value="non-game">Non-game</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {eventType === "non-game"
                  ? "Use for media days, practices, meetings, travel, and other schedule work without an opponent."
                  : "Game events require a sport and opponent so Home, Away, and Neutral stay distinct."}
              </p>
            </div>

            {/* Sport */}
            <div className="flex flex-col gap-1.5">
              <Label>
                Sport
                {eventType === "non-game" && <span className="text-muted-foreground font-normal"> (optional)</span>}
              </Label>
              <Select
                value={sportCode || "__none"}
                onValueChange={(v) => setSportCode(v === "__none" ? "" : v)}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {SPORT_CODES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {eventType !== "non-game" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="opponent">Opponent</Label>
                <Input
                  id="opponent"
                  placeholder="e.g. Duke"
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  disabled={submitting}
                />
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
          )}
        </SheetBody>

        <SheetFooter>
          {createdEvent ? (
            <>
              <Button variant="outline" type="button" onClick={() => finishCreatedEvent("another")}>
                Add another event
              </Button>
              <Button variant="outline" type="button" onClick={() => finishCreatedEvent("list")}>
                Return to schedule
              </Button>
              <Button type="button" onClick={() => finishCreatedEvent("open")}>
                Open event
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" form="new-event-form" disabled={submitting}>
                {submitting ? "Adding..." : "Add event"}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
