"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { institutionDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addDays,
  blockTimeLabel,
  blocksOnDate,
  weekStartOf,
  type TeamBlock,
  type TeamStudent,
} from "@/lib/team-availability";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Filter = "all" | "review" | "empty";

function chipClass(b: TeamBlock) {
  if (b.status === "PENDING") return "border border-dashed border-muted-foreground/50 text-muted-foreground";
  if (b.intent === "PREFER") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (b.intent === "DISLIKE") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-red-500/12 text-red-700 dark:text-red-300";
}

function dayLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Chips({ blocks }: { blocks: TeamBlock[] }) {
  return (
    <div className="flex flex-col gap-1">
      {blocks.map((b) => (
        <span key={b.id} title={b.label ?? undefined} className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", chipClass(b))}>
          {blockTimeLabel(b)}
          {b.label ? ` ${b.label}` : ""}
        </span>
      ))}
    </div>
  );
}

function StudentLink({ s }: { s: TeamStudent }) {
  const toReview = s.blocks.filter((b) => b.status === "PENDING").length;
  return (
    <Link href={`/staff/${s.id}?tab=availability`} className="flex min-w-0 items-center gap-2 text-foreground no-underline hover:underline">
      <UserAvatar name={s.name} avatarUrl={s.avatarUrl} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-bold">{s.name}</span>
        {s.blocks.length === 0 && <span className="block text-xs font-normal text-muted-foreground">Nothing added yet</span>}
        {toReview > 0 && <span className="block text-xs font-normal text-muted-foreground">{toReview} to review</span>}
      </span>
    </Link>
  );
}

export function TeamAvailabilityGrid({ students }: { students: TeamStudent[] }) {
  const today = institutionDateKey();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const mobileDay = pickedDay && days.includes(pickedDay) ? pickedDay : days.includes(today) ? today : days[0]!;

  const pending = students.reduce((n, s) => n + s.blocks.filter((b) => b.status === "PENDING").length, 0);
  const noneEntered = students.filter((s) => s.blocks.length === 0).length;

  const visible = students.filter((s) => {
    if (query && !s.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "review") return s.blocks.some((b) => b.status === "PENDING");
    if (filter === "empty") return s.blocks.length === 0;
    return true;
  });

  // Students who can't work each day, so a glance at the header shows the tight days.
  const unavailable = (d: string) =>
    students.filter((s) => blocksOnDate(s.blocks, d).some((b) => b.status === "APPROVED" && b.intent !== "PREFER")).length;
  const todayCount = unavailable(today);

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: "all", label: "Everyone" },
    { key: "review", label: "To review", count: pending > 0 ? students.filter((s) => s.blocks.some((b) => b.status === "PENDING")).length : 0 },
    { key: "empty", label: "Nothing added", count: noneEntered },
  ];

  return (
    <>
      <PageHeader
        title="Availability"
        description={
          todayCount === 0
            ? "Nobody has marked today as a day they can't work."
            : `${todayCount} of ${students.length} students can't work all or part of today.`
        }
      >
        <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" aria-label="Go to this week" onClick={() => setWeekStart(weekStartOf(today))}>
          {dayLabel(days[0]!)} – {dayLabel(days[6]!)}
        </Button>
        <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight />
        </Button>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student" className="pl-8" />
        </div>
        <div role="group" aria-label="Filter students" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === f.key ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
              )}
            >
              {f.label}
              {f.count ? <span className="ml-1.5 tabular-nums opacity-70">{f.count}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground shadow-xs">
          {students.length === 0 ? "No student workers yet." : "Nobody matches."}
        </p>
      ) : (
        <>
          {/* Phones: one day at a time, since seven columns don't fit. */}
          <div className="md:hidden">
            <div role="group" aria-label="Day" className="mb-3 grid grid-cols-7 gap-1">
              {days.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={d === mobileDay}
                  onClick={() => setPickedDay(d)}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center rounded-lg border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    d === mobileDay ? "border-foreground bg-foreground text-background" : "bg-card",
                  )}
                >
                  <span className="opacity-70">{DAY_NAMES[i]}</span>
                  <span className="text-sm font-bold tabular-nums">{Number(d.slice(8))}</span>
                </button>
              ))}
            </div>
            <ul className="divide-y rounded-xl border bg-card shadow-xs">
              {visible.map((s) => {
                const blocks = blocksOnDate(s.blocks, mobileDay);
                return (
                  <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <StudentLink s={s} />
                    <div className="shrink-0 text-right">
                      {blocks.length > 0 ? <Chips blocks={blocks} /> : <span className="text-xs text-muted-foreground">{s.blocks.length > 0 ? "Free" : "–"}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-xs md:block">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 w-52 bg-card px-3 py-2 font-semibold">Student</th>
                  {days.map((d, i) => (
                    <th
                      key={d}
                      className={cn("border-t-2 border-t-transparent px-2 py-2 font-semibold", d === today && "border-t-[var(--brand-red)] text-foreground")}
                    >
                      <span className="block">
                        {DAY_NAMES[i]} <span className="font-normal">{dayLabel(d)}</span>
                      </span>
                      <span className="block text-[11px] font-normal tabular-nums">{unavailable(d)} can&apos;t work</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id} className="border-b align-top last:border-0">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <StudentLink s={s} />
                    </td>
                    {days.map((d, i) => (
                      <td key={d} className={cn("px-2 py-2", d === today ? "bg-muted/60" : i >= 5 && "bg-muted/25")}>
                        <Chips blocks={blocksOnDate(s.blocks, d)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-red-500/40" />Can&apos;t work</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-amber-500/40" />Would rather not</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-emerald-500/40" />Prefers</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-dashed border-muted-foreground" />Waiting for review</li>
      </ul>
    </>
  );
}
