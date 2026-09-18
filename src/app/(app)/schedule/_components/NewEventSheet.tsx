"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  NONE_LOCATION_VALUE,
  NONE_SPORT_VALUE,
  buildCreatedEventWindow,
  createManualEventDraft,
  suggestedEventEditorTitle,
  type EventEditorDraft,
} from "@/lib/event-editor";
import { EventEditorFields, eventEditorIsComplete } from "@/components/event-editor/EventEditorFields";

type Location = { id: string; name: string };
type CreatedEvent = { id: string; summary: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function NewEventSheet({ open, onOpenChange, onCreated }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const titleTouchedRef = useRef(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsError, setLocationsError] = useState("");
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationLoadId, setLocationLoadId] = useState(0);
  const [createdEvent, setCreatedEvent] = useState<CreatedEvent | null>(null);
  const [draft, setDraft] = useState<EventEditorDraft>(createManualEventDraft);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    async function loadLocations() {
      setLocationsLoading(true);
      setLocationsError("");
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
      } finally {
        if (!controller.signal.aborted) setLocationsLoading(false);
      }
    }

    void loadLocations();
    return () => controller.abort();
  }, [open, locationLoadId]);

  function reset() {
    titleTouchedRef.current = false;
    setDraft(createManualEventDraft());
    setError("");
    setLocationsError("");
    setCreatedEvent(null);
  }

  function retryLocations() {
    setLocationLoadId((current) => current + 1);
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

  function patchDraft(next: Partial<EventEditorDraft>) {
    setDraft((current) => {
      if (next.title !== undefined) titleTouchedRef.current = true;
      const merged = { ...current, ...next };
      if (!titleTouchedRef.current) {
        const suggested = suggestedEventEditorTitle(merged);
        if (suggested && suggested !== merged.title) merged.title = suggested;
      }
      return merged;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    setError("");

    const { startsAt, endsAt } = buildCreatedEventWindow(draft);
    if (!draft.title.trim()) { setError("Title is required"); return; }
    if (!startsAt) { setError("Start date is required"); return; }
    if (!endsAt) { setError("End date is required"); return; }
    if (new Date(endsAt) <= new Date(startsAt)) { setError("End must be after start"); return; }
    if (draft.eventType !== "non-game" && draft.sportCode === NONE_SPORT_VALUE) {
      setError("Sport is required for a game event");
      return;
    }
    if (draft.eventType !== "non-game" && !draft.opponent.trim()) {
      setError("Opponent is required for a game event");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch("/api/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: draft.title.trim(),
          subtitle: draft.subtitle.trim() || null,
          startsAt,
          endsAt,
          allDay: draft.allDay,
          locationId: draft.locationId === NONE_LOCATION_VALUE ? null : draft.locationId,
          sportCode: draft.sportCode === NONE_SPORT_VALUE ? null : draft.sportCode,
          eventType: draft.eventType,
          opponent: draft.eventType === "non-game" ? null : draft.opponent.trim(),
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
      const created = event;
      titleTouchedRef.current = false;
      setDraft(createManualEventDraft());
      setError("");
      setCreatedEvent(created);
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
          <SheetTitle>{createdEvent ? "Event added" : "Add event"}</SheetTitle>
          <SheetDescription>
            {createdEvent
              ? "Staff a crew next, or add another event from here."
              : "Add a game or other work directly to the schedule."}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="px-6 py-5">
          {createdEvent ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertDescription>
                  <span className="font-medium text-foreground">{createdEvent.summary}</span>
                  {" "}is on the schedule. Open Event detail to set up a crew.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
          <form id="new-event-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <EventEditorFields
              intent="create"
              draft={draft}
              onChange={patchDraft}
              locations={locations}
              locationsError={locationsError}
              locationsLoading={locationsLoading}
              onRetryLocations={retryLocations}
              disabled={submitting}
              timingHint="Crew and call times follow this window. Gear reservations stay independent."
            />
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
              <Button variant="outline" type="button" className="h-10" onClick={() => finishCreatedEvent("another")}>
                Add another
              </Button>
              <Button variant="outline" type="button" className="h-10" onClick={() => finishCreatedEvent("list")}>
                Return to schedule
              </Button>
              <Button type="button" className="h-10" onClick={() => finishCreatedEvent("open")}>
                Open event
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" type="button" className="h-10" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" form="new-event-form" className="h-10" loading={submitting} disabled={!eventEditorIsComplete(draft)}>
                Add event
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
