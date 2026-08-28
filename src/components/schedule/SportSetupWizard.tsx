"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Check, CopyIcon, Plane, RefreshCw, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  SportSetupPerson,
  SportSetupResponse,
} from "@/lib/services/sport-setup";
import { AREA_LABELS } from "@/types/areas";
import { cn } from "@/lib/utils";

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

function MemberChip({
  member,
  onRemove,
  onToggleTravel,
  busy,
}: {
  member: SportSetupMember;
  onRemove: () => void;
  onToggleTravel: () => void;
  busy: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md py-1 pl-1 pr-1 text-sm",
        member.defaultTraveler ? "bg-[var(--yellow-bg)]/60" : "bg-muted/50",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "size-8 p-0",
              member.defaultTraveler
                ? "text-[var(--yellow-text)] hover:brightness-110"
                : "text-muted-foreground/40 hover:text-muted-foreground",
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
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {member.defaultTraveler ? "Travels by default — click to unset" : "Add to the travel roster"}
        </TooltipContent>
      </Tooltip>
      <span className="font-medium">{member.name}</span>
      <span className="text-xs text-muted-foreground">{areaLabel(member.primaryArea)}</span>
      <Button
        variant="ghost"
        size="sm"
        className="size-8 p-0 text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${member.name} from ${"this sport"}`}
        disabled={busy}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </span>
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
  const [setup, setSetup] = useState<SportSetupResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchRoster, setMatchRoster] = useState(true);
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
  const rosterSize = (sport?.staff.length ?? 0) + (sport?.students.length ?? 0);
  const travelers = useMemo(
    () => [...(sport?.staff ?? []), ...(sport?.students ?? [])].filter((member) => member.defaultTraveler),
    [sport],
  );

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

  async function addPerson(person: SportSetupPerson) {
    if (!sport || busy) return;
    setBusy(true);
    setPickerOpen(false);
    try {
      const response = await fetch(`/api/sport-configs/${sport.sportCode}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.id }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, `${person.name} was not added.`));
        return;
      }
      const json = await parseJsonSafely<{ data?: { id?: string } }>(response);
      const assignmentId = json?.data?.id;
      if (!assignmentId) {
        // Without the new row's id the chip could not be removed again, so
        // reload rather than render something that cannot be undone.
        await load();
        return;
      }
      const member: SportSetupMember = { ...person, assignmentId, defaultTraveler: false };
      patchSport(sport.sportCode, (entry) => ({
        ...entry,
        staff: member.workerType === "FT" ? [...entry.staff, member] : entry.staff,
        students: member.workerType === "ST" ? [...entry.students, member] : entry.students,
      }));
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

  async function toggleTravel(member: SportSetupMember) {
    if (!sport || busy) return;
    const next = !member.defaultTraveler;
    setBusy(true);
    const applyTravel = (value: boolean, touched = true) => patchSport(sport.sportCode, (entry) => ({
      ...entry,
      staff: entry.staff.map((candidate) =>
        candidate.assignmentId === member.assignmentId ? { ...candidate, defaultTraveler: value } : candidate),
      students: entry.students.map((candidate) =>
        candidate.assignmentId === member.assignmentId ? { ...candidate, defaultTraveler: value } : candidate),
    }), { touched });
    applyTravel(next);
    try {
      const response = await fetch(`/api/sport-configs/${sport.sportCode}/roster`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: member.assignmentId, defaultTraveler: next }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        applyTravel(!next, false);
        toast.error(await parseErrorMessage(response, `${member.name}'s travel roster was not updated.`));
      }
    } catch {
      applyTravel(!next, false);
      toast.error("Could not reach the server. The travel roster was not updated.");
    } finally {
      setBusy(false);
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
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
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{sport.label}</h2>
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

              <div className="flex flex-col gap-2">
                <div>
                  <span className="text-sm font-medium">Who can it pick from?</span>
                  <p className="text-xs text-muted-foreground">
                    Auto assign only ever proposes people on this roster. Area and availability decide which slot
                    each person can take.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Roster</span>
                  <span className="text-xs text-muted-foreground">
                    {sport.staff.length} staff · {sport.students.length} student{sport.students.length === 1 ? "" : "s"}
                    {travelers.length > 0 ? ` · ${travelers.length} travel` : ""}
                  </span>
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="ml-auto h-10" disabled={busy}>
                        <UserPlus data-icon="inline-start" className="size-3.5" />
                        Add person
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-0">
                      <Command>
                        <CommandInput placeholder="Find a person…" />
                        <CommandList>
                          <CommandEmpty>Nobody left to add.</CommandEmpty>
                          <CommandGroup>
                            {availablePeople.map((person) => (
                              <CommandItem
                                key={person.id}
                                value={person.name}
                                onSelect={() => void addPerson(person)}
                              >
                                <span className="flex-1 truncate">{person.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {person.workerType === "FT" ? "Staff" : "Student"}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {sport.policy === "HOLD" ? (
                  <p className="rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                    This sport is on hold, so the roster is not used by auto assign right now. It still drives who is
                    suggested when someone is assigned by hand.
                  </p>
                ) : null}

                {rosterSize > 0 ? (
                <div className="rounded-md border border-[var(--yellow-text)]/25 bg-[var(--yellow-bg)]/30 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                      <Plane className="size-3.5 text-[var(--yellow-text)]" />
                      Travel roster
                    </span>
                    {travelers.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Nobody travels by default. Mark anyone below who does.
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {travelers.map((member) => member.name).join(", ")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Who goes on the road for this sport. Auto assign crews away games from this list; if nobody is
                    marked, away games fall back to the full roster.
                  </p>
                </div>
                ) : null}

                <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Staff</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {sport.staff.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Nobody yet.</span>
                      ) : (
                        sport.staff.map((member) => (
                          <MemberChip
                            key={member.assignmentId}
                            member={member}
                            busy={busy}
                            onRemove={() => void removeMember(member)}
                            onToggleTravel={() => void toggleTravel(member)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Students
                      {sport.policy === "STAFF_ONLY" ? " · request their own slots" : ""}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {sport.students.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Nobody yet.</span>
                      ) : (
                        sport.students.map((member) => (
                          <MemberChip
                            key={member.assignmentId}
                            member={member}
                            busy={busy}
                            onRemove={() => void removeMember(member)}
                            onToggleTravel={() => void toggleTravel(member)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter className="border-t pt-4">
          <div className="mr-auto text-xs text-muted-foreground">
            {touchedCodes.size > 0
              ? `${touchedCodes.size} sport${touchedCodes.size === 1 ? "" : "s"} updated · already saved`
              : "Nothing changed yet · Skip leaves a sport exactly as it is"}
          </div>
          <Button
            variant="outline"
            className="h-10"
            disabled={index === 0 || busy}
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft className="size-4" />
            Back
          </Button>
          {isLast ? (
            <Button className="h-10" onClick={finish} disabled={busy}>Done</Button>
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
                className="h-10"
                disabled={busy}
                onClick={() => setIndex((current) => Math.min(total - 1, current + 1))}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
