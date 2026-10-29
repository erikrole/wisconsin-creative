"use client";

import Link from "next/link";
import { ArrowLeftRightIcon, ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatTimeShort } from "@/lib/format";
import { formatHours, type PersonRow } from "@/lib/schedule-by-person";
import { blockTimeLabel, blocksOnDate, type TeamBlock } from "@/lib/team-availability";
import { scheduleEventTitleParts, type CalendarEntry } from "./types";

export function dayHeading(dayKey: string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" }) {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

type Props = {
  person: PersonRow | null;
  blocks: TeamBlock[];
  dayKeys: string[];
  /** Average hours across everyone working this week, for the "vs team" line. */
  averageHours: number;
  onOpenChange: (open: boolean) => void;
  onOpenCrew: (entry: CalendarEntry) => void;
};

export function PersonScheduleSheet({ person, blocks, dayKeys, averageHours, onOpenChange, onOpenCrew }: Props) {
  const trades = person?.shifts.filter((s) => s.assignment.activeTrade).length ?? 0;
  const conflicts = person?.shifts.filter((s) => s.conflictsAvailability).length ?? 0;
  const shiftCount = person?.shifts.filter((s) => !s.pending).length ?? 0;

  return (
    <Sheet open={Boolean(person)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md" data-person-schedule-sheet>
        {person && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3 pr-8">
                <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{person.name}</SheetTitle>
                  <SheetDescription>
                    {dayHeading(dayKeys[0]!, { month: "short", day: "numeric" })} – {dayHeading(dayKeys[6]!, { month: "short", day: "numeric" })}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SheetBody className="flex flex-col gap-6 px-4 py-4 sm:px-6">
              <dl className="grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Shifts</dt>
                  <dd className="text-2xl font-black tabular-nums">{shiftCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Hours</dt>
                  <dd className="text-2xl font-black tabular-nums">{formatHours(person.hours)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Team average</dt>
                  <dd className="text-2xl font-black tabular-nums text-muted-foreground">{formatHours(Math.round(averageHours * 10) / 10)}</dd>
                </div>
              </dl>

              {(trades > 0 || conflicts > 0) && (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {conflicts > 0 && (
                    <li className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                      <TriangleAlertIcon className="size-4 shrink-0" />
                      {conflicts} {conflicts === 1 ? "shift overlaps" : "shifts overlap"} a time they can&apos;t work
                    </li>
                  )}
                  {trades > 0 && (
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <ArrowLeftRightIcon className="size-4 shrink-0" />
                      {trades} on the Trade Board
                    </li>
                  )}
                </ul>
              )}

              {dayKeys.map((dayKey) => {
                const shifts = person.shifts.filter((s) => s.dayKey === dayKey);
                const away = blocksOnDate(blocks, dayKey).filter((b) => b.status === "APPROVED" && b.intent !== "PREFER");
                if (shifts.length === 0 && away.length === 0) return null;
                return (
                  <section key={dayKey}>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{dayHeading(dayKey)}</h3>
                    <ul className="flex flex-col gap-1.5">
                      {shifts.map((s) => {
                        const title = scheduleEventTitleParts(s.entry).title;
                        return (
                          <li key={s.key}>
                            <button
                              type="button"
                              onClick={() => onOpenCrew(s.entry)}
                              className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold">{title}</span>
                                <span className="block truncate text-xs text-muted-foreground tabular-nums">
                                  {s.entry.allDay ? "All day" : `${formatTimeShort(s.startsAt)} – ${formatTimeShort(s.endsAt)}`}
                                  {s.assignment.crewLabel ? ` · ${s.assignment.crewLabel}` : ""}
                                  {s.pending ? " · Pending" : ""}
                                  {s.assignment.activeTrade ? " · Trade posted" : ""}
                                </span>
                              </span>
                              {s.conflictsAvailability && <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" aria-label="Overlaps a time they can't work" />}
                              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                            </button>
                          </li>
                        );
                      })}
                      {away.map((b) => (
                        <li key={b.id} className="px-1 text-xs text-muted-foreground">
                          Can&apos;t work {blockTimeLabel(b).toLowerCase()}{b.label ? ` · ${b.label}` : ""}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}

              {person.shifts.length === 0 && <p className="text-sm text-muted-foreground">Nothing scheduled this week.</p>}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Link href={`/staff/${person.id}`} className="font-semibold underline-offset-4 hover:underline">Open profile</Link>
                <Link href={`/staff/${person.id}?tab=availability`} className="font-semibold underline-offset-4 hover:underline">Availability</Link>
              </div>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
