"use client";

import { sportDotColor } from "@/lib/sport-color";
import Link from "next/link";
import { ArchiveIcon, ChevronRightIcon } from "lucide-react";
import { formatCalendarEventDateRange, eventSpansMultipleDays } from "@/lib/calendar-event-dates";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import type { CalendarEntry } from "./types";
import { WorkingCrewEditor, type WorkingCrewEntry } from "./WorkingCrewEditor";
import { scheduleEventTitleParts } from "./types";
import { CoverageBadge } from "./Coverage";
import { CrewRowActions, CrewSummary, ShiftRowList } from "./ListViewCrewRows";
import { EventGrid } from "./ListViewGrid";
import { eventStartLabel } from "./list-view-helpers";
import { type CrewTemplateSide } from "./ListView";

/* ── Event parent + shift child rows (desktop) ── */

export function EventRows({
  entry,
  isExpanded,
  hasShifts,
  isAssignedToMe,
  shiftStatus,
  isStaff,
  isHiding,
  onToggle,
  onSelectGroup,
  onHide,
  currentUserId,
  showShiftStatus,
  postingTradeId,
  cancelingTradeId,
  onPostTrade,
  onCancelTrade,
  canClaim,
  onClaimed,
  onSetupCrew,
  onQuickManageCrew,
  onPublished,
  isSettingUp,
}: {
  entry: CalendarEntry;
  isExpanded: boolean;
  hasShifts: boolean;
  isAssignedToMe: boolean;
  shiftStatus: string | null;
  isStaff: boolean;
  isHiding: boolean;
  onToggle: () => void;
  onSelectGroup: () => void;
  onHide?: () => void;
  currentUserId: string;
  showShiftStatus: boolean;
  postingTradeId: string | null;
  cancelingTradeId: string | null;
  onPostTrade?: (assignmentId: string) => void;
  onCancelTrade?: (tradeId: string) => void;
  canClaim: boolean;
  onClaimed?: () => void | Promise<void>;
  onSetupCrew?: (eventId: string, templateSide: CrewTemplateSide) => void;
  onQuickManageCrew?: (eventId: string) => void;
  onPublished: () => void;
  isSettingUp: boolean;
}) {
  const titleParts = scheduleEventTitleParts(entry);

  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];

  return (
    <>
      {/* Parent event row */}
      <tr
        data-schedule-event-id={entry.id}
        className={cn(
          "group/row border-l-[3px] transition-colors",
          venueTone.railClass,
          isExpanded
            ? "bg-muted/20"
            : isAssignedToMe
              ? "bg-primary/5 hover:bg-primary/10"
              : "hover:bg-muted/10",
        )}
      >
        <td className="border-b border-border/20 px-2 py-1.5">
          <EventGrid
            className="schedule-enter min-h-12"
            cells={{
              toggle: hasShifts ? (
                <button
                  type="button"
                  aria-label={isExpanded ? "Collapse shifts" : "Expand shifts"}
                  aria-expanded={isExpanded}
                  className="relative flex size-10 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] hover:bg-muted hover:text-foreground active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  onClick={onToggle}
                >
                  <ChevronRightIcon
                    className={cn("size-4 transition-transform duration-200 ease-out motion-reduce:transition-none", isExpanded && "rotate-90")}
                  />
                </button>
              ) : null,
              time: (
                <span
                  className="block shrink-0 text-[13px] font-medium tabular-nums text-muted-foreground"
                >
                  {eventStartLabel(entry)}
                </span>
              ),
              event: (
                <>
                  <Link
                    href={`/events/${entry.id}`}
                    className="flex min-h-10 items-center truncate rounded-sm text-sm font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {titleParts.title}
                  </Link>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                    {entry.sportCode && (
                      <span
                        aria-hidden="true"
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: sportDotColor(entry.sportCode) ?? undefined }}
                      />
                    )}
                    <span className="shrink-0">{venueTone.label}</span>
                    {(entry.combinedEventCount ?? 0) > 1 && (
                      <Badge variant="secondary" size="sm">{entry.combinedEventCount} events · shared crew</Badge>
                    )}
                    {!entry.allDay && eventSpansMultipleDays(entry) && (
                      <Badge variant="secondary" size="sm">{formatCalendarEventDateRange(entry)}</Badge>
                    )}
                    {titleParts.detail && <span className="truncate">{titleParts.detail}</span>}
                    {entry.subtitle && <span className="truncate font-medium text-muted-foreground">{entry.subtitle}</span>}
                  </div>
                </>
              ),
              coverage: entry.coverage ? (
                <CoverageBadge percentage={entry.coverage.percentage} filled={entry.coverage.filled} total={entry.coverage.total} />
              ) : null,
              crew: <CrewSummary entry={entry} />,
              status: (
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {showShiftStatus && shiftStatus === "Pending" && <Badge variant="orange" size="sm">{shiftStatus}</Badge>}
                  {entry.claimsPaused && canClaim && (
                    <Badge variant="secondary" size="sm">Updating</Badge>
                  )}
                  {entry.eventArchivedAt && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                      <ArchiveIcon className="size-3" />
                      Older record
                    </span>
                  )}
                </div>
              ),
              actions: isStaff && (Boolean(entry.shiftGroupId) || onSetupCrew || onHide) ? (
                <CrewRowActions
                  entry={entry}
                  isHiding={isHiding}
                  onHide={onHide}
                  onSetupCrew={onSetupCrew}
                  onQuickManageCrew={onQuickManageCrew}
                  isSettingUp={isSettingUp}
                />
              ) : null,
            }}
          />
        </td>
      </tr>

      {/* Expanded assignment detail */}
      {isExpanded && (
        <tr className="bg-muted/10">
          <td className="border-b border-border/15 px-4 py-2">
            <div className="schedule-enter pl-[116px] pr-10">
              {isStaff && entry.shiftGroupId ? (
                <WorkingCrewEditor
                  entry={{
                    shiftGroupId: entry.shiftGroupId,
                    allDay: entry.allDay,
                    shifts: entry.shifts,
                  } satisfies WorkingCrewEntry}
                  onPublished={onPublished}
                  compact
                  eventDetailHref={`/events/${entry.id}`}
                />
              ) : (
                <ShiftRowList
                  entry={entry}
                  currentUserId={currentUserId}
                  postingTradeId={postingTradeId}
                  cancelingTradeId={cancelingTradeId}
                  onPostTrade={onPostTrade}
                  onCancelTrade={onCancelTrade}
                  canClaim={canClaim}
                  onClaimed={onClaimed}
                  onSelectGroup={onSelectGroup}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
