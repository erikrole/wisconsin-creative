"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, HouseIcon, PlaneIcon, UsersRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateShort, formatTimeShort } from "@/lib/format";
import { formatCalendarEventAllDayLabel } from "@/lib/calendar-event-dates";
import { sportLabel } from "@/lib/sports";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import { cn } from "@/lib/utils";
import { CoverageTag } from "./Coverage";
import { WorkingCrewEditor, type WorkingCrewEntry } from "./WorkingCrewEditor";
import { scheduleEventTitleParts, type CalendarEntry } from "./types";

export type CrewTemplateSide = "HOME" | "AWAY" | "EMPTY";

type Props = {
  entry: CalendarEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetupCrew: (eventId: string, templateSide: CrewTemplateSide) => Promise<string | null>;
  onUpdated: () => void | Promise<void>;
};

const SETUP_OPTIONS: Array<{
  side: CrewTemplateSide;
  title: string;
  description: string;
  icon: typeof HouseIcon;
}> = [
  {
    side: "HOME",
    title: "Use Home defaults",
    description: "Start from this sport’s configured Home crew.",
    icon: HouseIcon,
  },
  {
    side: "AWAY",
    title: "Use Away defaults",
    description: "Start from the configured travel or neutral crew.",
    icon: PlaneIcon,
  },
  {
    side: "EMPTY",
    title: "Start empty",
    description: "Build the crew one area and slot at a time.",
    icon: UsersRoundIcon,
  },
];

function eventTiming(entry: CalendarEntry) {
  if (entry.allDay) {
    return `${formatDateShort(entry.startsAt, true)} · ${formatCalendarEventAllDayLabel(entry)}`;
  }
  return `${formatDateShort(entry.startsAt)} · ${formatTimeShort(entry.startsAt)} - ${formatTimeShort(entry.endsAt)}`;
}

export function ScheduleCrewSheet({
  entry,
  open,
  onOpenChange,
  onSetupCrew,
  onUpdated,
}: Props) {
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [settingUpSide, setSettingUpSide] = useState<CrewTemplateSide | null>(null);
  const setupRef = useRef(false);

  useEffect(() => {
    setCreatedGroupId(null);
    setSettingUpSide(null);
    setupRef.current = false;
  }, [entry?.id]);

  if (!entry) return null;

  const titleParts = scheduleEventTitleParts(entry);
  const eventId = entry.id;
  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];
  const shiftGroupId = entry.shiftGroupId ?? createdGroupId;
  const openSlots = entry.coverage
    ? Math.max(0, entry.coverage.total - entry.coverage.filled)
    : 0;

  async function setupCrew(templateSide: CrewTemplateSide) {
    if (setupRef.current) return;
    setupRef.current = true;
    setSettingUpSide(templateSide);
    try {
      const groupId = await onSetupCrew(eventId, templateSide);
      if (groupId) setCreatedGroupId(groupId);
    } finally {
      setupRef.current = false;
      setSettingUpSide(null);
    }
  }

  const workingEntry = {
    shiftGroupId,
    allDay: entry.allDay,
    shifts: entry.shifts,
  } satisfies WorkingCrewEntry;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl" data-schedule-crew-sheet>
        <SheetHeader>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 pr-1">
            {entry.sportCode && <Badge variant="secondary" size="sm">{sportLabel(entry.sportCode)}</Badge>}
            <Badge variant={venueTone.badgeVariant} size="sm">{venueTone.label}</Badge>
            {entry.hasWorkingCopy && <Badge variant="orange" size="sm">Pending changes</Badge>}
          </div>
          <SheetTitle>{titleParts.title}</SheetTitle>
          <SheetDescription>
            {[titleParts.detail, eventTiming(entry)].filter(Boolean).join(" · ")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border/40 bg-muted/15 px-4 py-2 sm:px-6">
          {entry.coverage ? (
            <>
              <CoverageTag
                percentage={entry.coverage.percentage}
                filled={entry.coverage.filled}
                total={entry.coverage.total}
              />
              <span className="text-xs text-muted-foreground">
                {openSlots > 0 ? `${openSlots} open slot${openSlots === 1 ? "" : "s"}` : "Crew covered"}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Crew has not been set up</span>
          )}
          <Button asChild variant="ghost" size="sm" className="ml-auto h-10 px-2 text-xs text-muted-foreground">
            <Link href={`/events/${entry.id}`}>
              Event detail
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </Button>
        </div>

        <SheetBody className="px-4 py-4 sm:px-6">
          {shiftGroupId ? (
            <WorkingCrewEditor
              key={shiftGroupId}
              entry={workingEntry}
              onPublished={onUpdated}
              compact
              showReleaseCountdown
            />
          ) : (
            <div className="mx-auto flex min-h-[360px] max-w-lg flex-col justify-center py-8">
              <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <UsersRoundIcon className="size-5" />
              </div>
              <h3 className="text-base font-semibold">Set up this crew</h3>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
                Choose a starting point. You can add, remove, convert, and assign every slot before changes are released.
              </p>
              <div className="mt-5 grid gap-2">
                {SETUP_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <Button
                      key={option.side}
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-auto min-h-16 justify-start gap-3 px-3 py-2.5 text-left",
                        settingUpSide === option.side && "border-primary/50 bg-primary/5",
                      )}
                      disabled={settingUpSide !== null}
                      loading={settingUpSide === option.side}
                      onClick={() => void setupCrew(option.side)}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{option.title}</span>
                        <span className="mt-0.5 block whitespace-normal text-xs font-normal text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
