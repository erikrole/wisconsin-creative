"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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

function chipClass(b: TeamBlock) {
  if (b.status === "PENDING") return "border border-dashed border-muted-foreground/50 text-muted-foreground";
  if (b.intent === "PREFER") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (b.intent === "DISLIKE") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-red-500/12 text-red-700 dark:text-red-300";
}

function dayLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function TeamAvailabilityGrid({ students }: { students: TeamStudent[] }) {
  const today = institutionDateKey();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const pending = students.reduce((n, s) => n + s.blocks.filter((b) => b.status === "PENDING").length, 0);
  const noneEntered = students.filter((s) => s.blocks.length === 0).length;

  return (
    <>
      <PageHeader
        title="Availability"
        description={`When students can't work. ${dayLabel(days[0]!)} – ${dayLabel(days[6]!)}.`}
      >
        <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" onClick={() => setWeekStart(weekStartOf(today))}>This week</Button>
        <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight />
        </Button>
      </PageHeader>

        {(pending > 0 || noneEntered > 0) && (
          <p className="mb-3 text-sm text-muted-foreground">
            {pending > 0 && `${pending} waiting for review (dashed). `}
            {noneEntered > 0 && `${noneEntered} ${noneEntered === 1 ? "student has" : "students have"} not added anything yet.`}
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 w-48 bg-card px-3 py-2 font-semibold">Student</th>
                {days.map((d, i) => (
                  <th key={d} className={cn("px-2 py-2 font-semibold", d === today && "text-foreground")}>
                    {DAY_NAMES[i]} <span className="font-normal">{dayLabel(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-b last:border-0 align-top">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2">
                    <Link
                      href={`/staff/${s.id}?tab=availability`}
                      className="flex items-center gap-2 text-foreground no-underline hover:underline"
                    >
                      <UserAvatar name={s.name} avatarUrl={s.avatarUrl} size="sm" />
                      <span className="font-bold">{s.name}</span>
                    </Link>
                  </td>
                  {days.map((d) => (
                    <td key={d} className={cn("px-2 py-2", d === today && "bg-muted/40")}>
                      <div className="flex flex-col gap-1">
                        {blocksOnDate(s.blocks, d).map((b) => (
                          <span
                            key={b.id}
                            title={b.label ?? undefined}
                            className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", chipClass(b))}
                          >
                            {blockTimeLabel(b)}
                            {b.label ? ` ${b.label}` : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Red: can&apos;t work. Amber: would rather not. Green: prefers. Dashed: waiting for review.
        </p>
    </>
  );
}
