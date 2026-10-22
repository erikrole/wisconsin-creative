"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowLeftRight, GitCompareArrows } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rateLabel, recordLabel } from "@/lib/scoreboard-digest";
import type { TeamScoreboardPerson } from "@/lib/services/team-scoreboard";
import { cn } from "@/lib/utils";

type Stat = {
  label: string;
  left: number;
  right: number;
  format: (value: number) => string;
};

function MirroredStat({ stat }: { stat: Stat }) {
  const reduced = useReducedMotion();
  const max = Math.max(stat.left, stat.right, 1);
  const leftWins = stat.left > stat.right;
  const rightWins = stat.right > stat.left;
  const transition = reduced ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const };
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span className={cn(leftWins ? "font-black text-foreground" : "text-muted-foreground")}>{stat.format(stat.left)}</span>
        <span className="text-xs text-muted-foreground">{stat.label}</span>
        <span className={cn(rightWins ? "font-black text-foreground" : "text-muted-foreground")}>{stat.format(stat.right)}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1" aria-hidden="true">
        <div className="flex h-1.5 justify-end overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full"
            style={{ background: leftWins ? "var(--accent)" : "var(--text-muted)" }}
            initial={false}
            animate={{ width: `${(stat.left / max) * 100}%` }}
            transition={transition}
          />
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full"
            style={{ background: rightWins ? "var(--accent)" : "var(--text-muted)" }}
            initial={false}
            animate={{ width: `${(stat.right / max) * 100}%` }}
            transition={transition}
          />
        </div>
      </div>
    </div>
  );
}

function Slot({
  person,
  people,
  excludeId,
  onPick,
  align,
}: {
  person: TeamScoreboardPerson | null;
  people: TeamScoreboardPerson[];
  excludeId: string | null;
  onPick: (userId: string) => void;
  align: "left" | "right";
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", align === "right" ? "items-end text-right" : "items-start")}>
      {person ? (
        <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="lg" />
      ) : (
        <span className="inline-flex size-10 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">?</span>
      )}
      <Select value={person?.userId ?? ""} onValueChange={onPick}>
        <SelectTrigger
          className="h-9 w-full max-w-40 bg-background text-xs font-bold"
          aria-label={align === "left" ? "First person to compare" : "Second person to compare"}
        >
          <SelectValue placeholder="Pick someone" />
        </SelectTrigger>
        <SelectContent className="max-h-[320px]">
          {people
            .filter((candidate) => candidate.userId !== excludeId)
            .map((candidate) => (
              <SelectItem key={candidate.userId} value={candidate.userId}>{candidate.name}</SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ScoreboardCompare({
  people,
  compareIds,
  onChange,
}: {
  people: TeamScoreboardPerson[];
  compareIds: [string | null, string | null];
  onChange: (next: [string | null, string | null]) => void;
}) {
  const [leftId, rightId] = compareIds;
  const left = people.find((person) => person.userId === leftId) ?? null;
  const right = people.find((person) => person.userId === rightId) ?? null;

  const stats: Stat[] = left && right ? [
    { label: "Events", left: left.summary.eventsWorked, right: right.summary.eventsWorked, format: String },
    { label: "Wins", left: left.summary.wins, right: right.summary.wins, format: String },
    { label: "Games", left: left.summary.games, right: right.summary.games, format: String },
    {
      label: "Win rate",
      left: left.summary.winRate ?? 0,
      right: right.summary.winRate ?? 0,
      format: (value) => (value ? rateLabel(value) : "—"),
    },
  ] : [];

  const shared = left && right
    ? left.bySport
      .map((sport) => ({ sport, other: right.bySport.find((candidate) => candidate.key === sport.key) }))
      .filter((pair): pair is { sport: typeof pair.sport; other: NonNullable<typeof pair.other> } => Boolean(pair.other))
    : [];

  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs" aria-labelledby="scoreboard-compare-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="scoreboard-compare-title" className="flex items-center gap-2 text-base font-black tracking-tight">
          <GitCompareArrows className="size-4 text-[var(--accent)]" aria-hidden="true" />
          Head to head
        </h2>
        {left && right ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange([rightId, leftId])}
            aria-label="Swap sides"
          >
            <ArrowLeftRight className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
        <Slot person={left} people={people} excludeId={rightId} onPick={(id) => onChange([id, rightId])} align="left" />
        <span className="mt-3 text-xs font-black text-muted-foreground">vs</span>
        <Slot person={right} people={people} excludeId={leftId} onPick={(id) => onChange([leftId, id])} align="right" />
      </div>

      {left && right ? (
        <div className="mt-4 flex flex-col gap-3">
          {stats.map((stat) => <MirroredStat key={stat.label} stat={stat} />)}
          {shared.length > 0 ? (
            <div className="border-t border-border/70 pt-3">
              <p className="text-xs font-bold text-foreground">Sports they share <span className="font-normal text-muted-foreground">· record in events worked</span></p>
              <ul className="mt-2 flex flex-col gap-1.5 text-xs tabular-nums">
                {shared.map(({ sport, other }) => (
                  <li key={sport.key ?? sport.label} className="grid grid-cols-[1fr_auto_1fr] gap-2">
                    <span className="text-muted-foreground">{sport.games > 0 ? recordLabel(sport) : "—"} <span className="text-[11px]">in {sport.eventsWorked}</span></span>
                    <span className="font-bold text-foreground">{sport.label}</span>
                    <span className="text-right text-muted-foreground">{other.games > 0 ? recordLabel(other) : "—"} <span className="text-[11px]">in {other.eventsWorked}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">No sports in common yet.</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Pick two people, or open anyone on the leaderboard and tap Compare.
        </p>
      )}
    </section>
  );
}
