"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, Clock, MapPin, RefreshCw, WifiOff, AlertTriangle, Pencil, RotateCcw, Users, PackageCheck, Plane, History, Cloud, Sparkles, MergeIcon, UnlinkIcon } from "lucide-react";
import { format } from "date-fns";
import { classifyError, handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { useFetch } from "@/hooks/use-fetch";
import { toast } from "sonner";
import { SPORT_CODES, sportLabel } from "@/lib/sports";
import { formatTimeShort } from "@/lib/format";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import { VENUE_TONES, venueBadgeVariant, venueToneFromIsHome } from "@/lib/venue-tone";
import type { VenueTone } from "@/lib/venue-tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import type { CalendarEvent, ShiftGroupSummary, CommandCenterData } from "./_utils";
import { formatRelativeTime } from "@/lib/format";
import { EventSkeleton } from "./_components/EventSkeleton";
import { ShiftCoverageCard } from "./_components/ShiftCoverageCard";
import { EventTravelCard } from "./_components/EventTravelCard";
import { EventWorkersCard } from "./_components/EventWorkersCard";
import { effectiveCallWindow, summarizeEffectiveCallWindows } from "@/lib/shift-call-windows";
import { QUARTER_HOUR_MINUTES, roundUpToQuarterHour } from "@/lib/quarter-hour";

type LocationOption = { id: string; name: string };
type EventTypeDraft = VenueTone;

function opponentLabel(event: CalendarEvent) {
  if (!event.opponent) return null;
  if (event.isHome === false) return `at ${event.opponent}`;
  return `vs ${event.opponent}`;
}

function locationDisplay(event: CalendarEvent): string | null {
  return event.rawLocationText ?? null;
}

function pickupLocationDisplay(event: CalendarEvent): string | null {
  return event.location?.name ?? null;
}

function eventTypeFromEvent(event: CalendarEvent): EventTypeDraft {
  if (!event.opponent) return "non-game";
  return venueToneFromIsHome(event.isHome);
}

function eventTypeLabel(type: EventTypeDraft): string {
  if (type === "non-game") return "Non-game";
  return VENUE_TONES[type].label;
}

function eventDraftDate(value: string, allDay: boolean, isEnd: boolean) {
  const date = new Date(value);
  if (!allDay) return date;
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - (isEnd ? 1 : 0),
  );
}

function eventDraftTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function buildEventDraftDateTime(date: Date | undefined, time: string, allDay: boolean, isEnd: boolean) {
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

function EventDateTimeField({
  label,
  fieldId,
  date,
  time,
  allDay,
  disabled,
  onDateChange,
  onTimeChange,
}: {
  label: string;
  fieldId: string;
  date: Date | undefined;
  time: string;
  allDay: boolean;
  disabled: boolean;
  onDateChange: (date: Date | undefined) => void;
  onTimeChange: (time: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="min-w-0 flex-1 justify-start gap-2 font-normal"
              disabled={disabled}
              aria-label={`${label} date`}
            >
              <Calendar className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{date ? format(date, "MMM d, yyyy") : "Pick a date"}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DatePickerCalendar mode="single" selected={date} onSelect={onDateChange} initialFocus />
          </PopoverContent>
        </Popover>
        {!allDay && (
          <Input
            id={fieldId}
            type="time"
            step={QUARTER_HOUR_MINUTES * 60}
            value={time}
            onChange={(event) => onTimeChange(event.target.value)}
            className="w-[120px] shrink-0 tabular-nums"
            disabled={disabled}
            aria-label={`${label} time`}
          />
        )}
      </div>
    </div>
  );
}

function sourceState(event: CalendarEvent) {
  if (!event.source) {
    return {
      label: "Manual",
      description: "Created directly in Schedule.",
      icon: Sparkles,
      badgeVariant: "purple" as const,
    };
  }
  const edited = event.summaryLocked || event.isHomeLocked || event.locationLocked;
  if (edited) {
    return {
      label: "Edited",
      description: `Synced from ${event.source.name}; display fields were adjusted here.`,
      icon: Pencil,
      badgeVariant: "orange" as const,
    };
  }
  return {
    label: "Synced",
    description: `Synced from ${event.source.name}.`,
    icon: Cloud,
    badgeVariant: "blue" as const,
  };
}

function compactNumber(value: number) {
  return value.toLocaleString("en-US");
}

function combinedSourceTime(event: Pick<CalendarEvent, "startsAt" | "endsAt" | "allDay">) {
  if (event.allDay) return formatCalendarEventDateRange(event, { includeYear: true });
  const date = new Date(event.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${date} · ${formatTimeShort(event.startsAt)} - ${formatTimeShort(event.endsAt)}`;
}

function titleCase(value: string) {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setBreadcrumbLabel } = useBreadcrumbLabel();
  const [acting, setActing] = useState<string | null>(null);
  const [uncombiningId, setUncombiningId] = useState<string | null>(null);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [subtitleDraft, setSubtitleDraft] = useState("");
  const [eventTypeDraft, setEventTypeDraft] = useState<EventTypeDraft>("non-game");
  const [sportCodeDraft, setSportCodeDraft] = useState("__none__");
  const [opponentDraft, setOpponentDraft] = useState("");
  const [locationIdDraft, setLocationIdDraft] = useState<string>("__none__");
  const [allDayDraft, setAllDayDraft] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState<Date | undefined>();
  const [startTimeDraft, setStartTimeDraft] = useState("09:00");
  const [endDateDraft, setEndDateDraft] = useState<Date | undefined>();
  const [endTimeDraft, setEndTimeDraft] = useState("17:00");
  const [startTimingTouched, setStartTimingTouched] = useState(false);
  const [endTimingTouched, setEndTimingTouched] = useState(false);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const savingRef = useRef(false);
  const nudgeRef = useRef(false);
  const uncombineRef = useRef(false);

  const {
    data: event,
    loading: eventLoading,
    refreshing: eventRefreshing,
    error: fetchError,
    lastRefreshed,
    reload: reloadEvent,
  } = useFetch<CalendarEvent>({
    url: `/api/calendar-events/${id}`,
    returnTo: `/events/${id}`,
  });

  const {
    data: shiftGroup,
    reload: reloadShiftGroup,
  } = useFetch<ShiftGroupSummary | null>({
    url: `/api/shift-groups?eventId=${id}`,
    transform: (json) => {
      const groups = (json.data ?? []) as ShiftGroupSummary[];
      return groups[0] ?? null;
    },
  });

  const { data: meData } = useFetch<{ id: string; role: string }>({
    url: "/api/me",
    transform: (json) => (json as Record<string, unknown>).user as { id: string; role: string },
    refetchOnFocus: false,
  });
  const currentUserRole = meData?.role ?? "STUDENT";
  const isStaffOrAdmin = currentUserRole === "STAFF" || currentUserRole === "ADMIN";

  const {
    data: commandCenter,
    reload: reloadCommandCenter,
  } = useFetch<CommandCenterData | null>({
    url: `/api/calendar-events/${id}/command-center`,
    transform: (json) => (json?.data as CommandCenterData) ?? null,
    enabled: isStaffOrAdmin,
  });

  useEffect(() => {
    if (event?.summary) setBreadcrumbLabel(event.summary);
  }, [event?.summary, setBreadcrumbLabel]);

  useEffect(() => {
    if (event?.combinedInto?.id) router.replace(`/events/${event.combinedInto.id}`);
  }, [event?.combinedInto?.id, router]);

  const handleRefresh = useCallback(() => {
    reloadEvent();
    reloadShiftGroup();
    if (isStaffOrAdmin) reloadCommandCenter();
  }, [reloadEvent, reloadShiftGroup, reloadCommandCenter, isStaffOrAdmin]);

  const handleUncombine = useCallback(async (secondaryEventId: string) => {
    if (uncombineRef.current) return;
    uncombineRef.current = true;
    setUncombiningId(secondaryEventId);
    try {
      const response = await fetch("/api/calendar-events/combine", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryEventId: id, secondaryEventId }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "The event combination could not be undone"));
      toast.success("Events separated. The retained crew draft was restored without publishing it.");
      await Promise.all([reloadEvent(), reloadShiftGroup()]);
      if (isStaffOrAdmin) await reloadCommandCenter();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The event combination could not be undone");
    } finally {
      uncombineRef.current = false;
      setUncombiningId(null);
    }
  }, [id, isStaffOrAdmin, reloadCommandCenter, reloadEvent, reloadShiftGroup]);

  function openEdit() {
    if (!event) return;
    setTitleDraft(event.summary);
    setSubtitleDraft(event.subtitle ?? "");
    setEventTypeDraft(eventTypeFromEvent(event));
    setSportCodeDraft(event.sportCode ?? "__none__");
    setOpponentDraft(event.opponent ?? "");
    setLocationIdDraft(event.location?.id ?? "__none__");
    setAllDayDraft(event.allDay);
    setStartDateDraft(eventDraftDate(event.startsAt, event.allDay, false));
    setStartTimeDraft(event.allDay ? "09:00" : eventDraftTime(event.startsAt));
    setEndDateDraft(eventDraftDate(event.endsAt, event.allDay, true));
    setEndTimeDraft(event.allDay ? "17:00" : eventDraftTime(event.endsAt));
    setStartTimingTouched(false);
    setEndTimingTouched(false);
    setEditError("");
    setEditOpen(true);

    // Fetch locations on every open so the list stays fresh
    setLocationsLoading(true);
    fetch("/api/locations")
      .then(async (res) => {
        if (handleAuthRedirect(res, `/events/${id}`)) return null;
        if (!res.ok) {
          toast.error(await parseErrorMessage(res, "Failed to load locations"));
          return null;
        }
        return parseJsonSafely<{ data?: LocationOption[] }>(res);
      })
      .then((json) => {
        if (json?.data) setLocations(json.data);
      })
      .catch((err) => {
        toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to load locations");
      })
      .finally(() => setLocationsLoading(false));
  }

  async function patchEvent(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/calendar-events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (handleAuthRedirect(res)) return false;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to update event");
        toast.error(msg);
        return false;
      }
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
      toast.error("Network error");
      return false;
    }
  }

  async function handleSaveEdit() {
    if (!event || !titleDraft.trim()) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setEditError("");
    try {
      const body: Record<string, unknown> = {};

      if (!event.source) {
        const draftStartsAt = buildEventDraftDateTime(startDateDraft, startTimeDraft, allDayDraft, false);
        const draftEndsAt = buildEventDraftDateTime(endDateDraft, endTimeDraft, allDayDraft, true);
        if (!draftStartsAt || !draftEndsAt) {
          setEditError("Start and end dates are required");
          return;
        }
        const timingModeChanged = allDayDraft !== event.allDay;
        // Preserve untouched legacy off-grid values. A newly chosen timed value
        // moves forward to the next quarter-hour so we never imply an earlier
        // event or crew commitment than the operator selected.
        const startsAt = !timingModeChanged && !startTimingTouched
          ? event.startsAt
          : !allDayDraft
            ? roundUpToQuarterHour(new Date(draftStartsAt)).toISOString()
            : draftStartsAt;
        const endsAt = !timingModeChanged && !endTimingTouched
          ? event.endsAt
          : !allDayDraft
            ? roundUpToQuarterHour(new Date(draftEndsAt)).toISOString()
            : draftEndsAt;
        if (new Date(endsAt) <= new Date(startsAt)) {
          setEditError("End must be after start");
          return;
        }
        const timingChanged = timingModeChanged
          || new Date(startsAt).getTime() !== new Date(event.startsAt).getTime()
          || new Date(endsAt).getTime() !== new Date(event.endsAt).getTime();
        if (timingChanged) {
          body.startsAt = startsAt;
          body.endsAt = endsAt;
        }
        if (allDayDraft !== event.allDay) {
          body.allDay = allDayDraft;
        }
      }

      if (titleDraft.trim() !== event.summary) {
        body.summary = titleDraft.trim();
      }
      // Always send subtitle so clearing it is persisted
      body.subtitle = subtitleDraft.trim() || null;

      const nextSportCode = sportCodeDraft === "__none__" ? null : sportCodeDraft;
      const nextOpponent = eventTypeDraft === "non-game" ? null : opponentDraft.trim() || null;
      const classificationChanged = eventTypeDraft !== eventTypeFromEvent(event)
        || nextSportCode !== event.sportCode
        || nextOpponent !== event.opponent;
      if (classificationChanged) {
        body.eventType = eventTypeDraft;
        body.sportCode = nextSportCode;
        body.opponent = nextOpponent;
      }

      const newLocationId = locationIdDraft === "__none__" ? null : locationIdDraft;
      if (newLocationId !== (event.location?.id ?? null)) {
        body.locationId = newLocationId;
      }

      if (Object.keys(body).length === 0) {
        setEditOpen(false);
        return;
      }

      const ok = await patchEvent(body);
      if (ok) {
        setEditOpen(false);
        reloadEvent();
        toast.success("Event updated");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleRevertField(field: "title" | "homeAway" | "location") {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const key = field === "title" ? "revertTitle" : field === "homeAway" ? "revertHomeAway" : "revertLocation";
      const ok = await patchEvent({ [key]: true });
      if (ok) {
        reloadEvent();
        toast.success("Reverted to synced value");
        // Refresh draft state from reloaded event
        setEditOpen(false);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (fetchError && !event) {
    return (
      <div className="py-10 px-5 max-w-md mx-auto">
        <Alert variant="destructive">
          {fetchError === "network" ? <WifiOff className="size-4" /> : <AlertTriangle className="size-4" />}
          <AlertTitle>{fetchError === "network" ? "You're offline" : "Failed to load event"}</AlertTitle>
          <AlertDescription>
            {fetchError === "network"
              ? "Check your connection and try again."
              : "The event could not be found or the server returned an error."}
          </AlertDescription>
        </Alert>
        <div className="mt-4 flex gap-3 justify-center">
          <Button variant="outline" onClick={reloadEvent}>Try again</Button>
          <Button variant="ghost" asChild>
            <Link href="/schedule">Back to schedule</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (eventLoading || !event) return <EventSkeleton />;

  const dateParam = encodeURIComponent(event.startsAt);
  const endParam = encodeURIComponent(event.endsAt);
  const titleParam = encodeURIComponent(event.summary);
  const locationParam = event.location?.id ? `&locationId=${event.location.id}` : "";
  const eventParam = `&eventId=${id}`;

  const callSummary = shiftGroup?.shifts.length
    ? summarizeEffectiveCallWindows(
        shiftGroup.shifts.map((shift) => {
          const activeAssignment = shift.assignments.find(
            (assignment) => assignment.status === "DIRECT_ASSIGNED" || assignment.status === "APPROVED",
          );
          return effectiveCallWindow(shift, activeAssignment);
        }),
        { hideAllDayEventWindows: event.allDay, hideInheritedFullDayWindows: true },
      )
    : null;

  const eventDate = event.allDay
    ? formatCalendarEventDateRange(event, { includeYear: true })
    : new Date(event.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const opponentText = opponentLabel(event);
  const eventType = eventTypeFromEvent(event);
  const anyFieldLocked = Boolean(event.source) && (event.summaryLocked || event.isHomeLocked || event.locationLocked);
  const source = sourceState(event);
  const SourceIcon = source.icon;
  const totalShifts = shiftGroup?.coverage?.total ?? shiftGroup?.shifts.length ?? 0;
  const filledShifts = shiftGroup?.coverage?.filled ?? 0;
  const gearTotal = commandCenter?.gearSummary.total ?? 0;
  const missingGearCount = commandCenter?.missingGear.length ?? 0;
  const linkedGearCount = commandCenter?.shifts.filter((shift) => shift.assignment?.linkedBookingId).length ?? 0;
  const hasTravel = event.isHome === false && Boolean(event.sportCode);
  const linkSummaryItems = [
    {
      label: "Crew",
      value: shiftGroup ? `${compactNumber(filledShifts)}/${compactNumber(totalShifts)}` : "Not set up",
      detail: shiftGroup ? "slots filled" : "create crew when ready",
      icon: Users,
      tone: shiftGroup && totalShifts > 0 && filledShifts >= totalShifts ? "text-[var(--green-text)]" : shiftGroup ? "text-[var(--orange-text)]" : "text-muted-foreground",
      wide: true,
    },
    {
      label: "Gear",
      value: isStaffOrAdmin ? compactNumber(gearTotal) : "Reserve",
      detail: isStaffOrAdmin
        ? missingGearCount > 0
          ? `${compactNumber(missingGearCount)} assignment gap${missingGearCount === 1 ? "" : "s"}`
          : linkedGearCount > 0
            ? `${compactNumber(linkedGearCount)} assignment link${linkedGearCount === 1 ? "" : "s"}`
            : "no assignment gaps"
        : "gear for this event",
      icon: PackageCheck,
      tone: missingGearCount > 0 ? "text-[var(--red-text)]" : linkedGearCount > 0 ? "text-[var(--green-text)]" : "text-muted-foreground",
      wide: false,
    },
    {
      label: "Travel",
      value: hasTravel ? "Away" : "Local",
      detail: hasTravel ? "travel roster available" : "no travel roster",
      icon: Plane,
      tone: hasTravel ? "text-[var(--orange-text)]" : "text-muted-foreground",
      wide: false,
    },
    ...(anyFieldLocked ? [{
      label: "Source",
      value: source.label,
      detail: anyFieldLocked ? "edited from source" : event.source ? "calendar import" : "manual event",
      icon: source.icon,
      tone: anyFieldLocked ? "text-[var(--orange-text)]" : event.source ? "text-[var(--blue-text)]" : "text-[var(--purple-text)]",
      wide: false,
    }] : []),
  ];

  return (
    <>
      <PageHeader title={event.summary}>
        <TooltipProvider>
          {isStaffOrAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openEdit}
                  aria-label={anyFieldLocked ? "Edit event with manual overrides" : "Edit event"}
                  className={anyFieldLocked ? "text-[var(--orange-text)] hover:text-[var(--orange-text)]" : ""}
                >
                  <Pencil className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{anyFieldLocked ? "Event has manual overrides" : "Edit event"}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={eventRefreshing}
                aria-label="Refresh event data"
              >
                <RefreshCw className={`size-4 ${eventRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), new Date())}` : "Refresh"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </PageHeader>

      {event.subtitle && (
        <p className="text-sm font-medium text-muted-foreground -mt-3 mb-3">{event.subtitle}</p>
      )}

      {/* Edit Event Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit event</DialogTitle>
            <DialogDescription className="sr-only">
              Update event details. Imported dates remain controlled by the source calendar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-title">Title</Label>
                {event.source && event.summaryLocked && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-[var(--orange-text)] hover:opacity-80"
                    onClick={() => handleRevertField("title")}
                    disabled={saving}
                  >
                    <RotateCcw className="size-3" />
                    Restore calendar value
                  </button>
                )}
              </div>
              <Input
                id="edit-title"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={200}
                placeholder="Event title"
                disabled={saving}
              />
            </div>

            {!event.source && (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">Date and time</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Moving the event also moves its crew and call times. Existing gear reservation windows stay unchanged.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="edit-all-day"
                    checked={allDayDraft}
                    onCheckedChange={(checked) => setAllDayDraft(checked === true)}
                    disabled={saving}
                  />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="edit-all-day" className="cursor-pointer">All-day event</Label>
                    <p className="text-xs text-muted-foreground">
                      {allDayDraft ? "Uses inclusive dates with no call time." : "Uses the selected local start and end times."}
                    </p>
                  </div>
                </div>
                <EventDateTimeField
                  label="Starts"
                  fieldId="edit-start-time"
                  date={startDateDraft}
                  time={startTimeDraft}
                  allDay={allDayDraft}
                  disabled={saving}
                  onDateChange={(date) => {
                    setStartDateDraft(date);
                    setStartTimingTouched(true);
                  }}
                  onTimeChange={(time) => {
                    setStartTimeDraft(time);
                    setStartTimingTouched(true);
                  }}
                />
                <EventDateTimeField
                  label={allDayDraft ? "Ends (inclusive)" : "Ends"}
                  fieldId="edit-end-time"
                  date={endDateDraft}
                  time={endTimeDraft}
                  allDay={allDayDraft}
                  disabled={saving}
                  onDateChange={(date) => {
                    setEndDateDraft(date);
                    setEndTimingTouched(true);
                  }}
                  onTimeChange={(time) => {
                    setEndTimeDraft(time);
                    setEndTimingTouched(true);
                  }}
                />
              </div>
            )}

            {/* Subtitle */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-subtitle">Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="edit-subtitle"
                value={subtitleDraft}
                onChange={(e) => setSubtitleDraft(e.target.value)}
                maxLength={100}
                placeholder="e.g. Homecoming, Big Ten Tournament"
                disabled={saving}
              />
            </div>

            {editError && (
              <Alert variant="destructive">
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}

            {/* Event type */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Event type</Label>
                {event.source && event.isHomeLocked && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-[var(--orange-text)] hover:opacity-80"
                    onClick={() => handleRevertField("homeAway")}
                    disabled={saving}
                  >
                    <RotateCcw className="size-3" />
                    Restore calendar value
                  </button>
                )}
              </div>
              <ToggleGroup
                type="single"
                value={eventTypeDraft}
                onValueChange={(value) => {
                  if (!value) return;
                  const nextType = value as EventTypeDraft;
                  setEventTypeDraft(nextType);
                  if (nextType === "non-game") setOpponentDraft("");
                }}
                disabled={saving}
                className="h-9 w-full gap-0 rounded-md border border-input bg-background p-0.5"
              >
                {(["home", "away", "neutral", "non-game"] as EventTypeDraft[]).map((type) => (
                  <ToggleGroupItem
                    key={type}
                    value={type}
                    className="h-8 flex-1 rounded-sm px-2 text-sm data-[state=on]:bg-muted data-[state=on]:text-foreground"
                  >
                    {eventTypeLabel(type)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-sport">
                Sport
                {eventTypeDraft === "non-game" && <span className="text-muted-foreground font-normal"> (optional)</span>}
              </Label>
              <Select
                value={sportCodeDraft}
                onValueChange={setSportCodeDraft}
                disabled={saving}
              >
                <SelectTrigger id="edit-sport">
                  <SelectValue placeholder="No sport" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No sport</SelectItem>
                  {SPORT_CODES.map((sport) => (
                    <SelectItem key={sport.code} value={sport.code}>{sport.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {eventTypeDraft !== "non-game" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-opponent">Opponent</Label>
                <Input
                  id="edit-opponent"
                  value={opponentDraft}
                  onChange={(e) => setOpponentDraft(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Notre Dame"
                  disabled={saving}
                />
              </div>
            )}

            {/* Location */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-location">Pickup location</Label>
                {event.source && event.locationLocked && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-[var(--orange-text)] hover:opacity-80"
                    onClick={() => handleRevertField("location")}
                    disabled={saving}
                  >
                    <RotateCcw className="size-3" />
                    Restore calendar value
                  </button>
                )}
              </div>
              <Select
                value={locationIdDraft}
                onValueChange={setLocationIdDraft}
                disabled={saving || locationsLoading}
              >
                <SelectTrigger id="edit-location">
                  <SelectValue placeholder={locationsLoading ? "Loading…" : "No pickup location"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No pickup location</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {event.rawLocationText && (
                <p className="text-[11px] text-muted-foreground">Event venue from calendar: {event.rawLocationText}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleSaveEdit}
              disabled={
                saving
                || !titleDraft.trim()
                || (!event.source && (!startDateDraft || !endDateDraft))
                || (eventTypeDraft !== "non-game" && (sportCodeDraft === "__none__" || !opponentDraft.trim()))
              }
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="mb-6 rounded-xl bg-background p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={event.status === "CANCELLED" ? "red" : "green"} className="h-7 px-3 text-xs">
                  {titleCase(event.status)}
                </Badge>
                <Badge variant={source.badgeVariant} className="h-7 gap-1.5 px-3 text-xs">
                  <SourceIcon />
                  {source.label}
                </Badge>
                {event.sportCode && <Badge variant="purple" className="h-7 px-3 text-xs">{sportLabel(event.sportCode)}</Badge>}
                {event.opponent ? (
                  <Badge variant={venueBadgeVariant(event.isHome)} className="h-7 px-3 text-xs">
                    {VENUE_TONES[venueToneFromIsHome(event.isHome)].label}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3.5 shrink-0" />
                  {eventDate}
                </span>
                {!event.allDay && (
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <Clock className="size-3.5 shrink-0" />
                    {formatTimeShort(event.startsAt)} - {formatTimeShort(event.endsAt)}
                  </span>
                )}
                {callSummary?.label && (
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    {callSummary.label}
                  </span>
                )}
                {opponentText && <span>{opponentText}</span>}
                {eventType === "non-game" && <span>Non-game</span>}
                {locationDisplay(event) && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0" />
                    {locationDisplay(event)}
                  </span>
                )}
                {pickupLocationDisplay(event) && event.rawLocationText && pickupLocationDisplay(event) !== event.rawLocationText && (
                  <span className="text-xs">Pickup: {pickupLocationDisplay(event)}</span>
                )}
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground [text-wrap:pretty]">{source.description}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {linkSummaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className={cn("rounded-lg bg-muted/45 px-3 py-3", item.wide && "lg:col-span-2")}>
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Icon className={cn("size-3.5", item.tone)} />
                    {item.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none tracking-normal tabular-nums">{item.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
                </div>
              );
            })}
          </div>

          {anyFieldLocked && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--orange-bg)] px-3 py-2 text-xs text-[var(--orange-text)]">
              <History className="size-3.5" />
              Edited fields:
              {event.summaryLocked && <Badge variant="outline" size="sm">Title</Badge>}
              {event.isHomeLocked && <Badge variant="outline" size="sm">Event type</Badge>}
              {event.locationLocked && <Badge variant="outline" size="sm">Pickup location</Badge>}
            </div>
          )}
        </div>
      </section>

      {event.combinedEvents.length > 0 && (
        <Card className="mb-6 border-orange-500/25">
          <CardContent className="grid gap-4 p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-orange-500/10 text-[var(--orange-text)]">
                <MergeIcon className="size-4" />
              </div>
              <div>
                <p className="font-medium">Combined event</p>
                <p className="text-sm text-muted-foreground">One shared crew covers both source events.</p>
              </div>
            </div>
            <div className="grid gap-2">
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <p className="text-sm font-medium">{event.summary}</p>
                <p className="text-xs text-muted-foreground">{combinedSourceTime(event)}</p>
              </div>
              {event.combinedEvents.map((sourceEvent) => (
                <div key={sourceEvent.id} className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{sourceEvent.summary}</p>
                    <p className="text-xs text-muted-foreground">{combinedSourceTime(sourceEvent)}</p>
                  </div>
                  {isStaffOrAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={uncombiningId !== null}
                      onClick={() => void handleUncombine(sourceEvent.id)}
                    >
                      <UnlinkIcon data-icon="inline-start" />
                      {uncombiningId === sourceEvent.id ? "Undoing…" : "Undo combination"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {isStaffOrAdmin && (
              <p className="text-xs text-muted-foreground">Undo restores the retained secondary crew draft, but does not publish or release it.</p>
            )}
          </CardContent>
        </Card>
      )}

      {shiftGroup ? (
        <ShiftCoverageCard
          shiftGroup={shiftGroup}
          commandCenter={commandCenter}
          currentUserId={meData?.id}
          currentUserRole={currentUserRole}
          acting={acting}
          linkParams={{ titleParam, dateParam, endParam, locationParam, eventParam }}
          eventAllDay={event.allDay}
          eventEndsAt={event.endsAt}
          onUpdated={() => {
            reloadShiftGroup();
            if (isStaffOrAdmin) reloadCommandCenter();
          }}
          onNudge={async (assignmentId, userName) => {
            if (nudgeRef.current || acting) return;
            nudgeRef.current = true;
            setActing(assignmentId);
            try {
              const res = await fetch("/api/notifications/nudge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignmentId }),
              });
              if (handleAuthRedirect(res)) return;
              if (!res.ok) {
                const msg = await parseErrorMessage(res, "Failed to send nudge");
                toast.error(msg);
              } else {
                toast.success(`Nudge sent to ${userName}`);
              }
            } catch (err) {
              if (isAbortError(err)) return;
              const kind = classifyError(err);
              toast.error(kind === "network" ? "You're offline - nudge not sent" : "Something went wrong - nudge not sent");
            } finally {
              nudgeRef.current = false;
              setActing(null);
            }
          }}
        />
      ) : isStaffOrAdmin ? (
        <Card className="mt-4">
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              No crew is set up. Use the Schedule event menu to choose a crew template.
            </p>
            <Button variant="outline" className="h-10" asChild>
              <Link href="/schedule">Open Schedule</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isStaffOrAdmin && (
        <EventWorkersCard eventId={id} isAdmin={currentUserRole === "ADMIN"} />
      )}

      {event.isHome === false && event.sportCode && (
        <EventTravelCard eventId={id} sportCode={event.sportCode} isStaff={isStaffOrAdmin} />
      )}

      <div className="flex gap-2 mt-6 max-sm:flex-col sm:flex-row flex-wrap">
        <Button asChild className="min-h-11 px-5 active:scale-[0.96] transition-transform">
          <Link href={`/reservations?title=${titleParam}&startsAt=${dateParam}&endsAt=${endParam}${locationParam}${eventParam}`}>
            Reserve gear for this event
          </Link>
        </Button>
        {isStaffOrAdmin && (
          <Button variant="outline" asChild className="min-h-11 px-5 active:scale-[0.96] transition-transform">
            <Link href="/schedule">
              Review schedule
            </Link>
          </Button>
        )}
      </div>

      {currentUserRole === "ADMIN" && (
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Raw ICS data</summary>
          <pre className="bg-muted p-3 rounded-lg mt-2 overflow-auto">
            {JSON.stringify({ rawSummary: event.rawSummary, rawLocationText: event.rawLocationText, rawDescription: event.rawDescription }, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}
