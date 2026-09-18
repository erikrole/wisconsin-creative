"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MergeIcon, UnlinkIcon, WifiOff, AlertTriangle } from "lucide-react";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { useFetch } from "@/hooks/use-fetch";
import { useCurrentUser } from "@/hooks/use-current-user";
import { toast } from "sonner";
import { formatTimeShort } from "@/lib/format";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import { venueToneFromIsHome } from "@/lib/venue-tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import { scheduleEventTitleParts } from "@/app/(app)/schedule/_components/types";
import type { CalendarEvent, ShiftGroupSummary, CommandCenterData } from "./_utils";
import { EventSkeleton } from "./_components/EventSkeleton";
import { EventHeader } from "./_components/EventHeader";
import { ShiftCoverageCard } from "./_components/ShiftCoverageCard";
import { EventActivityCard } from "./_components/EventActivityCard";
import { EventTravelCard } from "./_components/EventTravelCard";
import { EventWorkersCard } from "./_components/EventWorkersCard";
import { CrewSetupChoices, type CrewTemplateSide } from "@/app/(app)/schedule/_components/ScheduleCrewSheet";
import { EventEditorFields, eventEditorIsComplete } from "@/components/event-editor/EventEditorFields";
import { effectiveCallWindow, studentCallTimeAppliesToEvent, summarizeEffectiveCallWindows } from "@/lib/shift-call-windows";
import { roundUpToQuarterHour } from "@/lib/quarter-hour";
import {
  NONE_LOCATION_VALUE,
  NONE_SPORT_VALUE,
  buildEventDraftDateTime,
  emptyEventEditorDraft,
  eventDraftDate,
  eventDraftTime,
  type EventEditorDraft,
  type EventTypeDraft,
} from "@/lib/event-editor";

type LocationOption = { id: string; name: string };

function eventTypeFromEvent(event: CalendarEvent): EventTypeDraft {
  if (!event.opponent) return "non-game";
  return venueToneFromIsHome(event.isHome);
}

function combinedSourceTime(event: Pick<CalendarEvent, "startsAt" | "endsAt" | "allDay">) {
  if (event.allDay) return formatCalendarEventDateRange(event, { includeYear: true });
  const date = new Date(event.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${date} · ${formatTimeShort(event.startsAt)} - ${formatTimeShort(event.endsAt)}`;
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setBreadcrumbLabel } = useBreadcrumbLabel();
  const [uncombiningId, setUncombiningId] = useState<string | null>(null);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [studentCallOpen, setStudentCallOpen] = useState(false);
  const [settingUpSide, setSettingUpSide] = useState<CrewTemplateSide | null>(null);
  const settingUpRef = useRef(false);
  const [editDraft, setEditDraft] = useState<EventEditorDraft>(emptyEventEditorDraft);
  const [startTimingTouched, setStartTimingTouched] = useState(false);
  const [endTimingTouched, setEndTimingTouched] = useState(false);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const savingRef = useRef(false);
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

  const { data: meData } = useCurrentUser();
  const currentUserRole = meData?.role ?? "STUDENT";
  const isStaffOrAdmin = currentUserRole === "STAFF" || currentUserRole === "ADMIN";

  const {
    data: commandCenter,
    loading: commandCenterLoading,
    reload: reloadCommandCenter,
  } = useFetch<CommandCenterData | null>({
    url: `/api/calendar-events/${id}/command-center`,
    transform: (json) => (json?.data as CommandCenterData) ?? null,
    enabled: isStaffOrAdmin,
  });

  useEffect(() => {
    if (!event) return;
    const title = scheduleEventTitleParts({
      summary: event.summary,
      sportCode: event.sportCode,
      opponent: event.opponent,
      isHome: event.isHome,
      site: event.site,
      location: event.location,
      combinedEventCount: event.combinedEvents.length,
    }).title;
    setBreadcrumbLabel(title);
  }, [event, setBreadcrumbLabel]);

  useEffect(() => {
    if (event?.combinedInto?.id) router.replace(`/events/${event.combinedInto.id}`);
  }, [event?.combinedInto?.id, router]);

  const handleRefresh = useCallback(() => {
    reloadEvent();
    reloadShiftGroup();
    if (isStaffOrAdmin) reloadCommandCenter();
  }, [reloadEvent, reloadShiftGroup, reloadCommandCenter, isStaffOrAdmin]);

  const setupCrew = useCallback(async (templateSide: CrewTemplateSide) => {
    if (!id || settingUpRef.current) return;
    settingUpRef.current = true;
    setSettingUpSide(templateSide);
    try {
      const res = await fetch("/api/shift-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: id, templateSide }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: { id?: string } }>(res);
        if (!json?.data?.id) {
          toast.error("Crew setup response was incomplete. Refresh and try again.");
          return;
        }
        const templateLabel = templateSide === "EMPTY" ? "Empty" : templateSide === "HOME" ? "Home" : "Away";
        toast.success(`${templateLabel} crew setup created.`);
        reloadShiftGroup();
        if (isStaffOrAdmin) reloadCommandCenter();
      } else {
        toast.error(await parseErrorMessage(res, "Failed to set up crew"));
      }
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error(error instanceof TypeError ? "You're offline - crew setup was not created" : "Failed to set up crew");
    } finally {
      settingUpRef.current = false;
      setSettingUpSide(null);
    }
  }, [id, isStaffOrAdmin, reloadCommandCenter, reloadShiftGroup]);

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
    setEditDraft({
      title: event.summary,
      subtitle: event.subtitle ?? "",
      allDay: event.allDay,
      startDate: eventDraftDate(event.startsAt, event.allDay, false),
      startTime: event.allDay ? "09:00" : eventDraftTime(event.startsAt),
      endDate: eventDraftDate(event.endsAt, event.allDay, true),
      endTime: event.allDay ? "17:00" : eventDraftTime(event.endsAt),
      locationId: event.location?.id ?? NONE_LOCATION_VALUE,
      sportCode: event.sportCode ?? NONE_SPORT_VALUE,
      eventType: eventTypeFromEvent(event),
      opponent: event.opponent ?? "",
    });
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
    if (!event || !editDraft.title.trim()) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setEditError("");
    try {
      const body: Record<string, unknown> = {};
      const draftStartsAt = buildEventDraftDateTime(editDraft.startDate, editDraft.startTime, editDraft.allDay, false);
      const draftEndsAt = buildEventDraftDateTime(editDraft.endDate, editDraft.endTime, editDraft.allDay, true);
      if (!draftStartsAt || !draftEndsAt) {
        setEditError("Start and end dates are required");
        return;
      }
      const timingModeChanged = editDraft.allDay !== event.allDay;
      // Preserve untouched legacy off-grid values. A newly chosen timed value
      // moves forward to the next quarter-hour so we never imply an earlier
      // event or crew commitment than the operator selected.
      const startsAt = !timingModeChanged && !startTimingTouched
        ? event.startsAt
        : !editDraft.allDay
          ? roundUpToQuarterHour(new Date(draftStartsAt)).toISOString()
          : draftStartsAt;
      const endsAt = !timingModeChanged && !endTimingTouched
        ? event.endsAt
        : !editDraft.allDay
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
      if (editDraft.allDay !== event.allDay) {
        body.allDay = editDraft.allDay;
      }

      if (editDraft.title.trim() !== event.summary) {
        body.summary = editDraft.title.trim();
      }
      // Always send subtitle so clearing it is persisted
      body.subtitle = editDraft.subtitle.trim() || null;

      const nextSportCode = editDraft.sportCode === NONE_SPORT_VALUE ? null : editDraft.sportCode;
      const nextOpponent = editDraft.eventType === "non-game" ? null : editDraft.opponent.trim() || null;
      const classificationChanged = editDraft.eventType !== eventTypeFromEvent(event)
        || nextSportCode !== event.sportCode
        || nextOpponent !== event.opponent;
      if (classificationChanged) {
        body.eventType = editDraft.eventType;
        body.sportCode = nextSportCode;
        body.opponent = nextOpponent;
      }

      const newLocationId = editDraft.locationId === NONE_LOCATION_VALUE ? null : editDraft.locationId;
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
        reloadShiftGroup();
        toast.success("Event updated");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleRevertField(field: "title" | "homeAway" | "location" | "timing") {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const key = field === "title"
        ? "revertTitle"
        : field === "homeAway"
          ? "revertHomeAway"
          : field === "location"
            ? "revertLocation"
            : "revertTiming";
      const ok = await patchEvent({ [key]: true });
      if (ok) {
        reloadEvent();
        reloadShiftGroup();
        toast.success("Reverted to synced value");
        setEditOpen(false);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleHideEvent(isHidden: boolean) {
    if (hiding || savingRef.current) return;
    setHiding(true);
    try {
      const res = await fetch(`/api/calendar-events/${id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, isHidden ? "Failed to hide event" : "Failed to show event"));
        return;
      }
      toast.success(isHidden ? "Event hidden from schedule" : "Event restored to schedule");
      reloadEvent();
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Network error");
    } finally {
      setHiding(false);
    }
  }

  async function handleRemoveEvent() {
    if (removing || savingRef.current) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/calendar-events/${id}`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to remove event"));
        return;
      }
      toast.success("Event removed");
      setRemoveOpen(false);
      setEditOpen(false);
      router.push("/schedule");
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Network error");
    } finally {
      setRemoving(false);
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

  const studentCallTimeVisible = isStaffOrAdmin || studentCallTimeAppliesToEvent(event);
  const callSummary = shiftGroup?.shifts.length && studentCallTimeVisible
    ? summarizeEffectiveCallWindows(
        shiftGroup.shifts.filter((shift) => shift.workerType === "ST").map((shift) => {
          const activeAssignment = shift.assignments.find(
            (assignment) => assignment.status === "DIRECT_ASSIGNED" || assignment.status === "APPROVED",
          );
          return effectiveCallWindow(shift, activeAssignment);
        }),
        { hideAllDayEventWindows: event.allDay, hideInheritedFullDayWindows: true },
      )
    : null;

  const reserveHref = `/reservations?title=${titleParam}&startsAt=${dateParam}&endsAt=${endParam}${locationParam}${eventParam}`;
  const eventHasEnded = new Date(event.endsAt).getTime() <= Date.now();

  return (
    <div className="flex flex-col gap-4">
      {event.isHidden && isStaffOrAdmin && (
        <Alert>
          <AlertTitle>Hidden from schedule</AlertTitle>
          <AlertDescription>
            This event stays in the calendar but does not appear on Schedule. Restore it from Edit event.
          </AlertDescription>
        </Alert>
      )}
      <EventHeader
        event={event}
        callLabel={callSummary?.label ?? null}
        crewCoverage={shiftGroup?.coverage ?? null}
        isStaffOrAdmin={isStaffOrAdmin}
        refreshing={eventRefreshing}
        lastRefreshed={lastRefreshed}
        reserveHref={reserveHref}
        onEdit={openEdit}
        onRefresh={handleRefresh}
        onEditStudentCall={isStaffOrAdmin && !event.allDay && shiftGroup ? () => setStudentCallOpen(true) : undefined}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit event</DialogTitle>
            <DialogDescription className="sr-only">
              Change the title, label, times, type, or pickup location. Hide imported games from Schedule, or remove an added event.
            </DialogDescription>
          </DialogHeader>

          <EventEditorFields
            draft={editDraft}
            onChange={(patch) => setEditDraft((current) => ({ ...current, ...patch }))}
            locations={locations}
            locationsLoading={locationsLoading}
            disabled={saving || hiding || removing}
            imported={Boolean(event.source)}
            venueHint={event.rawLocationText}
            locks={{
              title: event.summaryLocked,
              type: event.isHomeLocked,
              location: event.locationLocked,
              timing: event.timingLocked,
            }}
            onRevert={{
              title: () => void handleRevertField("title"),
              type: () => void handleRevertField("homeAway"),
              location: () => void handleRevertField("location"),
              timing: () => void handleRevertField("timing"),
            }}
            onStartTimingTouch={() => setStartTimingTouched(true)}
            onEndTimingTouch={() => setEndTimingTouched(true)}
          />

          {editError && (
            <Alert variant="destructive">
              <AlertDescription>{editError}</AlertDescription>
            </Alert>
          )}

          {isStaffOrAdmin && (
            <div className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{event.isHidden ? "Show on schedule" : "Hide from schedule"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {event.source
                      ? "Imported events stay on UWBadgers.com. Hide is how they leave our schedule."
                      : "Hides this added event without deleting its crew."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0"
                  disabled={saving || hiding || removing}
                  onClick={() => void handleHideEvent(!event.isHidden)}
                >
                  {hiding ? "Updating…" : event.isHidden ? "Show" : "Hide"}
                </Button>
              </div>
              {!event.source && (
                <div className="flex items-start justify-between gap-3 border-t border-destructive/15 pt-3">
                  <div>
                    <p className="text-sm font-medium">Remove event</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Deletes this added event and its crew. Gear reservations stay.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-10 shrink-0"
                    disabled={saving || hiding || removing}
                    onClick={() => setRemoveOpen(true)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={() => void handleSaveEdit()}
              disabled={saving || hiding || removing || !eventEditorIsComplete(editDraft)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the added event and its crew from the schedule. Gear reservations stay, unlinked from the event.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void handleRemoveEvent();
              }}
            >
              {removing ? "Removing…" : "Remove event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {event.combinedEvents.length > 0 && (
        <Card elevation="flat" className="border-orange-500/25 shadow-xs">
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
                      className="h-10"
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
          eventId={id}
          shiftGroup={shiftGroup}
          currentUserId={meData?.id}
          currentUserRole={currentUserRole}
          eventAllDay={event.allDay}
          eventEndsAt={event.endsAt}
          studentCallTimeAllowed={studentCallTimeVisible}
          studentCallOpen={studentCallOpen}
          onStudentCallOpenChange={setStudentCallOpen}
          onUpdated={() => {
            reloadShiftGroup();
            if (isStaffOrAdmin) reloadCommandCenter();
          }}
        />
      ) : isStaffOrAdmin ? (
        <Card elevation="flat" className="border-border/50 shadow-xs">
          <CardHeader>
            <CardTitle>Crew</CardTitle>
            {eventHasEnded && (
              <p className="text-xs text-muted-foreground">
                This event has ended. Record who worked to update Scoreboard. Nobody is notified.
              </p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 py-1">
              <p className="text-sm text-muted-foreground">
                {eventHasEnded
                  ? "No scheduled crew. Set one up to assign slots, or record unslotted work below."
                  : "No crew is set up. Choose a starting point, then assign people in place."}
              </p>
              <CrewSetupChoices loadingSide={settingUpSide} onSetup={(side) => void setupCrew(side)} />
            </div>
            {eventHasEnded && (
              <EventWorkersCard
                eventId={id}
                isAdmin={currentUserRole === "ADMIN"}
                eventHasEnded
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {event.isHome === false && event.sportCode && (
        <EventTravelCard eventId={id} sportCode={event.sportCode} isStaff={isStaffOrAdmin} />
      )}

      {isStaffOrAdmin && (
        <EventActivityCard
          recentChanges={commandCenter?.recentChanges ?? []}
          event={event}
          loading={commandCenterLoading && !commandCenter}
          showRawSource={currentUserRole === "ADMIN"}
        />
      )}
    </div>
  );
}
