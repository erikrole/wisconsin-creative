"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MergeIcon, SparklesIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  combinedScheduleSuggestionKey,
  type CombinedScheduleEventSuggestion,
} from "@/lib/combined-schedule-event-suggestions";
import { shareScheduleSportFamily } from "@/lib/schedule-sport-family";
import { scheduleEventTitleParts, type CalendarEntry } from "./types";

type CombinePreview = {
  primary: { id: string; summary: string; startsAt: string; endsAt: string; shiftGroupId: string | null; assignedCrewCount: number };
  secondary: {
    id: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    shiftGroupId: string | null;
    workingVersion: number | null;
    draftSlotCount: number;
  };
  combinedWindow: { startsAt: string; endsAt: string };
};

function eventOptionLabel(event: CalendarEntry) {
  const title = scheduleEventTitleParts(event).title;
  const time = event.allDay
    ? "All day"
    : new Date(event.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${time} · ${title}`;
}

function normalizedVenue(event: CalendarEntry) {
  if (event.location?.id) return `location:${event.location.id}`;
  const raw = event.rawLocationText
    ?.toLowerCase()
    .replace(/\bwis\.?\b/g, "wi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return raw ? `raw:${raw}` : null;
}

function isCandidate(primary: CalendarEntry, candidate: CalendarEntry) {
  if (primary.id === candidate.id || candidate.combinedIntoId || (candidate.combinedEventCount ?? 1) > 1) return false;
  const overlaps = new Date(primary.startsAt) < new Date(candidate.endsAt)
    && new Date(candidate.startsAt) < new Date(primary.endsAt);
  const venue = normalizedVenue(primary);
  return overlaps
    && Boolean(venue && venue === normalizedVenue(candidate))
    && shareScheduleSportFamily(primary.sportCode, candidate.sportCode);
}

export function CombineEventsDialog({
  open,
  onOpenChange,
  entries,
  suggestions,
  initialEventIds,
  onDismissSuggestion,
  onCombined,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: CalendarEntry[];
  suggestions: CombinedScheduleEventSuggestion<CalendarEntry>[];
  initialEventIds?: readonly [string, string] | null;
  onDismissSuggestion: (suggestion: CombinedScheduleEventSuggestion<CalendarEntry>) => void;
  onCombined: () => void | Promise<void>;
}) {
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");
  const [preview, setPreview] = useState<CombinePreview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const actingRef = useRef(false);
  const initialReviewRef = useRef<string | null>(null);
  const standalone = useMemo(
    () => entries.filter((entry) => !entry.combinedIntoId && (entry.combinedEventCount ?? 1) === 1),
    [entries],
  );
  const first = standalone.find((entry) => entry.id === firstId) ?? null;
  const candidates = first ? standalone.filter((entry) => isCandidate(first, entry)) : [];

  const reset = () => {
    setFirstId("");
    setSecondId("");
    setPreview(null);
  };

  const review = useCallback(async (eventIds?: readonly [string, string]) => {
    const selectedIds = eventIds ?? [firstId, secondId] as const;
    if (!selectedIds[0] || !selectedIds[1] || actingRef.current) return;
    setFirstId(selectedIds[0]);
    setSecondId(selectedIds[1]);
    actingRef.current = true;
    setReviewing(true);
    try {
      const response = await fetch("/api/calendar-events/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventIds: selectedIds }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "These events cannot be combined"));
      const json = await parseJsonSafely<{ data?: CombinePreview }>(response);
      if (!json?.data) throw new Error("Combine preview was incomplete. Refresh and try again.");
      setPreview(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "These events cannot be combined");
    } finally {
      actingRef.current = false;
      setReviewing(false);
    }
  }, [firstId, secondId]);

  useEffect(() => {
    if (!open || !initialEventIds) return;
    const key = [...initialEventIds].sort().join(":");
    if (initialReviewRef.current === key) return;
    initialReviewRef.current = key;
    void review(initialEventIds);
  }, [initialEventIds, open, review]);

  const apply = async () => {
    if (!preview || actingRef.current) return;
    actingRef.current = true;
    setApplying(true);
    try {
      const response = await fetch("/api/calendar-events/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventIds: [firstId, secondId],
          apply: true,
          expectedPrimaryId: preview.primary.id,
          expectedSecondaryWorkingVersion: preview.secondary.workingVersion,
        }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Events were not combined"));
      toast.success("Events combined with one shared crew.");
      onOpenChange(false);
      reset();
      await onCombined();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Events were not combined");
    } finally {
      actingRef.current = false;
      setApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying) {
          initialReviewRef.current = null;
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Combine events</DialogTitle>
          <DialogDescription>
            Use one Schedule row and one crew for two overlapping events at the same venue. Both source events stay in the system.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="grid gap-5 py-2">
            {suggestions.length > 0 && (
              <section className="grid gap-2" aria-labelledby="combine-event-suggestions">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p id="combine-event-suggestions" className="text-sm font-medium">Suggested pairs</p>
                    <p className="text-xs text-muted-foreground">Same day, sport, venue, and overlapping time.</p>
                  </div>
                  <Badge variant="secondary">{suggestions.length}</Badge>
                </div>
                <div className="grid gap-2">
                  {suggestions.map((suggestion) => (
                    <div key={combinedScheduleSuggestionKey(suggestion)} className="flex items-stretch gap-1 rounded-md border p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-h-10 min-w-0 flex-1 justify-start gap-3 px-2 py-1 text-left"
                        onClick={() => void review([suggestion.first.id, suggestion.second.id])}
                        disabled={reviewing}
                      >
                        <SparklesIcon className="size-4 shrink-0 text-[var(--orange-text)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{suggestion.sportFamily}</span>
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {eventOptionLabel(suggestion.first)} + {eventOptionLabel(suggestion.second)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-primary">Review</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-auto min-h-10 shrink-0 text-muted-foreground"
                        aria-label={`Dismiss ${suggestion.sportFamily} suggestion`}
                        onClick={() => onDismissSuggestion(suggestion)}
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="grid gap-2">
              <Label htmlFor="combine-event-first">First event</Label>
              <Select value={firstId} onValueChange={(value) => { setFirstId(value); setSecondId(""); }}>
                <SelectTrigger id="combine-event-first"><SelectValue placeholder="Choose an event" /></SelectTrigger>
                <SelectContent>
                  {standalone.map((event) => <SelectItem key={event.id} value={event.id}>{eventOptionLabel(event)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="combine-event-second">Matching event</Label>
              <Select value={secondId} onValueChange={setSecondId} disabled={!firstId}>
                <SelectTrigger id="combine-event-second"><SelectValue placeholder={firstId ? "Choose an overlapping event" : "Choose the first event"} /></SelectTrigger>
                <SelectContent>
                  {candidates.map((event) => <SelectItem key={event.id} value={event.id}>{eventOptionLabel(event)}</SelectItem>)}
                </SelectContent>
              </Select>
              {firstId && candidates.length === 0 && (
                <p className="text-sm text-muted-foreground">No same-venue, overlapping event from the same sport family is loaded.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm">
            <div>
              <p className="font-medium">Shared crew stays with</p>
              <p className="text-muted-foreground">{preview.primary.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Keep {preview.primary.assignedCrewCount} assigned crew member{preview.primary.assignedCrewCount === 1 ? "" : "s"}.
              </p>
            </div>
            <div>
              <p className="font-medium">Combined source event</p>
              <p className="text-muted-foreground">{preview.secondary.summary}</p>
            </div>
            {preview.secondary.draftSlotCount > 0 && (
              <p className="rounded-md border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-orange-800 dark:text-orange-200">
                Retire {preview.secondary.draftSlotCount} empty draft slot{preview.secondary.draftSlotCount === 1 ? "" : "s"}. No assigned or published crew is removed.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={applying}>Back</Button>
              <Button onClick={apply} disabled={applying}>
                <MergeIcon data-icon="inline-start" />
                {applying ? "Combining…" : "Combine events"}
              </Button>
            </>
          ) : (
            <Button onClick={() => void review()} disabled={!firstId || !secondId || reviewing}>
              {reviewing ? "Reviewing…" : "Review combination"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
