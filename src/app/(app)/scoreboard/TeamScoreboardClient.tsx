"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles, Trophy } from "lucide-react";
import MetricCard from "../reports/MetricCard";
import {
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportLoadingState,
  ReportMetricGrid,
  ReportSectionCard,
} from "../reports/report-ui";
import { UserAvatar } from "@/components/UserAvatar";
import {
  OperationalActiveFilterChips,
  OperationalToolbar,
  type OperationalActiveFilter,
} from "@/components/OperationalToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FadeUp } from "@/components/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFetch } from "@/hooks/use-fetch";
import { formatRelativeTime } from "@/lib/format";
import { rateLabel, recordLabel } from "@/lib/scoreboard-digest";
import type {
  TeamScoreboard,
  TeamScoreboardBreakdown,
  TeamScoreboardFacet,
  TeamScoreboardPerson,
  TeamScoreboardPersonSummary,
} from "@/lib/services/team-scoreboard";
import { cn } from "@/lib/utils";

type SortKey = "events" | "wins" | "rate";
type FilterKey = "sportCode" | "venue" | "opponent" | "site";
type FilterState = Record<FilterKey, string>;
type RankedPerson = {
  person: TeamScoreboardPerson;
  metrics: TeamScoreboardPersonSummary;
};

const ALL_FILTERS = "__all__";
const EMPTY_FILTERS: FilterState = {
  sportCode: ALL_FILTERS,
  venue: ALL_FILTERS,
  opponent: ALL_FILTERS,
  site: ALL_FILTERS,
};

function scoreboardUrl(filters: FilterState): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== ALL_FILTERS) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `/api/scoreboard?${serialized}` : "/api/scoreboard";
}

function compareRankedPeople(
  a: RankedPerson,
  b: RankedPerson,
  sort: SortKey,
  minimumRateGames: number,
): number {
  if (sort === "events") {
    const delta = b.metrics.eventsWorked - a.metrics.eventsWorked;
    if (delta) return delta;
  } else if (sort === "wins") {
    const delta = b.metrics.wins - a.metrics.wins;
    if (delta) return delta;
  } else {
    const aEligible = a.metrics.games >= minimumRateGames && a.metrics.winRate !== null;
    const bEligible = b.metrics.games >= minimumRateGames && b.metrics.winRate !== null;
    if (aEligible !== bEligible) return bEligible ? 1 : -1;
    if (aEligible && bEligible) {
      const delta = (b.metrics.winRate ?? 0) - (a.metrics.winRate ?? 0);
      if (delta) return delta;
    }
  }

  return b.metrics.games - a.metrics.games
    || b.metrics.wins - a.metrics.wins
    || b.metrics.eventsWorked - a.metrics.eventsWorked
    || a.person.name.localeCompare(b.person.name)
    || a.person.userId.localeCompare(b.person.userId);
}

function rankTone(rank: number): string {
  if (rank === 1) return "border-[var(--orange-border)] bg-[var(--orange-bg)] text-[var(--orange-text)]";
  if (rank === 2) return "border-border bg-muted text-foreground";
  if (rank === 3) return "border-[var(--red-border)] bg-[var(--red-bg)] text-[var(--red-text)]";
  return "border-transparent bg-transparent text-muted-foreground";
}

function RankMark({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
        rankTone(rank),
      )}
      aria-label={`Rank ${rank}`}
    >
      {rank === 1 ? <Trophy className="size-3.5" aria-hidden="true" /> : rank}
    </span>
  );
}

function LeaderboardTable({
  minimumRateGames,
  rows,
}: {
  minimumRateGames: number;
  rows: RankedPerson[];
}) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableCaption className="sr-only">
            Per-person Scoreboard rankings. Open a name to view that person&apos;s shared Scoreboard.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Rank</TableHead>
              <TableHead>Person</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Record</TableHead>
              <TableHead className="text-right">Win rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ person, metrics }, index) => {
              const rank = index + 1;
              const rateIsRankEligible = metrics.games >= minimumRateGames;
              return (
                <TableRow key={person.userId}>
                  <TableCell><RankMark rank={rank} /></TableCell>
                  <TableCell>
                    <Link
                      prefetch={false}
                      href={`/scoreboard/${person.userId}`}
                      className="inline-flex items-center gap-2.5 rounded-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="md" />
                      <span className="brand-identity">{person.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{metrics.eventsWorked}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{recordLabel(metrics)}</TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", !rateIsRankEligible && "text-muted-foreground")}
                    title={rateIsRankEligible ? undefined : `Needs ${minimumRateGames} resolved games for win-rate ranking`}
                  >
                    {rateLabel(metrics.winRate)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y md:hidden">
        {rows.map(({ person, metrics }, index) => (
          <Link
            key={person.userId}
            prefetch={false}
            href={`/scoreboard/${person.userId}`}
            className="flex min-h-20 items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <RankMark rank={index + 1} />
            <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="brand-identity truncate text-sm font-semibold">{person.name}</p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {metrics.eventsWorked} {metrics.eventsWorked === 1 ? "event" : "events"} · {recordLabel(metrics)} record · {rateLabel(metrics.winRate)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function ScoreboardFilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: TeamScoreboardFacet[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-full bg-background" aria-label={`Filter Scoreboard by ${label.toLowerCase()}`}>
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent className="max-h-[320px]">
          <SelectItem value={ALL_FILTERS}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function BreakdownRows({
  rows,
  selectedValue,
  onSelect,
  emptyTitle,
  emptyDescription,
}: {
  rows: TeamScoreboardBreakdown[];
  selectedValue: string;
  onSelect: (value: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) {
    return (
      <ReportEmptyState
        compact
        icon="calendar"
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="divide-y">
      {rows.map((row) => {
        const value = row.key;
        const selected = value !== null && selectedValue === value;
        const interactive = value !== null;
        return (
          <button
            key={`${value ?? "__unknown__"}-${row.label}`}
            type="button"
            onClick={() => value && onSelect(selected ? ALL_FILTERS : value)}
            aria-pressed={selected}
            disabled={!interactive}
            className={cn(
              "relative flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selected && "bg-muted/45 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-[var(--wi-red)]",
              !interactive && "cursor-default hover:bg-transparent",
            )}
          >
            <span className="min-w-0">
              <span className="brand-identity block truncate text-sm font-semibold">{row.label}</span>
              <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                {row.eventsCovered} {row.eventsCovered === 1 ? "event" : "events"} · {row.contributors} {row.contributors === 1 ? "person" : "people"}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums">{recordLabel(row)}</span>
              <span className="block text-xs tabular-nums text-muted-foreground">{rateLabel(row.winRate)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function TeamScoreboardClient() {
  const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS });
  const [sort, setSort] = useState<SortKey>("events");
  const [clock, setClock] = useState(() => new Date());
  const apiUrl = useMemo(() => scoreboardUrl(filters), [filters]);
  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<TeamScoreboard>({
    url: apiUrl,
    returnTo: "/scoreboard",
    refetchOnFocus: false,
    keepPreviousData: true,
  });

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!error || !data) return;
    const lastLoadedFilters: FilterState = {
      sportCode: data.filters?.sportCode ?? ALL_FILTERS,
      venue: data.filters?.venue ?? ALL_FILTERS,
      opponent: data.filters?.opponent ?? ALL_FILTERS,
      site: data.filters?.site ?? ALL_FILTERS,
    };
    if (scoreboardUrl(lastLoadedFilters) !== apiUrl) setFilters(lastLoadedFilters);
  }, [apiUrl, data, error]);

  const rankedPeople = useMemo(() => {
    if (!data) return [];
    return data.leaderboard
      .map((person): RankedPerson => ({ person, metrics: person.summary }))
      .sort((a, b) => compareRankedPeople(a, b, sort, data.methodology.minimumGamesForWinRate));
  }, [data, sort]);
  const eventLeader = useMemo(() => {
    if (!data) return null;
    return data.leaderboard
      .map((person): RankedPerson => ({ person, metrics: person.summary }))
      .sort((a, b) => compareRankedPeople(a, b, "events", data.methodology.minimumGamesForWinRate))[0] ?? null;
  }, [data]);

  if (loading && !data) return <ReportLoadingState metricCount={4} rows={8} />;

  if (error && !data) {
    return <ReportErrorState error={error} onRetry={reload} title="Scoreboard unavailable" />;
  }

  if (!data) return null;

  const facets = {
    sportCode: data.facets?.sports ?? [],
    venue: data.facets?.venues ?? [],
    opponent: data.facets?.opponents ?? [],
    site: data.facets?.sites ?? [],
  };
  const setFilter = (key: FilterKey, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const filterDefinitions: Array<{
    key: FilterKey;
    label: string;
    allLabel: string;
    options: TeamScoreboardFacet[];
  }> = [
    { key: "sportCode", label: "Sport", allLabel: "All sports", options: facets.sportCode },
    { key: "venue", label: "Venue", allLabel: "All venues", options: facets.venue },
    { key: "opponent", label: "Opponent", allLabel: "All opponents", options: facets.opponent },
    { key: "site", label: "Site", allLabel: "All sites", options: facets.site },
  ];
  const activeFilters: OperationalActiveFilter[] = filterDefinitions.flatMap((definition) => {
    const value = filters[definition.key];
    if (value === ALL_FILTERS) return [];
    const optionLabel = definition.options.find((option) => option.key === value)?.label ?? value;
    return [{
      key: definition.key,
      label: `${definition.label}: ${optionLabel}`,
      onRemove: () => setFilter(definition.key, ALL_FILTERS),
    }];
  });
  const activeFilterCount = activeFilters.length;
  const scopeLabel = activeFilterCount > 0
    ? activeFilters.map((filter) => filter.label.replace(/^[^:]+:\s*/, "")).join(" · ")
    : "All events";
  const selectedTotals = data.summary;
  const optionLabel = (key: FilterKey) => {
    const value = filters[key];
    return value === ALL_FILTERS
      ? null
      : filterDefinitions.find((definition) => definition.key === key)
          ?.options.find((option) => option.key === value)?.label ?? value;
  };
  const snapshotParts = [
    optionLabel("sportCode"),
    optionLabel("venue") ? `At ${optionLabel("venue")}` : null,
    optionLabel("opponent") ? `Against ${optionLabel("opponent")}` : null,
    optionLabel("site") ? `${optionLabel("site")} events` : null,
  ].filter((part): part is string => Boolean(part));
  const snapshotTitle = snapshotParts.length > 0
    ? snapshotParts.join(" · ")
    : "All events, one shared Scoreboard";

  return (
    <FadeUp>
      <div className="flex flex-col gap-4">
        <OperationalToolbar className="border border-border/60 bg-card/60 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="brand-identity text-sm font-semibold">Explore the Scoreboard</p>
                {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount} active</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sport, venue, opponent, and site combine to filter every total and ranking below.
              </p>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
              <Badge variant="secondary">Current season</Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    onClick={reload}
                    aria-label="Refresh Scoreboard"
                  >
                    <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), clock)}` : "Refresh Scoreboard"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {filterDefinitions.map((definition) => (
              <ScoreboardFilterSelect
                key={definition.key}
                label={definition.label}
                allLabel={definition.allLabel}
                value={filters[definition.key]}
                options={definition.options}
                onChange={(value) => setFilter(definition.key, value)}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-border/50 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Rank by</span>
              <ToggleGroup
                type="single"
                value={sort}
                onValueChange={(value) => value && setSort(value as SortKey)}
                aria-label="Rank leaderboard"
              >
                <ToggleGroupItem value="events" className="h-10 text-xs">Events</ToggleGroupItem>
                <ToggleGroupItem value="wins" className="h-10 text-xs">Wins</ToggleGroupItem>
                <ToggleGroupItem value="rate" className="h-10 text-xs">Win rate</ToggleGroupItem>
              </ToggleGroup>
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 self-start sm:self-auto"
                onClick={() => setFilters({ ...EMPTY_FILTERS })}
              >
                Clear filters
              </Button>
            )}
          </div>

          <OperationalActiveFilterChips filters={activeFilters} />
        </OperationalToolbar>

        <ReportDataRegion refreshing={refreshing}>
          <ReportMetricGrid>
            <MetricCard
              value={selectedTotals.eventsCovered}
              label="Events covered"
              helper="Unique completed events"
              tooltip={data.methodology.eventsCovered}
            />
            <MetricCard
              value={recordLabel(selectedTotals)}
              label="Team record"
              helper={`${selectedTotals.games} unique resolved ${selectedTotals.games === 1 ? "game" : "games"} · ${rateLabel(selectedTotals.winRate)}`}
              tooltip={data.methodology.record}
            />
            <MetricCard
              value={selectedTotals.eventCredits}
              label="Work credits"
              helper={`${selectedTotals.gameCredits} person-game record credits`}
              tooltip={`${data.methodology.eventCredits} ${data.methodology.gameCredits}`}
            />
            <MetricCard
              value={selectedTotals.contributors}
              label="Contributors"
              helper={scopeLabel}
              tooltip="Active, visible people with at least one event or record credit in this scope."
            />
          </ReportMetricGrid>

          <Card className="mt-4 border-[var(--orange-border)] bg-[var(--orange-bg)] p-4 shadow-xs">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-background/75 text-[var(--orange-text)]">
                  <Sparkles className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--orange-text)]">Snapshot</p>
                  <p className="brand-identity mt-0.5 text-base font-semibold text-balance">{snapshotTitle}</p>
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {selectedTotals.eventsCovered} {selectedTotals.eventsCovered === 1 ? "event" : "events"} · {recordLabel(selectedTotals)} record · {selectedTotals.contributors} {selectedTotals.contributors === 1 ? "contributor" : "contributors"}
                  </p>
                </div>
              </div>

              {eventLeader && (
                <Link
                  prefetch={false}
                  href={`/scoreboard/${eventLeader.person.userId}`}
                  className="flex min-w-56 items-center gap-2.5 rounded-lg border border-[var(--orange-border)] bg-background/70 px-3 py-2.5 no-underline transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <UserAvatar name={eventLeader.person.name} avatarUrl={eventLeader.person.avatarUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block text-xs text-muted-foreground">Most events</span>
                    <span className="brand-identity block truncate text-sm font-semibold">{eventLeader.person.name}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
                    {eventLeader.metrics.eventsWorked}
                  </span>
                </Link>
              )}
            </div>
          </Card>

          <ReportSectionCard
            title="Leaderboard"
            description={sort === "rate"
              ? `Win-rate ranking requires at least ${data.methodology.minimumGamesForWinRate} resolved games.`
              : `${rankedPeople.length} ${rankedPeople.length === 1 ? "person" : "people"} · ${scopeLabel}`}
            contentClassName="p-0"
          >
            {rankedPeople.length > 0 ? (
              <LeaderboardTable
                rows={rankedPeople}
                minimumRateGames={data.methodology.minimumGamesForWinRate}
              />
            ) : (
              <ReportEmptyState
                icon="users"
                title={activeFilterCount > 0 ? "No matching Scoreboard results" : "No Scoreboard credits yet"}
                description={activeFilterCount > 0
                  ? "Remove one filter or clear the stack to broaden the results."
                  : "People appear here after they work an eligible Schedule event."}
              />
            )}
          </ReportSectionCard>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            <ReportSectionCard
              title="By sport"
              description="Select a row to stack its sport with the current filters."
              contentClassName="p-0"
            >
              <BreakdownRows
                rows={data.bySport ?? []}
                selectedValue={filters.sportCode}
                onSelect={(value) => setFilter("sportCode", value)}
                emptyTitle="No sport results"
                emptyDescription="No sport has work or record credits in this filter stack."
              />
            </ReportSectionCard>

            <ReportSectionCard
              title="At venues"
              description="Records and coverage at each venue in the current stack."
              contentClassName="p-0"
            >
              <BreakdownRows
                rows={data.byVenue ?? []}
                selectedValue={filters.venue}
                onSelect={(value) => setFilter("venue", value)}
                emptyTitle="No venue results"
                emptyDescription="No venue is represented in this filter stack."
              />
            </ReportSectionCard>

            <ReportSectionCard
              title="Against teams"
              description="Records and coverage against each opponent in the current stack."
              contentClassName="p-0"
            >
              <BreakdownRows
                rows={data.byOpponent ?? []}
                selectedValue={filters.opponent}
                onSelect={(value) => setFilter("opponent", value)}
                emptyTitle="No opponent results"
                emptyDescription="No opponent is represented in this filter stack."
              />
            </ReportSectionCard>

            <ReportSectionCard
              title="By site"
              description="Compare Home, Away, and Neutral work without changing the other filters."
              contentClassName="p-0"
            >
              <BreakdownRows
                rows={data.bySite ?? []}
                selectedValue={filters.site}
                onSelect={(value) => setFilter("site", value)}
                emptyTitle="No site results"
                emptyDescription="No Home, Away, or Neutral events match this filter stack."
              />
            </ReportSectionCard>
          </div>

          <p className="mt-4 max-w-4xl text-xs leading-relaxed text-muted-foreground">
            {data.methodology.eventsCovered} {data.methodology.eventCredits} {data.methodology.record} {data.methodology.gameCredits}
          </p>
        </ReportDataRegion>
      </div>
    </FadeUp>
  );
}
