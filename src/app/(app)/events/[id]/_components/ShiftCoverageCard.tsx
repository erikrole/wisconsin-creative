"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { CallWindowEditor } from "@/components/shift-detail/CallWindowEditor";
import { ScheduleReleaseNotice } from "@/components/ScheduleReleaseNotice";
import { ClaimShiftAction } from "@/components/ClaimShiftAction";
import { WorkingCrewEditor, type WorkingCrewEntry } from "@/app/(app)/schedule/_components/WorkingCrewEditor";
import type { ShiftGroupSummary, CommandCenterData } from "../_utils";
import { AREA_LABELS } from "../_utils";
import { shiftWorkerLabel, shiftWorkerLabelForProfile } from "@/lib/shift-display";
import { effectiveCallWindow, isInheritedFullDayCallWindow, type EffectiveCallWindow } from "@/lib/shift-call-windows";
import { cn } from "@/lib/utils";
import {
  CREW_ROW_GROUP,
  CrewAreaHeading,
  CrewSlotStatus,
  CrewTypeLabel,
  areaLabel,
  crewSlotState,
} from "@/components/shift-detail/crew-row";

const AREAS = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"] as const;
const GEAR_STATE: Record<CommandCenterData["gearPlans"][number]["state"], { label: string; variant: "gray" | "purple" | "orange" | "green" | "blue" }> = {
  draft: { label: "Draft", variant: "gray" },
  reserved: { label: "Reserved", variant: "purple" },
  ready_for_pickup: { label: "Ready for pickup", variant: "orange" },
  partially_picked_up: { label: "Partially picked up", variant: "orange" },
  checked_out: { label: "Checked out", variant: "green" },
  returned: { label: "Returned", variant: "blue" },
};

type Shift = ShiftGroupSummary["shifts"][number];
type Assignment = Shift["assignments"][number];

type Props = {
  shiftGroup: ShiftGroupSummary;
  commandCenter: CommandCenterData | null;
  currentUserId?: string;
  currentUserRole: string;
  acting: string | null;
  linkParams: {
    titleParam: string;
    dateParam: string;
    endParam: string;
    locationParam: string;
    eventParam: string;
  };
  eventAllDay?: boolean;
  eventEndsAt: string;
  studentCallTimeAllowed?: boolean;
  onNudge: (assignmentId: string, userName: string) => void;
  onUpdated?: () => void;
};

export function ShiftCoverageCard({
  shiftGroup,
  commandCenter,
  currentUserId,
  currentUserRole,
  acting,
  linkParams,
  eventAllDay = false,
  eventEndsAt,
  studentCallTimeAllowed = true,
  onNudge,
  onUpdated,
}: Props) {
  const { titleParam, dateParam, endParam, locationParam, eventParam } = linkParams;
  const isStaffOrAdmin = currentUserRole === "STAFF" || currentUserRole === "ADMIN";
  const groupId = shiftGroup.id;

  // ── Derived data ──

  const shiftsByArea = useMemo(() => {
    const map: Record<string, Shift[]> = {};
    for (const s of shiftGroup.shifts) {
      if (!map[s.area]) map[s.area] = [];
      map[s.area]!.push(s);
    }
    return map;
  }, [shiftGroup.shifts]);

  const coverage = shiftGroup.coverage;
  const coverageVariant = !coverage ? "gray"
    : coverage.percentage >= 100 ? "green"
    : coverage.percentage > 0 ? "orange"
    : "red";
  const publication = shiftGroup.publication;
  const publicationBadge = !publication?.publishedAt
    ? { label: "Not released", variant: "gray" as const }
    : publication.changedAfterPublish
      ? { label: "Pending sync", variant: "orange" as const }
      : { label: "Current", variant: "green" as const };

  // ── Row renderers ──

  function renderPerson(_shift: Shift, activeAssignment: Assignment | null) {
    if (activeAssignment) {
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <UserAvatar
              name={activeAssignment.user.name}
              avatarUrl={activeAssignment.user.avatarUrl}
              size="sm"
            />
            <span className="min-w-0 truncate text-sm">{activeAssignment.user.name}</span>
          </span>
          {activeAssignment.hasConflict && (
            <span className="flex items-center gap-1 pl-8 text-[11px] text-[var(--orange-text)]">
              <AlertTriangleIcon className="size-3 shrink-0" />
              <span className="truncate">{activeAssignment.conflictNote ?? "Schedule conflict"}</span>
            </span>
          )}
        </div>
      );
    }

    return <span className="text-muted-foreground">-</span>;
  }

  function renderStatus(_shift: Shift, activeAssignment: Assignment | null, pendingRequests: Assignment[]) {
    return (
      <CrewSlotStatus
        state={crewSlotState(Boolean(activeAssignment), pendingRequests.length)}
        requestCount={pendingRequests.length}
      />
    );
  }

  function shouldShowCallWindow(window: EffectiveCallWindow): boolean {
    return studentCallTimeAllowed && !eventAllDay && !isInheritedFullDayCallWindow(window);
  }

  function changeTimeLabel(iso: string) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // Coalesce back-to-back identical changes (same label + actor + detail within
  // 5 min) so a save that fires "Republished schedule" twice reads as one row.
  const recentChanges = (() => {
    const raw = commandCenter?.recentChanges ?? [];
    const out: (typeof raw[number] & { repeatCount?: number })[] = [];
    for (const change of raw) {
      const last = out[out.length - 1];
      if (
        last &&
        last.label === change.label &&
        last.actorId === change.actorId &&
        last.detail === change.detail &&
        Math.abs(new Date(last.createdAt).getTime() - new Date(change.createdAt).getTime()) <= 5 * 60_000
      ) {
        last.repeatCount = (last.repeatCount ?? 1) + 1;
        continue;
      }
      out.push({ ...change });
    }
    return out;
  })();
  const reviewChangeCount = recentChanges.filter((change) => change.needsReview).length;

  // ── Crew table ──
  // Read-only event-detail table for workers. Staff/admin authoring uses the
  // buffered working-copy editor below so every change gets the release buffer.
  const crewTable = (
    <Table>
      <TableHeader>
        <TableRow striped={false}>
          {studentCallTimeAllowed && <TableHead className="w-28">Call</TableHead>}
          <TableHead className="w-24">Type</TableHead>
          <TableHead>Person</TableHead>
          <TableHead className="w-32">Status</TableHead>
          {!isStaffOrAdmin && <TableHead className="w-36 text-right">Action</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {AREAS.map((area) => {
          const shifts = shiftsByArea[area] ?? [];
          // Students have no way to add a slot, so an empty area is just noise.
          if (shifts.length === 0 && !isStaffOrAdmin) return [];
          const filledInArea = shifts.filter((s) =>
            s.assignments.some((a) => a.status === "DIRECT_ASSIGNED" || a.status === "APPROVED")
          ).length;
          return [
            // Area sub-header
            <TableRow key={`header-${area}`} striped={false} className="border-b-0 bg-transparent hover:bg-transparent">
              <TableCell colSpan={(isStaffOrAdmin ? 4 : 5) - (studentCallTimeAllowed ? 0 : 1)} className="pt-5 pb-1.5">
                <CrewAreaHeading
                  area={area}
                  filled={filledInArea}
                  total={shifts.length}
                />
              </TableCell>
            </TableRow>,
            // Shift rows
            ...shifts.map((shift) => {
              const activeAssignment = shift.assignments.find(
                (a) => a.status === "DIRECT_ASSIGNED" || a.status === "APPROVED"
              ) ?? null;
              const pendingRequests = shift.assignments.filter((a) => a.status === "REQUESTED");
              const slotWindow = effectiveCallWindow(shift);
              const assignmentWindow = activeAssignment ? effectiveCallWindow(shift, activeAssignment) : null;
              const rowCallWindow = assignmentWindow ?? slotWindow;
              const rowClassLabel = activeAssignment
                ? shiftWorkerLabelForProfile(activeAssignment.user) ?? "Assigned"
                : shiftWorkerLabel(shift.workerType);
              return (
                <TableRow key={shift.id} striped={false} className={cn(CREW_ROW_GROUP, "border-border/40")}>
                  {studentCallTimeAllowed && (
                    <TableCell className="py-2.5 text-muted-foreground">
                      {shift.workerType === "ST" && shouldShowCallWindow(rowCallWindow) ? (
                        <CallWindowEditor
                          effectiveWindow={rowCallWindow}
                          compact
                          variant="bare"
                        />
                      ) : (
                        <span className="pl-0.5">-</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="py-2.5">
                    <CrewTypeLabel label={rowClassLabel} />
                  </TableCell>
                  <TableCell className="py-2.5">
                    {renderPerson(shift, activeAssignment)}
                  </TableCell>
                  <TableCell className="py-2.5">
                    {renderStatus(shift, activeAssignment, pendingRequests)}
                  </TableCell>
                  {!isStaffOrAdmin && (
                    <TableCell className="py-2.5 text-right">
                      <ClaimShiftAction
                        shiftId={shift.id}
                        workerType={shift.workerType}
                        startsAt={shift.startsAt}
                        isAssigned={Boolean(activeAssignment)}
                        viewerRequest={shift.viewerRequest}
                        canClaim={currentUserRole === "STUDENT" && Boolean(currentUserId)}
                        isPublished={Boolean(publication?.publishedAt)}
                        onChanged={onUpdated}
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            }),
            // Empty area placeholder
            ...(shifts.length === 0 ? [
              <TableRow key={`empty-${area}`} striped={false} className="border-border/40">
                <TableCell colSpan={(isStaffOrAdmin ? 4 : 5) - (studentCallTimeAllowed ? 0 : 1)} className="py-3 text-sm text-muted-foreground">
                  No {areaLabel(area).toLowerCase()} slots yet.
                </TableCell>
              </TableRow>
            ] : []),
          ];
        })}
      </TableBody>
    </Table>
  );

  return (
    <>
    <Card className="mt-4">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle>Crew</CardTitle>
          {coverage && (
            <Badge variant={coverageVariant} size="sm" className="tabular-nums">
              {coverage.filled}/{coverage.total} filled
            </Badge>
          )}
          <Badge variant={publicationBadge.variant} size="sm">
            {publicationBadge.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {isStaffOrAdmin && (
          <ScheduleReleaseNotice
            hasWorkingCopy={shiftGroup.hasWorkingCopy}
            eventEndsAt={eventEndsAt}
            autoReleaseAt={shiftGroup.autoReleaseAt}
            autoReleaseError={shiftGroup.autoReleaseError}
            onRefresh={onUpdated}
          />
        )}
        {/* Gear summary badges (staff only) */}
        {commandCenter && isStaffOrAdmin && (
          commandCenter.gearSummary.byStatus.draft > 0 ||
          commandCenter.gearSummary.byStatus.reserved > 0 ||
          commandCenter.gearSummary.byStatus.pendingPickup > 0 ||
          commandCenter.gearSummary.byStatus.checkedOut > 0 ||
          commandCenter.gearSummary.byStatus.completed > 0
        ) && (
          <div className="mb-4 flex flex-wrap gap-2">
            {commandCenter.gearSummary.byStatus.draft > 0 && <Badge variant="gray" size="sm">{commandCenter.gearSummary.byStatus.draft} draft</Badge>}
            {commandCenter.gearSummary.byStatus.reserved > 0 && <Badge variant="purple" size="sm">{commandCenter.gearSummary.byStatus.reserved} reserved</Badge>}
            {commandCenter.gearSummary.byStatus.pendingPickup > 0 && <Badge variant="orange" size="sm">{commandCenter.gearSummary.byStatus.pendingPickup} pending pickup</Badge>}
            {commandCenter.gearSummary.byStatus.checkedOut > 0 && <Badge variant="green" size="sm">{commandCenter.gearSummary.byStatus.checkedOut} checked out</Badge>}
            {commandCenter.gearSummary.byStatus.completed > 0 && <Badge variant="blue" size="sm">{commandCenter.gearSummary.byStatus.completed} returned</Badge>}
          </div>
        )}

        {commandCenter && isStaffOrAdmin && commandCenter.gearPlans.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border border-border/60">
            <div className="flex items-center justify-between bg-muted/35 px-3 py-2">
              <h3 className="text-sm font-medium">Event gear readiness</h3>
              <span className="text-xs text-muted-foreground">One row per person</span>
            </div>
            <div className="divide-y divide-border/50">
              {commandCenter.gearPlans.map((plan) => {
                const state = GEAR_STATE[plan.state];
                const href = plan.bookingIds.length === 1
                  ? `/bookings?highlight=${encodeURIComponent(plan.bookingIds[0]!)}`
                  : `/bookings?tab=reservations&requester_id=${encodeURIComponent(plan.requesterUserId)}`;
                return (
                  <Link
                    key={plan.requesterUserId}
                    href={href}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{plan.requesterName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {plan.title} · {plan.itemCount} item{plan.itemCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {plan.bookingIds.length > 1 && (
                        <Badge variant="orange" size="sm">{plan.bookingIds.length} plans · combine</Badge>
                      )}
                      <Badge variant={state.variant} size="sm">{state.label}</Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {isStaffOrAdmin ? (
          <WorkingCrewEditor
            entry={{
              shiftGroupId: groupId,
              allDay: eventAllDay,
              shifts: shiftGroup.shifts,
            } satisfies WorkingCrewEntry}
            onPublished={() => onUpdated?.()}
            showReleaseCountdown={false}
          />
        ) : crewTable}

        {isStaffOrAdmin && recentChanges.length > 0 && (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Recent schedule changes</h3>
              {reviewChangeCount > 0 ? (
                <Badge variant="orange">{reviewChangeCount} review</Badge>
              ) : (
                <Badge variant="gray">Audit trail</Badge>
              )}
            </div>
            <div className="divide-y divide-border/50">
              {recentChanges.slice(0, 5).map((change) => (
                <div key={change.id} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{change.label}</span>
                      {change.repeatCount && change.repeatCount > 1 && (
                        <Badge variant="gray" size="sm" className="tabular-nums">×{change.repeatCount}</Badge>
                      )}
                      {change.needsReview && <Badge variant="orange" size="sm">Needs review</Badge>}
                    </div>
                    {change.detail && (
                      <p className="truncate text-xs text-muted-foreground">{change.detail}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground sm:text-right">
                    {change.actorName} · {changeTimeLabel(change.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Missing gear actions (staff only) */}
        {commandCenter && commandCenter.missingGear.length > 0 && isStaffOrAdmin && (
          <div className="mt-4">
            <h3 className="text-sm mb-2">Missing Gear ({commandCenter.missingGear.length})</h3>
            <div className="flex flex-col gap-2">
              {commandCenter.missingGear.map((m) => (
                <div key={`${m.shiftId}-${m.userId}`} className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <strong>{m.userName}</strong>
                    <span className="text-muted-foreground ml-2">{AREA_LABELS[m.area] ?? m.area}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10"
                      disabled={acting !== null}
                      onClick={() => onNudge(m.assignmentId, m.userName)}
                    >
                      {acting === m.assignmentId ? "Sending..." : "Nudge"}
                    </Button>
                    <Button size="sm" className="h-10" asChild>
                      <Link href={`/reservations?create=true&title=${titleParam}&startsAt=${dateParam}&endsAt=${endParam}${locationParam}${eventParam}&requesterUserId=${m.userId}`}>
                        Reserve gear
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}
