"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, ArrowRight, CalendarDays, Check, ChevronsUpDown, Clock3, RefreshCw, ShieldCheck, Users } from "lucide-react";
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

function WorkflowProgress({ applying, reviewActive }: { applying: boolean; reviewActive: boolean }) {
  const currentStep = applying ? 2 : reviewActive ? 1 : 0;
  const steps = ["Scope", "Review", "Apply"];

  return (
    <ol className="mt-4 flex items-center" aria-label="Auto assign progress">
      {steps.map((label, index) => {
        const complete = index < currentStep;
        const current = index === currentStep;
        return (
          <li
            key={label}
            className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium last:flex-none"
            aria-current={current ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums transition-colors",
                current && "border-primary bg-primary text-primary-foreground",
                complete && "border-[var(--blue-text)]/30 bg-[var(--blue-bg)] text-[var(--blue-text)]",
                !current && !complete && "border-border text-muted-foreground",
              )}
            >
              {complete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span className={cn("truncate", current ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {index < steps.length - 1 ? <span className="h-px min-w-3 flex-1 bg-border" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
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

  const reviewActive = loading || preview !== null;

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

  function returnToScope() {
    setPreview(null);
    setSelectedEventIds(new Set());
    setError(null);
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
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-4xl">
        <DialogHeader className="block pr-16">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>Build assignment plan</DialogTitle>
              <DialogDescription className="mt-1">
                Set the scope, review every proposed assignment, then apply it to a private schedule.
              </DialogDescription>
            </div>
            <Badge variant="outline" className="hidden h-7 shrink-0 sm:inline-flex">
              <Clock3 aria-hidden="true" /> 10-minute cancel window
            </Badge>
          </div>
          <WorkflowProgress applying={applying} reviewActive={reviewActive} />
        </DialogHeader>

        <DialogBody className="min-h-0 px-6 py-4">
          <div className="flex flex-col gap-4">
            <PendingAssignmentBatches batches={pendingBatches} onChanged={() => { void refreshBatches(); onApplied(); }} />

            {reviewActive ? (
              <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Assignment plan</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {sportSummary(sportCodes)} · {activeWindow.detail} · {BULK_ASSIGNMENT_WORKER_SCOPE_LABELS[workerScope]}
                    {area ? ` · ${AREA_LABELS[area]}` : ""}
                    {requireFullCrew ? " · Complete crews required" : ""}
                  </p>
                </div>
                {!loading ? (
                  <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                    <Button variant="ghost" className="h-10 flex-1 sm:flex-none" onClick={returnToScope} disabled={applying}>
                      Change scope
                    </Button>
                    <Button variant="outline" className="h-10 flex-1 sm:flex-none" onClick={() => void buildPreview()} disabled={applying}>
                      <RefreshCw className="size-4" /> Refresh review
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-3 lg:grid-cols-2">
                  <section className="rounded-md border border-border/60 bg-card p-4 shadow-xs">
                    <div className="mb-4 flex items-start gap-2.5">
                      <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div>
                        <h3 className="text-sm! font-semibold">Events</h3>
                        <p className="text-xs text-muted-foreground">Choose what should be included in this plan.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_9rem]">
                        <div className="min-w-0 space-y-1.5">
                          <p className="text-xs font-medium">Sports</p>
                          <div className="flex min-w-0 items-center gap-2">
                            <Popover open={sportPickerOpen} onOpenChange={setSportPickerOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="h-10 min-w-0 flex-1 justify-between"
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
                                className="h-10 shrink-0 px-3 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => setSportCodes([])}
                              >
                                Clear
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium">Area</p>
                          <Select value={area ?? "_all"} onValueChange={(value) => setArea(value === "_all" ? null : value as Area)}>
                            <SelectTrigger className="h-10 w-full" aria-label="Auto assign area filter">
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
                      </div>

                      <div className="space-y-1.5 border-t border-border/50 pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-medium">Time window</p>
                          <p className="truncate text-xs text-muted-foreground">{activeWindow.detail}</p>
                        </div>
                        <ToggleGroup
                          type="single"
                          value={period}
                          onValueChange={(value) => {
                            if (value) setPeriod(value as AssignmentPeriodValue);
                          }}
                          className="w-full flex-wrap justify-start gap-1 rounded-md bg-muted/35 p-1"
                          aria-label="Auto assign period"
                        >
                          {ASSIGNMENT_PERIODS.map((value) => (
                            <ToggleGroupItem key={value} value={value} className="h-10 flex-1 px-2 text-xs data-[state=on]:shadow-xs">
                              {windows[value].label}
                            </ToggleGroupItem>
                          ))}
                          {customWindow ? (
                            <ToggleGroupItem value="custom" className="h-10 flex-1 px-2 text-xs data-[state=on]:shadow-xs">
                              {customWindow.label}
                            </ToggleGroupItem>
                          ) : null}
                        </ToggleGroup>
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
                          All sports in the selected window are included. Choose specific sports to inspect their rosters.
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="rounded-md border border-border/60 bg-card p-4 shadow-xs">
                    <div className="mb-4 flex items-start gap-2.5">
                      <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div>
                        <h3 className="text-sm! font-semibold">Crew rules</h3>
                        <p className="text-xs text-muted-foreground">Decide which open positions this plan may fill.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium">Open slots</p>
                        <ToggleGroup
                          type="single"
                          value={workerScope}
                          onValueChange={(value) => {
                            if (value) setWorkerScope(value as BulkAssignmentWorkerScope);
                          }}
                          className="w-full justify-start gap-1 rounded-md bg-muted/35 p-1"
                          aria-label="Which slots to fill"
                        >
                          {BULK_ASSIGNMENT_WORKER_SCOPES.map((value) => (
                            <ToggleGroupItem key={value} value={value} className="h-10 flex-1 px-2 text-xs data-[state=on]:shadow-xs">
                              {BULK_ASSIGNMENT_WORKER_SCOPE_LABELS[value]}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                        <p className="text-xs text-muted-foreground">Only compatible Student or Staff positions are considered.</p>
                      </div>

                      <label className="flex min-h-16 items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                        <Checkbox
                          checked={requireFullCrew}
                          onCheckedChange={(checked) => setRequireFullCrew(checked === true)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">Require complete crews</span>
                          <span className="block text-xs text-muted-foreground">
                            {requireFullCrew
                              ? "Hold back any event that still has an open position."
                              : "Allow safe proposals even when another position stays open."}
                          </span>
                        </span>
                      </label>
                    </div>
                  </section>
                </div>

                <div className="flex items-start gap-3 rounded-md border border-[var(--blue-text)]/20 bg-[var(--blue-bg)]/35 px-4 py-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--blue-text)]" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Preview checks every match</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Roster, travel, class schedules, availability, approved time off, and conflicts are checked now and again when you apply. Sport policy still applies; held sports are skipped.
                    </p>
                  </div>
                </div>
              </>
            )}

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
                          {requireFullCrew ? " Complete crews are required, so they are held back." : " Require complete crews to hold them back."}
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
            ) : null}
          </div>
        </DialogBody>

        <DialogFooter className="border-t pt-4">
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            {preview && selectedProposals.length > 0 ? <Check className="size-4 text-[var(--blue-text)]" /> : null}
            {preview
              ? `${selectedProposals.length} assignment${selectedProposals.length === 1 ? "" : "s"} for ${selectedPeople.length} ${selectedPeople.length === 1 ? "person" : "people"}`
              : ""}
          </div>
          <Button variant="outline" className="h-10 w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
          {preview ? (
            <Button className="h-10 w-full sm:w-auto" onClick={() => void applyAssignments()} disabled={selectedProposals.length === 0 || applying || loading}>
              {applying ? "Applying…" : `Apply ${selectedProposals.length || "assignments"}`}
            </Button>
          ) : (
            <Button className="h-10 w-full sm:w-auto" onClick={() => void buildPreview()} disabled={loading || applying}>
              {loading ? <RefreshCw className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              Review assignments
            </Button>
          )}
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
