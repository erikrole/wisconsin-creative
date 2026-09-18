"use client";

import { useMemo } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { CallWindowEditor } from "@/components/shift-detail/CallWindowEditor";
import { ScheduleReleaseNotice } from "@/components/ScheduleReleaseNotice";
import { ClaimShiftAction, ClaimsPausedNotice } from "@/components/ClaimShiftAction";
import { WorkingCrewEditor, type WorkingCrewEntry } from "@/app/(app)/schedule/_components/WorkingCrewEditor";
import { EventWorkersCard } from "./EventWorkersCard";
import type { ShiftGroupSummary } from "../_utils";
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

type Shift = ShiftGroupSummary["shifts"][number];
type Assignment = Shift["assignments"][number];

type Props = {
  eventId: string;
  shiftGroup: ShiftGroupSummary;
  currentUserId?: string;
  currentUserRole: string;
  eventAllDay?: boolean;
  eventEndsAt: string;
  studentCallTimeAllowed?: boolean;
  studentCallOpen?: boolean;
  onStudentCallOpenChange?: (open: boolean) => void;
  onUpdated?: () => void;
};

export function ShiftCoverageCard({
  eventId,
  shiftGroup,
  currentUserId,
  currentUserRole,
  eventAllDay = false,
  eventEndsAt,
  studentCallTimeAllowed = true,
  studentCallOpen,
  onStudentCallOpenChange,
  onUpdated,
}: Props) {
  const isStaffOrAdmin = currentUserRole === "STAFF" || currentUserRole === "ADMIN";
  const isAdmin = currentUserRole === "ADMIN";
  const groupId = shiftGroup.id;
  const eventHasEnded = new Date(eventEndsAt).getTime() <= Date.now();

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
  const publicationBadge = eventHasEnded
    ? { label: "Ended", variant: "gray" as const }
    : !publication?.publishedAt
      ? { label: "Not released", variant: "gray" as const }
      : shiftGroup.hasWorkingCopy
        ? { label: "Unpublished changes", variant: "orange" as const }
        : { label: "Current", variant: "green" as const };

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
          if (shifts.length === 0 && !isStaffOrAdmin) return [];
          const filledInArea = shifts.filter((s) =>
            s.assignments.some((a) => a.status === "DIRECT_ASSIGNED" || a.status === "APPROVED")
          ).length;
          return [
            <TableRow key={`header-${area}`} striped={false} className="border-b-0 bg-transparent hover:bg-transparent">
              <TableCell colSpan={(isStaffOrAdmin ? 4 : 5) - (studentCallTimeAllowed ? 0 : 1)} className="pt-5 pb-1.5">
                <CrewAreaHeading
                  area={area}
                  filled={filledInArea}
                  total={shifts.length}
                />
              </TableCell>
            </TableRow>,
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
                        claimsPaused={Boolean(shiftGroup.claimsPaused)}
                        isPublished={Boolean(publication?.publishedAt)}
                        onChanged={onUpdated}
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            }),
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
    <Card id="event-crew" elevation="flat" className="scroll-mt-24 border-border/50 shadow-xs">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
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
          {eventHasEnded && isStaffOrAdmin && (
            <p className="text-xs text-muted-foreground">
              This event has ended. Assignments apply silently and count on Scoreboard.
            </p>
          )}
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
        {currentUserRole === "STUDENT" && shiftGroup.claimsPaused && (
          <ClaimsPausedNotice className="mb-3 rounded-md bg-muted/40 px-3 py-2" />
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
            showStudentCallButton={false}
            studentCallOpen={studentCallOpen}
            onStudentCallOpenChange={onStudentCallOpenChange}
          />
        ) : crewTable}

        {isStaffOrAdmin && (
          <EventWorkersCard
            eventId={eventId}
            isAdmin={isAdmin}
            eventHasEnded={eventHasEnded}
          />
        )}
      </CardContent>
    </Card>
  );
}
