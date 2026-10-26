"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDownIcon,
  ChevronsUpDown,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
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
import { UserAvatar } from "@/components/UserAvatar";
import { FRESH_SCOPE_CLASS } from "@/lib/fonts/fresh";
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

/** Event detail's Auto assign: the scope is pinned to this one event. */
export type AutoAssignEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
};

export type AutoAssignDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
  initialSportCodes?: string[];
  initialArea?: Area | null;
  initialPeriod?: AssignmentPeriodValue;
  customWindow?: AutoAssignCustomWindow | null;
  event?: AutoAssignEvent | null;
};

type Step = "scope" | "review";

/** Product-facing buckets for why an event did not make the staging list. */
type BlockerKind =
  | "needs_schedule"
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
  "needs_schedule",
  "pending_changes",
  "no_match",
  "no_open_slots",
  "on_hold",
];

const BLOCKER_COPY: Record<BlockerKind, { title: string; detail: string }> = {
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
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function eventSelectionLabel(event: BulkAssignmentPreviewEvent) {
  const count = event.proposals.length;
  return `${count} assignment${count === 1 ? "" : "s"}`;
}

function ScopeRow({ label, hint, children }: { label: string; hint?: string | null; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-4">
      <div className="pt-2.5 text-sm font-bold">{label}</div>
      <div className="min-w-0">
        <div className="flex min-h-10 items-center">{children}</div>
        {hint ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{hint}</p> : null}
      </div>
    </div>
  );
}

/** The one line that says why this person got this slot. */
function proposalReason(proposal: BulkAssignmentPreviewProposal) {
  if (proposal.advisoryConflictNote) return { tone: "warning" as const, text: proposal.advisoryConflictNote };
  if (proposal.warnings[0]) return { tone: "warning" as const, text: proposal.warnings[0].label };
  const reasons = proposal.reasons
    .filter((reason) => reason.code !== "role_fit")
    .slice(0, 2)
    .map((reason) => reason.label);
  return { tone: "neutral" as const, text: reasons.join(" · ") || (proposal.workerType === "ST" ? "Student" : "Staff") };
}

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
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
  event,
}: AutoAssignDialogProps) {
  const [step, setStep] = useState<Step>("scope");
  const [sportCodes, setSportCodes] = useState<string[]>(initialSportCodes ?? []);
  const [area, setArea] = useState<Area | null>(initialArea ?? null);
  const [workerScope, setWorkerScope] = useState<BulkAssignmentWorkerScope>("ALL");
  const [period, setPeriod] = useState<AssignmentPeriodValue>(
    initialPeriod ?? (customWindow ? "custom" : "week"),
  );
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const [wizardSportCode, setWizardSportCode] = useState<string | null>(null);
  const [focusPersonId, setFocusPersonId] = useState<string | null>(null);
  const [showBlockedEvents, setShowBlockedEvents] = useState(false);

  const [preview, setPreview] = useState<BulkAssignmentPreviewResponse | null>(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setPeriod(initialPeriod ?? (customWindow ? "custom" : "week"));
    setPreview(null);
    setSelectedProposalIds(new Set());
    setFocusPersonId(null);
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
    if (event) {
      const startsAt = new Date(event.startsAt);
      const endsAt = new Date(Math.max(new Date(event.endsAt).getTime(), startsAt.getTime() + 60_000));
      return {
        rangeStartsAt: startsAt.toISOString(),
        rangeEndsAt: endsAt.toISOString(),
        detail: formatEventDate(event.startsAt),
      };
    }
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
  }, [customWindow, event, period, windows]);

  const scope = useMemo<BulkAssignmentScope>(() => ({
    sportCodes: event ? [] : [...sportCodes].sort(),
    eventIds: event ? [event.id] : [],
    rangeStartsAt: activeWindow.rangeStartsAt,
    rangeEndsAt: activeWindow.rangeEndsAt,
    area,
    workerScope,
    period: event ? "custom" : period,
  }), [activeWindow, area, event, period, sportCodes, workerScope]);

  useEffect(() => {
    setPreview(null);
    setSelectedProposalIds(new Set());
    setFocusPersonId(null);
    setShowBlockedEvents(false);
    setError(null);
    if (step === "review") setStep("scope");
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || event || sportCodes.length === 0) {
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
  }, [open, event, sportCodes, rosterToken]);

  const buildPreview = useCallback(async (nextScope: BulkAssignmentScope = scope) => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setSelectedProposalIds(new Set());
    setFocusPersonId(null);
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
      setSelectedProposalIds(new Set(
        json.data.events
          .filter((event) => event.status === "ready")
          .flatMap((event) => event.proposals.map((proposal) => proposal.proposalId)),
      ));
    } catch {
      setError("Could not reach the server. No assignments were changed.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const selectedProposals = useMemo(
    () => preview?.events
      .filter((event) => event.status === "ready")
      .flatMap((event) => event.proposals)
      .filter((proposal) => selectedProposalIds.has(proposal.proposalId)) ?? [],
    [preview, selectedProposalIds],
  );
  const selectedEventCount = useMemo(
    () => new Set(selectedProposals.map((proposal) => proposal.eventId)).size,
    [selectedProposals],
  );
  const selectedPeople = useMemo(
    () => summarizeAssignmentPeople(selectedProposals),
    [selectedProposals],
  );


  const readyEvents = useMemo(
    () => preview?.events.filter((event) => event.status === "ready" && event.proposals.length > 0) ?? [],
    [preview],
  );

  const blockedEvents = useMemo(
    () => preview?.events.filter((event) => !(event.status === "ready" && event.proposals.length > 0)) ?? [],
    [preview],
  );

  const blockerGroups = useMemo(() => summarizeBlockers(blockedEvents), [blockedEvents]);
  const eventsChecked = preview?.events.length ?? 0;
  const heldAside = preview?.summary.eventsOnHold ?? 0;

  function toggleSport(code: string) {
    setSportCodes((current) => {
      if (current.includes(code)) return current.filter((value) => value !== code);
      if (current.length >= MAX_BULK_ASSIGNMENT_SPORTS) return current;
      return [...current, code];
    });
  }

  function toggleEvent(event: BulkAssignmentPreviewEvent, checked: boolean) {
    setSelectedProposalIds((current) => {
      const next = new Set(current);
      for (const proposal of event.proposals) {
        if (checked) next.add(proposal.proposalId);
        else next.delete(proposal.proposalId);
      }
      return next;
    });
  }

  function toggleProposal(proposalId: string, checked: boolean) {
    setSelectedProposalIds((current) => {
      const next = new Set(current);
      if (checked) next.add(proposalId);
      else next.delete(proposalId);
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
      const json = await parseJsonSafely<{ data?: { eventCount?: number; assignmentCount?: number; droppedCount?: number; releaseAt?: string } }>(response);
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
        {
          description: json?.data?.droppedCount
            ? `${json.data.droppedCount} no longer fit and ${json.data.droppedCount === 1 ? "was" : "were"} left out. Workers are notified when it releases. Reopen Auto assign to cancel before then.`
            : "Workers are notified when it releases. Reopen Auto assign to cancel before then.",
        },
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
      <DialogContent className={cn(FRESH_SCOPE_CLASS, "grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--background)] sm:max-w-3xl")}>
        <DialogHeader className="pr-16">
          <div>
            <DialogTitle>{event ? "Fill open slots" : "Auto assign crew"}</DialogTitle>
            <DialogDescription className="mt-1">
              {step === "scope"
                ? event
                  ? "Suggest people for this event's open slots, then review before anything is staged."
                  : "Pick the window, then preview who gets staged. Workers are notified after a ten-minute cancel window."
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

              <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]">
                {event ? (
                  <ScopeRow label="Event" hint={activeWindow.detail}>
                    <span className="truncate text-sm font-bold">{event.summary}</span>
                  </ScopeRow>
                ) : null}
                {event ? null : (
                <ScopeRow label="Sports" hint={sportCodes.length > 0 ? null : "Every sport in the window is included."}>
                  <div className="flex flex-wrap items-center gap-2">
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
                        className="h-10 text-xs text-[var(--text-secondary)] hover:text-[var(--text)]"
                        onClick={() => setSportCodes([])}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                  {sportCodes.length > 0 ? (
                    <div className="mt-3">
                      <SportRosterPreview
                        roster={roster}
                        loading={rosterLoading}
                        error={rosterError}
                        onEditSport={setWizardSportCode}
                      />
                    </div>
                  ) : null}
                </ScopeRow>
                )}

                <ScopeRow label="Area">
                  <Select value={area ?? "_all"} onValueChange={(value) => setArea(value === "_all" ? null : value as Area)}>
                    <SelectTrigger size="sm" className="h-10 w-44" aria-label="Auto assign area filter">
                      <SelectValue placeholder="All areas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All areas</SelectItem>
                      {AREAS.map((value) => (
                        <SelectItem key={value} value={value}>{AREA_LABELS[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ScopeRow>

                {event ? null : (
                <ScopeRow label="Period" hint={activeWindow.detail}>
                  <ToggleGroup
                    type="single"
                    value={period}
                    onValueChange={(value) => {
                      if (value) setPeriod(value as AssignmentPeriodValue);
                    }}
                    className="flex-wrap justify-start"
                    aria-label="Auto assign period"
                  >
                    {ASSIGNMENT_PERIODS.map((value) => (
                      <ToggleGroupItem key={value} value={value} className="h-10 px-3 text-sm">
                        {windows[value].label}
                      </ToggleGroupItem>
                    ))}
                    {customWindow ? (
                      <ToggleGroupItem value="custom" className="h-10 px-3 text-sm">
                        {customWindow.label}
                      </ToggleGroupItem>
                    ) : null}
                  </ToggleGroup>
                </ScopeRow>
                )}

                <ScopeRow label="Assign">
                  <ToggleGroup
                    type="single"
                    value={workerScope}
                    onValueChange={(value) => {
                      if (value) setWorkerScope(value as BulkAssignmentWorkerScope);
                    }}
                    className="flex-wrap justify-start"
                    aria-label="Which slots to fill"
                  >
                    {BULK_ASSIGNMENT_WORKER_SCOPES.map((value) => (
                      <ToggleGroupItem key={value} value={value} className="h-10 px-3 text-sm">
                        {BULK_ASSIGNMENT_WORKER_SCOPE_LABELS[value]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </ScopeRow>

              </div>

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
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                    {[
                      { value: selectedProposals.length, label: selectedProposals.length === 1 ? "shift" : "shifts" },
                      { value: selectedPeople.length, label: selectedPeople.length === 1 ? "person" : "people" },
                      { value: selectedEventCount, label: selectedEventCount === 1 ? "event" : "events" },
                    ].map((stat) => (
                      <div key={stat.label} className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black tabular-nums tracking-tight">{stat.value}</span>
                        <span className="text-sm text-[var(--text-secondary)]">{stat.label}</span>
                      </div>
                    ))}
                    {blockedEvents.length > 0 ? (
                      <span className="pb-1 text-sm text-[var(--text-muted)]">
                        {blockedEvents.length} other event{blockedEvents.length === 1 ? "" : "s"} stayed out
                      </span>
                    ) : null}
                  </div>
                  {selectedProposals.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">Select events below to stage assignments.</p>
                  ) : null}

                  {preview.summary.eventsPendingChanges > 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      <strong className="text-[var(--text)]">{preview.summary.eventsPendingChanges}</strong>{" "}
                      skipped for unreleased staff changes.{" "}
                      <a className="underline underline-offset-2" href="/schedule/assign">Review them</a>, then build again.
                    </p>
                  ) : null}

                  {selectedPeople.length > 0 ? (
                    <section className="flex flex-col gap-2" aria-label="Who is getting added">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-sm font-bold">Who is getting added</h3>
                        <span className="text-xs text-[var(--text-muted)] max-sm:hidden">
                          {focusPersonId ? "Showing one person's shifts" : "Tap someone to see their shifts"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[...selectedPeople].sort((a, b) => b.shiftCount - a.shiftCount || a.userName.localeCompare(b.userName)).map((person) => {
                          const focused = focusPersonId === person.userId;
                          return (
                            <button
                              key={person.userId}
                              type="button"
                              aria-pressed={focused}
                              onClick={() => setFocusPersonId(focused ? null : person.userId)}
                              className={cn(
                                "flex h-9 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] py-1 pl-1 pr-3 text-sm transition-colors hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                                focused && "border-[var(--accent)] bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)]",
                              )}
                            >
                              <UserAvatar name={person.userName} size="xs" />
                              <span className="font-bold">{firstName(person.userName)}</span>
                              <span className="tabular-nums text-[var(--text-secondary)]">{person.shiftCount}</span>
                              {person.warningCount > 0 ? (
                                <span className="size-1.5 rounded-full bg-[#f76b15]" aria-label={`${person.warningCount} to check`} />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  <section className="flex flex-col gap-2" aria-label="Include events">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm font-bold">Include events</h3>
                      <span className="text-xs text-[var(--text-muted)] max-sm:hidden">
                        Uncheck any slot to leave it open
                      </span>
                    </div>
                    <ul className="flex flex-col gap-2">
                      {readyEvents.map((event) => {
                        const selectedCount = event.proposals.filter((proposal) => selectedProposalIds.has(proposal.proposalId)).length;
                        const eventChecked = selectedCount === event.proposals.length
                          ? true
                          : selectedCount === 0 ? false : "indeterminate" as const;
                        const proposals = focusPersonId
                          ? event.proposals.filter((proposal) => proposal.userId === focusPersonId)
                          : event.proposals;
                        if (focusPersonId && proposals.length === 0) return null;
                        return (
                          <li key={event.eventId} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]">
                            <div className="flex min-h-12 items-center gap-3 bg-[var(--bg-surface)] px-3">
                              <Checkbox
                                checked={eventChecked}
                                disabled={applying}
                                onCheckedChange={(checked) => toggleEvent(event, checked === true)}
                                aria-label={`Include ${event.summary}`}
                                className="size-5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-bold">{event.summary}</div>
                                <div className="text-xs text-[var(--text-secondary)]">{formatEventDate(event.startsAt)}</div>
                              </div>
                              <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">
                                {eventSelectionLabel(event)}
                                {!event.fullyCrewed ? ` · ${event.unfilledSlots} left open` : ""}
                              </span>
                            </div>
                            <ul className="divide-y divide-[var(--border)]">
                              {proposals.map((proposal) => {
                                const reason = proposalReason(proposal);
                                const included = selectedProposalIds.has(proposal.proposalId);
                                return (
                                  <li
                                    key={proposal.proposalId}
                                    className={cn(
                                      "grid min-h-12 grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:gap-3",
                                      !included && "opacity-50",
                                    )}
                                  >
                                    <span className="truncate text-xs font-bold text-[var(--text-muted)]">
                                      {AREA_LABELS[proposal.area] ?? proposal.area}
                                    </span>
                                    <span className="flex min-w-0 items-center gap-2.5">
                                      <UserAvatar name={proposal.userName} size="sm" />
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-bold">{proposal.userName}</span>
                                        <span
                                          className={cn(
                                            "block truncate text-xs",
                                            reason.tone === "warning" ? "text-[var(--orange-text)]" : "text-[var(--text-secondary)]",
                                          )}
                                        >
                                          {reason.text}
                                        </span>
                                      </span>
                                    </span>
                                    <Checkbox
                                        checked={included}
                                        disabled={applying}
                                        onCheckedChange={(checked) => toggleProposal(proposal.proposalId, checked === true)}
                                        aria-label={`Assign ${proposal.userName} to ${AREA_LABELS[proposal.area] ?? proposal.area} for ${event.summary}`}
                                        className="size-5"
                                      />
                                  </li>
                                );
                              })}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  </section>

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
          setSelectedProposalIds(new Set());
          setStep("scope");
        }}
      />
    </Dialog>
  );
}
