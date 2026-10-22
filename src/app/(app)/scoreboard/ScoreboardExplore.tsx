"use client";

import { useState } from "react";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BucketBar } from "@/components/scoreboard/ScoreboardVisuals";
import { rateLabel, recordLabel } from "@/lib/scoreboard-digest";
import { SCOREBOARD_ALL_FILTER, type TeamScoreboardFilterKey } from "@/lib/scoreboard-explorer";
import type { TeamScoreboard, TeamScoreboardBreakdown } from "@/lib/services/team-scoreboard";
import { cn } from "@/lib/utils";

const COLLAPSED_ROWS = 6;

const DIMENSIONS: Array<{
  key: TeamScoreboardFilterKey;
  label: string;
  rows: (data: TeamScoreboard) => TeamScoreboardBreakdown[];
  hint: string;
}> = [
  { key: "sportCode", label: "Sport", rows: (data) => data.bySport ?? [], hint: "Which sports our crews win at" },
  { key: "venue", label: "Venue", rows: (data) => data.byVenue ?? [], hint: "Where we work the most" },
  { key: "opponent", label: "Opponent", rows: (data) => data.byOpponent ?? [], hint: "Who we keep seeing" },
  { key: "site", label: "Site", rows: (data) => data.bySite ?? [], hint: "Home, away and neutral" },
];

export function ScoreboardExplore({
  data,
  filters,
  onSelect,
}: {
  data: TeamScoreboard;
  filters: Record<TeamScoreboardFilterKey, string>;
  onSelect: (key: TeamScoreboardFilterKey, value: string) => void;
}) {
  const [dimension, setDimension] = useState<TeamScoreboardFilterKey>("sportCode");
  const [expanded, setExpanded] = useState(false);
  const definition = DIMENSIONS.find((candidate) => candidate.key === dimension) ?? DIMENSIONS[0]!;
  const rows = definition.rows(data);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const maxGames = rows.reduce((max, row) => Math.max(max, row.games, row.eventsCovered), 0);
  const selectedValue = filters[dimension];

  return (
    <section className="rounded-xl border bg-card shadow-xs" aria-labelledby="scoreboard-explore-title">
      <div className="p-4 pb-3">
        <h2 id="scoreboard-explore-title" className="flex items-center gap-2 text-base font-black tracking-tight">
          <Compass className="size-4 text-[var(--accent)]" aria-hidden="true" />
          Explore
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{definition.hint}. Tap a row to zoom the whole page in.</p>
        <ToggleGroup
          type="single"
          value={dimension}
          onValueChange={(value) => {
            if (!value) return;
            setDimension(value as TeamScoreboardFilterKey);
            setExpanded(false);
          }}
          aria-label="Explore by"
          className="mt-3 w-full"
        >
          {DIMENSIONS.map((candidate) => (
            <ToggleGroupItem key={candidate.key} value={candidate.key} className="min-h-8 flex-1 text-xs font-bold">
              {candidate.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing to explore in this view yet.</p>
      ) : (
        <ul className="border-t border-border/70">
          {visible.map((row) => {
            const value = row.key;
            const selected = value !== null && selectedValue === value;
            return (
              <li key={`${value ?? "__unknown__"}-${row.label}`} className="border-b border-border/70 last:border-b-0">
                <button
                  type="button"
                  disabled={value === null}
                  aria-pressed={selected}
                  onClick={() => value && onSelect(dimension, selected ? SCOREBOARD_ALL_FILTER : value)}
                  className={cn(
                    "relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent",
                    selected && "bg-[var(--accent-soft)] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--accent)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="brand-identity truncate text-sm font-bold">{row.label}</span>
                      <span className="shrink-0 text-xs font-bold tabular-nums">{row.games > 0 ? recordLabel(row) : "—"}</span>
                    </span>
                    <BucketBar row={row} maxGames={maxGames} />
                    <span className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
                      <span>{row.eventsCovered} {row.eventsCovered === 1 ? "event" : "events"} · {row.contributors} {row.contributors === 1 ? "person" : "people"}</span>
                      <span>{rateLabel(row.winRate)}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > COLLAPSED_ROWS ? (
        <div className="border-t border-border/70">
          <Button variant="ghost" className="h-10 w-full rounded-none rounded-b-xl text-xs" onClick={() => setExpanded((current) => !current)}>
            {expanded ? "Show fewer" : `Show all ${rows.length}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
