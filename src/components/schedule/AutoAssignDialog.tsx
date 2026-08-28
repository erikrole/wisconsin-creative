"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, CalendarDays, Check, ChevronsUpDown, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  BULK_ASSIGNMENT_WORKER_SCOPES,
  BULK_ASSIGNMENT_WORKER_SCOPE_LABELS,
  MAX_BULK_ASSIGNMENT_SPORTS,
  summarizeAssignmentPeople,
  type BulkAssignmentPreviewEvent,
  type BulkAssignmentPreviewResponse,
  type BulkAssignmentScope,
  type BulkAssignmentWorkerScope,
} from "@/lib/bulk-schedule-assignment-types";
import {
  ASSIGNMENT_PERIODS,
  resolveAssignmentWindow,
  type AssignmentPeriod,
  type AssignmentPeriodValue,
} from "@/lib/schedule-assignment-window";
import type { SportRosterPreviewResponse } from "@/lib/services/sport-roster-preview";
import { AREAS, AREA_LABELS, type Area } from "@/types/areas";
import { SPORT_CODES } from "@/lib/sports";
import { cn } from "@/lib/utils";
import { SportRosterPreview } from "./SportRosterPreview";
import { PendingAssignmentBatches, usePendingAssignmentBatches } from "./PendingAssignmentBatches";
import { SportSetupWizard } from "./SportSetupWizard";

/** A caller-supplied window shown as an extra period option (the month grid). */
export type AutoAssignCustomWindow = {
  rangeStartsAt: string;
  rangeEndsAt: string;
  label: string;
};

export type AutoAssignDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
  initialSportCodes?: string[];
  initialArea?: Area | null;
  initialPeriod?: AssignmentPeriodValue;
  customWindow?: AutoAssignCustomWindow | null;
};

function formatEventDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function eventSelectionLabel(event: BulkAssignmentPreviewEvent) {
  const count = event.proposals.length;
  return `${count} assignment${count === 1 ? "" : "s"}`;
}

function sportSummary(codes: string[]) {
  if (codes.length === 0) return "All sports";
  if (codes.length <= 2) {
    return codes.map((code) => SPORT_CODES.find((sport) => sport.code === code)?.label ?? code).join(", ");
  }
  return `${codes.length} sports`;
}

/**
 * One preview-first auto assignment surface, shared by the Schedule page button
 * and the `/schedule/assign` month grid.
 *
 * The preview is built on demand rather than on every control change: it scores
 * every candidate against every open slot, so it is the expensive half of the
 * flow and is rate limited. Changing scope therefore discards the current
 * preview instead of silently refetching, which also keeps the fingerprint the
 * apply step validates honest about what the reviewer actually saw.
 */
export function AutoAssignDialog({
  open,
  onOpenChange,
  onApplied,
  initialSportCodes,
  initialArea,
  initialPeriod,
  customWindow,
}: AutoAssignDialogProps) {
  const [sportCodes, setSportCodes] = useState<string[]>(initialSportCodes ?? []);
  const [area, setArea] = useState<Area | null>(initialArea ?? null);
  const [workerScope, setWorkerScope] = useState<BulkAssignmentWorkerScope>("ALL");
  const [requireFullCrew, setRequireFullCrew] = useState(false);
  const [period, setPeriod] = useState<AssignmentPeriodValue>(
    initialPeriod ?? (customWindow ? "custom" : "week"),
  );
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const [wizardSportCode, setWizardSportCode] = useState<string | null>(null);

  const [preview, setPreview] = useState<BulkAssignmentPreviewResponse | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { batches: pendingBatches, refresh: refreshBatches } = usePendingAssignmentBatches(open);
  const [roster, setRoster] = useState<SportRosterPreviewResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterToken, setRosterToken] = useState(0);

  // Reset to the caller's scope each time the dialog is opened so a stale
  // preview from a previous session can never be applied.
  useEffect(() => {
    if (!open) return;
    setSportCodes(initialSportCodes ?? []);
    setArea(initialArea ?? null);
    setWorkerScope("ALL");
    setRequireFullCrew(false);
    setPeriod(initialPeriod ?? (customWindow ? "custom" : "week"));
    setPreview(null);
    setSelectedEventIds(new Set());
    setError(null);
    // Only the open transition should reseed; later prop churn must not wipe
    // scope the user has already adjusted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const windows = useMemo(() => {
    const now = new Date();
    return Object.fromEntries(
      ASSIGNMENT_PERIODS.map((value) => [value, resolveAssignmentWindow(value, now)]),
    ) as Record<AssignmentPeriod, ReturnType<typeof resolveAssignmentWindow>>;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeWindow = useMemo(() => {
    if (period === "custom" && customWindow) {
      return {
        rangeStartsAt: customWindow.rangeStartsAt,
        rangeEndsAt: customWindow.rangeEndsAt,
        detail: customWindow.label,
      };
    }
    const resolved = windows[period === "custom" ? "week" : period];
    return {
      rangeStartsAt: resolved.rangeStartsAt,
      rangeEndsAt: resolved.rangeEndsAt,
      detail: resolved.detail,
    };
  }, [customWindow, period, windows]);

  const scope = useMemo<BulkAssignmentScope>(() => ({
    sportCodes: [...sportCodes].sort(),
    rangeStartsAt: activeWindow.rangeStartsAt,
    rangeEndsAt: activeWindow.rangeEndsAt,
    area,
    workerScope,
    requireFullCrew,
    period,
  }), [activeWindow, area, period, requireFullCrew, sportCodes, workerScope]);

  // Any scope change invalidates the reviewed preview.
  useEffect(() => {
    setPreview(null);
    setSelectedEventIds(new Set());
    setError(null);
  }, [scope]);

  useEffect(() => {
    if (!open || sportCodes.length === 0) {
      setRoster(null);
      setRosterError(null);
      return;
    }
    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/schedule/sport-roster?codes=${encodeURIComponent(sportCodes.join(","))}`);
        if (handleAuthRedirect(response)) return;
        if (!response.ok) {
          if (!cancelled) setRosterError("Sport assignments could not be loaded.");
          return;
        }
        const json = await parseJsonSafely<{ data?: SportRosterPreviewResponse }>(response);
        if (cancelled) return;
        if (!json?.data) {
          setRosterError("Sport assignments could not be loaded.");
          return;
        }
        setRoster(json.data);
      } catch {
        if (!cancelled) setRosterError("Sport assignments could not be loaded.");
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sportCodes, rosterToken]);

  const buildPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setSelectedEventIds(new Set());
    try {
      const response = await fetch("/api/schedule/bulk-assignment/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scope),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        setError(await parseErrorMessage(response, "The auto assign preview could not be loaded."));
        return;
      }
      const json = await parseJsonSafely<{ data?: BulkAssignmentPreviewResponse }>(response);
      if (!json?.data) {
        setError("The preview response was incomplete. Refresh and try again.");
        return;
      }
      setPreview(json.data);
      setSelectedEventIds(new Set(
        json.data.events
          .filter((event) => event.status === "ready" && event.proposals.length > 0)
          .map((event) => event.eventId),
      ));
    } catch {
      setError("Could not reach the server. No assignments were changed.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const selectedProposals = useMemo(
    () => preview?.events
      .filter((event) => selectedEventIds.has(event.eventId))
      .flatMap((event) => event.proposals) ?? [],
    [preview, selectedEventIds],
  );

  // Recomputed from the current selection so the per-person counts always match
  // the events that are actually checked.
  const selectedPeople = useMemo(
    () => summarizeAssignmentPeople(selectedProposals),
    [selectedProposals],
  );

  function toggleSport(code: string) {
    setSportCodes((current) => {
      if (current.includes(code)) return current.filter((value) => value !== code);
      if (current.length >= MAX_BULK_ASSIGNMENT_SPORTS) return current;
      return [...current, code];
    });
  }

  function toggleEvent(eventId: string, checked: boolean) {
    setSelectedEventIds((current) => {
      const next = new Set(current);
      if (checked) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
  }

  async function applyAssignments() {
    if (!preview || selectedProposals.length === 0 || applying) return;
    setApplying(true);
    setError(null);
    try {
      const response = await fetch("/api/schedule/bulk-assignment/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: preview.scope,
          fingerprint: preview.fingerprint,
          proposals: selectedProposals.map(({ proposalId, shiftGroupId, shiftId, eventId, userId }) => ({
            proposalId,
            shiftGroupId,
            shiftId,
            eventId,
            userId,
          })),
        }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        const message = await parseErrorMessage(response, "The auto assignment was not saved.");
        setError(message);
        toast.error(message);
        return;
      }
      const json = await parseJsonSafely<{ data?: { eventCount?: number; assignmentCount?: number; releaseAt?: string } }>(response);
      const eventCount = json?.data?.eventCount;
      const assignmentCount = json?.data?.assignmentCount;
      if (typeof eventCount !== "number" || typeof assignmentCount !== "number") {
        setError("Assignments were staged, but the confirmation was incomplete. Refresh the schedule to verify.");
        toast.warning("Assignments were staged. Refresh the schedule to verify.");
        onApplied();
        return;
      }
      toast.success(
        `Staged ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"} across ${eventCount} event${eventCount === 1 ? "" : "s"}`,
        { description: "Workers are notified when it releases. Reopen Auto assign to cancel before then." },
      );
      void refreshBatches();
      onOpenChange(false);
      onApplied();
    } catch {
      const message = "Could not reach the server. No auto assignment was saved.";
      setError(message);
      toast.error(message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
        <DialogHeader className="pr-16">
          <div>
            <DialogTitle>Auto assign crew</DialogTitle>
            <DialogDescription className="mt-1">
              Pick what to cover, review every proposed worker, then apply. Applying stages the schedule and gives you
              ten minutes to cancel before workers are notified.
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="min-h-0 px-6 py-4">
          <div className="flex flex-col gap-4">
            <PendingAssignmentBatches batches={pendingBatches} onChanged={() => { void refreshBatches(); onApplied(); }} />

            <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Sports</span>
                <Popover open={sportPickerOpen} onOpenChange={setSportPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 min-w-52 justify-between"
                      aria-label="Select sports to auto assign"
                    >
                      <span className="truncate">{sportSummary(sportCodes)}</span>
                      <ChevronsUpDown className="size-3.5 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-0">
                    <Command>
                      <CommandInput placeholder="Find a sport…" />
                      <CommandList>
                        <CommandEmpty>No sport matches.</CommandEmpty>
                        <CommandGroup>
                          {SPORT_CODES.map((sport) => {
                            const selected = sportCodes.includes(sport.code);
                            return (
                              <CommandItem
                                key={sport.code}
                                value={`${sport.label} ${sport.code}`}
                                onSelect={() => toggleSport(sport.code)}
                              >
                                <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
                                {sport.label}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {sportCodes.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSportCodes([])}
                  >
                    Clear
                  </Button>
                ) : null}

                <Select value={area ?? "_all"} onValueChange={(value) => setArea(value === "_all" ? null : value as Area)}>
                  <SelectTrigger size="sm" className="ml-auto h-10 w-36" aria-label="Auto assign area filter">
                    <SelectValue placeholder="All areas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All areas</SelectItem>
                    {AREAS.map((value) => (
                      <SelectItem key={value} value={value}>{AREA_LABELS[value]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {sportCodes.length > 0 ? (
                <SportRosterPreview
                  roster={roster}
                  loading={rosterLoading}
                  error={rosterError}
                  onEditSport={setWizardSportCode}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Every sport in the window is included. Pick specific sports to see who is on their rosters.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Period</span>
                <ToggleGroup
                  type="single"
                  value={period}
                  onValueChange={(value) => {
                    if (value) setPeriod(value as AssignmentPeriodValue);
                  }}
                  className="gap-1"
                  aria-label="Auto assign period"
                >
                  {ASSIGNMENT_PERIODS.map((value) => (
                    <ToggleGroupItem key={value} value={value} className="h-10 px-2.5 text-xs">
                      {windows[value].label}
                    </ToggleGroupItem>
                  ))}
                  {customWindow ? (
                    <ToggleGroupItem value="custom" className="h-10 px-2.5 text-xs">
                      {customWindow.label}
                    </ToggleGroupItem>
                  ) : null}
                </ToggleGroup>
                <span className="text-xs text-muted-foreground">{activeWindow.detail}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Assign</span>
                <ToggleGroup
                  type="single"
                  value={workerScope}
                  onValueChange={(value) => {
                    if (value) setWorkerScope(value as BulkAssignmentWorkerScope);
                  }}
                  className="gap-1"
                  aria-label="Which slots to fill"
                >
                  {BULK_ASSIGNMENT_WORKER_SCOPES.map((value) => (
                    <ToggleGroupItem key={value} value={value} className="h-10 px-2.5 text-xs">
                      {BULK_ASSIGNMENT_WORKER_SCOPE_LABELS[value]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Button
                  variant={requireFullCrew ? "secondary" : "ghost"}
                  size="sm"
                  className="h-10 text-xs"
                  aria-pressed={requireFullCrew}
                  onClick={() => setRequireFullCrew((current) => !current)}
                >
                  <Check className={cn("size-3.5", requireFullCrew ? "opacity-100" : "opacity-30")} />
                  Full crews only
                </Button>
                <span className="text-xs text-muted-foreground max-lg:hidden">
                  {requireFullCrew
                    ? "Events that cannot be filled completely are held back."
                    : "Events may be filled partway."}
                </span>
                <Button
                  className="ml-auto h-10"
                  onClick={() => void buildPreview()}
                  disabled={loading || applying}
                >
                  {loading ? <RefreshCw className="size-4 animate-spin" /> : null}
                  {preview ? "Rebuild preview" : "Build preview"}
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground" aria-live="polite">
                <RefreshCw className="mr-2 size-4 animate-spin" /> Building the preview…
              </div>
            ) : error ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
                <p className="max-w-md text-sm text-destructive" role="alert">{error}</p>
                <Button variant="outline" onClick={() => void buildPreview()}>
                  <RefreshCw className="size-4" /> Try again
                </Button>
              </div>
            ) : preview ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                    <div className="text-[11px] text-muted-foreground">Events matched</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{preview.summary.eventsMatched}</div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                    <div className="text-[11px] text-muted-foreground">People added</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{selectedPeople.length}</div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                    <div className="text-[11px] text-muted-foreground">Will assign</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{selectedProposals.length}</div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                    <div className="text-[11px] text-muted-foreground">Full crews</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">
                      {preview.summary.eventsFullyCrewed}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        of {preview.summary.eventsFullyCrewed + preview.summary.eventsPartiallyCrewed}
                      </span>
                    </div>
                  </div>
                </div>

                {preview.summary.eventsPartiallyCrewed > 0 || preview.summary.eventsPendingChanges > 0 || preview.summary.eventsOnHold > 0 ? (
                  <div className="flex flex-col gap-1.5 rounded-md border border-[var(--orange-text)]/30 bg-[var(--orange-bg)]/40 px-3 py-2 text-xs">
                    {preview.summary.eventsPartiallyCrewed > 0 ? (
                      <div className="flex items-start gap-2">
                        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--orange-text)]" />
                        <span>
                          <strong>{preview.summary.eventsPartiallyCrewed}</strong>{" "}
                          event{preview.summary.eventsPartiallyCrewed === 1 ? "" : "s"} would release short a position.
                          {requireFullCrew ? " Full crews only is on, so they are held back." : " Turn on Full crews only to hold them back."}
                        </span>
                      </div>
                    ) : null}
                    {preview.summary.eventsOnHold > 0 ? (
                      <div className="flex items-start gap-2">
                        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--orange-text)]" />
                        <span>
                          <strong>{preview.summary.eventsOnHold}</strong>{" "}
                          {preview.summary.eventsOnHold === 1
                            ? "event was skipped because its sport is on hold"
                            : "events were skipped because their sport is on hold"}{" "}
                          for auto assignment.
                        </span>
                      </div>
                    ) : null}
                    {preview.summary.eventsPendingChanges > 0 ? (
                      <div className="flex items-start gap-2">
                        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--orange-text)]" />
                        <span>
                          <strong>{preview.summary.eventsPendingChanges}</strong>{" "}
                          {preview.summary.eventsPendingChanges === 1 ? "event was" : "events were"} skipped for unreleased staff changes.{" "}
                          <a className="underline underline-offset-2" href="/schedule/assign">Review them</a> and run auto assign again.
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedPeople.length > 0 ? (
                  <div className="rounded-md border border-border/60 bg-card p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      Who is getting added
                    </div>
                    <div className="flex flex-col gap-1">
                      {selectedPeople.map((person) => (
                        <div
                          key={person.userId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-1.5"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Users className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm font-medium">{person.userName}</span>
                            <Badge variant="gray" size="sm">
                              {person.workerType === "ST" ? "Student" : "Staff"}
                            </Badge>
                            {person.warningCount > 0 ? (
                              <Badge variant="orange" size="sm">
                                {person.warningCount} warning{person.warningCount === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {person.shiftCount} shift{person.shiftCount === 1 ? "" : "s"}
                            {person.eventCount !== person.shiftCount
                              ? ` · ${person.eventCount} event${person.eventCount === 1 ? "" : "s"}`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2">
                    {preview.events.map((event) => {
                      const selectable = event.status === "ready" && event.proposals.length > 0;
                      const selected = selectedEventIds.has(event.eventId);
                      return (
                        <div key={event.eventId} className="rounded-md border border-border/70 bg-card">
                          <div className="flex items-start gap-3 p-3">
                            <Checkbox
                              checked={selected}
                              disabled={!selectable || applying}
                              onCheckedChange={(checked) => toggleEvent(event.eventId, checked === true)}
                              aria-label={`Include ${event.summary}`}
                              className="mt-0.5 size-5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-medium">{event.summary}</span>
                                <span className="text-xs text-muted-foreground">{formatEventDate(event.startsAt)}</span>
                                {selectable ? (
                                  <Badge variant={selected ? "blue" : "outline"} size="sm">
                                    {eventSelectionLabel(event)}
                                  </Badge>
                                ) : (
                                  <Badge variant="orange" size="sm">Review needed</Badge>
                                )}
                                {selectable && !event.fullyCrewed ? (
                                  <Badge variant="orange" size="sm">
                                    Still short {event.unfilledSlots}
                                  </Badge>
                                ) : null}
                              </div>
                              {event.proposals.length > 0 ? (
                                <div className="mt-3 flex flex-col gap-2">
                                  {event.proposals.map((proposal) => (
                                    <div key={proposal.proposalId} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-muted/35 px-3 py-2">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                          <Users className="size-3.5 text-muted-foreground" />
                                          {proposal.userName}
                                        </div>
                                        <div className="mt-0.5 text-xs text-muted-foreground">
                                          {AREA_LABELS[proposal.area] ?? proposal.area} · {proposal.workerType === "ST" ? "Student" : "Staff"}
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {proposal.warnings[0]?.label ?? proposal.reasons[0]?.label ?? "Best available fit"}
                                        </div>
                                      </div>
                                      <Badge variant={proposal.warnings.length > 0 ? "orange" : "blue"} size="sm">
                                        Score {proposal.score}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {event.skipped.length > 0 ? (
                                <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                                  {event.skipped.map((skipped, index) => (
                                    <div key={`${skipped.reasonCode}:${skipped.shiftId ?? index}`} className="flex gap-2">
                                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--orange-text)]" />
                                      <span>{skipped.reason}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {preview.events.length === 0 ? (
                      <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-6 text-center">
                        <CalendarDays className="size-5 text-muted-foreground" />
                        {preview.summary.eventsOnHold > 0 ? (
                          <>
                            <p className="text-sm font-medium">
                              Every event in this scope is on a sport that is on hold.
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Change a sport&apos;s policy in Sport setup, or pick different sports.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-medium">No upcoming events match this scope.</p>
                            <p className="text-xs text-muted-foreground">Change the sports or period and build the preview again.</p>
                          </>
                        )}
                      </div>
                    ) : null}
                </div>
              </>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-6 text-center">
                <CalendarDays className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">Choose what to cover, then build the preview.</p>
                <p className="text-xs text-muted-foreground">
                  {sportSummary(sportCodes)} · {activeWindow.detail} · {BULK_ASSIGNMENT_WORKER_SCOPE_LABELS[workerScope]}
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  Nothing is scheduled until you review the proposals and apply. Each sport&apos;s own policy still
                  applies — a sport on hold is skipped whatever you pick here.
                </p>
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter className="border-t pt-4">
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            {preview && selectedProposals.length > 0 ? <Check className="size-4 text-[var(--blue-text)]" /> : null}
            {preview
              ? `${selectedProposals.length} assignment${selectedProposals.length === 1 ? "" : "s"} for ${selectedPeople.length} ${selectedPeople.length === 1 ? "person" : "people"}`
              : ""}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
          <Button onClick={() => void applyAssignments()} disabled={!preview || selectedProposals.length === 0 || applying || loading}>
            {applying ? "Applying…" : `Apply ${selectedProposals.length || "assignments"}`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <SportSetupWizard
        open={wizardSportCode !== null}
        onOpenChange={(next) => { if (!next) setWizardSportCode(null); }}
        startAtSportCode={wizardSportCode}
        onCompleted={() => {
          // Policy or roster may have changed, so the strip and any built
          // preview are both stale.
          setRosterToken((current) => current + 1);
          setPreview(null);
          setSelectedEventIds(new Set());
        }}
      />
    </Dialog>
  );
}
