"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { Calendar, Clock, Cloud, History, MapPin, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import { formatRelativeTime, formatTimeShort } from "@/lib/format";
import { eventSourceAttribution, scheduleVenueParts } from "@/lib/schedule-event-identity";
import { sportLabel } from "@/lib/sports";
import { VENUE_TONES, venueBadgeVariant, venueToneFromIsHome } from "@/lib/venue-tone";
import { scheduleEventTitleParts } from "@/app/(app)/schedule/_components/types";
import type { CalendarEvent } from "../_utils";

function titleIncludes(summary: string, value: string | null) {
  if (!value) return false;
  return summary.toLowerCase().includes(value.toLowerCase());
}

function uniqueHeadlineParts(...values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(trimmed);
  }
  return parts;
}

function MetaFact({
  icon: Icon,
  label,
  value,
  emphasize = false,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  emphasize?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={emphasize ? "mt-0.5 text-sm font-medium text-foreground" : "mt-0.5 text-sm text-foreground"}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function EventHeader({
  event,
  callLabel,
  crewCoverage,
  isStaffOrAdmin,
  refreshing,
  lastRefreshed,
  reserveHref,
  onEdit,
  onRefresh,
  onEditStudentCall,
}: {
  event: CalendarEvent;
  callLabel: string | null;
  crewCoverage?: { filled: number; total: number } | null;
  isStaffOrAdmin: boolean;
  refreshing: boolean;
  lastRefreshed: Date | null;
  reserveHref: string;
  onEdit: () => void;
  onRefresh: () => void;
  onEditStudentCall?: () => void;
}) {
  const titleParts = scheduleEventTitleParts({
    summary: event.summary,
    sportCode: event.sportCode,
    opponent: event.opponent,
    isHome: event.isHome,
    site: event.site,
    location: event.location,
    combinedEventCount: event.combinedEvents.length,
  });
  const subheadline = uniqueHeadlineParts(event.subtitle, titleParts.detail)
    .filter((part) => !titleIncludes(titleParts.title, part))
    .join(" · ");
  const venue = scheduleVenueParts(event.rawLocationText);
  const sourceValue = eventSourceAttribution({
    source: event.source,
    createdByName: event.createdByName,
  });
  const imported = Boolean(event.source);
  const anyFieldLocked = imported && (event.summaryLocked || event.isHomeLocked || event.locationLocked || event.timingLocked);
  const sportName = event.sportCode ? sportLabel(event.sportCode) : null;
  const showSportBadge = Boolean(sportName) && !titleIncludes(titleParts.title, sportName);
  const when = event.allDay
    ? formatCalendarEventDateRange(event, { includeYear: true })
    : `${new Date(event.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${formatTimeShort(event.startsAt)} – ${formatTimeShort(event.endsAt)}`;

  return (
    <TooltipProvider>
      <DetailPageHeader
        sideBySideAt="sm"
        status={
          <>
            {event.status === "CANCELLED" ? (
              <Badge variant="gray">Cancelled</Badge>
            ) : null}
            {event.isHidden ? (
              <Badge variant="gray">Hidden</Badge>
            ) : null}
            {event.combinedEvents.length > 0 ? (
              <Badge variant="orange">Combined</Badge>
            ) : null}
            {showSportBadge ? <Badge variant="purple">{sportName}</Badge> : null}
            {event.opponent ? (
              <Badge variant={venueBadgeVariant(event.isHome)}>
                {VENUE_TONES[venueToneFromIsHome(event.isHome)].label}
              </Badge>
            ) : (
              <Badge variant="gray">Non-game</Badge>
            )}
            {crewCoverage && crewCoverage.total > 0 ? (
              <Badge
                variant={!crewCoverage.filled ? "red" : crewCoverage.filled >= crewCoverage.total ? "green" : "orange"}
                asChild
              >
                <a href="#event-crew" className="tabular-nums">
                  {crewCoverage.filled}/{crewCoverage.total} crew
                </a>
              </Badge>
            ) : null}
          </>
        }
        title={titleParts.title}
        subtitle={
          subheadline ? (
            <span className="text-base font-medium tracking-tight text-foreground">{subheadline}</span>
          ) : undefined
        }
        meta={
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetaFact icon={Calendar} label={event.allDay ? "Dates" : "When"} value={when} />
            {!event.allDay && (callLabel || onEditStudentCall) ? (
              <MetaFact
                icon={Clock}
                label="Student call"
                emphasize
                value={
                  <span className="inline-flex min-h-10 items-center gap-1">
                    <span>{callLabel ? callLabel.replace(/^Call\s+/i, "") : "Not set"}</span>
                    {onEditStudentCall ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-10 text-muted-foreground hover:text-foreground"
                        onClick={onEditStudentCall}
                        aria-label="Edit Student call time"
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                  </span>
                }
              />
            ) : null}
            {venue ? (
              <MetaFact
                icon={MapPin}
                label="Venue"
                value={
                  venue.locality ? (
                    <>
                      {venue.name}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {venue.locality}
                      </span>
                    </>
                  ) : (
                    venue.name
                  )
                }
              />
            ) : null}
            <MetaFact icon={imported ? Cloud : Sparkles} label="Source" value={sourceValue} />
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button asChild variant="outline" className="h-10">
              <Link href={reserveHref}>Reserve gear for this event</Link>
            </Button>
            {isStaffOrAdmin && (
              <Button
                variant="outline"
                className="h-10"
                onClick={onEdit}
                aria-label={anyFieldLocked ? "Edit event with manual overrides" : "Edit event"}
              >
                <Pencil data-icon="inline-start" />
                Edit
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  onClick={onRefresh}
                  disabled={refreshing}
                  aria-label="Refresh event data"
                >
                  <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), new Date())}` : "Refresh"}
              </TooltipContent>
            </Tooltip>
          </div>
        }
        footer={
          anyFieldLocked ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--orange-text)]">
              <History className="size-3.5" />
              Edited fields
              {event.summaryLocked && <Badge variant="outline" size="sm">Title</Badge>}
              {event.timingLocked && <Badge variant="outline" size="sm">Time</Badge>}
              {event.isHomeLocked && <Badge variant="outline" size="sm">Event type</Badge>}
              {event.locationLocked && <Badge variant="outline" size="sm">Pickup location</Badge>}
            </div>
          ) : null
        }
      />
    </TooltipProvider>
  );
}
