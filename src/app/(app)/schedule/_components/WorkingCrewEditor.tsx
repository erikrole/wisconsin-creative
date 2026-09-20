"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRightIcon, MoreHorizontalIcon, PlusIcon, UserMinusIcon, UsersRoundIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/UserAvatar";
import { CrewPendingReview } from "@/components/shift-detail/CrewPendingReview";
import { UserAvatarPicker, type PickerUser } from "@/components/shift-detail/UserAvatarPicker";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatTimeShort } from "@/lib/format";
import { formatScheduleReleaseCountdown } from "@/lib/schedule-release";
import { QUARTER_HOUR_MINUTES, roundUpToQuarterHour } from "@/lib/quarter-hour";
import { useCurrentUser } from "@/hooks/use-current-user";
import { claimsForWorkingSlot, tradeForWorkingSlot, type PendingCrewClaim, type PendingCrewTrade } from "@/lib/crew-pending-review";
import type { WorkingScheduleCommand, WorkingSchedulePayload } from "@/lib/schedule-working-copy";
import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";
import { cn } from "@/lib/utils";
import {
  AddSlotMenu,
  AssignSlotButton,
  CREW_CALL_TRIGGER_CLASS,
  CREW_ROW_GROUP,
  CrewAreaHeading,
  CrewAssignFaceOverlay,
  CrewFaceClearButton,
  CrewFaceFrame,
  CrewTypeLabel,
} from "@/components/shift-detail/crew-row";
import { AREA_LABELS } from "@/types/areas";

function formatNotificationCountdown(iso: string, now = Date.now()) {
  return formatScheduleReleaseCountdown(iso, now, "Assignees");
}

type EditorData = {
  shiftGroupId: string;
  publicationState: "draft" | "published" | "unpublished_changes";
  publishedAt: string | null;
  publishedVersion: number;
  basePublishedVersion: number;
  workingVersion: number;
  hasWorkingCopy: boolean;
  allDay: boolean;
  eventStartsAt: string;
  eventEndsAt: string;
  defaultWindow: { startsAt: string; endsAt: string };
  changes: {
    addedSlots: number;
    removedSlots: number;
    convertedSlots: number;
    assignmentChanges: number;
    callWindowChanges: number;
    total: number;
  };
  affectedWorkerCount: number;
  assignedUsers: PickerUser[];
  pendingClaims?: PendingCrewClaim[];
  pendingTrades?: PendingCrewTrade[];
  autoReleaseAt: string | null;
  autoReleaseError: string | null;
  schedule: WorkingSchedulePayload;
};

type WorkingCrewAssignedUser = Pick<PickerUser, "id" | "name" | "role"> & {
  staffingType?: string | null;
  primaryArea?: string | null;
  avatarUrl?: string | null;
};

export type WorkingCrewEntry = {
  shiftGroupId: string | null;
  allDay: boolean;
  shifts: Array<{
    assignments: Array<{ user: WorkingCrewAssignedUser }>;
  }>;
};

type Props = {
  entry: WorkingCrewEntry;
  onPublished: () => void;
  compact?: boolean;
  showReleaseCountdown?: boolean;
  eventDetailHref?: string;
  showStudentCallButton?: boolean;
  studentCallOpen?: boolean;
  onStudentCallOpenChange?: (open: boolean) => void;
};

const AREA_ORDER = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"] as const;
// Call | Type | Person | row actions
const SLOT_ROW_GRID_CLASS = "grid-cols-[4.5rem_4.5rem_minmax(0,1fr)]";
type LoadError = false | "network" | "server";

function candidateWorkerType(candidate: PickerUser): "FT" | "ST" {
  if (candidate.role === "COLLABORATOR") return "FT";
  return candidate.staffingType === "ST" ? "ST" : "FT";
}

function isEligibleScheduleCandidate(candidate: PickerUser) {
  if (candidate.role !== "COLLABORATOR") return true;
  return candidate.collaboratorPolicy?.status === "ACTIVE"
    && candidate.collaboratorPolicy.capabilities?.includes("PUBLISHED_SCHEDULE_VIEW") === true;
}

function toLocalDateTimeValue(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function CallWindowEditor({
  slot,
  disabled,
  onSave,
  onReview,
}: {
  slot: WorkingSchedulePayload["slots"][number];
  disabled: boolean;
  onSave: (callStartsAt: string | null, callEndsAt: string | null) => Promise<boolean>;
  onReview: () => Promise<void>;
}) {
  const defaultStartsAt = slot.assignment?.callStartsAt ?? slot.callStartsAt ?? slot.startsAt;
  const defaultEndsAt = slot.assignment?.callEndsAt ?? slot.callEndsAt ?? slot.endsAt;
  const resetLabel = slot.assignment ? "Use slot time" : "Use shift time";
  const [open, setOpen] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [startsAt, setStartsAt] = useState(() => toLocalDateTimeValue(defaultStartsAt));
  const [endsAt, setEndsAt] = useState(() => toLocalDateTimeValue(defaultEndsAt));
  const inputId = slot.key.replace(/[^a-zA-Z0-9_-]/g, "-");

  useEffect(() => {
    if (open) return;
    setSaveError(false);
    setStartsAt(toLocalDateTimeValue(defaultStartsAt));
    setEndsAt(toLocalDateTimeValue(defaultEndsAt));
  }, [defaultEndsAt, defaultStartsAt, open]);

  async function save() {
    if (disabled) return;
    setSaveError(false);
    const nextStartsAt = roundUpToQuarterHour(new Date(startsAt));
    const nextEndsAt = roundUpToQuarterHour(new Date(endsAt));
    if (!startsAt || !endsAt || Number.isNaN(nextStartsAt.getTime()) || Number.isNaN(nextEndsAt.getTime())) {
      toast.error("Enter both a call time and release time.");
      return;
    }
    if (nextEndsAt <= nextStartsAt) {
      toast.error("Release time must be after call time.");
      return;
    }
    const saved = await onSave(nextStartsAt.toISOString(), nextEndsAt.toISOString());
    if (saved) setOpen(false);
    else setSaveError(true);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn("h-10 justify-start px-2 text-xs tabular-nums", CREW_CALL_TRIGGER_CLASS)}
          disabled={disabled}
          aria-label={`Edit call time for ${AREA_LABELS[slot.area] ?? slot.area} ${slot.workerType === "FT" ? "Staff" : "Student"} slot`}
        >
          {formatTimeShort(defaultStartsAt)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3" align="start">
        <div>
          <p className="text-sm font-medium">Call window</p>
          <p className="text-xs text-muted-foreground">Future changes release after ten minutes without another edit. Past corrections apply immediately.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs" htmlFor={`${inputId}-call-start`}>
            <span className="text-muted-foreground">Call</span>
            <Input
              id={`${inputId}-call-start`}
              type="datetime-local"
              step={QUARTER_HOUR_MINUTES * 60}
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs" htmlFor={`${inputId}-call-end`}>
            <span className="text-muted-foreground">Release</span>
            <Input
              id={`${inputId}-call-end`}
              type="datetime-local"
              step={QUARTER_HOUR_MINUTES * 60}
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </label>
        </div>
        {saveError && <div className="space-y-2"><p role="alert" className="text-xs text-destructive">Save was not confirmed. Your entered times are still here. Review the latest crew before trying again.</p><Button type="button" variant="outline" className="h-10" onClick={() => void onReview()}>Review latest crew</Button></div>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-10 text-xs"
            disabled={disabled}
            onClick={async () => {
              if (await onSave(null, null)) setOpen(false);
              else setSaveError(true);
            }}
          >
            {resetLabel}
          </Button>
          <Button type="button" className="h-10 text-xs" disabled={disabled} onClick={() => void save()}>Save call time</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SetAllCallTimesEditor({
  data,
  disabled,
  onSave,
  onReview,
  open,
  onOpenChange,
  showTrigger = true,
}: {
  data: Pick<EditorData, "defaultWindow" | "schedule">;
  disabled: boolean;
  onSave: (callStartsAt: string, callEndsAt: string) => Promise<boolean>;
  onReview: () => Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const dialogOpen = open ?? uncontrolledOpen;
  const setDialogOpen = onOpenChange ?? setUncontrolledOpen;
  const [saveError, setSaveError] = useState(false);
  const [startsAt, setStartsAt] = useState(() => toLocalDateTimeValue(data.defaultWindow.startsAt));
  const [endsAt, setEndsAt] = useState(() => toLocalDateTimeValue(data.defaultWindow.endsAt));

  useEffect(() => {
    if (dialogOpen) return;
    setSaveError(false);
    setStartsAt(toLocalDateTimeValue(data.defaultWindow.startsAt));
    setEndsAt(toLocalDateTimeValue(data.defaultWindow.endsAt));
  }, [data.defaultWindow.endsAt, data.defaultWindow.startsAt, dialogOpen]);

  async function save() {
    if (disabled) return;
    setSaveError(false);
    const nextStartsAt = roundUpToQuarterHour(new Date(startsAt));
    const nextEndsAt = roundUpToQuarterHour(new Date(endsAt));
    if (!startsAt || !endsAt || Number.isNaN(nextStartsAt.getTime()) || Number.isNaN(nextEndsAt.getTime())) {
      toast.error("Enter both a call time and release time.");
      return;
    }
    if (nextEndsAt <= nextStartsAt) {
      toast.error("Release time must be after call time.");
      return;
    }
    const saved = await onSave(nextStartsAt.toISOString(), nextEndsAt.toISOString());
    if (saved) setDialogOpen(false);
    else setSaveError(true);
  }

  return (
    <>
      {showTrigger ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 gap-1.5 px-2 text-xs"
          disabled={disabled || data.schedule.slots.length === 0}
          onClick={() => setDialogOpen(true)}
        >
          <UsersRoundIcon className="size-3.5" />
          Set Student call time
        </Button>
      ) : null}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader className="flex-col items-start gap-1">
            <DialogTitle>Set Student call time</DialogTitle>
            <DialogDescription>
              Every Student slot will use this window and Student personal overrides will be cleared.
              Staff and collaborators do not have a call time. The ten-minute release timer restarts when you apply it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 px-6 py-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs" htmlFor="all-call-time-start">
              <span className="text-muted-foreground">Call time</span>
              <Input
                id="all-call-time-start"
                type="datetime-local"
                step={QUARTER_HOUR_MINUTES * 60}
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs" htmlFor="all-call-time-end">
              <span className="text-muted-foreground">Coverage end</span>
              <Input
                id="all-call-time-end"
                type="datetime-local"
                step={QUARTER_HOUR_MINUTES * 60}
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </label>
          </div>
          {saveError && <div className="space-y-2 px-6"><p role="alert" className="text-xs text-destructive">Save was not confirmed. Your entered times are still here. Review the latest crew before trying again.</p><Button type="button" variant="outline" className="h-10" onClick={() => void onReview()}>Review latest crew</Button></div>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="button" disabled={disabled} onClick={() => void save()}>Apply to Students</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkingCrewEditor({
  entry,
  onPublished,
  compact = false,
  showReleaseCountdown = true,
  eventDetailHref,
  showStudentCallButton = true,
  studentCallOpen,
  onStudentCallOpenChange,
}: Props) {
  const shiftGroupId = entry.shiftGroupId;
  const { data: currentUser } = useCurrentUser();
  const canManageSchedule = currentUser?.role === "ADMIN" || currentUser?.role === "STAFF";
  const canReviewClaims = currentUser?.role === "ADMIN";
  const [data, setData] = useState<EditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editorLoadError, setEditorLoadError] = useState<LoadError>(false);
  const [clock, setClock] = useState(() => Date.now());
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [candidateScoreState, setCandidateScoreState] = useState<{
    slotKey: string;
    scores: Record<string, CandidateRecommendation>;
  } | null>(null);
  const [scoresLoadingKey, setScoresLoadingKey] = useState<string | null>(null);
  const [scoresErrorKey, setScoresErrorKey] = useState<string | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<{
    slotKey: string;
    workerType: "FT" | "ST";
    currentWorkerName: string;
  } | null>(null);
  const actingRef = useRef(false);
  const [allUsers, setAllUsers] = useState<PickerUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const usersLoadedRef = useRef(false);
  const usersAbortRef = useRef<AbortController | null>(null);
  const editorAbortRef = useRef<AbortController | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [activePickerKey, setActivePickerKey] = useState<string | null>(null);
  const [internalStudentCallOpen, setInternalStudentCallOpen] = useState(false);
  const studentCallDialogOpen = studentCallOpen ?? internalStudentCallOpen;
  const setStudentCallDialogOpen = onStudentCallOpenChange ?? setInternalStudentCallOpen;
  const [usersLoadError, setUsersLoadError] = useState<LoadError>(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [publishNowOpen, setPublishNowOpen] = useState(false);
  const [mutationUncertain, setMutationUncertain] = useState(false);
  const actionsDisabled = Boolean(actingKey) || mutationUncertain;

  const loadUsers = useCallback(async (force = false) => {
    if (usersLoadedRef.current && !force) return;
    usersLoadedRef.current = true;
    usersAbortRef.current?.abort();
    const controller = new AbortController();
    usersAbortRef.current = controller;
    setUsersLoadError(false);
    setUsersLoading(true);
    try {
      const response = await fetch("/api/users?limit=200&active=true", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (handleAuthRedirect(response)) {
        usersLoadedRef.current = false;
        return;
      }
      if (!response.ok) {
        usersLoadedRef.current = false;
        setUsersLoadError("server");
        toast.error(await parseErrorMessage(response, "Failed to load users"));
        return;
      }
      const json = await parseJsonSafely<{ data?: PickerUser[]; users?: PickerUser[] }>(response);
      const users = json?.data ?? json?.users;
      if (!Array.isArray(users)) {
        usersLoadedRef.current = false;
        setUsersLoadError("server");
        toast.error("User response was incomplete. Refresh and try again.");
        return;
      }
      setAllUsers(users);
      setUsersLoadError(false);
    } catch (error) {
      if (isAbortError(error)) return;
      usersLoadedRef.current = false;
      setUsersLoadError("network");
      toast.error(error instanceof TypeError ? "You’re offline. Check your connection." : "Failed to load users");
    } finally {
      if (!controller.signal.aborted) setUsersLoading(false);
    }
  }, []);

  const retryUsers = useCallback(() => {
    usersLoadedRef.current = false;
    void loadUsers(true);
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return allUsers;
    const query = userSearch.toLowerCase();
    return allUsers.filter((user) => user.name.toLowerCase().includes(query));
  }, [allUsers, userSearch]);

  const openPicker = useCallback(() => {
    setUserSearch("");
    void loadUsers();
  }, [loadUsers]);

  const closePicker = useCallback(() => {
    setUserSearch("");
    setActivePickerKey(null);
  }, []);

  const loadEditor = useCallback(async (): Promise<EditorData | null> => {
    if (!shiftGroupId) return null;
    editorAbortRef.current?.abort();
    const controller = new AbortController();
    editorAbortRef.current = controller;
    setEditorLoadError(false);
    setLoading(true);
    try {
      const response = await fetch(`/api/shift-groups/${shiftGroupId}/working-copy`, { signal: controller.signal });
      if (controller.signal.aborted) return null;
      if (handleAuthRedirect(response)) return null;
      if (!response.ok) {
        setEditorLoadError("server");
        toast.error(await parseErrorMessage(response, "Failed to load working schedule"));
        return null;
      }
      const json = await parseJsonSafely<{ data?: EditorData }>(response);
      if (controller.signal.aborted) return null;
      if (json?.data) {
        setData(json.data);
        setEditorLoadError(false);
        return json.data;
      }
      setEditorLoadError("server");
      toast.error("Working schedule response was incomplete. Refresh and try again.");
      return null;
    } catch (error) {
      if (isAbortError(error)) return null;
      setEditorLoadError("network");
      toast.error("Network error - could not load working schedule");
      return null;
    } finally {
      if (editorAbortRef.current === controller) setLoading(false);
    }
  }, [shiftGroupId]);

  useEffect(() => {
    void loadEditor();
  }, [loadEditor]);

  useEffect(() => {
    return () => {
      editorAbortRef.current?.abort();
      usersAbortRef.current?.abort();
    };
  }, []);

  const loadCandidateScores = useCallback(async (slotKey: string, workerType?: "FT" | "ST") => {
    if (!shiftGroupId) return;
    setScoresLoadingKey(slotKey);
    setScoresErrorKey(null);
    const query = new URLSearchParams({ slotKey });
    if (workerType) query.set("workerType", workerType);
    try {
      const response = await fetch(
        `/api/shift-groups/${shiftGroupId}/working-copy/candidate-scores?${query.toString()}`,
      );
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        setScoresErrorKey(slotKey);
        return;
      }
      const json = await parseJsonSafely<{ data?: CandidateRecommendation[] }>(response);
      if (!json?.data) {
        setScoresErrorKey(slotKey);
        return;
      }
      setCandidateScoreState({
        slotKey,
        scores: Object.fromEntries(json.data.map((score) => [score.userId, score])),
      });
    } catch {
      setScoresErrorKey(slotKey);
    } finally {
      setScoresLoadingKey((current) => current === slotKey ? null : current);
    }
  }, [shiftGroupId]);

  const userById = useMemo(() => {
    const users = new Map<string, PickerUser>();
    for (const user of data?.assignedUsers ?? []) users.set(user.id, user);
    for (const user of allUsers) users.set(user.id, user);
    for (const shift of entry.shifts) {
      for (const assignment of shift.assignments) {
        users.set(assignment.user.id, {
          ...assignment.user,
          primaryArea: assignment.user.primaryArea ?? null,
          avatarUrl: assignment.user.avatarUrl ?? null,
        });
      }
    }
    return users;
  }, [allUsers, data?.assignedUsers, entry.shifts]);

  const assignedUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slot of data?.schedule.slots ?? []) {
      if (slot.assignment?.userId) ids.add(slot.assignment.userId);
    }
    return ids;
  }, [data?.schedule.slots]);

  const availableUsersForSlot = useCallback((workerType: "FT" | "ST") => {
    return filteredUsers.filter((candidate) => {
      return isEligibleScheduleCandidate(candidate)
        && candidateWorkerType(candidate) === workerType
        && !assignedUserIds.has(candidate.id);
    });
  }, [assignedUserIds, filteredUsers]);

  const mutate = useCallback(async (command: WorkingScheduleCommand, key: string) => {
    if (!shiftGroupId || !data || actingRef.current || mutationUncertain) return false;
    actingRef.current = true;
    setActingKey(key);
    editorAbortRef.current?.abort();
    try {
      const response = await fetch(`/api/shift-groups/${shiftGroupId}/working-copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: data.workingVersion, command }),
      });
      if (handleAuthRedirect(response)) return false;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to update working schedule"));
        if (response.status >= 500) setMutationUncertain(true);
        if (response.status === 409 || response.status >= 500) await loadEditor();
        return false;
      }
      const json = await parseJsonSafely<{ data?: EditorData }>(response);
      if (!json?.data) {
        setMutationUncertain(true);
        await loadEditor();
        toast.error("The save response was incomplete. Review the latest crew before another change.");
        return false;
      }
      setData(json.data);
      void Promise.resolve().then(onPublished).catch(() => toast.error("Crew saved; refresh the schedule to confirm its display."));
      setUserSearch("");
      return true;
    } catch {
      setMutationUncertain(true);
      await loadEditor();
      toast.error("The save response was lost. Review the latest crew before another change.");
      return false;
    } finally {
      actingRef.current = false;
      setActingKey(null);
    }
  }, [data, loadEditor, mutationUncertain, onPublished, shiftGroupId]);

  const reviewLatestCrew = useCallback(async () => {
    if (actingRef.current) return;
    if (await loadEditor()) setMutationUncertain(false);
  }, [loadEditor]);

  const reviewPending = useCallback(async (
    kind: "claim" | "trade",
    id: string,
    decision: "approve" | "decline",
    claimantName: string,
  ) => {
    if (!canReviewClaims || actingRef.current || mutationUncertain) return;
    actingRef.current = true;
    const acting = `${decision}:${id}`;
    setActingKey(acting);
    const path = kind === "claim"
      ? `/api/shift-assignments/${id}/${decision}`
      : `/api/shift-trades/${id}/${decision}`;
    try {
      const response = await fetch(path, { method: "PATCH" });
      if (handleAuthRedirect(response)) return;
      if (response.status >= 500) throw new Error("Mutation outcome unavailable");
      if (response.ok) {
        toast.success(decision === "approve"
          ? kind === "claim"
            ? `${claimantName} is on the schedule`
            : "Trade approved"
          : kind === "claim"
            ? `Request declined for ${claimantName}`
            : "Claim declined");
        await loadEditor();
        void Promise.resolve().then(onPublished).catch(() => {
          toast.error("Review saved; refresh the schedule to confirm its display.");
        });
        return;
      }
      toast.error(await parseErrorMessage(
        response,
        decision === "approve" ? "Could not approve this request" : "Could not decline this request",
      ));
      if (response.status === 409) await loadEditor();
    } catch {
      await loadEditor();
      toast.error("The review response was lost. Review the latest crew before trying again.");
    } finally {
      actingRef.current = false;
      setActingKey(null);
    }
  }, [canReviewClaims, loadEditor, mutationUncertain, onPublished]);

  const discard = useCallback(async () => {
    if (!shiftGroupId || !data?.hasWorkingCopy || actingRef.current || mutationUncertain) return;
    actingRef.current = true;
    setActingKey("discard");
    try {
      const response = await fetch(
        `/api/shift-groups/${shiftGroupId}/working-copy?expectedVersion=${data.workingVersion}`,
        { method: "DELETE" },
      );
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to discard changes"));
        if (response.status === 409) void loadEditor();
        return;
      }
      const json = await parseJsonSafely<{ data?: EditorData }>(response);
      if (json?.data) setData(json.data);
      onPublished();
      toast.success("Changes reverted");
    } catch {
      toast.error("Network error - could not discard changes");
    } finally {
      actingRef.current = false;
      setActingKey(null);
    }
  }, [data, loadEditor, mutationUncertain, onPublished, shiftGroupId]);

  const refreshFromLive = useCallback(async (sourceData: EditorData | null = data, silent = false) => {
    if (!shiftGroupId || !sourceData?.hasWorkingCopy || actingRef.current || mutationUncertain) return;
    actingRef.current = true;
    setActingKey("refresh");
    try {
      const response = await fetch(`/api/shift-groups/${shiftGroupId}/working-copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: sourceData.workingVersion }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to refresh from the live schedule"));
        if (response.status === 409) void loadEditor();
        return;
      }
      const json = await parseJsonSafely<{ data?: EditorData }>(response);
      if (json?.data) setData(json.data);
      if (!silent) toast.success("Schedule refreshed from live");
    } catch {
      toast.error("Network error - could not refresh from the live schedule");
    } finally {
      actingRef.current = false;
      setActingKey(null);
    }
  }, [data, loadEditor, mutationUncertain, shiftGroupId]);

  const publishNow = useCallback(async () => {
    if (!shiftGroupId || !data?.hasWorkingCopy || actingRef.current || mutationUncertain) return;
    actingRef.current = true;
    setActingKey("publish-now");
    try {
      const response = await fetch(`/api/shift-groups/${shiftGroupId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: data.workingVersion }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to publish schedule now"));
        if (response.status === 409 || response.status >= 500) await loadEditor();
        if (response.status >= 500) setMutationUncertain(true);
        return;
      }
      const json = await parseJsonSafely<{ data?: EditorData }>(response);
      if (!json?.data) {
        setMutationUncertain(true);
        await loadEditor();
        toast.error("The publish response was incomplete. Review the latest schedule before continuing.");
        return;
      }
      setData(json.data);
      setMutationUncertain(false);
      void Promise.resolve().then(onPublished).catch(() => toast.error("Schedule published; refresh the schedule to confirm its display."));
      toast.success(new Date(data.eventEndsAt).getTime() <= Date.now()
        ? "Correction applied"
        : "Schedule published now");
    } catch {
      setMutationUncertain(true);
      await loadEditor();
      toast.error("The publish response was lost. Review the latest schedule before trying again.");
    } finally {
      actingRef.current = false;
      setActingKey(null);
    }
  }, [data, loadEditor, mutationUncertain, onPublished, shiftGroupId]);

  useEffect(() => {
    if (!data?.hasWorkingCopy || !data.autoReleaseAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [data?.autoReleaseAt, data?.hasWorkingCopy]);

  useEffect(() => {
    if (!data?.hasWorkingCopy || data.basePublishedVersion >= data.publishedVersion) return;
    void refreshFromLive(data, true).then(() => onPublished());
  }, [data, onPublished, refreshFromLive]);

  useEffect(() => {
    if (!data?.hasWorkingCopy) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (actingRef.current || polling) return;
      polling = true;
      void (async () => {
        try {
          const latest = await loadEditor();
          if (latest?.hasWorkingCopy && latest.basePublishedVersion < latest.publishedVersion) {
            await refreshFromLive(latest, true);
          }
          onPublished();
        } catch {
          // A failed background refresh is retried on the next tick; the editor keeps its last good state.
        } finally {
          polling = false;
        }
      })();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [data?.hasWorkingCopy, loadEditor, onPublished, refreshFromLive]);

  if (!shiftGroupId) {
    return <p className="text-xs text-muted-foreground">Create staffing for this event before editing crew.</p>;
  }
  if (loading && !data) {
    return <div className="h-24 animate-pulse rounded-md bg-muted/30" />;
  }
  if (!data) {
    return (
      <Alert variant="destructive" className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <AlertDescription className="min-w-0 flex-1 text-xs">
          {editorLoadError === "network"
            ? "Could not reach the server. Retry before managing this crew."
            : "Could not load the crew editor. Retry before managing this crew."}
        </AlertDescription>
        <Button variant="outline" size="sm" className="h-10 shrink-0" onClick={() => void loadEditor()}>
          Retry crew editor
        </Button>
      </Alert>
    );
  }

  const areasWithSlots = AREA_ORDER
    .map((area) => ({ area, slots: data.schedule.slots.filter((slot) => slot.area === area) }))
    .filter(({ slots }) => slots.length > 0);
  const emptyAreas = AREA_ORDER.filter((area) => !areasWithSlots.some((entry) => entry.area === area));
  const replacementSlot = replacementTarget
    ? data.schedule.slots.find((slot) => slot.key === replacementTarget.slotKey) ?? null
    : null;
  const replacementUsers = replacementTarget
    ? availableUsersForSlot(replacementTarget.workerType)
    : [];
  const eventHasEnded = new Date(data.eventEndsAt).getTime() <= Date.now();

  return (
    <div className="flex flex-col gap-2">
      {mutationUncertain && (
        <Alert role="alert">
          <AlertDescription>The last save could not be confirmed. Check the latest crew before making another change.</AlertDescription>
          <Button variant="outline" className="mt-2 h-10" disabled={loading} onClick={() => void reviewLatestCrew()}>Review latest crew</Button>
        </Alert>
      )}
      {(data.hasWorkingCopy
        || (showReleaseCountdown && data.autoReleaseError)
        || compact
        || (showStudentCallButton && !data.allDay && data.schedule.slots.some((slot) => slot.workerType === "ST"))) && (
        <div className="flex min-h-10 flex-wrap items-center gap-2 pb-1">
          {showReleaseCountdown && !eventHasEnded && data.hasWorkingCopy && data.autoReleaseAt && !data.autoReleaseError && (
            <span className="text-xs text-muted-foreground">{formatNotificationCountdown(data.autoReleaseAt, clock)}</span>
          )}
          {showReleaseCountdown && !eventHasEnded && data.hasWorkingCopy && !data.autoReleaseAt && !data.autoReleaseError && (
            <span className="text-xs text-muted-foreground">{formatScheduleReleaseCountdown(null, clock)}</span>
          )}
          {showReleaseCountdown && data.autoReleaseError && (
            <span className="text-xs text-destructive">Release needs attention: {data.autoReleaseError}</span>
          )}
          <div className="ml-0 flex w-full flex-wrap items-center gap-1.5 sm:ml-auto sm:w-auto">
            {canManageSchedule && showStudentCallButton && !data.allDay && data.schedule.slots.some((slot) => slot.workerType === "ST") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 gap-1.5 px-2 text-xs"
                disabled={actionsDisabled || data.schedule.slots.length === 0}
                onClick={() => setStudentCallDialogOpen(true)}
              >
                <UsersRoundIcon className="size-3.5" />
                Set Student call time
              </Button>
            )}
            {canManageSchedule && data.hasWorkingCopy && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 px-2 text-xs"
                disabled={actionsDisabled}
                onClick={() => setPublishNowOpen(true)}
              >
                {eventHasEnded ? "Apply correction now" : "Publish now"}
              </Button>
            )}
            {data.hasWorkingCopy && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 px-2 text-xs text-muted-foreground"
                loading={actingKey === "discard"}
                disabled={actionsDisabled}
                onClick={() => setRevertOpen(true)}
              >
                Revert changes
              </Button>
            )}
            {compact && eventDetailHref && (
              <Button asChild type="button" variant="ghost" size="sm" className="h-10 px-2 text-xs text-muted-foreground">
                <Link href={eventDetailHref}>Open Event detail</Link>
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="divide-y divide-border/40 border-y border-border/40">
        {areasWithSlots.map(({ area, slots }) => {
          return (
            <section key={area} className={cn(compact ? "py-2" : "py-2.5")}>
              <CrewAreaHeading
                className="min-h-10 px-1"
                area={area}
                filled={slots.filter((slot) => slot.assignment).length}
                total={slots.length}
                action={canManageSchedule ? (
                  <AddSlotMenu
                    area={area}
                    disabled={actionsDisabled}
                    onAdd={(workerType) => void mutate(
                      { type: "adjustSlots", area, workerType, delta: 1 },
                      `${area}-${workerType}-add`,
                    )}
                  />
                ) : undefined}
              />
              <div className="space-y-0.5">
                {slots.map((slot) => {
                  const user = slot.assignment ? userById.get(slot.assignment.userId) : null;
                  const roleLabel = slot.workerType === "FT" ? "Staff" : "Student";
                  const otherWorkerType = slot.workerType === "FT" ? "ST" : "FT";
                  const showCallWindow = !data.allDay && slot.workerType === "ST";
                  const canConvert = !slot.assignment && slot.assignmentHistoryCount === 0;
                  const eligibleUsers = availableUsersForSlot(slot.workerType);
                  const pendingClaims = claimsForWorkingSlot(slot, data.pendingClaims ?? []);
                  const pendingTrade = tradeForWorkingSlot(slot, data.pendingTrades ?? []);
                  const reviewBlockedReason = data.hasWorkingCopy
                    ? "Release or discard crew edits before reviewing claims."
                    : null;
                  return slot.assignment ? (
                    <div key={slot.key} className={cn(`${CREW_ROW_GROUP} grid min-h-11 min-w-0 items-center gap-2 rounded-md px-1 hover:bg-muted/20`, SLOT_ROW_GRID_CLASS)}>
                      {showCallWindow ? (
                        <CallWindowEditor
                          slot={slot}
                          onReview={reviewLatestCrew}
                          disabled={actionsDisabled}
                          onSave={(callStartsAt, callEndsAt) => mutate(
                            { type: "setCallWindow", slotKey: slot.key, callStartsAt, callEndsAt },
                            `${slot.key}-call-window`,
                          )}
                        />
                      ) : <span aria-hidden="true" />}
                      <CrewTypeLabel label={roleLabel} />
                      <div className="flex min-w-0 items-center gap-2 overflow-visible">
                        <CrewFaceFrame>
                          <UserAvatar name={user?.name ?? "Assigned"} avatarUrl={user?.avatarUrl} size="sm" />
                          <CrewFaceClearButton
                            label={`Unassign ${user?.name ?? "worker"}`}
                            disabled={actionsDisabled}
                            onClick={() => void mutate({ type: "unassign", slotKey: slot.key }, `${slot.key}-unassign`)}
                          />
                        </CrewFaceFrame>
                        <span className="min-w-0 truncate text-sm">{user?.name ?? "Assigned worker"}</span>
                        {pendingTrade && (
                          <CrewPendingReview
                            trade={pendingTrade}
                            canReview={canReviewClaims}
                            reviewBlockedReason={reviewBlockedReason}
                            disabled={actionsDisabled}
                            actingId={actingKey}
                            onApprove={(id) => void reviewPending(
                              "trade",
                              id,
                              "approve",
                              pendingTrade.claimedBy?.name ?? "Someone",
                            )}
                            onDecline={(id) => void reviewPending(
                              "trade",
                              id,
                              "decline",
                              pendingTrade.claimedBy?.name ?? "Someone",
                            )}
                          />
                        )}
                        <div className="ml-auto flex items-center justify-end gap-0.5">
                        <Popover
                          open={activePickerKey === `${slot.key}-replace`}
                          onOpenChange={(open) => {
                            if (open) {
                              setActivePickerKey(`${slot.key}-replace`);
                              openPicker();
                              void loadCandidateScores(slot.key, slot.workerType);
                            } else {
                              closePicker();
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-10 px-2 text-xs text-muted-foreground hover:text-foreground"
                              disabled={actionsDisabled}
                              aria-label={`Replace ${user?.name ?? "assigned worker"}`}
                            >
                              <ArrowLeftRightIcon className="size-3.5" />
                              Replace
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-2 sm:w-96" align="end">
                            <UserAvatarPicker
                              users={eligibleUsers}
                              loading={usersLoading}
                              loadError={usersLoadError}
                              onRetry={retryUsers}
                              search={userSearch}
                              onSearchChange={setUserSearch}
                              onSelect={(userId) => {
                                void mutate(
                                  { type: "convertAndReplace", slotKey: slot.key, workerType: slot.workerType, userId },
                                  `${slot.key}-replace`,
                                ).then((succeeded) => {
                                  if (succeeded) closePicker();
                                });
                              }}
                              disabled={actionsDisabled}
                              slotWorkerType={slot.workerType}
                              candidateScores={candidateScoreState?.slotKey === slot.key ? candidateScoreState.scores : undefined}
                              scoresLoading={scoresLoadingKey === slot.key}
                              scoresLoadError={scoresErrorKey === slot.key}
                            />
                          </PopoverContent>
                        </Popover>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              className="size-10 text-muted-foreground"
                              aria-label={`More actions for ${user?.name ?? "assigned worker"}`}
                              disabled={actionsDisabled}
                            >
                              <MoreHorizontalIcon className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onSelect={() => {
                                const target = {
                                  slotKey: slot.key,
                                  workerType: otherWorkerType as "FT" | "ST",
                                  currentWorkerName: user?.name ?? "assigned worker",
                                };
                                setReplacementTarget(target);
                                openPicker();
                                void loadCandidateScores(slot.key, target.workerType);
                              }}
                            >
                              <ArrowLeftRightIcon />
                              Convert to {otherWorkerType === "FT" ? "Staff" : "Student"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => void mutate({ type: "unassign", slotKey: slot.key }, `${slot.key}-unassign`)}
                            >
                              <UserMinusIcon />
                              Unassign
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      </div>
                    </div>
                  ) : (
                    <div key={slot.key} className={cn(`${CREW_ROW_GROUP} grid min-h-11 min-w-0 items-center gap-2 rounded-md px-1 hover:bg-muted/20`, SLOT_ROW_GRID_CLASS)}>
                      {showCallWindow ? (
                        <CallWindowEditor
                          slot={slot}
                          onReview={reviewLatestCrew}
                          disabled={actionsDisabled}
                          onSave={(callStartsAt, callEndsAt) => mutate(
                            { type: "setCallWindow", slotKey: slot.key, callStartsAt, callEndsAt },
                            `${slot.key}-call-window`,
                          )}
                        />
                      ) : <span aria-hidden="true" />}
                      <CrewTypeLabel label={roleLabel} />
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="relative w-fit overflow-visible">
                          <Popover
                            open={activePickerKey === `${slot.key}-assign`}
                            onOpenChange={(open) => {
                              if (open) {
                                setActivePickerKey(`${slot.key}-assign`);
                                openPicker();
                                void loadCandidateScores(slot.key);
                              } else {
                                closePicker();
                              }
                            }}
                          >
                            <PopoverTrigger asChild>
                              <AssignSlotButton
                                disabled={actionsDisabled}
                                aria-label={`Assign ${roleLabel.toLowerCase()} slot`}
                              />
                            </PopoverTrigger>
                            <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-2 sm:w-96" align="start">
                              <UserAvatarPicker
                                users={eligibleUsers}
                                loading={usersLoading}
                                loadError={usersLoadError}
                                onRetry={retryUsers}
                                search={userSearch}
                                onSearchChange={setUserSearch}
                                onSelect={(userId) => {
                                  void mutate({ type: "assign", slotKey: slot.key, userId }, `${slot.key}-assign`)
                                    .then((succeeded) => {
                                      if (succeeded) closePicker();
                                    });
                                }}
                                disabled={actionsDisabled}
                                slotWorkerType={slot.workerType}
                                candidateScores={candidateScoreState?.slotKey === slot.key ? candidateScoreState.scores : undefined}
                                scoresLoading={scoresLoadingKey === slot.key}
                                scoresLoadError={scoresErrorKey === slot.key}
                              />
                            </PopoverContent>
                          </Popover>
                          {canConvert ? (
                            <CrewAssignFaceOverlay>
                              <CrewFaceClearButton
                                label={`Remove ${roleLabel} slot`}
                                disabled={actionsDisabled}
                                onClick={() => void mutate({ type: "removeSlot", slotKey: slot.key }, `${slot.key}-remove`)}
                              />
                            </CrewAssignFaceOverlay>
                          ) : null}
                        </div>
                        {pendingClaims.length > 0 && (
                          <CrewPendingReview
                            claims={pendingClaims}
                            canReview={canReviewClaims}
                            reviewBlockedReason={reviewBlockedReason}
                            disabled={actionsDisabled}
                            actingId={actingKey}
                            onApprove={(id) => {
                              const claim = pendingClaims.find((row) => row.id === id);
                              void reviewPending("claim", id, "approve", claim?.user.name ?? "Student");
                            }}
                            onDecline={(id) => {
                              const claim = pendingClaims.find((row) => row.id === id);
                              void reviewPending("claim", id, "decline", claim?.user.name ?? "Student");
                            }}
                          />
                        )}
                        <div className="ml-auto flex items-center justify-end gap-0.5">
                        {canConvert ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                className="size-10 text-muted-foreground"
                                disabled={actionsDisabled}
                                aria-label={`More actions for open ${roleLabel} slot`}
                              >
                                <MoreHorizontalIcon className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                onSelect={() => void mutate(
                                  { type: "convertSlot", slotKey: slot.key, workerType: otherWorkerType },
                                  `${slot.key}-convert`,
                                )}
                              >
                                <ArrowLeftRightIcon />
                                Convert to {otherWorkerType === "FT" ? "Staff" : "Student"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => void mutate({ type: "removeSlot", slotKey: slot.key }, `${slot.key}-remove`)}
                              >
                                <XIcon />
                                Remove slot
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {canManageSchedule && emptyAreas.length > 0 && (
          <div className={cn("flex items-center", compact ? "py-1" : "py-1.5")}>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-10 gap-1.5 px-2 text-xs text-muted-foreground">
                  <PlusIcon className="size-3.5" />
                  Add another area
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-1 p-2" align="start">
                {emptyAreas.map((area) => (
                  <div key={area} className="flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted/40">
                    <span className="min-w-0 flex-1 text-sm">{AREA_LABELS[area] ?? area}</span>
                    {(["FT", "ST"] as const).map((workerType) => {
                      const label = workerType === "FT" ? "Staff" : "Student";
                      return (
                        <Button
                          key={workerType}
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 px-2 text-xs"
                          disabled={actionsDisabled}
                          onClick={() => void mutate(
                            { type: "adjustSlots", area, workerType, delta: 1 },
                            `${area}-${workerType}-add`,
                          )}
                        >
                          + {label}
                        </Button>
                      );
                    })}
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {canManageSchedule && !data.allDay && (
        <SetAllCallTimesEditor
          data={data}
          onReview={reviewLatestCrew}
          disabled={actionsDisabled}
          showTrigger={false}
          open={studentCallDialogOpen}
          onOpenChange={setStudentCallDialogOpen}
          onSave={(callStartsAt, callEndsAt) => mutate(
            { type: "setCallWindowForAll", callStartsAt, callEndsAt },
            "all-call-window",
          )}
        />
      )}

      <Dialog
        open={replacementTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReplacementTarget(null);
            closePicker();
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Replace and convert to {replacementTarget?.workerType === "FT" ? "Staff" : "Student"}
            </DialogTitle>
            <DialogDescription>
              {replacementTarget
                ? `${replacementTarget.currentWorkerName} will be replaced after ten minutes without another edit.`
                : "Choose a replacement worker."}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            {replacementSlot && replacementTarget ? (
              <UserAvatarPicker
                users={replacementUsers}
                loading={usersLoading}
                loadError={usersLoadError}
                onRetry={retryUsers}
                search={userSearch}
                onSearchChange={setUserSearch}
                onSelect={(userId) => {
                  void mutate(
                    {
                      type: "convertAndReplace",
                      slotKey: replacementTarget.slotKey,
                      workerType: replacementTarget.workerType,
                      userId,
                    },
                    `${replacementTarget.slotKey}-convert-replace`,
                  ).then((succeeded) => {
                    if (!succeeded) return;
                    setReplacementTarget(null);
                    closePicker();
                  });
                }}
                disabled={actionsDisabled}
                slotWorkerType={replacementTarget.workerType}
                candidateScores={candidateScoreState?.slotKey === replacementTarget.slotKey ? candidateScoreState.scores : undefined}
                scoresLoading={scoresLoadingKey === replacementTarget.slotKey}
                scoresLoadError={scoresErrorKey === replacementTarget.slotKey}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Refresh the schedule and try again.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revertOpen} onOpenChange={setRevertOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Revert pending crew changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the private crew edits for this event and restores the last released schedule. The change cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionsDisabled}>Keep changes</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionsDisabled}
              onClick={() => {
                setRevertOpen(false);
                void discard();
              }}
            >
              Revert changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={publishNowOpen} onOpenChange={setPublishNowOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{eventHasEnded ? "Apply this correction now?" : "Publish schedule now?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {eventHasEnded
                ? "This writes the pending correction to the published crew immediately. Nobody is notified."
                : "This sends the pending schedule to worker-facing views immediately and may notify affected workers. It bypasses the normal ten-minute release timer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionsDisabled}>
              {eventHasEnded ? "Keep editing" : "Keep waiting"}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={actionsDisabled}
              onClick={() => {
                setPublishNowOpen(false);
                void publishNow();
              }}
            >
              {actingKey === "publish-now"
                ? (eventHasEnded ? "Applying…" : "Publishing…")
                : (eventHasEnded ? "Apply correction now" : "Publish now")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
