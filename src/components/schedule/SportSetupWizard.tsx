"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  CircleCheck,
  CopyIcon,
  Plane,
  RefreshCw,
  Search,
  TriangleAlert,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  SPORT_AUTO_ASSIGN_POLICIES,
  SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS,
  SPORT_AUTO_ASSIGN_POLICY_LABELS,
  type SportAutoAssignPolicy,
} from "@/lib/sport-auto-assign-policy";
import type {
  SportSetupEntry,
  SportSetupMember,
  SportSetupResponse,
} from "@/lib/services/sport-setup";
import { AREA_LABELS } from "@/types/areas";
import { cn } from "@/lib/utils";
import { isBigSixSportCode } from "@/lib/sports";
import { VarsityOwnershipEditor } from "@/components/schedule/VarsityOwnershipEditor";
import { useCurrentUser } from "@/hooks/use-current-user";
import { evaluateTravelReadiness } from "@/lib/travel-readiness";
import { summarizeSportRosterCoverage } from "@/lib/sport-roster-coverage";

type SportSetupWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump straight to this sport -- used by the "Change" link on a roster. */
  startAtSportCode?: string | null;
  onCompleted?: () => void;
};

function areaLabel(area: string | null) {
  if (!area) return "No area";
  return AREA_LABELS[area as keyof typeof AREA_LABELS] ?? area;
}

function MemberRow({
  member,
  onRemove,
  onToggleTravel,
  onSelect,
  selected,
  busy,
}: {
  member: SportSetupMember;
  onRemove: () => void;
  onToggleTravel: () => void;
  onSelect: () => void;
  selected: boolean;
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-md border px-3 py-2",
        member.defaultTraveler
          ? "border-[var(--yellow-text)]/25 bg-[var(--yellow-bg)]/35"
          : "border-border/60 bg-card",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onSelect}
        aria-label={`Select ${member.name}`}
        disabled={busy}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{member.name}</p>
        {member.primaryArea ? (
          <p className="truncate text-xs text-muted-foreground">{areaLabel(member.primaryArea)}</p>
        ) : (
          <Link
            href={`/users/${member.id}`}
            className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            No area · Set on profile
          </Link>
        )}
      </div>
      <Button
        variant={member.defaultTraveler ? "outline" : "ghost"}
        size="sm"
        className={cn(
          "h-10 shrink-0 px-3 text-xs",
          member.defaultTraveler && "border-[var(--yellow-text)]/30 bg-[var(--yellow-bg)]/50 text-[var(--yellow-text)]",
        )}
        aria-pressed={member.defaultTraveler}
        aria-label={
          member.defaultTraveler
            ? `Remove ${member.name} from the travel roster`
            : `Add ${member.name} to the travel roster`
        }
        disabled={busy}
        onClick={onToggleTravel}
      >
        <Plane className="size-3.5" fill={member.defaultTraveler ? "currentColor" : "none"} />
        {member.defaultTraveler ? "Travels" : "Add to travel"}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="size-10 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${member.name} from this sport`}
            disabled={busy}
            onClick={onRemove}
          >
            <X className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove from this sport</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * A sport-by-sport pass over the two things auto assignment needs: the policy
 * and the roster.
 *
 * The Big 6 come first, because those are the sports that carry the schedule
 * and the ones most likely to be set up wrong. Every step is saved as it is
 * made rather than at the end, so quitting halfway still leaves the sports
 * already visited configured.
 */
export function SportSetupWizard({
  open,
  onOpenChange,
  startAtSportCode,
  onCompleted,
}: SportSetupWizardProps) {
  const { data: currentUser } = useCurrentUser();
  const [setup, setSetup] = useState<SportSetupResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerWorkerType, setPickerWorkerType] = useState<"ALL" | "FT" | "ST">("ALL");
  const [pickerArea, setPickerArea] = useState("ALL");
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(() => new Set());
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchRoster, setMatchRoster] = useState(true);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterView, setRosterView] = useState<"ALL" | "TRAVEL">("ALL");
  const [rosterWorkerType, setRosterWorkerType] = useState<"ALL" | "FT" | "ST">("ALL");
  const [rosterArea, setRosterArea] = useState("ALL");
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(() => new Set());
  const [travelFallbackTarget, setTravelFallbackTarget] = useState<SportSetupMember[] | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SportSetupMember | null>(null);
  const [touchedCodes, setTouchedCodes] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/schedule/sport-setup");
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Sport setup could not be loaded."));
        return;
      }
      const json = await parseJsonSafely<{ data?: SportSetupResponse }>(response);
      if (!json?.data) {
        setError("Sport setup could not be loaded.");
        return;
      }
      setSetup(json.data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTouchedCodes(new Set());
    void load();
  }, [open, load]);

  // Seek to the requested sport once the list has arrived.
  useEffect(() => {
    if (!setup || !startAtSportCode) return;
    const target = setup.sports.findIndex((sport) => sport.sportCode === startAtSportCode);
    setIndex(target >= 0 ? target : 0);
  }, [setup, startAtSportCode]);

  useEffect(() => {
    setRosterQuery("");
    setRosterView("ALL");
    setRosterWorkerType("ALL");
    setRosterArea("ALL");
    setSelectedRosterIds(new Set());
  }, [index]);

  const sport: SportSetupEntry | null = setup?.sports[index] ?? null;
  const total = setup?.sports.length ?? 0;

  const assignedIds = useMemo(
    () => new Set([...(sport?.staff ?? []), ...(sport?.students ?? [])].map((member) => member.id)),
    [sport],
  );
  const availablePeople = useMemo(
    () => (setup?.people ?? []).filter((person) => !assignedIds.has(person.id)),
    [assignedIds, setup],
  );
  const availableAreas = useMemo(
    () => Array.from(new Set(availablePeople.map((person) => person.primaryArea).filter((area): area is string => !!area)))
      .sort((a, b) => areaLabel(a).localeCompare(areaLabel(b))),
    [availablePeople],
  );
  const filteredAvailablePeople = useMemo(
    () => availablePeople.filter((person) =>
      (pickerWorkerType === "ALL" || person.workerType === pickerWorkerType)
      && (pickerArea === "ALL" || person.primaryArea === pickerArea)),
    [availablePeople, pickerArea, pickerWorkerType],
  );
  const rosterSize = (sport?.staff.length ?? 0) + (sport?.students.length ?? 0);
  const travelers = useMemo(
    () => [...(sport?.staff ?? []), ...(sport?.students ?? [])].filter((member) => member.defaultTraveler),
    [sport],
  );
  const travelReadiness = useMemo(
    () => sport
      ? evaluateTravelReadiness(sport.awayRequirements, [...sport.staff, ...sport.students])
      : null,
    [sport],
  );
  const rosterMembers = useMemo(
    () => [...(sport?.staff ?? []), ...(sport?.students ?? [])],
    [sport],
  );
  const rosterCoverage = useMemo(
    () => summarizeSportRosterCoverage(rosterMembers)
      .sort((a, b) => areaLabel(a.area).localeCompare(areaLabel(b.area))),
    [rosterMembers],
  );
  const rosterAreas = useMemo(
    () => rosterCoverage.filter((coverage) => coverage.area !== null),
    [rosterCoverage],
  );
  const selectedRosterMembers = useMemo(
    () => rosterMembers.filter((member) => selectedRosterIds.has(member.assignmentId)),
    [rosterMembers, selectedRosterIds],
  );
  const filteredStaff = useMemo(() => {
    const query = rosterQuery.trim().toLocaleLowerCase();
    return (sport?.staff ?? []).filter((member) =>
      (rosterView === "ALL" || member.defaultTraveler)
      && (rosterWorkerType === "ALL" || rosterWorkerType === "FT")
      && (rosterArea === "ALL" || (rosterArea === "NO_AREA" ? !member.primaryArea : member.primaryArea === rosterArea))
      && (!query || `${member.name} ${areaLabel(member.primaryArea)}`.toLocaleLowerCase().includes(query)),
    );
  }, [rosterArea, rosterQuery, rosterView, rosterWorkerType, sport]);
  const filteredStudents = useMemo(() => {
    const query = rosterQuery.trim().toLocaleLowerCase();
    return (sport?.students ?? []).filter((member) =>
      (rosterView === "ALL" || member.defaultTraveler)
      && (rosterWorkerType === "ALL" || rosterWorkerType === "ST")
      && (rosterArea === "ALL" || (rosterArea === "NO_AREA" ? !member.primaryArea : member.primaryArea === rosterArea))
      && (!query || `${member.name} ${areaLabel(member.primaryArea)}`.toLocaleLowerCase().includes(query)),
    );
  }, [rosterArea, rosterQuery, rosterView, rosterWorkerType, sport]);
  const visibleRosterIds = useMemo(
    () => [...filteredStaff, ...filteredStudents].map((member) => member.assignmentId),
    [filteredStaff, filteredStudents],
  );
  const allVisibleSelected = visibleRosterIds.length > 0
    && visibleRosterIds.every((assignmentId) => selectedRosterIds.has(assignmentId));

  function patchSport(
    sportCode: string,
    update: (entry: SportSetupEntry) => SportSetupEntry,
    { touched = true }: { touched?: boolean } = {},
  ) {
    setSetup((current) => current && {
      ...current,
      sports: current.sports.map((entry) => (entry.sportCode === sportCode ? update(entry) : entry)),
    });
    if (touched) setTouchedCodes((current) => new Set(current).add(sportCode));
  }

  /** Undo an optimistic change without claiming the sport was updated. */
  function revertSport(sportCode: string, update: (entry: SportSetupEntry) => SportSetupEntry) {
    patchSport(sportCode, update, { touched: false });
    setTouchedCodes((current) => {
      const next = new Set(current);
      next.delete(sportCode);
      return next;
    });
  }

  async function setPolicy(policy: SportAutoAssignPolicy) {
    if (!sport || busy) return;
    const previous = sport.policy;
    patchSport(sport.sportCode, (entry) => ({ ...entry, policy }));
    setBusy(true);
    try {
      const response = await fetch("/api/schedule/sport-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sportCode: sport.sportCode, policy }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        revertSport(sport.sportCode, (entry) => ({ ...entry, policy: previous }));
        toast.error(await parseErrorMessage(response, "That policy was not saved."));
      }
    } catch {
      revertSport(sport.sportCode, (entry) => ({ ...entry, policy: previous }));
      toast.error("Could not reach the server. The policy was not saved.");
    } finally {
      setBusy(false);
    }
  }

  function setPickerVisibility(nextOpen: boolean) {
    setPickerOpen(nextOpen);
    if (nextOpen) {
      setPickerWorkerType("ALL");
      setPickerArea("ALL");
      setSelectedPersonIds(new Set());
    }
  }

  function toggleSelectedPerson(personId: string) {
    setSelectedPersonIds((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  async function addSelectedPeople() {
    if (!sport || busy || selectedPersonIds.size === 0) return;
    const userIds = Array.from(selectedPersonIds);
    setBusy(true);
    setPickerOpen(false);
    try {
      const response = await fetch(`/api/sport-configs/${sport.sportCode}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Those people were not added."));
        return;
      }
      setTouchedCodes((current) => new Set(current).add(sport.sportCode));
      toast.success(`Added ${userIds.length} ${userIds.length === 1 ? "person" : "people"} to ${sport.label}`);
      await load();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function matchSport(sourceSportCode: string) {
    if (!sport || busy) return;
    setBusy(true);
    setMatchOpen(false);
    try {
      const response = await fetch("/api/schedule/sport-setup/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceSportCode,
          targetSportCode: sport.sportCode,
          includeRoster: matchRoster,
        }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That sport could not be matched."));
        return;
      }
      const json = await parseJsonSafely<{ data?: { peopleAdded?: number } }>(response);
      const added = json?.data?.peopleAdded ?? 0;
      const sourceLabel = setup?.sports.find((entry) => entry.sportCode === sourceSportCode)?.label ?? sourceSportCode;
      toast.success(
        added > 0
          ? `Matched ${sourceLabel} and added ${added} ${added === 1 ? "person" : "people"}`
          : `Matched ${sourceLabel}`,
      );
      setTouchedCodes((current) => new Set(current).add(sport.sportCode));
      // The copy touched policy and roster together, so reload rather than
      // reconstruct the merged result on the client.
      await load();
    } catch {
      toast.error("Could not reach the server. Nothing was matched.");
    } finally {
      setBusy(false);
    }
  }

  function toggleRosterSelection(assignmentId: string) {
    setSelectedRosterIds((current) => {
      const next = new Set(current);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  }

  async function setTravelForMembers(members: SportSetupMember[], next: boolean) {
    if (!sport || busy || members.length === 0) return;
    const assignmentIds = members.map((member) => member.assignmentId);
    const selected = new Set(assignmentIds);
    const previous = new Map(members.map((member) => [member.assignmentId, member.defaultTraveler]));
    setBusy(true);
    const applyTravel = (value: boolean, touched = true) => patchSport(sport.sportCode, (entry) => ({
      ...entry,
      staff: entry.staff.map((candidate) =>
        selected.has(candidate.assignmentId) ? { ...candidate, defaultTraveler: value } : candidate),
      students: entry.students.map((candidate) =>
        selected.has(candidate.assignmentId) ? { ...candidate, defaultTraveler: value } : candidate),
    }), { touched });
    applyTravel(next);
    try {
      const response = await fetch(`/api/sport-configs/${sport.sportCode}/roster`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentIds, defaultTraveler: next }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        patchSport(sport.sportCode, (entry) => ({
          ...entry,
          staff: entry.staff.map((candidate) => selected.has(candidate.assignmentId)
            ? { ...candidate, defaultTraveler: previous.get(candidate.assignmentId) ?? candidate.defaultTraveler }
            : candidate),
          students: entry.students.map((candidate) => selected.has(candidate.assignmentId)
            ? { ...candidate, defaultTraveler: previous.get(candidate.assignmentId) ?? candidate.defaultTraveler }
            : candidate),
        }), { touched: false });
        toast.error(await parseErrorMessage(response, "The travel roster was not updated."));
        return;
      }
      setSelectedRosterIds(new Set());
      toast.success(`${members.length} ${members.length === 1 ? "person" : "people"} ${next ? "added to" : "removed from"} travel`);
    } catch {
      patchSport(sport.sportCode, (entry) => ({
        ...entry,
        staff: entry.staff.map((candidate) => selected.has(candidate.assignmentId)
          ? { ...candidate, defaultTraveler: previous.get(candidate.assignmentId) ?? candidate.defaultTraveler }
          : candidate),
        students: entry.students.map((candidate) => selected.has(candidate.assignmentId)
          ? { ...candidate, defaultTraveler: previous.get(candidate.assignmentId) ?? candidate.defaultTraveler }
          : candidate),
      }), { touched: false });
      toast.error("Could not reach the server. The travel roster was not updated.");
    } finally {
      setBusy(false);
    }
  }

  function requestTravelUpdate(members: SportSetupMember[], next: boolean) {
    if (!next && travelers.length > 0) {
      const selected = new Set(members.map((member) => member.assignmentId));
      if (travelers.every((member) => selected.has(member.assignmentId))) {
        setTravelFallbackTarget(members);
        return;
      }
    }
    void setTravelForMembers(members, next);
  }

  async function removeMember(member: SportSetupMember) {
    if (!sport || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/sport-configs/${sport.sportCode}/roster?assignmentId=${encodeURIComponent(member.assignmentId)}`,
        { method: "DELETE" },
      );
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, `${member.name} was not removed.`));
        return;
      }
      patchSport(sport.sportCode, (entry) => ({
        ...entry,
        staff: entry.staff.filter((candidate) => candidate.assignmentId !== member.assignmentId),
        students: entry.students.filter((candidate) => candidate.assignmentId !== member.assignmentId),
      }));
      setSelectedRosterIds((current) => {
        const next = new Set(current);
        next.delete(member.assignmentId);
        return next;
      });
      setRemoveTarget(null);
      toast.success(`${member.name} removed from ${sport.label}`);
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    if (touchedCodes.size > 0) {
      toast.success(`Set up ${touchedCodes.size} sport${touchedCodes.size === 1 ? "" : "s"}`);
    }
    onOpenChange(false);
    onCompleted?.();
  }

  const isLast = index >= total - 1;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
        <DialogHeader className="pr-16">
          <div>
            <DialogTitle>Sport setup</DialogTitle>
            <DialogDescription className="mt-1">
              Each sport decides what Auto assign does for it and who it can pick from. Changes save as you make them
              and take effect the next time Auto assign runs — nothing is scheduled from here.
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="min-h-0 px-6 py-4">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground" aria-live="polite">
              <RefreshCw className="mr-2 size-4 animate-spin" /> Loading sports…
            </div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-md text-sm text-destructive" role="alert">{error}</p>
              <Button variant="outline" onClick={() => void load()}>
                <RefreshCw className="size-4" /> Try again
              </Button>
            </div>
          ) : sport ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={sport.sportCode}
                      onValueChange={(sportCode) => {
                        const nextIndex = setup?.sports.findIndex((entry) => entry.sportCode === sportCode) ?? -1;
                        if (nextIndex >= 0) setIndex(nextIndex);
                      }}
                    >
                      <SelectTrigger className="h-10 w-full min-w-56 sm:w-72" aria-label="Choose sport">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(setup?.sports ?? []).map((entry) => (
                          <SelectItem key={entry.sportCode} value={entry.sportCode}>
                            {entry.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Badge variant="gray" size="sm">{sport.sportCode}</Badge>
                    {touchedCodes.has(sport.sportCode) ? (
                      <Badge variant="green" size="sm">Saved</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    Sport {index + 1} of {total}
                  </p>
                </div>

                <Popover open={matchOpen} onOpenChange={setMatchOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-10" disabled={busy}>
                      <CopyIcon data-icon="inline-start" className="size-3.5" />
                      Match another sport
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-0">
                    <div className="border-b p-3">
                      <p className="text-sm font-medium">Set up {sport.label} like another sport</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Copies that sport&apos;s policy onto this one.
                      </p>
                      <label className="mt-2 flex items-start gap-2 text-xs">
                        <Checkbox
                          checked={matchRoster}
                          onCheckedChange={(checked) => setMatchRoster(checked === true)}
                          className="mt-0.5"
                        />
                        <span>
                          Also add its people to this roster, travel flags included. Nobody already here is removed.
                        </span>
                      </label>
                    </div>
                    <Command>
                      <CommandInput placeholder="Match which sport?" />
                      <CommandList>
                        <CommandEmpty>No sport matches.</CommandEmpty>
                        <CommandGroup>
                          {(setup?.sports ?? [])
                            .filter((entry) => entry.sportCode !== sport.sportCode)
                            .map((entry) => (
                              <CommandItem
                                key={entry.sportCode}
                                value={entry.label}
                                onSelect={() => void matchSport(entry.sportCode)}
                              >
                                <span className="flex-1 truncate">{entry.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {SPORT_AUTO_ASSIGN_POLICY_LABELS[entry.policy]}
                                </span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <span className="text-sm font-medium">What should Auto assign do for {sport.label}?</span>
                  <p className="text-xs text-muted-foreground">
                    Applies to every {sport.label} event. Change it any time.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {SPORT_AUTO_ASSIGN_POLICIES.map((policy) => {
                    const active = sport.policy === policy;
                    return (
                      <button
                        key={policy}
                        type="button"
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => void setPolicy(policy)}
                        className={cn(
                          "min-h-10 rounded-md border p-3 text-left transition-colors",
                          active
                            ? "border-[var(--blue-text)] bg-[var(--blue-bg)]/50"
                            : "border-border/70 bg-card hover:bg-muted/40",
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          {active ? <Check className="size-3.5 text-[var(--blue-text)]" /> : null}
                          {SPORT_AUTO_ASSIGN_POLICY_LABELS[policy]}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS[policy]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {currentUser?.role === "ADMIN" && !isBigSixSportCode(sport.sportCode)
                ? <VarsityOwnershipEditor sportCode={sport.sportCode} />
                : null}

              <div className="flex flex-col gap-2">
                <div>
                  <span className="text-sm font-medium">Who can it pick from?</span>
                  <p className="text-xs text-muted-foreground">
                    Auto assign only ever proposes people on this roster. Area and availability decide which slot
                    each person can take.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Roster controls</span>
                  <Popover open={pickerOpen} onOpenChange={setPickerVisibility}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="ml-auto h-10" disabled={busy}>
                        <UserPlus data-icon="inline-start" className="size-3.5" />
                        Add person
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
                      <div className="space-y-2 border-b p-3">
                        <div className="flex rounded-md border border-border/60 bg-muted/20 p-1" aria-label="Person type">
                          {(["ALL", "FT", "ST"] as const).map((workerType) => (
                            <Button
                              key={workerType}
                              type="button"
                              variant={pickerWorkerType === workerType ? "secondary" : "ghost"}
                              size="sm"
                              className="h-8 flex-1 text-xs"
                              aria-pressed={pickerWorkerType === workerType}
                              onClick={() => setPickerWorkerType(workerType)}
                            >
                              {workerType === "ALL" ? "Everyone" : workerType === "FT" ? "Staff" : "Students"}
                            </Button>
                          ))}
                        </div>
                        <Select value={pickerArea} onValueChange={setPickerArea}>
                          <SelectTrigger className="h-10" aria-label="Filter people by area">
                            <SelectValue placeholder="All areas" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All areas</SelectItem>
                            {availableAreas.map((area) => (
                              <SelectItem key={area} value={area}>{areaLabel(area)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Command>
                        <CommandInput placeholder="Find a person…" />
                        <CommandList className="max-h-72">
                          <CommandEmpty>No available people match.</CommandEmpty>
                          <CommandGroup>
                            {filteredAvailablePeople.map((person) => {
                              const selected = selectedPersonIds.has(person.id);
                              return (
                              <CommandItem
                                key={person.id}
                                value={`${person.name} ${areaLabel(person.primaryArea)} ${person.workerType}`}
                                onSelect={() => toggleSelectedPerson(person.id)}
                                aria-selected={selected}
                              >
                                <span className={cn(
                                  "flex size-4 shrink-0 items-center justify-center rounded border",
                                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                )}>
                                  {selected ? <Check className="size-3" /> : null}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{person.name}</span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {person.workerType === "FT" ? "Staff" : "Student"} · {areaLabel(person.primaryArea)}
                                  </span>
                                </span>
                              </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                      <div className="flex items-center justify-between gap-3 border-t p-3">
                        <span className="text-xs text-muted-foreground">
                          {selectedPersonIds.size === 0 ? "Select one or more people" : `${selectedPersonIds.size} selected`}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          className="h-10"
                          disabled={busy || selectedPersonIds.size === 0}
                          onClick={() => void addSelectedPeople()}
                        >
                          Add selected
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {sport.policy === "HOLD" ? (
                  <p className="rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                    This sport is on hold, so the roster is not used by auto assign right now. It still drives who is
                    suggested when someone is assigned by hand.
                  </p>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
                    <p className="text-xs font-medium text-muted-foreground">Full roster</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{rosterSize}</p>
                    <p className="text-xs text-muted-foreground">
                      {sport.staff.length} staff · {sport.students.length} student{sport.students.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className={cn(
                    "rounded-md border px-3 py-3",
                    travelers.length > 0
                      ? "border-[var(--yellow-text)]/25 bg-[var(--yellow-bg)]/35"
                      : "border-[var(--orange-text)]/25 bg-[var(--orange-bg)]/30",
                  )}>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Plane className="size-3.5" /> Travel roster
                    </p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{travelers.length}</p>
                    <p className="text-xs text-muted-foreground">
                      {travelers.length > 0
                        ? "Away events use only these marked travelers."
                        : "Fallback active: away events use the full roster."}
                    </p>
                  </div>
                </div>

                {rosterCoverage.length > 0 ? (
                  <div className="rounded-md border border-border/60 bg-muted/15 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">Full roster coverage</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Primary coverage areas saved on each person&apos;s profile. Select one to review that group.
                        </p>
                      </div>
                      <Badge variant="gray" size="sm">{rosterCoverage.length} {rosterCoverage.length === 1 ? "area" : "areas"}</Badge>
                    </div>
                    <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {rosterCoverage.map((coverage) => {
                        const value = coverage.area ?? "NO_AREA";
                        const active = rosterView === "ALL" && rosterArea === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={active}
                            className={cn(
                              "min-h-12 rounded-md border px-3 py-2 text-left transition-colors",
                              active
                                ? "border-[var(--blue-text)] bg-[var(--blue-bg)]/40"
                                : "border-border/60 bg-card hover:bg-muted/40",
                            )}
                            onClick={() => {
                              setRosterView("ALL");
                              setRosterArea(active ? "ALL" : value);
                              setRosterWorkerType("ALL");
                              setRosterQuery("");
                            }}
                          >
                            <span className="flex items-center justify-between gap-2 text-xs font-medium">
                              <span className="truncate">{areaLabel(coverage.area)}</span>
                              <span className="tabular-nums text-muted-foreground">{coverage.total}</span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {coverage.staffCount} staff · {coverage.studentCount} student{coverage.studentCount === 1 ? "" : "s"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {travelReadiness ? (
                  <div className={cn(
                    "rounded-md border p-3",
                    travelReadiness.status === "READY"
                      ? "border-[var(--green-text)]/25 bg-[var(--green-bg)]/25"
                      : travelReadiness.status === "GAPS"
                        ? "border-[var(--orange-text)]/25 bg-[var(--orange-bg)]/25"
                        : "border-border/60 bg-muted/15",
                  )}>
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {travelReadiness.status === "READY" ? (
                            <CircleCheck className="size-4 text-[var(--green-text)]" />
                          ) : travelReadiness.status === "GAPS" ? (
                            <TriangleAlert className="size-4 text-[var(--orange-text)]" />
                          ) : (
                            <Plane className="size-4 text-muted-foreground" />
                          )}
                          Away crew readiness
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {travelReadiness.mode === "EXPLICIT_TRAVEL"
                            ? `Checking ${travelReadiness.effectivePoolSize} marked travelers against saved away minimums.`
                            : `No travel roster is set, so this checks all ${travelReadiness.effectivePoolSize} roster members.`}
                        </p>
                      </div>
                      <Badge
                        variant={travelReadiness.status === "READY" ? "green" : travelReadiness.status === "GAPS" ? "orange" : "gray"}
                        size="sm"
                      >
                        {travelReadiness.status === "READY"
                          ? "Ready by template"
                          : travelReadiness.status === "GAPS"
                            ? `${travelReadiness.gaps.length} ${travelReadiness.gaps.length === 1 ? "gap" : "gaps"}`
                            : "No away minimums"}
                      </Badge>
                    </div>

                    {travelReadiness.status === "GAPS" ? (
                      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                        {travelReadiness.gaps.map((gap) => (
                          <button
                            key={`${gap.area}-${gap.workerType}`}
                            type="button"
                            className="flex min-h-10 items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40"
                            onClick={() => {
                              setRosterView(travelReadiness.mode === "EXPLICIT_TRAVEL" ? "TRAVEL" : "ALL");
                              setRosterArea(gap.area);
                              setRosterWorkerType(gap.workerType);
                              setRosterQuery("");
                            }}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{areaLabel(gap.area)} · {gap.workerType === "FT" ? "Staff" : "Student"}</span>
                              <span className="block text-xs text-muted-foreground">{gap.eligible} eligible for {gap.required} required</span>
                            </span>
                            <Badge variant="orange" size="sm">Need {gap.missing}</Badge>
                          </button>
                        ))}
                      </div>
                    ) : travelReadiness.status === "NO_TEMPLATE" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Set away Staff and Student minimums on this sport card to evaluate its travel pool.
                      </p>
                    ) : null}

                    {travelReadiness.membersWithoutArea > 0 ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="mt-2 h-auto px-0 text-xs"
                        onClick={() => {
                          setRosterView(travelReadiness.mode === "EXPLICIT_TRAVEL" ? "TRAVEL" : "ALL");
                          setRosterArea("NO_AREA");
                          setRosterWorkerType("ALL");
                          setRosterQuery("");
                        }}
                      >
                        Review {travelReadiness.membersWithoutArea} {travelReadiness.membersWithoutArea === 1 ? "person" : "people"} without a coverage area
                      </Button>
                    ) : null}

                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      This is a template check, not an event promise. Auto assign still rechecks travel eligibility,
                      availability, approved time off, conflicts, and current schedule state for each event.
                    </p>
                    {sport.sportCode === "FB" ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        Football game-day positions stay in Staffing sheet review; they are not coverage areas or crew minimums.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {rosterSize > 0 ? (
                  <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/15 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={rosterQuery}
                          onChange={(event) => setRosterQuery(event.target.value)}
                          placeholder="Find a roster member or area…"
                          aria-label="Find a roster member or area"
                          className="h-10 pl-9"
                        />
                      </div>
                      <div className="flex rounded-md border border-border/60 bg-card p-1" aria-label="Roster view">
                        <Button
                          variant={rosterView === "ALL" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-8 flex-1 px-3 text-xs sm:flex-none"
                          aria-pressed={rosterView === "ALL"}
                          onClick={() => setRosterView("ALL")}
                        >
                          All {rosterSize}
                        </Button>
                        <Button
                          variant={rosterView === "TRAVEL" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-8 flex-1 px-3 text-xs sm:flex-none"
                          aria-pressed={rosterView === "TRAVEL"}
                          onClick={() => setRosterView("TRAVEL")}
                        >
                          <Plane className="size-3.5" /> Travel {travelers.length}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="flex rounded-md border border-border/60 bg-card p-1" aria-label="Roster person type">
                        {(["ALL", "FT", "ST"] as const).map((workerType) => (
                          <Button
                            key={workerType}
                            type="button"
                            variant={rosterWorkerType === workerType ? "secondary" : "ghost"}
                            size="sm"
                            className="h-8 flex-1 px-3 text-xs sm:flex-none"
                            aria-pressed={rosterWorkerType === workerType}
                            onClick={() => setRosterWorkerType(workerType)}
                          >
                            {workerType === "ALL" ? "Everyone" : workerType === "FT" ? "Staff" : "Students"}
                          </Button>
                        ))}
                      </div>
                      <Select value={rosterArea} onValueChange={setRosterArea}>
                        <SelectTrigger className="h-10 w-full sm:w-48" aria-label="Filter roster by area">
                          <SelectValue placeholder="All coverage areas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All coverage areas</SelectItem>
                          {rosterAreas.map((coverage) => (
                            <SelectItem key={coverage.area} value={coverage.area!}>{areaLabel(coverage.area)}</SelectItem>
                          ))}
                          {rosterCoverage.some((coverage) => coverage.area === null) ? (
                            <SelectItem value="NO_AREA">No area</SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                      {rosterWorkerType !== "ALL" || rosterArea !== "ALL" || rosterQuery ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 sm:ml-auto"
                          onClick={() => {
                            setRosterWorkerType("ALL");
                            setRosterArea("ALL");
                            setRosterQuery("");
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-2">
                      <label className="flex min-h-10 cursor-pointer items-center gap-2 px-1 text-xs font-medium">
                        <Checkbox
                          checked={allVisibleSelected ? true : selectedRosterMembers.length > 0 ? "indeterminate" : false}
                          onCheckedChange={(checked) => {
                            if (checked === true) {
                              setSelectedRosterIds((current) => new Set([...current, ...visibleRosterIds]));
                            } else {
                              setSelectedRosterIds((current) => {
                                const next = new Set(current);
                                for (const assignmentId of visibleRosterIds) next.delete(assignmentId);
                                return next;
                              });
                            }
                          }}
                          disabled={busy || visibleRosterIds.length === 0}
                        />
                        {selectedRosterMembers.length > 0
                          ? `${selectedRosterMembers.length} selected`
                          : `Select visible (${visibleRosterIds.length})`}
                      </label>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-10"
                          disabled={busy || !selectedRosterMembers.some((member) => !member.defaultTraveler)}
                          onClick={() => requestTravelUpdate(selectedRosterMembers, true)}
                        >
                          <Plane className="size-3.5" /> Add to travel
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10"
                          disabled={busy || !selectedRosterMembers.some((member) => member.defaultTraveler)}
                          onClick={() => requestTravelUpdate(
                            selectedRosterMembers.filter((member) => member.defaultTraveler),
                            false,
                          )}
                        >
                          Remove from travel
                        </Button>
                      </div>
                    </div>

                    {filteredStaff.length === 0 && filteredStudents.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                        {rosterView === "TRAVEL" && travelers.length === 0
                          ? "Nobody is marked for travel. Away events currently fall back to the full roster."
                          : "No roster members match this search."}
                      </p>
                    ) : (
                      <div className={cn(
                        "grid gap-4",
                        filteredStaff.length > 0 && filteredStudents.length > 0 && "sm:grid-cols-2",
                      )}>
                        {filteredStaff.length > 0 ? <div className="min-w-0">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Staff</span>
                          <div className="mt-1.5 flex flex-col gap-1.5">
                            {filteredStaff.map((member) => (
                              <MemberRow
                                key={member.assignmentId}
                                member={member}
                                busy={busy}
                                selected={selectedRosterIds.has(member.assignmentId)}
                                onSelect={() => toggleRosterSelection(member.assignmentId)}
                                onRemove={() => setRemoveTarget(member)}
                                onToggleTravel={() => requestTravelUpdate([member], !member.defaultTraveler)}
                              />
                            ))}
                          </div>
                        </div> : null}
                        {filteredStudents.length > 0 ? <div className="min-w-0">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Students{sport.policy === "STAFF_ONLY" ? " · request their own slots" : ""}
                          </span>
                          <div className="mt-1.5 flex flex-col gap-1.5">
                            {filteredStudents.map((member) => (
                              <MemberRow
                                key={member.assignmentId}
                                member={member}
                                busy={busy}
                                selected={selectedRosterIds.has(member.assignmentId)}
                                onSelect={() => toggleRosterSelection(member.assignmentId)}
                                onRemove={() => setRemoveTarget(member)}
                                onToggleTravel={() => requestTravelUpdate([member], !member.defaultTraveler)}
                              />
                            ))}
                          </div>
                        </div> : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                    Nobody is on this sport roster yet. Add a person to make them eligible for Auto assign.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter className="flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
          <div className="w-full text-xs text-muted-foreground sm:mr-auto sm:w-auto">
            {touchedCodes.size > 0
              ? `${touchedCodes.size} sport${touchedCodes.size === 1 ? "" : "s"} updated · already saved`
              : "Nothing changed yet · Skip leaves a sport exactly as it is"}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="h-10 flex-1 sm:flex-none"
              disabled={index === 0 || busy}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
            {isLast ? (
              <Button className="h-10 flex-1 sm:flex-none" onClick={finish} disabled={busy}>Done</Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="h-10"
                  disabled={busy}
                  onClick={() => setIndex((current) => Math.min(total - 1, current + 1))}
                >
                  Skip
                </Button>
                <Button
                  className="h-10 flex-1 sm:flex-none"
                  disabled={busy}
                  onClick={() => setIndex((current) => Math.min(total - 1, current + 1))}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!removeTarget} onOpenChange={(nextOpen) => { if (!nextOpen) setRemoveTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {removeTarget?.name} from {sport?.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            They will no longer be eligible for this sport in Auto assign. This does not remove any existing shift assignments.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep on roster</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || !removeTarget}
            onClick={() => { if (removeTarget) void removeMember(removeTarget); }}
          >
            Remove from roster
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog
      open={!!travelFallbackTarget}
      onOpenChange={(nextOpen) => { if (!nextOpen) setTravelFallbackTarget(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Use the full roster for away events?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the final {travelFallbackTarget?.length === 1 ? "traveler" : "travelers"} from {sport?.label}.
            With no travel roster set, Auto assign will fall back to everyone on the full sport roster for away events.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep travel roster</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !travelFallbackTarget}
            onClick={() => {
              if (!travelFallbackTarget) return;
              const members = travelFallbackTarget;
              setTravelFallbackTarget(null);
              void setTravelForMembers(members, false);
            }}
          >
            Use full roster fallback
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
