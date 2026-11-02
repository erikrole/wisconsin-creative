"use client";

import { useMemo, useState } from "react";
import { SearchIcon, TriangleAlertIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { formatTimeShort, institutionDateKey } from "@/lib/format";
import { buildPersonWeek, formatHours, type PersonShift } from "@/lib/schedule-by-person";
import { addDays, blockTimeLabel, blocksOnDate, type TeamBlock, type TeamStudent } from "@/lib/team-availability";
import { cn } from "@/lib/utils";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import { PersonScheduleSheet, dayHeading } from "./PersonScheduleSheet";
import { SchedulePeriodNavigator } from "./SchedulePeriodNavigator";
import { getMonday, scheduleEventTitleParts, type CalendarEntry } from "./types";

type Props = {
  /** Active students with their availability; null while it loads or if it fails. */
  students: TeamStudent[] | null;
  entries: CalendarEntry[];
  weekStart: Date;
  setWeekStart: (d: Date) => void;
  loading: boolean;
  onOpenCrew: (entry: CalendarEntry) => void;
  hasFilters?: boolean;
  onClearFilters?: () => void;
};

const NO_BLOCKS: TeamBlock[] = [];

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ShiftChip({ s, onOpen }: { s: PersonShift; onOpen: () => void }) {
  const tone = VENUE_TONES[venueToneFromEvent(s.entry)];
  const title = scheduleEventTitleParts(s.entry).title;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={s.conflictsAvailability ? "Overlaps a time they can't work" : undefined}
      className={cn(
        "flex w-full items-stretch overflow-hidden rounded-md border bg-card text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        s.pending && "border-dashed",
        s.conflictsAvailability && "border-amber-500/70",
      )}
    >
      <span className={cn("w-[3px] shrink-0", tone.solidClass)} />
      <span className="min-w-0 flex-1 px-2 py-1.5">
        <span className="flex items-center justify-between gap-1 tabular-nums text-muted-foreground">
          {s.entry.allDay ? "All day" : formatTimeShort(s.startsAt)}
          {s.conflictsAvailability && <TriangleAlertIcon className="size-3 text-amber-600" />}
        </span>
        <span className="block truncate font-bold">{title}</span>
        {(s.assignment.crewLabel || s.pending || s.assignment.activeTrade) && (
          <span className="block truncate text-muted-foreground">
            {[s.assignment.crewLabel, s.pending && "Pending", s.assignment.activeTrade && "Trade posted"].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </button>
  );
}

export function PersonWeekView(props: Omit<Props, "students">) {
  const { data } = useFetch<TeamStudent[]>({
    url: "/api/availability/team",
    refetchOnFocus: false,
    transform: (json) => json.data as TeamStudent[],
  });
  return <PersonWeek {...props} students={data} />;
}

export function PersonWeek({ students, entries, weekStart, setWeekStart, loading, onOpenCrew, hasFilters = false, onClearFilters }: Props) {
  const today = institutionDateKey();
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);

  const dayKeys = useMemo(() => {
    const monday = localDateKey(weekStart);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [weekStart]);

  const rows = useMemo(() => buildPersonWeek(entries, dayKeys, students ?? []), [entries, dayKeys, students]);
  const blocksFor = useMemo(() => new Map((students ?? []).map((s) => [s.id, s.blocks])), [students]);

  const needle = query.trim().toLowerCase();
  const visible = rows.filter((r) => !needle || r.name.toLowerCase().includes(needle));
  const working = visible.filter((r) => r.shifts.length > 0);
  const idle = visible.filter((r) => r.shifts.length === 0);
  const allWorking = rows.filter((r) => r.shifts.some((s) => !s.pending));
  const totalHours = allWorking.reduce((n, r) => n + r.hours, 0);
  const averageHours = allWorking.length > 0 ? totalHours / allWorking.length : 0;
  const person = rows.find((r) => r.id === personId) ?? null;

  const thisMonday = getMonday(new Date());
  const isThisWeek = localDateKey(weekStart) === localDateKey(thisMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const title = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const summary = allWorking.length === 0
    ? "Nobody scheduled"
    : `${allWorking.length} ${allWorking.length === 1 ? "person" : "people"} · ${formatHours(Math.round(totalHours))} scheduled`;
  const shift = (delta: number) => {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + 7 * delta);
    setWeekStart(next);
  };

  const rowHeader = (r: (typeof rows)[number]) => (
    <button
      type="button"
      onClick={() => setPersonId(r.id)}
      className="flex min-w-0 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <UserAvatar name={r.name} avatarUrl={r.avatarUrl} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{r.name}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">
          {r.shifts.length === 0 ? "No shifts" : `${formatHours(r.hours)} · ${r.shifts.length} ${r.shifts.length === 1 ? "shift" : "shifts"}`}
        </span>
      </span>
    </button>
  );

  return (
    <div className="schedule-enter" data-schedule-view="people">
      <SchedulePeriodNavigator
        title={title}
        summary={summary}
        isCurrent={isThisWeek}
        onPrevious={() => shift(-1)}
        onNext={() => shift(1)}
        onToday={() => setWeekStart(thisMonday)}
        previousLabel="Previous week"
        nextLabel="Next week"
      />

      <div className="relative mb-3 w-full sm:w-64">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" aria-label="Find a person" className="pl-8" />
      </div>

      {loading && <Skeleton className="h-64 rounded-xl" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="calendar"
          title={hasFilters ? "No shifts match these filters" : "Nobody is scheduled this week"}
          description={hasFilters ? "Try another week or clear schedule filters." : "Assigned crew shows up here, one row per person."}
          actionLabel={hasFilters ? "Clear filters" : undefined}
          onAction={hasFilters ? onClearFilters : undefined}
          compact
        />
      )}

      {!loading && rows.length > 0 && visible.length === 0 && (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Nobody matches.</p>
      )}

      {!loading && visible.length > 0 && (
        <>
          {/* Phones: one card per person with the week as a list. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {working.map((r) => (
              <li key={r.id} className="rounded-xl border bg-card p-3 shadow-xs">
                {rowHeader(r)}
                <ul className="mt-2 flex flex-col gap-1">
                  {r.shifts.map((s) => (
                    <li key={s.key}>
                      <button type="button" onClick={() => onOpenCrew(s.entry)} className="flex w-full items-baseline gap-2 py-1 text-left text-sm">
                        <span className="w-9 shrink-0 text-xs font-bold uppercase text-muted-foreground">{dayHeading(s.dayKey, { weekday: "short" })}</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{scheduleEventTitleParts(s.entry).title}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.entry.allDay ? "All day" : formatTimeShort(s.startsAt)}</span>
                        {s.conflictsAvailability && <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-600" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {idle.length > 0 && (
              <li className="px-1 pt-2 text-sm text-muted-foreground">
                No shifts: {idle.map((r) => r.name).join(", ")}
              </li>
            )}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-xs md:block">
            <table className="w-full min-w-[920px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 w-56 bg-card px-3 py-2 font-semibold">Person</th>
                  {dayKeys.map((d) => (
                    <th key={d} className={cn("border-t-2 border-t-transparent px-2 py-2 font-semibold", d === today && "border-t-[var(--brand-red)] text-foreground")}>
                      {dayHeading(d, { weekday: "short" })} <span className="font-normal">{dayHeading(d, { month: "short", day: "numeric" })}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...working, ...idle].map((r) => {
                  const blocks = blocksFor.get(r.id) ?? NO_BLOCKS;
                  return (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className={cn("sticky left-0 z-10 bg-card px-3 py-2", r.shifts.length === 0 && "[&_.font-bold]:font-semibold [&_.font-bold]:text-muted-foreground")}>{rowHeader(r)}</td>
                      {dayKeys.map((d) => {
                        const away = blocksOnDate(blocks, d).filter((b) => b.status === "APPROVED" && b.intent !== "PREFER");
                        return (
                          <td key={d} className={cn("w-[12%] min-w-28 px-1.5 py-1.5", d === today && "bg-[var(--brand-red)]/[0.04]", away.some((b) => b.allDay) && "bg-muted/50")}>
                            <div className="flex flex-col gap-1">
                              {r.shifts.filter((s) => s.dayKey === d).map((s) => (
                                <ShiftChip key={s.key} s={s} onOpen={() => onOpenCrew(s.entry)} />
                              ))}
                              {away.map((b) => (
                                <span key={b.id} title={b.label ?? undefined} className="px-0.5 text-[11px] tabular-nums text-muted-foreground">
                                  Can&apos;t work {blockTimeLabel(b).toLowerCase()}
                                </span>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PersonScheduleSheet
        person={person}
        blocks={person ? blocksFor.get(person.id) ?? NO_BLOCKS : NO_BLOCKS}
        dayKeys={dayKeys}
        averageHours={averageHours}
        onOpenChange={(open) => { if (!open) setPersonId(null); }}
        onOpenCrew={(entry) => { setPersonId(null); onOpenCrew(entry); }}
      />
    </div>
  );
}
