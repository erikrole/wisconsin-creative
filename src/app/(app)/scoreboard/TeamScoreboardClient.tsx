"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Info, RefreshCw, SlidersHorizontal } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import {
  OperationalActiveFilterChips,
  type OperationalActiveFilter,
} from "@/components/OperationalToolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FadeUp } from "@/components/ui/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { CountUp } from "@/components/scoreboard/CountUp";
import { RecordMeter, ScoreboardDataRegion } from "@/components/scoreboard/ScoreboardVisuals";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFetch } from "@/hooks/use-fetch";
import { formatRelativeTime } from "@/lib/format";
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
import { scoreboardFunFacts, type ScoreboardFunFact } from "@/lib/scoreboard-fun-facts";
import type { TeamScoreboard, TeamScoreboardFacet } from "@/lib/services/team-scoreboard";
import { cn } from "@/lib/utils";
import { ScoreboardCompare } from "./ScoreboardCompare";
import { ScoreboardExplore } from "./ScoreboardExplore";
import { ScoreboardFunFacts } from "./ScoreboardFunFacts";
import { WrappedBanner } from "./WrappedBanner";
import { ScoreboardLeaderboard, type RankedPerson } from "./ScoreboardLeaderboard";

type SortKey = TeamScoreboardSortKey;
type FilterKey = TeamScoreboardFilterKey;
type FilterState = TeamScoreboardFilterState;

const ALL_FILTERS = SCOREBOARD_ALL_FILTER;
const EMPTY_FILTERS = EMPTY_TEAM_SCOREBOARD_FILTERS;

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
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-12 w-48" />
        <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((slot) => <Skeleton key={slot} className="h-28 w-full rounded-xl" />)}
      </div>
      <div className="rounded-xl border p-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => <Skeleton key={row} className="my-2 h-14 w-full" />)}
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
      <span className="mb-1.5 block text-xs font-bold text-muted-foreground">{label}</span>
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

function SportChips({
  sports,
  value,
  onChange,
}: {
  sports: TeamScoreboardFacet[];
  value: string;
  onChange: (value: string) => void;
}) {
  const chips = [{ key: ALL_FILTERS, label: "All sports" }, ...sports];
  return (
    <div
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      role="group"
      aria-label="Filter Scoreboard by sport"
    >
      {chips.map((chip) => {
        const selected = value === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(chip.key)}
            className={cn(
              "h-10 shrink-0 rounded-full border px-3.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-foreground bg-foreground text-background"
                : "bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function TeamScoreboardExplorer() {
  const { data: currentUser } = useCurrentUser();
  const { filters, setFilters, sort, setSort } = useTeamScoreboardExplorerState();
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);
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

  const currentUserId = currentUser?.id ?? null;
  const facts = useMemo(() => (data ? scoreboardFunFacts(data, currentUserId) : []), [data, currentUserId]);
  const yourStanding = currentUserId
    ? rankedPeople.find((row) => row.person.userId === currentUserId) ?? null
    : null;

  // Compare starts as you vs the leader, so there is always something to poke at.
  const leaderId = rankedPeople[0]?.person.userId ?? null;
  const defaultCompare: [string | null, string | null] = yourStanding && yourStanding.person.userId !== leaderId
    ? [yourStanding.person.userId, leaderId]
    : [leaderId, rankedPeople[1]?.person.userId ?? null];
  const leaderboardIds = new Set(rankedPeople.map((row) => row.person.userId));
  const activeCompare: [string | null, string | null] = compareIds[0] || compareIds[1]
    ? [
      compareIds[0] && leaderboardIds.has(compareIds[0]) ? compareIds[0] : null,
      compareIds[1] && leaderboardIds.has(compareIds[1]) ? compareIds[1] : null,
    ]
    : defaultCompare;

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
  const moreFilterDefinitions = filterDefinitions.filter((definition) => definition.key !== "sportCode");

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
  const moreFilterCount = moreFilterDefinitions.filter((definition) => filters[definition.key] !== ALL_FILTERS).length;
  const loadedFilters = filtersFromTeamScoreboardResponse(data.filters);
  const loadedOptionLabel = (key: FilterKey) => {
    const value = loadedFilters[key];
    return value === ALL_FILTERS
      ? null
      : filterDefinitions.find((definition) => definition.key === key)
          ?.options.find((option) => option.key === value)?.label ?? value;
  };
  const snapshotParts = [
    loadedOptionLabel("sportCode"),
    loadedOptionLabel("venue") ? `at ${loadedOptionLabel("venue")}` : null,
    loadedOptionLabel("opponent") ? `vs ${loadedOptionLabel("opponent")}` : null,
    loadedOptionLabel("site") ? `${loadedOptionLabel("site")?.toLowerCase()} events` : null,
  ].filter((part): part is string => Boolean(part));
  const snapshotTitle = snapshotParts.length > 0
    ? snapshotParts.join(" · ")
    : "All events, one shared Scoreboard";
  const totals = data.summary;
  const hasSearch = query.trim().length > 0;
  const minimumRateGames = data.methodology.minimumGamesForWinRate;

  const revealPerson = (userId: string) => {
    setQuery("");
    setExpandedId(userId);
    window.requestAnimationFrame(() => {
      const targets = document.querySelectorAll<HTMLElement>(`[data-scoreboard-person="${userId}"]`);
      const visible = [...targets].find((node) => node.getClientRects().length > 0) ?? targets[0];
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      visible?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    });
  };

  const exploreFact = (fact: ScoreboardFunFact) => {
    if (!fact.action) return;
    if (fact.action.type === "person") revealPerson(fact.action.userId);
    else setFilter(fact.action.key, fact.action.value);
  };

  const addToCompare = (userId: string) => {
    const [left, right] = activeCompare;
    if (left === userId || right === userId) {
      setCompareIds([left === userId ? null : left, right === userId ? null : right]);
      return;
    }
    // A new pick replaces the side that isn't you, so "me vs them" stays put.
    if (left && left === currentUserId) setCompareIds([left, userId]);
    else if (!left) setCompareIds([userId, right]);
    else setCompareIds([left, userId]);
    document.getElementById("scoreboard-compare-title")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <FadeUp>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <SportChips sports={facets.sportCode} value={filters.sportCode} onChange={(value) => setFilter("sportCode", value)} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-10">
                    <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                    More filters
                    {moreFilterCount > 0 ? (
                      <span className="ml-0.5 rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-black text-white tabular-nums">{moreFilterCount}</span>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <div className="flex flex-col gap-3">
                    {moreFilterDefinitions.map((definition) => (
                      <ScoreboardFilterSelect
                        key={definition.key}
                        label={definition.label}
                        allLabel={definition.allLabel}
                        value={filters[definition.key]}
                        options={definition.options}
                        onChange={(value) => setFilter(definition.key, value)}
                      />
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Sport, venue, opponent, and site combine to filter every total and ranking.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
              {activeFilterCount > 0 ? (
                <Button variant="ghost" size="sm" className="h-10" onClick={() => setFilters({ ...EMPTY_FILTERS })}>
                  Clear filters
                </Button>
              ) : null}
            </div>
            <DebouncedSearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Find a person"
              aria-label="Find a person on the Scoreboard"
              containerClassName="w-full sm:max-w-64"
            />
          </div>
          <OperationalActiveFilterChips filters={activeFilters} />
        </div>

        <ScoreboardDataRegion refreshing={refreshing}>
          <div className="flex flex-col gap-5">
            <section className="rounded-xl border bg-card p-5 shadow-xs sm:p-6" aria-labelledby="scoreboard-record-title">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 id="scoreboard-record-title" className="text-sm font-bold text-muted-foreground">
                    Team record <span className="font-normal">· {data.scope.label}</span>
                  </h2>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-5xl font-black tracking-tight tabular-nums sm:text-6xl">
                      <CountUp value={totals.wins} />–<CountUp value={totals.losses} />
                      {totals.ties > 0 ? <>–<CountUp value={totals.ties} /></> : null}
                    </span>
                    <span className="text-xl font-black tabular-nums text-[var(--accent)]">
                      {totals.winRate === null ? "—" : <CountUp value={totals.winRate} decimals={1} suffix="%" />}
                    </span>
                  </p>
                  <p className="brand-identity mt-1 text-sm text-muted-foreground" aria-label="Snapshot">{snapshotTitle}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="How these numbers count">
                        <Info className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80">
                      <p className="text-sm font-bold">How these numbers count</p>
                      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                        <li>{data.methodology.eventsCovered}</li>
                        <li>{data.methodology.eventCredits}</li>
                        <li>{data.methodology.record}</li>
                        <li>{data.methodology.gameCredits}</li>
                        <li>{`Win-rate ranking needs ${minimumRateGames} resolved games. A tie counts as half a win.`}</li>
                      </ul>
                    </PopoverContent>
                  </Popover>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-sm" onClick={reload} aria-label="Refresh Scoreboard">
                        <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), clock)}` : "Refresh Scoreboard"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="mt-4">
                <RecordMeter wins={totals.wins} losses={totals.losses} ties={totals.ties} />
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border/70 pt-4">
                <div>
                  <dd className="text-2xl font-black tracking-tight tabular-nums"><CountUp value={totals.eventsCovered} /></dd>
                  <dt className="text-xs text-muted-foreground">Events covered</dt>
                </div>
                <div>
                  <dd className="text-2xl font-black tracking-tight tabular-nums"><CountUp value={totals.contributors} /></dd>
                  <dt className="text-xs text-muted-foreground">Contributors</dt>
                </div>
                <div>
                  <dd className="text-2xl font-black tracking-tight tabular-nums"><CountUp value={totals.eventCredits} /></dd>
                  <dt className="text-xs text-muted-foreground">Work credits</dt>
                </div>
              </dl>
            </section>

            <WrappedBanner now={clock} isAdmin={currentUser?.role === "ADMIN"} />

            <ScoreboardFunFacts facts={facts} onExplore={exploreFact} />

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="rounded-xl border bg-card shadow-xs" aria-labelledby="scoreboard-leaderboard-title">
                <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 id="scoreboard-leaderboard-title" className="text-base font-black tracking-tight">Leaderboard</h2>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {hasSearch
                        ? `${visiblePeople.length} of ${rankedPeople.length} people`
                        : `${rankedPeople.length} ${rankedPeople.length === 1 ? "person" : "people"} · tap anyone to dig in`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {yourStanding ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 font-bold text-[var(--accent)]"
                        onClick={() => revealPerson(yourStanding.person.userId)}
                        aria-label={`Jump to your Scoreboard standing, ${ordinal(yourStanding.rank)}`}
                      >
                        You’re {ordinal(yourStanding.rank)}
                      </Button>
                    ) : null}
                    <ToggleGroup
                      type="single"
                      value={sort}
                      onValueChange={(value) => value && setSort(value as SortKey)}
                      aria-label="Rank leaderboard"
                    >
                      <ToggleGroupItem value="events" className="min-h-8 px-3 text-xs font-bold">Events</ToggleGroupItem>
                      <ToggleGroupItem value="wins" className="min-h-8 px-3 text-xs font-bold">Wins</ToggleGroupItem>
                      <ToggleGroupItem value="rate" className="min-h-8 px-3 text-xs font-bold">Win rate</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>
                {rankedPeople.length === 0 ? (
                  <EmptyState
                    icon="users"
                    title={activeFilterCount > 0 ? "No matching Scoreboard results" : "No Scoreboard credits yet"}
                    description={activeFilterCount > 0
                      ? "Remove one filter or clear them all to broaden the results."
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
                  <ScoreboardLeaderboard
                    rows={visiblePeople}
                    sort={sort}
                    minimumRateGames={minimumRateGames}
                    currentUserId={currentUserId}
                    expandedId={expandedId}
                    compareIds={activeCompare.filter((id): id is string => Boolean(id))}
                    hrefForPerson={(userId) => personScoreboardPath(userId, filters, sort)}
                    onToggle={(userId) => setExpandedId((current) => (current === userId ? null : userId))}
                    onCompare={addToCompare}
                  />
                )}
              </section>

              <div className="flex flex-col gap-5 lg:sticky lg:top-4">
                <ScoreboardCompare
                  people={rankedPeople.map((row) => row.person)}
                  compareIds={activeCompare}
                  onChange={setCompareIds}
                />
                <ScoreboardExplore data={data} filters={filters} onSelect={setFilter} />
              </div>
            </div>
          </div>
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
