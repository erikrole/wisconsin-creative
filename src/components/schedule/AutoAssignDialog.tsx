"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDownIcon,
  ChevronsUpDown,
  RefreshCw,
  Users,
} from "lucide-react";
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
  type BulkAssignmentPreviewProposal,
  type BulkAssignmentPreviewResponse,
  type BulkAssignmentPreviewSkipped,
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
import { sportColumnLabel, sportsGroupedByProgram } from "@/lib/sports";
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

type Step = "scope" | "review";

/** Product-facing buckets for why an event did not make the staging list. */
type BlockerKind =
  | "needs_schedule"
  | "incomplete_crew"
  | "pending_changes"
  | "no_open_slots"
  | "no_match"
  | "on_hold";

type BlockerGroup = {
  kind: BlockerKind;
  count: number;
  title: string;
  detail: string;
};

const BLOCKER_ORDER: BlockerKind[] = [
  "incomplete_crew",
  "needs_schedule",
  "pending_changes",
  "no_match",
  "no_open_slots",
  "on_hold",
];

const BLOCKER_COPY: Record<BlockerKind, { title: string; detail: string }> = {
  incomplete_crew: {
    title: "Couldn't fill every open slot",
    detail: "Full crews only kept these out so nothing stages short.",
  },
  needs_schedule: {
    title: "No crew schedule yet",
    detail: "Open the event and set Home or Away before auto assign can fill it.",
  },
  pending_changes: {
    title: "Unreleased staff changes",
    detail: "Release or cancel the pending edit, then build again.",
  },
  no_match: {
    title: "No matching people",
    detail: "Roster, travel, area fit, or time off blocked the open slots.",
  },
  no_open_slots: {
    title: "Nothing open in this filter",
    detail: "Crew is already filled, or the Assign filter left no slots.",
  },
  on_hold: {
    title: "Sport is on hold",
    detail: "Change the sport's auto-assign policy to include it.",
  },
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
  const groups = sportsGroupedByProgram(new Set(codes));
  const labels = [...groups.men, ...groups.women].map((sport) => sport.label);
  if (labels.length <= 2) return labels.join(", ");
  return `${codes.length} sports`;
}

function primaryReasonCode(event: BulkAssignmentPreviewEvent): BulkAssignmentPreviewSkipped["reasonCode"] | null {
  return event.skipped[0]?.reasonCode ?? null;
}

function blockerKindForEvent(event: BulkAssignmentPreviewEvent): BlockerKind {
  switch (primaryReasonCode(event)) {
    case "no_shift_group":
      return "needs_schedule";
    case "partial_crew_blocked":
      return "incomplete_crew";
    case "pending_working_copy":
      return "pending_changes";
    case "no_open_slots":
      return "no_open_slots";
    case "sport_policy_hold":
      return "on_hold";
    default:
      return "no_match";
  }
}

function summarizeBlockers(events: BulkAssignmentPreviewEvent[]): BlockerGroup[] {
  const counts = new Map<BlockerKind, number>();
  for (const event of events) {
    const kind = blockerKindForEvent(event);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return BLOCKER_ORDER
    .filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => ({
      kind,
      count: counts.get(kind)!,
      title: BLOCKER_COPY[kind].title,
      detail: BLOCKER_COPY[kind].detail,
    }));
}

function shortBlockedLabel(event: BulkAssignmentPreviewEvent) {
  return BLOCKER_COPY[blockerKindForEvent(event)].title;
}

/**
 * One preview-first auto assignment surface, shared by the Schedule page button
 * and the `/schedule/assign` month grid.
 *
 * Scope and Review are separate steps so the expensive preview is deliberate.
 * Changing scope discards the preview and returns to Scope so the apply
 * fingerprint always matches what the reviewer saw.
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
  const [step, setStep] = useState<Step>("scope");
  const [sportCodes, setSportCodes] = useState<string[]>(initialSportCodes ?? []);
  const [area, setArea] = useState<Area | null>(initialArea ?? null);
  const [workerScope, setWorkerScope] = useState<BulkAssignmentWorkerScope>("ALL");
  const [requireFullCrew, setRequireFullCrew] = useState(true);
  const [period, setPeriod] = useState<AssignmentPeriodValue>(
    initialPeriod ?? (customWindow ? "custom" : "week"),
  );
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const [wizardSportCode, setWizardSportCode] = useState<string | null>(null);
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const [showBlockedEvents, setShowBlockedEvents] = useState(false);

  const [preview, setPreview] = useState<BulkAssignmentPreviewResponse | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Lets Review rebuild after a Full-crews tweak without bouncing to Scope. */
  const skipScopeResetRef = useRef(false);

  const { batches: pendingBatches, refresh: refreshBatches } = usePendingAssignmentBatches(open);
  const [roster, setRoster] = useState<SportRosterPreviewResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterToken, setRosterToken] = useState(0);

  const sportGroups = useMemo(() => sportsGroupedByProgram(), []);
  const sportColumnCount = Number(sportGroups.men.length > 0) + Number(sportGroups.women.length > 0);

  useEffect(() => {
    if (!open) return;
    setStep("scope");
    setSportCodes(initialSportCodes ?? []);
    setArea(initialArea ?? null);
    setWorkerScope("ALL");
    setRequireFullCrew(true);
    setPeriod(initialPeriod ?? (customWindow ? "custom" : "week"));
    setPreview(null);
    setSelectedEventIds(new Set());
    setExpandedPersonId(null);
    setShowBlockedEvents(false);
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

  useEffect(() => {
    if (skipScopeResetRef.current) {
      skipScopeResetRef.current = false;
      return;
    }
    setPreview(null);
    setSelectedEventIds(new Set());
    setExpandedPersonId(null);
    setShowBlockedEvents(false);
    setError(null);
    if (step === "review") setStep("scope");
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const buildPreview = useCallback(async (nextScope: BulkAssignmentScope = scope) => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setSelectedEventIds(new Set());
    setExpandedPersonId(null);
    setShowBlockedEvents(false);
    setStep("review");
    try {
      const response = await fetch("/api/schedule/bulk-assignment/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextScope),
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

  const allowIncompleteCrews = useCallback(() => {
    const nextScope = { ...scope, requireFullCrew: false };
    skipScopeResetRef.current = true;
    setRequireFullCrew(false);
    void buildPreview(nextScope);
  }, [buildPreview, scope]);

  const selectedProposals = useMemo(
    () => preview?.events
      .filter((event) => selectedEventIds.has(event.eventId))
      .flatMap((event) => event.proposals) ?? [],
    [preview, selectedEventIds],
  );

  const selectedPeople = useMemo(
    () => summarizeAssignmentPeople(selectedProposals),
    [selectedProposals],
  );

  const proposalsByPerson = useMemo(() => {
    const map = new Map<string, BulkAssignmentPreviewProposal[]>();
    for (const proposal of selectedProposals) {
      const list = map.get(proposal.userId) ?? [];
      list.push(proposal);
      map.set(proposal.userId, list);
    }
    return map;
  }, [selectedProposals]);

  const readyEvents = useMemo(
    () => preview?.events.filter((event) => event.status === "ready" && event.proposals.length > 0) ?? [],
    [preview],
  );

  const blockedEvents = useMemo(
    () => preview?.events.filter((event) => !(event.status === "ready" && event.proposals.length > 0)) ?? [],
    [preview],
  );

  const blockerGroups = useMemo(() => summarizeBlockers(blockedEvents), [blockedEvents]);
  const incompleteCrewCount = blockerGroups.find((group) => group.kind === "incomplete_crew")?.count ?? 0;
  const eventsChecked = preview?.events.length ?? 0;
  const heldAside = preview?.summary.eventsOnHold ?? 0;

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

  function backToScope() {
    setStep("scope");
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
        <DialogHeader className="pr-16">
          <div>
            <DialogTitle>Auto assign crew</DialogTitle>
            <DialogDescription className="mt-1">
              {step === "scope"
                ? "Pick the window, then preview who gets staged. Workers are notified after a ten-minute cancel window."
                : loading
                  ? "Building a preview of who can be staged."
                  : readyEvents.length > 0
                    ? "Confirm who is getting added. Apply stages the schedule; nothing notifies workers until release."
                    : "Nothing is ready to stage yet. Fix the blockers below, or change the scope."}
            </DialogDescription>
            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground" aria-label="Auto assign steps">
              <span className={cn(step === "scope" ? "text-foreground" : "text-muted-foreground")}>1. Scope</span>
              <span aria-hidden="true">·</span>
              <span className={cn(step === "review" ? "text-foreground" : "text-muted-foreground")}>2. Review</span>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="min-h-0 px-6 py-4">
          {step === "scope" ? (
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
                    <PopoverContent align="start" className={cn("p-0", sportColumnCount > 1 ? "w-[28rem]" : "w-64")}>
                      <Command>
                        <CommandInput placeholder="Find a sport…" />
                        <CommandList className={cn(sportColumnCount > 1 && "max-h-72 [&_[cmdk-list-sizer]]:grid [&_[cmdk-list-sizer]]:grid-cols-2 [&_[cmdk-list-sizer]]:gap-x-1")}>
                          <CommandEmpty>No sport matches.</CommandEmpty>
                          {(["men", "women"] as const).map((program) => {
                            const sports = sportGroups[program];
                            if (sports.length === 0) return null;
                            return (
                              <CommandGroup key={program} heading={program === "men" ? "Men" : "Women"}>
                                {sports.map((sport) => {
                                  const selected = sportCodes.includes(sport.code);
                                  return (
                                    <CommandItem
                                      key={sport.code}
                                      value={`${sport.label} ${sport.code}`}
                                      onSelect={() => toggleSport(sport.code)}
                                    >
                                      <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
                                      {sportColumnLabel(sport.code)}
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            );
                          })}
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
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {sportSummary(sportCodes)} · {activeWindow.detail} · {BULK_ASSIGNMENT_WORKER_SCOPE_LABELS[workerScope]}
                {" · "}
                {requireFullCrew ? "Full crews only" : "Partial crews allowed"}
              </p>
            </div>
          ) : loading ? (
            <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground" aria-live="polite">
              <RefreshCw className="mr-2 size-4 animate-spin" /> Building the preview…
            </div>
          ) : error ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-md text-sm text-destructive" role="alert">{error}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" onClick={backToScope}>Back to scope</Button>
                <Button variant="outline" onClick={() => void buildPreview()}>
                  <RefreshCw className="size-4" /> Try again
                </Button>
              </div>
            </div>
          ) : preview ? (
            <div className="flex flex-col gap-4">
              {readyEvents.length > 0 ? (
                <>
                  <p className="text-sm text-foreground">
                    {selectedProposals.length > 0 ? (
                      <>
                        Ready to stage{" "}
                        <strong className="font-semibold tabular-nums">{selectedProposals.length}</strong>{" "}
                        assignment{selectedProposals.length === 1 ? "" : "s"} for{" "}
                        <strong className="font-semibold tabular-nums">{selectedPeople.length}</strong>{" "}
                        {selectedPeople.length === 1 ? "person" : "people"}
                        {" "}across{" "}
                        <strong className="font-semibold tabular-nums">{selectedEventIds.size}</strong>{" "}
                        event{selectedEventIds.size === 1 ? "" : "s"}
                        .
                      </>
                    ) : (
                      <>Select events below to stage assignments.</>
                    )}
                    {blockedEvents.length > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        {blockedEvents.length} other event{blockedEvents.length === 1 ? "" : "s"} stayed out.
                      </span>
                    ) : null}
                  </p>

                  {preview.summary.eventsPendingChanges > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-foreground">{preview.summary.eventsPendingChanges}</strong>{" "}
                      skipped for unreleased staff changes.{" "}
                      <a className="underline underline-offset-2" href="/schedule/assign">Review them</a>, then build again.
                    </p>
                  ) : null}

                  {selectedPeople.length > 0 ? (
                    <div className="rounded-md border border-border/60 bg-card">
                      <div className="border-b border-border/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                        Who is getting added
                      </div>
                      <ul className="flex flex-col">
                        {selectedPeople.map((person) => {
                          const openPerson = expandedPersonId === person.userId;
                          const proposals = proposalsByPerson.get(person.userId) ?? [];
                          return (
                            <li key={person.userId} className="border-b border-border/40 last:border-b-0">
                              <button
                                type="button"
                                className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left transition-[background-color] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-expanded={openPerson}
                                onClick={() => setExpandedPersonId(openPerson ? null : person.userId)}
                              >
                                <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{person.userName}</span>
                                <Badge variant="gray" size="sm">
                                  {person.workerType === "ST" ? "Student" : "Staff"}
                                </Badge>
                                {person.warningCount > 0 ? (
                                  <Badge variant="orange" size="sm">
                                    {person.warningCount} warning{person.warningCount === 1 ? "" : "s"}
                                  </Badge>
                                ) : null}
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {person.shiftCount} shift{person.shiftCount === 1 ? "" : "s"}
                                </span>
                                <ChevronDownIcon
                                  className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", openPerson && "rotate-180")}
                                  aria-hidden="true"
                                />
                              </button>
                              {openPerson ? (
                                <div className="flex flex-col gap-1 px-3 pb-3">
                                  {proposals.map((proposal) => (
                                    <div key={proposal.proposalId} className="flex flex-wrap items-baseline justify-between gap-2 px-1 py-1 text-xs">
                                      <span className="min-w-0 truncate font-medium text-foreground">
                                        {proposal.eventSummary}
                                        <span className="font-normal text-muted-foreground">
                                          {" · "}{AREA_LABELS[proposal.area] ?? proposal.area}
                                        </span>
                                      </span>
                                      <span className="shrink-0 text-muted-foreground">{formatEventDate(proposal.eventStartsAt)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  <div className="rounded-md border border-border/60 bg-card">
                    <div className="border-b border-border/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                      Include events
                    </div>
                    <ul className="flex flex-col">
                      {readyEvents.map((event) => {
                        const selected = selectedEventIds.has(event.eventId);
                        return (
                          <li key={event.eventId} className="flex min-h-10 items-center gap-3 border-b border-border/40 px-3 last:border-b-0">
                            <Checkbox
                              checked={selected}
                              disabled={applying}
                              onCheckedChange={(checked) => toggleEvent(event.eventId, checked === true)}
                              aria-label={`Include ${event.summary}`}
                              className="size-5"
                            />
                            <div className="min-w-0 flex-1 truncate text-sm">
                              <span className="font-medium">{event.summary}</span>
                              <span className="text-muted-foreground"> · {formatEventDate(event.startsAt)}</span>
                            </div>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {eventSelectionLabel(event)}
                              {!event.fullyCrewed ? ` · short ${event.unfilledSlots}` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {blockedEvents.length > 0 ? (
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 px-2 text-xs text-muted-foreground"
                        aria-expanded={showBlockedEvents}
                        onClick={() => setShowBlockedEvents((current) => !current)}
                      >
                        {blockedEvents.length} event{blockedEvents.length === 1 ? "" : "s"} stayed out
                        <ChevronDownIcon
                          className={cn("size-3.5 transition-transform", showBlockedEvents && "rotate-180")}
                          aria-hidden="true"
                        />
                      </Button>
                      {showBlockedEvents ? (
                        <ul className="mt-1 space-y-1 px-2 text-xs text-muted-foreground">
                          {blockedEvents.map((event) => (
                            <li key={event.eventId} className="flex justify-between gap-3">
                              <span className="min-w-0 truncate">{event.summary}</span>
                              <span className="shrink-0">{shortBlockedLabel(event)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-medium">Nothing ready to stage</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Checked{" "}
                      <strong className="font-medium text-foreground tabular-nums">{eventsChecked}</strong>{" "}
                      event{eventsChecked === 1 ? "" : "s"}
                      {" · "}
                      {sportSummary(sportCodes)}
                      {" · "}
                      {activeWindow.detail}
                      {heldAside > 0 ? (
                        <>
                          {" · "}
                          <strong className="font-medium text-foreground tabular-nums">{heldAside}</strong>{" "}
                          held sport{heldAside === 1 ? "" : "s"} excluded
                        </>
                      ) : null}
                      .
                    </p>
                  </div>

                  {blockerGroups.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {blockerGroups.map((group) => (
                        <li
                          key={group.kind}
                          className="flex gap-3 rounded-md border border-border/60 bg-card/60 px-3 py-2.5"
                        >
                          <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-foreground">
                            {group.count}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{group.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{group.detail}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No open slots matched this scope.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {incompleteCrewCount > 0 && requireFullCrew ? (
                      <Button onClick={allowIncompleteCrews} disabled={loading || applying}>
                        Allow incomplete crews
                      </Button>
                    ) : null}
                    <Button variant="outline" onClick={backToScope} disabled={loading || applying}>
                      Change scope
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">No preview yet.</p>
              <Button variant="outline" onClick={backToScope}>Back to scope</Button>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="border-t pt-4">
          {step === "scope" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying || loading}>
                Cancel
              </Button>
              <Button onClick={() => void buildPreview()} disabled={loading || applying}>
                {loading ? <RefreshCw className="size-4 animate-spin" /> : null}
                Build preview
              </Button>
            </>
          ) : (
            <>
              <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
                {selectedProposals.length > 0 ? <Check className="size-4 text-[var(--blue-text)]" /> : null}
                {selectedProposals.length > 0
                  ? `${selectedProposals.length} assignment${selectedProposals.length === 1 ? "" : "s"} for ${selectedPeople.length} ${selectedPeople.length === 1 ? "person" : "people"}`
                  : loading
                    ? "Building preview…"
                    : "No assignments to apply"}
              </div>
              <Button variant="outline" onClick={backToScope} disabled={applying || loading}>
                Back
              </Button>
              {selectedProposals.length > 0 || loading ? (
                <Button
                  onClick={() => void applyAssignments()}
                  disabled={!preview || selectedProposals.length === 0 || applying || loading}
                >
                  {applying
                    ? "Applying…"
                    : selectedProposals.length > 0
                      ? `Apply ${selectedProposals.length}`
                      : "Apply"}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <SportSetupWizard
        open={wizardSportCode !== null}
        onOpenChange={(next) => { if (!next) setWizardSportCode(null); }}
        startAtSportCode={wizardSportCode}
        onCompleted={() => {
          setRosterToken((current) => current + 1);
          setPreview(null);
          setSelectedEventIds(new Set());
          setStep("scope");
        }}
      />
    </Dialog>
  );
}
