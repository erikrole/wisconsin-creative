"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw, Sparkles } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { UserAvatar } from "@/components/UserAvatar";
import {
  OperationalActiveFilterChips,
  OperationalToolbar,
  type OperationalActiveFilter,
} from "@/components/OperationalToolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FadeUp } from "@/components/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BucketBar, RankMark, RecordMeter, ScoreboardDataRegion } from "@/components/scoreboard/ScoreboardVisuals";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFetch } from "@/hooks/use-fetch";
import { formatRelativeTime } from "@/lib/format";
import { rateLabel, recordLabel } from "@/lib/scoreboard-digest";
import {
  EMPTY_TEAM_SCOREBOARD_FILTERS,
  SCOREBOARD_ALL_FILTER,
  filtersFromTeamScoreboardResponse,
  parseTeamScoreboardFilters,
  parseTeamScoreboardSort,
  personScoreboardPath,
  scoreboardPersonMatches,
  teamScoreboardApiUrl,
  teamScoreboardFiltersEqual,
  writeTeamScoreboardSearchParams,
  type TeamScoreboardFilterKey,
  type TeamScoreboardFilterState,
  type TeamScoreboardSortKey,
} from "@/lib/scoreboard-explorer";
import type {
  TeamScoreboard,
  TeamScoreboardBreakdown,
  TeamScoreboardFacet,
  TeamScoreboardPerson,
  TeamScoreboardPersonSummary,
} from "@/lib/services/team-scoreboard";
import { cn } from "@/lib/utils";
import { ReportSectionCard } from "../reports/report-ui";

type SortKey = TeamScoreboardSortKey;
type FilterKey = TeamScoreboardFilterKey;
type FilterState = TeamScoreboardFilterState;
type RankedPerson = {
  person: TeamScoreboardPerson;
  metrics: TeamScoreboardPersonSummary;
  rank: number;
};

const ALL_FILTERS = SCOREBOARD_ALL_FILTER;
const EMPTY_FILTERS = EMPTY_TEAM_SCOREBOARD_FILTERS;
const BREAKDOWN_COLLAPSED_ROWS = 8;

function scoreboardUrl(filters: FilterState): string {
  return teamScoreboardApiUrl(filters);
}

function ordinal(rank: number): string {
  const remainder = rank % 100;
  if (remainder >= 11 && remainder <= 13) return `${rank}th`;
  if (rank % 10 === 1) return `${rank}st`;
  if (rank % 10 === 2) return `${rank}nd`;
  if (rank % 10 === 3) return `${rank}rd`;
  return `${rank}th`;
}

function compareRankedPeople(
  a: Pick<RankedPerson, "person" | "metrics">,
  b: Pick<RankedPerson, "person" | "metrics">,
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

function useTeamScoreboardExplorerState() {
  const searchParams = useSearchParams();
  const searchSignature = searchParams.toString();
  const lastObservedSearchRef = useRef(searchSignature);
  const skipNextWriteRef = useRef(false);
  const [filters, setFilters] = useState<FilterState>(() => parseTeamScoreboardFilters(searchParams));
  const [sort, setSort] = useState<SortKey>(() => parseTeamScoreboardSort(searchParams));

  useEffect(() => {
    if (lastObservedSearchRef.current === searchSignature) return;
    lastObservedSearchRef.current = searchSignature;
    skipNextWriteRef.current = true;
    setFilters(parseTeamScoreboardFilters(searchParams));
    setSort(parseTeamScoreboardSort(searchParams));
  }, [searchParams, searchSignature]);

  useEffect(() => {
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      return;
    }
    const url = new URL(window.location.href);
    writeTeamScoreboardSearchParams(url.searchParams, filters, sort);
    const next = url.searchParams.toString()
      ? `${url.pathname}?${url.searchParams.toString()}`
      : url.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [filters, sort]);

  return { filters, setFilters, sort, setSort };
}

function ScoreboardLoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <Skeleton className="h-10 w-full max-w-sm" />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((slot) => <Skeleton key={slot} className="h-10 w-full" />)}
        </div>
      </div>
      <div className="rounded-xl border p-5 sm:p-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-10 w-36" />
        <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((slot) => <Skeleton key={slot} className="h-12 w-full" />)}
        </div>
      </div>
      <div className="rounded-xl border p-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => <Skeleton key={row} className="my-2 h-12 w-full" />)}
      </div>
    </div>
  );
}

function ScoreboardErrorState({ error, onRetry }: { error: string | false; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Scoreboard unavailable</AlertTitle>
      <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p>
          {error === "network"
            ? "Couldn’t reach the server. Check the connection and try again."
            : "The shared Scoreboard could not be loaded."}
        </p>
        <Button variant="outline" onClick={onRetry} className="h-10 w-fit">Retry</Button>
      </AlertDescription>
    </Alert>
  );
}

function LeaderboardTable({
  currentUserId,
  hrefForPerson,
  minimumRateGames,
  rows,
  showRateEligibility,
}: {
  currentUserId: string | null;
  hrefForPerson: (userId: string) => string;
  minimumRateGames: number;
  rows: RankedPerson[];
  showRateEligibility: boolean;
}) {
  return (
    <>
      <div className="hidden md:block">
        <div
          role="table"
          aria-label="Per-person Scoreboard rankings. Open a name to view that person's shared Scoreboard."
        >
          <div
            role="row"
            className="grid grid-cols-[4rem_minmax(0,1fr)_5.5rem_6rem_7rem] border-b bg-muted/30 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <span role="columnheader" className="flex h-10 items-center">Rank</span>
            <span role="columnheader" className="flex h-10 items-center">Person</span>
            <span role="columnheader" className="flex h-10 items-center justify-end">Events</span>
            <span role="columnheader" className="flex h-10 items-center justify-end">Record</span>
            <span role="columnheader" className="flex h-10 items-center justify-end">Win rate</span>
          </div>
          {rows.map(({ person, metrics, rank }) => {
            const rateIsRankEligible = metrics.games >= minimumRateGames;
            const showEligibility = showRateEligibility && !rateIsRankEligible;
            const isYou = currentUserId === person.userId;
            return (
              <Link
                key={person.userId}
                data-scoreboard-person={person.userId}
                prefetch={false}
                href={hrefForPerson(person.userId)}
                role="row"
                className={cn(
                  "grid min-h-14 grid-cols-[4rem_minmax(0,1fr)_5.5rem_6rem_7rem] items-center border-b px-4 no-underline last:border-b-0 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isYou && "bg-muted/40",
                )}
              >
                <span role="cell"><RankMark rank={rank} /></span>
                <span role="cell" className="flex min-w-0 items-center gap-2.5">
                  <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="md" />
                  <span className="brand-identity truncate font-medium text-foreground">{person.name}</span>
                  {isYou ? <Badge variant="secondary" size="sm">You</Badge> : null}
                </span>
                <span role="cell" className="text-right font-semibold tabular-nums">{metrics.eventsWorked}</span>
                <span role="cell" className="text-right font-semibold tabular-nums">{recordLabel(metrics)}</span>
                <span
                  role="cell"
                  className={cn("text-right tabular-nums", showEligibility && "text-muted-foreground")}
                >
                  <span className="block">{rateLabel(metrics.winRate)}</span>
                  {showEligibility ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      Min. {minimumRateGames} games
                    </span>
                  ) : null}
                  {showEligibility ? (
                    <span className="sr-only">{`Needs ${minimumRateGames} resolved games for win-rate ranking`}</span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="divide-y md:hidden">
        {rows.map(({ person, metrics, rank }) => {
          const isYou = currentUserId === person.userId;
          return (
            <Link
              key={person.userId}
              data-scoreboard-person={person.userId}
              prefetch={false}
              href={hrefForPerson(person.userId)}
              className={cn(
                "flex min-h-20 items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isYou && "bg-muted/40",
              )}
            >
              <RankMark rank={rank} />
              <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="brand-identity truncate text-sm font-semibold">{person.name}</span>
                  {isYou ? <Badge variant="secondary" size="sm">You</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {metrics.eventsWorked} {metrics.eventsWorked === 1 ? "event" : "events"} · {recordLabel(metrics)} record · {rateLabel(metrics.winRate)}
                </p>
              </div>
            </Link>
          );
        })}
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
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, BREAKDOWN_COLLAPSED_ROWS);
  const maxGames = rows.reduce((max, row) => Math.max(max, row.games), 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon="calendar"
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <>
      <div className="divide-y">
        {visible.map((row) => {
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
              <span className="min-w-0 flex-1">
                <span className="brand-identity block truncate text-sm font-semibold">{row.label}</span>
                <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                  {row.eventsCovered} {row.eventsCovered === 1 ? "event" : "events"} · {row.contributors} {row.contributors === 1 ? "person" : "people"}
                </span>
                <BucketBar row={row} maxGames={maxGames} />
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums">{recordLabel(row)}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">{rateLabel(row.winRate)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {rows.length > BREAKDOWN_COLLAPSED_ROWS ? (
        <div className="border-t border-border/40">
          <Button
            variant="ghost"
            className="h-10 w-full rounded-none text-xs"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show fewer" : `Show all ${rows.length}`}
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function TeamScoreboardExplorer() {
  const { data: currentUser } = useCurrentUser();
  const { filters, setFilters, sort, setSort } = useTeamScoreboardExplorerState();
  const [query, setQuery] = useState("");
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
    const lastLoadedFilters = filtersFromTeamScoreboardResponse(data.filters);
    if (!teamScoreboardFiltersEqual(lastLoadedFilters, filters)) setFilters(lastLoadedFilters);
  }, [data, error, filters, setFilters]);

  const rankedPeople = useMemo(() => {
    if (!data) return [];
    return data.leaderboard
      .map((person) => ({ person, metrics: person.summary }))
      .sort((a, b) => compareRankedPeople(a, b, sort, data.methodology.minimumGamesForWinRate))
      .map((row, index): RankedPerson => ({ ...row, rank: index + 1 }));
  }, [data, sort]);
  const visiblePeople = useMemo(
    () => rankedPeople.filter((row) => scoreboardPersonMatches(row.person.name, query)),
    [query, rankedPeople],
  );
  const eventLeader = useMemo(() => {
    if (!data) return null;
    return data.leaderboard
      .map((person) => ({ person, metrics: person.summary }))
      .sort((a, b) => compareRankedPeople(a, b, "events", data.methodology.minimumGamesForWinRate))[0] ?? null;
  }, [data]);
  const currentUserId = currentUser?.id ?? null;
  const yourStanding = currentUserId
    ? rankedPeople.find((row) => row.person.userId === currentUserId) ?? null
    : null;

  if (loading && !data) return <ScoreboardLoadingState />;

  if (error && !data) {
    return <ScoreboardErrorState error={error} onRetry={reload} />;
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
  const loadedFilters = filtersFromTeamScoreboardResponse(data.filters);
  const loadedOptionLabel = (key: FilterKey) => {
    const value = loadedFilters[key];
    return value === ALL_FILTERS
      ? null
      : filterDefinitions.find((definition) => definition.key === key)
          ?.options.find((option) => option.key === value)?.label ?? value;
  };
  const scopeLabel = [
    loadedOptionLabel("sportCode"),
    loadedOptionLabel("venue"),
    loadedOptionLabel("opponent"),
    loadedOptionLabel("site"),
  ].filter((part): part is string => Boolean(part)).join(" · ") || "All events";
  const selectedTotals = data.summary;
  const snapshotParts = [
    loadedOptionLabel("sportCode"),
    loadedOptionLabel("venue") ? `At ${loadedOptionLabel("venue")}` : null,
    loadedOptionLabel("opponent") ? `Against ${loadedOptionLabel("opponent")}` : null,
    loadedOptionLabel("site") ? `${loadedOptionLabel("site")} events` : null,
  ].filter((part): part is string => Boolean(part));
  const snapshotTitle = snapshotParts.length > 0
    ? snapshotParts.join(" · ")
    : "All events, one shared Scoreboard";
  const hasSearch = query.trim().length > 0;
  const revealYou = () => {
    if (!currentUserId) return;
    setQuery("");
    window.requestAnimationFrame(() => {
      const targets = document.querySelectorAll<HTMLElement>(`[data-scoreboard-person="${currentUserId}"]`);
      const visible = [...targets].find((node) => node.getClientRects().length > 0) ?? targets[0];
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      visible?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    });
  };

  return (
    <FadeUp>
      <div className="flex flex-col gap-4">
        <OperationalToolbar>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <DebouncedSearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Find a person"
              aria-label="Find a person on the Scoreboard"
              containerClassName="w-full max-w-sm"
            />
            <div className="flex shrink-0 items-center justify-between gap-2 lg:justify-end">
              <Badge variant="secondary">{data.scope.label}</Badge>
              {yourStanding ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10"
                  onClick={revealYou}
                  aria-label={`Jump to your Scoreboard standing, ${ordinal(yourStanding.rank)}`}
                >
                  You’re {ordinal(yourStanding.rank)}
                </Button>
              ) : null}
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

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Sport, venue, opponent, and site combine to filter every total and ranking below.
            </p>
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

        <ScoreboardDataRegion refreshing={refreshing}>
          <Card className="p-5 shadow-xs sm:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Team record
                  </p>
                  <div className="mt-1.5 flex items-baseline gap-3">
                    <p className="text-4xl font-bold tracking-tight tabular-nums">{recordLabel(selectedTotals)}</p>
                    <span className="text-sm text-muted-foreground">{scopeLabel}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold tabular-nums">{rateLabel(selectedTotals.winRate)}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Win rate</p>
                </div>
              </div>

              <RecordMeter wins={selectedTotals.wins} losses={selectedTotals.losses} ties={selectedTotals.ties} />

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Events covered</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{selectedTotals.eventsCovered}</p>
                  <p className="text-xs text-muted-foreground">Unique completed events</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Work credits</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{selectedTotals.eventCredits}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedTotals.gameCredits} person-game record credits
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contributors</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{selectedTotals.contributors}</p>
                  <p className="text-xs text-muted-foreground">People with work in this view</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Sparkles className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Snapshot</p>
                    <p className="brand-identity mt-0.5 text-base font-semibold text-balance">{snapshotTitle}</p>
                    <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                      {selectedTotals.eventsCovered} {selectedTotals.eventsCovered === 1 ? "event" : "events"} · {recordLabel(selectedTotals)} record · {selectedTotals.contributors} {selectedTotals.contributors === 1 ? "contributor" : "contributors"}
                    </p>
                  </div>
                </div>

                {eventLeader && (
                  <Link
                    prefetch={false}
                    href={personScoreboardPath(eventLeader.person.userId, filters, sort)}
                    className="flex min-w-56 items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 no-underline transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            </div>
          </Card>

          <ReportSectionCard
            title="Leaderboard"
            description={sort === "rate"
              ? `${hasSearch
                ? `${visiblePeople.length} ${visiblePeople.length === 1 ? "match" : "matches"}`
                : `${rankedPeople.length} ${rankedPeople.length === 1 ? "person" : "people"}`} · win-rate ranking needs ${data.methodology.minimumGamesForWinRate} resolved games`
              : `${hasSearch
                ? `${visiblePeople.length} ${visiblePeople.length === 1 ? "match" : "matches"}`
                : `${rankedPeople.length} ${rankedPeople.length === 1 ? "person" : "people"}`} · ${scopeLabel}`}
            contentClassName="p-0"
          >
            <div className="flex flex-col gap-2 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
              {hasSearch ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {visiblePeople.length} of {rankedPeople.length}
                </p>
              ) : null}
            </div>
            {rankedPeople.length === 0 ? (
              <EmptyState
                icon="users"
                title={activeFilterCount > 0 ? "No matching Scoreboard results" : "No Scoreboard credits yet"}
                description={activeFilterCount > 0
                  ? "Remove one filter or clear the stack to broaden the results."
                  : "People appear here after they work an eligible Schedule event."}
                actionLabel={activeFilterCount > 0 ? "Clear filters" : undefined}
                onAction={activeFilterCount > 0 ? () => setFilters({ ...EMPTY_FILTERS }) : undefined}
              />
            ) : visiblePeople.length === 0 ? (
              <EmptyState
                icon="search"
                title="No matching people"
                description="The current leaderboard has no name that matches this search."
                actionLabel="Clear search"
                onAction={() => setQuery("")}
              />
            ) : (
              <LeaderboardTable
                rows={visiblePeople}
                hrefForPerson={(userId) => personScoreboardPath(userId, filters, sort)}
                minimumRateGames={data.methodology.minimumGamesForWinRate}
                currentUserId={currentUserId}
                showRateEligibility={sort === "rate"}
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

          <Collapsible className="mt-4">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="h-10 px-0 text-xs text-muted-foreground">
                How these numbers count
                <ChevronDown className="size-3.5" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 max-w-4xl list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                <li>{data.methodology.eventsCovered}</li>
                <li>{data.methodology.eventCredits}</li>
                <li>{data.methodology.record}</li>
                <li>{data.methodology.gameCredits}</li>
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </ScoreboardDataRegion>
      </div>
    </FadeUp>
  );
}

export default function TeamScoreboardClient() {
  return (
    <Suspense fallback={<ScoreboardLoadingState />}>
      <TeamScoreboardExplorer />
    </Suspense>
  );
}
