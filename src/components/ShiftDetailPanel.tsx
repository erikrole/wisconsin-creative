"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatDateShort, formatTimeShort } from "@/lib/format";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import { sportLabel } from "@/lib/sports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/sheet";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { ShiftAreaSection } from "./shift-detail/ShiftAreaSection";
import type { PickerUser } from "./shift-detail/UserAvatarPicker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScheduleReleaseNotice } from "@/components/ScheduleReleaseNotice";
import { formatRoleSlotAssignmentOutcome, shiftWorkerLabel, shiftWorkerSlotLabel, type RoleSlotOutcomeLike } from "@/lib/shift-display";
import type { AutoFillPreviewResponse } from "@/lib/auto-fill-preview-types";

/* ───── Types ───── */

type ShiftUser = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  staffingType?: string | null;
  primaryArea: string | null;
  avatarUrl?: string | null;
};

type ShiftAssignment = {
  id: string;
  status: string;
  notes: string | null;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  callNote?: string | null;
  hasConflict: boolean;
  conflictNote: string | null;
  acknowledgedAt?: string | null;
  acknowledgedById?: string | null;
  createdAt: string;
  user: ShiftUser;
  assigner?: { id: string; name: string } | null;
};

type Shift = {
  id: string;
  area: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  notes: string | null;
  assignments: ShiftAssignment[];
};

type ShiftGroupDetail = {
  id: string;
  eventId: string;
  hasWorkingCopy?: boolean;
  publication?: {
    status: "draft" | "published" | "changed";
    publishedAt: string | null;
    publishedById: string | null;
    changedAfterPublish: boolean;
    activeAssignmentCount: number;
    acknowledgedCount: number;
    unacknowledgedCount: number;
  } | null;
  autoReleaseAt?: string | null;
  autoReleaseError?: string | null;
  manuallyEdited?: boolean;
  notes: string | null;
  archivedAt: string | null;
  event: {
    id: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    sportCode: string | null;
    isHome: boolean | null;
    opponent: string | null;
  };
  shifts: Shift[];
};

type UserListResponse = {
  data?: PickerUser[];
  users?: PickerUser[];
};

type Props = {
  groupId: string | null;
  onClose: () => void;
  onUpdated?: () => void;
  currentUserId?: string;
  currentUserRole?: string;
};

const AREAS = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"] as const;

function publicationLabel(publication: ShiftGroupDetail["publication"]) {
  if (!publication?.publishedAt) return { label: "Not released", variant: "gray" as const };
  if (publication.changedAfterPublish) return { label: "Pending sync", variant: "orange" as const };
  return { label: "Current", variant: "green" as const };
}

/* ───── Component ───── */

export default function ShiftDetailPanel({
  groupId,
  onClose,
  onUpdated,
  currentUserId,
  currentUserRole,
}: Props) {
  const confirm = useConfirm();
  const [group, setGroup] = useState<ShiftGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<false | "network" | "server">(false);
  const [acting, setActing] = useState<string | null>(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillApplying, setAutoFillApplying] = useState(false);
  const [autoFillPreview, setAutoFillPreview] = useState<AutoFillPreviewResponse | null>(null);
  const [autoFillPreviewOpen, setAutoFillPreviewOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [tradeDialogAssignmentId, setTradeDialogAssignmentId] = useState<string | null>(null);
  const [tradeNotes, setTradeNotes] = useState("");
  const [tradeError, setTradeError] = useState("");
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [createdShiftNotice, setCreatedShiftNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const usersAbortRef = useRef<AbortController | null>(null);
  const actingRef = useRef<string | null>(null);
  const autoFillingRef = useRef(false);
  const archivingRef = useRef(false);
  const postingRef = useRef(false);

  // User picker state
  const [pickerShiftId, setPickerShiftId] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<PickerUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const isStaff = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  // Schedule is the only staffing authoring surface. Keeping this detail panel
  // read-only prevents direct mutations from bypassing the 10-minute buffer.
  const canEditPublishedSchedule = false;
  const eventTimingLabel = group?.event.allDay
    ? formatCalendarEventDateRange(group.event, { includeYear: true })
    : group
      ? `${formatDateShort(group.event.startsAt)} · ${formatTimeShort(group.event.startsAt)} - ${formatTimeShort(group.event.endsAt)}`
      : "";

  /* ── Data fetching ── */

  const fetchGroup = useCallback(async () => {
    if (!groupId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(`/api/shift-groups/${groupId}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: ShiftGroupDetail | null }>(res);
        setGroup(json?.data ?? null);
        setLoadError(false);
      } else {
        setLoadError("server");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setLoadError("network");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (groupId) { fetchGroup(); setUsersLoaded(false); }
    else { setGroup(null); }
    return () => { abortRef.current?.abort(); usersAbortRef.current?.abort(); };
  }, [groupId, fetchGroup]);

  const loadUsers = useCallback(async () => {
    if (usersLoaded) return;
    usersAbortRef.current?.abort();
    const controller = new AbortController();
    usersAbortRef.current = controller;
    setUsersLoading(true);
    try {
      const res = await fetch("/api/users?limit=200&active=true", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<UserListResponse>(res);
        setAllUsers((json?.data ?? json?.users ?? []).map((u) => ({
          id: u.id, name: u.name, role: u.role, staffingType: u.staffingType,
          primaryArea: u.primaryArea ?? null, avatarUrl: u.avatarUrl ?? null,
        })));
        setUsersLoaded(true);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      /* picker shows empty state */
    }
    setUsersLoading(false);
  }, [usersLoaded]);

  const filteredUsers = useMemo(() => {
    if (!group || !pickerShiftId) return allUsers;
    const shift = group.shifts.find((s) => s.id === pickerShiftId);
    const assignedIds = new Set(
      (shift?.assignments ?? [])
        .filter((a) => a.status === "DIRECT_ASSIGNED" || a.status === "APPROVED")
        .map((a) => a.user.id)
    );
    let users = allUsers.filter((u) => !assignedIds.has(u.id));
    if (userSearch) {
      const q = userSearch.toLowerCase();
      users = users.filter((u) => u.name.toLowerCase().includes(q));
    }
    return users;
  }, [allUsers, group, pickerShiftId, userSearch]);

  /* ── Mutation helper ── */

  async function mutate(
    key: string,
    url: string,
    opts: RequestInit,
    successMsg: string,
    preAction?: () => ShiftGroupDetail | null,
    onSuccess?: () => void,
  ) {
    if (actingRef.current) return;
    actingRef.current = key;
    setActing(key);
    setActionError("");
    setCreatedShiftNotice("");
    const prev = preAction?.() ?? null;
    try {
      const res = await fetch(url, opts);
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success(successMsg);
        onSuccess?.();
        await fetchGroup();
        onUpdated?.();
      } else {
        if (prev) setGroup(prev);
        const msg = await parseErrorMessage(res, "Action failed");
        setActionError(msg);
        toast.error(msg);
      }
    } catch {
      if (prev) setGroup(prev);
      setActionError("Could not reach the server. The shift change was not saved.");
      toast.error("Could not reach the server. The shift change was not saved.");
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  }

  /* ── Actions ── */

  async function handleAssign(shiftId: string, userId: string) {
    if (actingRef.current) return;
    const assignedUser = allUsers.find((u) => u.id === userId);
    setPickerShiftId(null);
    actingRef.current = shiftId;
    setActing(shiftId);
    setActionError("");
    setCreatedShiftNotice("");
    const prev = group;
    try {
      if (group && assignedUser) {
        setGroup({
          ...group,
          shifts: group.shifts.map((s) =>
            s.id === shiftId ? {
              ...s,
              assignments: [...s.assignments, {
                id: `optimistic-${Date.now()}`, status: "DIRECT_ASSIGNED",
                notes: null, hasConflict: false, conflictNote: null,
                createdAt: new Date().toISOString(),
                user: { ...assignedUser, email: undefined }, assigner: null,
              }],
            } : s
          ),
        });
      }
      const res = await fetch("/api/shift-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId, userId }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ meta?: { roleSlotOutcome?: RoleSlotOutcomeLike } }>(res);
        toast.success(formatRoleSlotAssignmentOutcome(json?.meta?.roleSlotOutcome, assignedUser?.name));
        await fetchGroup();
        onUpdated?.();
      } else {
        if (prev) setGroup(prev);
        const msg = await parseErrorMessage(res, "Action failed");
        setActionError(msg);
        toast.error(msg);
      }
    } catch {
      if (prev) setGroup(prev);
      setActionError("Could not reach the server. The shift change was not saved.");
      toast.error("Could not reach the server. The shift change was not saved.");
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  }

  const handleApprove = (id: string) =>
    mutate(id, `/api/shift-assignments/${id}/approve`, { method: "PATCH" }, "Request approved");
  const handleDecline = (id: string) =>
    mutate(id, `/api/shift-assignments/${id}/decline`, { method: "PATCH" }, "Request declined");

  async function handleRemove(id: string) {
    const yes = await confirm({
      title: "Remove shift assignment?",
      message: "This removes the assigned worker from the shift and reopens the slot for staff assignment or instant Student pickup.",
      confirmLabel: "Remove assignment",
      variant: "danger",
    });
    if (!yes) return;
    mutate(id, `/api/shift-assignments/${id}`, { method: "DELETE" }, "Assignment removed");
  }

  function handleRequest(shiftId: string) {
    mutate(shiftId, "/api/shift-assignments/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftId }),
    }, "Request sent for staff approval");
  }

  async function handleAutoFill() {
    if (!canEditPublishedSchedule) {
      toast.error("Review or discard the private working schedule before running auto-fill.");
      return;
    }
    if (!group || autoFillingRef.current) return;
    autoFillingRef.current = true;
    setAutoFilling(true);
    try {
      const res = await fetch(`/api/shift-groups/${group.id}/auto-assign/preview`);
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: AutoFillPreviewResponse }>(res);
        if (!json?.data) {
          toast.error("Auto-fill preview could not be read. Refresh schedule before continuing.");
          return;
        }
        setAutoFillPreview(json.data);
        setAutoFillPreviewOpen(true);
      } else {
        const msg = await parseErrorMessage(res, "Auto-fill preview failed");
        toast.error(msg);
      }
    } catch {
      toast.error("Could not reach the server. Auto-fill preview was not loaded.");
    } finally {
      autoFillingRef.current = false;
      setAutoFilling(false);
    }
  }

  async function handleApplyAutoFill() {
    if (!group || autoFillingRef.current || !autoFillPreview) return;
    autoFillingRef.current = true;
    setAutoFillApplying(true);
    try {
      const res = await fetch(`/api/shift-groups/${group.id}/auto-assign`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: { assigned?: number; conflicts?: number; skipped?: number } }>(res);
        const assigned = json?.data?.assigned;
        const conflicts = json?.data?.conflicts;
        if (typeof assigned !== "number" || typeof conflicts !== "number") {
          toast.error("Auto-fill finished, but the response could not be read. Refresh schedule before continuing.");
          await fetchGroup();
          onUpdated?.();
          return;
        }
        if (assigned === 0) {
          toast.info("No eligible workers found for open shifts");
        } else if (conflicts > 0) {
          toast.warning(`${assigned} shift${assigned !== 1 ? "s" : ""} filled. Review ${conflicts} schedule conflict${conflicts !== 1 ? "s" : ""}.`);
        } else {
          toast.success(`${assigned} shift${assigned !== 1 ? "s" : ""} auto-filled`);
        }
        setAutoFillPreviewOpen(false);
        await fetchGroup();
        onUpdated?.();
      } else {
        const msg = await parseErrorMessage(res, "Auto-fill failed");
        toast.error(msg);
      }
    } catch {
      toast.error("Could not reach the server. Open shifts were not auto-filled.");
    } finally {
      autoFillingRef.current = false;
      setAutoFillApplying(false);
    }
  }

  async function handleArchive() {
    if (!group || archivingRef.current) return;
    archivingRef.current = true;
    setArchiving(true);
    try {
      const res = await fetch(`/api/shift-groups/${group.id}/archive`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success("Event archived");
        await fetchGroup();
        onUpdated?.();
      } else {
        const msg = await parseErrorMessage(res, "Archive failed");
        toast.error(msg);
      }
    } catch {
      toast.error("Could not reach the server. The event was not archived.");
    } finally {
      archivingRef.current = false;
      setArchiving(false);
    }
  }

  async function handlePostTrade(assignmentId: string) {
    if (postingRef.current) return;
    postingRef.current = true;
    setPosting(true);
    setTradeError("");
    try {
      const res = await fetch("/api/shift-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftAssignmentId: assignmentId,
          ...(tradeNotes.trim() ? { notes: tradeNotes.trim() } : {}),
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success("Shift posted to trade board");
        setTradeDialogAssignmentId(null);
        setTradeNotes("");
      } else {
        const msg = await parseErrorMessage(res, "Failed to post trade");
        setTradeError(msg);
        toast.error(msg);
      }
    } catch {
      setTradeError("Could not reach the server. The shift was not posted for trade.");
      toast.error("Could not reach the server. The shift was not posted for trade.");
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  }

  function handleAddShift(area: string, workerType: string) {
    if (!group) return;
    const label = shiftWorkerLabel(workerType);
    mutate(`add-${area}`, `/api/shift-groups/${group.id}/shifts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area, workerType }),
    }, `Added ${label} ${area.charAt(0) + area.slice(1).toLowerCase()} shift`, undefined, () => {
      setCreatedShiftNotice(`Added ${label} ${area.charAt(0) + area.slice(1).toLowerCase()} shift. Assign someone from the new open row, or leave it open for pickup.`);
    });
  }

  async function handleDeleteShift(shiftId: string, hasAssignment: boolean) {
    if (hasAssignment) {
      const yes = await confirm({
        title: "Remove staffed shift?",
        message: "This deletes the shift slot and removes the assigned worker from this event. Use this only when the role is no longer needed.",
        confirmLabel: "Remove shift",
        variant: "danger",
      });
      if (!yes) return;
    }
    if (!group) return;
    const force = hasAssignment ? "?force=true" : "";
    mutate(`del-${shiftId}`, `/api/shift-groups/${group.id}/shifts/${shiftId}${force}`, { method: "DELETE" }, "Shift removed");
  }

  /* ── Derived data ── */

  const isPast = group ? new Date(group.event.endsAt) < new Date() : false;
  const publication = publicationLabel(group?.publication ?? null);

  const shiftsByArea = useMemo(() => {
    const map: Record<string, Shift[]> = {};
    for (const s of group?.shifts ?? []) {
      if (!map[s.area]) map[s.area] = [];
      map[s.area]!.push(s); // guarded by initialization above
    }
    return map;
  }, [group?.shifts]);

  /* ── Render ── */

  return (
    <>
    <Sheet open={!!groupId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{group?.event.summary ?? "Loading..."}</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="p-4 text-muted-foreground">Loading shift details...</div>
        ) : loadError ? (
          <div className="p-4 text-center">
            <p className="text-muted-foreground mb-2">
              {loadError === "network"
                ? "Check your connection and try again."
                : "Shift details could not load. Retry before changing assignments."}
            </p>
            <Button variant="outline" size="sm" onClick={fetchGroup}>Retry</Button>
          </div>
        ) : !group ? (
          <div className="p-4 text-muted-foreground">Shift group not found.</div>
        ) : (
          <SheetBody className="px-6 py-4">
            {isStaff && (
              <ScheduleReleaseNotice
                hasWorkingCopy={group.hasWorkingCopy}
                autoReleaseAt={group.autoReleaseAt}
                autoReleaseError={group.autoReleaseError}
                onRefresh={fetchGroup}
              />
            )}
            {(actionError || createdShiftNotice) && (
              <Alert variant={actionError ? "destructive" : "default"} className="mb-4">
                <AlertDescription>{actionError || createdShiftNotice}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                {group.event.sportCode && (
                  <Badge variant="purple">{sportLabel(group.event.sportCode)}</Badge>
                )}
                <Badge variant={publication.variant}>{publication.label}</Badge>
                <span className="text-sm text-muted-foreground">
                  {eventTimingLabel}
                </span>
              </div>
              {canEditPublishedSchedule && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={handleAutoFill}
                    disabled={autoFilling || acting !== null}
                  >
                    {autoFilling ? "Building preview..." : "Preview auto-fill"}
                  </Button>
                </div>
              )}
            </div>

            {(AREAS as readonly string[]).map((area) => {
              const shifts = shiftsByArea[area] ?? [];
              if (shifts.length === 0 && !isStaff) return null;
              return (
                <ShiftAreaSection
                  key={area}
                  area={area}
                  shifts={shifts}
                  eventAllDay={group.event.allDay}
                  isStaff={isStaff}
                  canEdit={canEditPublishedSchedule}
                  currentUserId={currentUserId}
                  acting={acting}
                  pickerShiftId={pickerShiftId}
                  pickerUsers={filteredUsers}
                  pickerLoading={usersLoading}
                  pickerSearch={userSearch}
                  onPickerSearchChange={setUserSearch}
                  onOpenPicker={(shiftId) => { setPickerShiftId(shiftId); setUserSearch(""); loadUsers(); }}
                  onClosePicker={() => setPickerShiftId(null)}
                  onAddShift={(wt) => handleAddShift(area, wt)}
                  onDeleteShift={handleDeleteShift}
                  onAssign={handleAssign}
                  onRemove={handleRemove}
                  onApprove={handleApprove}
                  onDecline={handleDecline}
                  onRequest={handleRequest}
                  onPostTrade={!isStaff && !isPast && !group.archivedAt
                    ? (assignmentId) => { setTradeDialogAssignmentId(assignmentId); setTradeNotes(""); }
                    : undefined}
                  onCallWindowSaved={() => {
                    void fetchGroup();
                    onUpdated?.();
                  }}
                />
              );
            })}

            {/* Archive footer (past events, staff only) */}
            {isStaff && isPast && (
              <div className="mt-4 pt-4 border-t flex items-center justify-between gap-3">
                {group.archivedAt ? (
                  <Badge variant="gray" className="text-xs">
                    Archived {new Date(group.archivedAt).toLocaleDateString()}
                  </Badge>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Archive past events when the schedule record is ready to close.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleArchive}
                      disabled={archiving || acting !== null}
                    >
                      {archiving ? "Archiving..." : "Archive event"}
                    </Button>
                  </>
                )}
              </div>
            )}

            {group.notes && (
              <div className="mt-4 p-3 rounded-md bg-muted/50 text-sm">
                <strong>Notes:</strong> {group.notes}
              </div>
            )}
          </SheetBody>
        )}
      </SheetContent>
    </Sheet>

    {/* Post for Trade dialog */}
    <Dialog
      open={!!tradeDialogAssignmentId}
      onOpenChange={(open) => {
        if (!open) { setTradeDialogAssignmentId(null); setTradeNotes(""); }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Post Shift for Trade</DialogTitle>
          <DialogDescription>
            Anyone on the crew can claim your shift. The first valid claim takes the assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-1">
          {tradeError && (
            <Alert variant="destructive">
              <AlertDescription>{tradeError}</AlertDescription>
            </Alert>
          )}
          <Label htmlFor="trade-notes" className="text-xs font-medium">
            Notes <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="trade-notes"
            placeholder="e.g. Conflict with class, available all week"
            value={tradeNotes}
            onChange={(e) => setTradeNotes(e.target.value)}
            className="text-sm resize-none"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setTradeDialogAssignmentId(null); setTradeNotes(""); }}
            disabled={posting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => tradeDialogAssignmentId && handlePostTrade(tradeDialogAssignmentId)}
            disabled={posting}
          >
            {posting ? "Posting..." : "Post trade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Auto-fill preview dialog */}
    <Dialog open={autoFillPreviewOpen} onOpenChange={setAutoFillPreviewOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Auto-fill preview</DialogTitle>
          <DialogDescription>
            Review suggested assignments before applying them. Nothing changes until you apply.
          </DialogDescription>
        </DialogHeader>
        {autoFillPreview && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">Open slots</div>
                <div className="text-lg font-semibold tabular-nums">{autoFillPreview.summary.openSlots}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">Proposed</div>
                <div className="text-lg font-semibold tabular-nums">{autoFillPreview.summary.proposed}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">Warnings</div>
                <div className="text-lg font-semibold tabular-nums">{autoFillPreview.summary.warnings}</div>
              </div>
            </div>
            <div className="max-h-80 flex flex-col gap-2 overflow-y-auto pr-1">
              {autoFillPreview.proposals.map((proposal) => (
                <div key={proposal.shiftId} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{proposal.userName}</div>
                      <div className="text-xs text-muted-foreground">
                        {proposal.area.charAt(0) + proposal.area.slice(1).toLowerCase()} · Planned {shiftWorkerSlotLabel(proposal.workerType)} · Assigned {proposal.userStaffingType ? shiftWorkerLabel(proposal.userStaffingType) : "worker"}
                      </div>
                    </div>
                    <Badge variant={proposal.warnings.length > 0 ? "orange" : "green"} className="shrink-0 tabular-nums">
                      {proposal.score}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {[proposal.warnings[0]?.label, proposal.reasons[0]?.label].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
              {autoFillPreview.skipped.map((slot) => (
                <div key={slot.shiftId} className="rounded-lg border border-dashed border-border/70 p-3 text-sm">
                  <div className="font-medium">
                    {slot.area.charAt(0) + slot.area.slice(1).toLowerCase()} · {shiftWorkerSlotLabel(slot.workerType)}
                  </div>
                  <div className="text-xs text-muted-foreground">{slot.reason}</div>
                  {slot.reasonDetails.length > 0 && (
                    <ul className="mt-1 list-disc flex flex-col gap-0.5 pl-4 text-xs text-muted-foreground">
                      {slot.reasonDetails.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setAutoFillPreviewOpen(false)} disabled={autoFillApplying}>
            Cancel
          </Button>
          <Button onClick={handleApplyAutoFill} disabled={autoFillApplying || !autoFillPreview || autoFillPreview.proposals.length === 0}>
            {autoFillApplying ? "Applying..." : "Apply recommended assignments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
