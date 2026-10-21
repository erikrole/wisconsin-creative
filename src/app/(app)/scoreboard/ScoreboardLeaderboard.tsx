"use client";

import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, ChevronDown, GitCompareArrows } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { BucketBar, WIN_FILL } from "@/components/scoreboard/ScoreboardVisuals";
import { rateLabel, recordLabel } from "@/lib/scoreboard-digest";
import type { TeamScoreboardSortKey } from "@/lib/scoreboard-explorer";
import type { TeamScoreboardPerson, TeamScoreboardPersonSummary } from "@/lib/services/team-scoreboard";
import { cn } from "@/lib/utils";

export type RankedPerson = {
  person: TeamScoreboardPerson;
  metrics: TeamScoreboardPersonSummary;
  rank: number;
};

const ROW_SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.7 } as const;

function metricValue(metrics: TeamScoreboardPersonSummary, sort: TeamScoreboardSortKey): number {
  if (sort === "events") return metrics.eventsWorked;
  if (sort === "wins") return metrics.wins;
  return metrics.winRate ?? 0;
}

function metricLabel(metrics: TeamScoreboardPersonSummary, sort: TeamScoreboardSortKey): string {
  if (sort === "events") return String(metrics.eventsWorked);
  if (sort === "wins") return String(metrics.wins);
  return rateLabel(metrics.winRate);
}

const METRIC_UNIT: Record<TeamScoreboardSortKey, string> = {
  events: "events",
  wins: "wins",
  rate: "win rate",
};

function RankBadge({ rank }: { rank: number }) {
  const medal = rank <= 3;
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black tabular-nums",
        rank === 1 && "bg-[#f5d565] text-[#5c4300]",
        rank === 2 && "bg-[#dfe3ea] text-[#3b4252]",
        rank === 3 && "bg-[#efc8a4] text-[#5b3412]",
        !medal && "text-muted-foreground",
      )}
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  );
}

function PersonDetail({
  row,
  comparing,
  href,
  onCompare,
}: {
  row: RankedPerson;
  comparing: boolean;
  href: string;
  onCompare: () => void;
}) {
  const sports = row.person.bySport;
  const maxGames = sports.reduce((max, sport) => Math.max(max, sport.games), 0);
  const best = sports
    .filter((sport) => sport.winRate !== null && sport.games >= 2)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.games - a.games)[0];

  return (
    <div className="grid gap-4 px-4 pb-4 pl-[3.25rem] sm:grid-cols-[minmax(0,1fr)_auto] sm:pl-[4.75rem]">
      <div className="min-w-0">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dd className="text-xl font-black tabular-nums tracking-tight">{row.metrics.eventsWorked}</dd>
            <dt className="text-xs text-muted-foreground">Events</dt>
          </div>
          <div>
            <dd className="text-xl font-black tabular-nums tracking-tight">{recordLabel(row.metrics)}</dd>
            <dt className="text-xs text-muted-foreground">Record</dt>
          </div>
          <div>
            <dd className="text-xl font-black tabular-nums tracking-tight">{rateLabel(row.metrics.winRate)}</dd>
            <dt className="text-xs text-muted-foreground">Win rate</dt>
          </div>
        </dl>
        {sports.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2.5" aria-label={`${row.person.name} by sport`}>
            {sports.map((sport) => (
              <li key={sport.key ?? sport.label} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-bold text-foreground">{sport.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {sport.eventsWorked} {sport.eventsWorked === 1 ? "event" : "events"}
                    {sport.games > 0 ? ` · ${recordLabel(sport)}` : ""}
                  </span>
                </div>
                <BucketBar row={sport} maxGames={maxGames} />
              </li>
            ))}
          </ul>
        ) : null}
        {best && sports.length > 1 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Best with: <span className="font-bold text-foreground">{best.label}</span>, {recordLabel(best)}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2 sm:flex-col">
        <Button
          variant={comparing ? "secondary" : "outline"}
          size="sm"
          onClick={onCompare}
          aria-pressed={comparing}
        >
          <GitCompareArrows className="size-3.5" aria-hidden="true" />
          {comparing ? "Comparing" : "Compare"}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link prefetch={false} href={href} className="no-underline">
            Full page
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function ScoreboardLeaderboard({
  rows,
  sort,
  minimumRateGames,
  currentUserId,
  expandedId,
  compareIds,
  hrefForPerson,
  onToggle,
  onCompare,
}: {
  rows: RankedPerson[];
  sort: TeamScoreboardSortKey;
  minimumRateGames: number;
  currentUserId: string | null;
  expandedId: string | null;
  compareIds: string[];
  hrefForPerson: (userId: string) => string;
  onToggle: (userId: string) => void;
  onCompare: (userId: string) => void;
}) {
  const reduced = useReducedMotion();
  const max = rows.reduce((top, row) => Math.max(top, metricValue(row.metrics, sort)), 0);

  return (
    <LayoutGroup>
      <ol
        className="flex flex-col"
        aria-label="Per-person Scoreboard rankings. Open a name to see their sports, compare, or view that person's shared Scoreboard."
      >
        {rows.map((row) => {
          const { person, metrics, rank } = row;
          const isYou = currentUserId === person.userId;
          const expanded = expandedId === person.userId;
          const comparing = compareIds.includes(person.userId);
          const unranked = sort === "rate" && metrics.games < minimumRateGames;
          const share = max > 0 && !unranked ? (metricValue(metrics, sort) / max) * 100 : 0;
          const panelId = `scoreboard-person-${person.userId}`;
          return (
            <motion.li
              key={person.userId}
              layout={reduced ? false : "position"}
              transition={ROW_SPRING}
              data-scoreboard-person={person.userId}
              className={cn(
                "border-b border-border/70 last:border-b-0",
                isYou && "bg-[var(--accent-soft)]",
                expanded && !isYou && "bg-muted/40",
              )}
            >
              <button
                type="button"
                onClick={() => onToggle(person.userId)}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="group flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4"
              >
                <span className="flex w-7 justify-center sm:w-9"><RankBadge rank={rank} /></span>
                <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="brand-identity truncate text-sm font-bold text-foreground">{person.name}</span>
                    {isYou ? (
                      <span className="rounded-full bg-[var(--accent)] px-1.5 py-px text-[10px] font-black text-white">You</span>
                    ) : null}
                    {comparing ? (
                      <GitCompareArrows className="size-3.5 text-[var(--accent)]" aria-label="In compare" />
                    ) : null}
                  </span>
                  <span className="mt-1 block h-1 w-full max-w-64 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: sort === "events" ? "var(--accent)" : WIN_FILL }}
                      initial={false}
                      animate={{ width: `${Math.max(share, share > 0 ? 3 : 0)}%` }}
                      transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                  <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                    {metrics.eventsWorked} {metrics.eventsWorked === 1 ? "event" : "events"} · {recordLabel(metrics)} · {rateLabel(metrics.winRate)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {unranked ? (
                    <span className="block text-xs text-muted-foreground">
                      Not ranked yet
                      <span className="block text-[11px]">{`Needs ${minimumRateGames} games`}</span>
                    </span>
                  ) : (
                    <>
                      <span className="block text-lg font-black tabular-nums tracking-tight">{metricLabel(metrics, sort)}</span>
                      <span className="block text-[11px] text-muted-foreground">{METRIC_UNIT[sort]}</span>
                    </>
                  )}
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                    expanded && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
              <AnimatePresence initial={false}>
                {expanded ? (
                  <motion.div
                    id={panelId}
                    key="detail"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <PersonDetail
                      row={row}
                      comparing={comparing}
                      href={hrefForPerson(person.userId)}
                      onCompare={() => onCompare(person.userId)}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ol>
    </LayoutGroup>
  );
}
