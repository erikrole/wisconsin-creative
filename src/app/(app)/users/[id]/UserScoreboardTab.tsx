"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, ChevronDown, ChevronUp, Flag, Home, Route, Trophy } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import {
  classifyError,
  handleAuthRedirect,
  isAbortError,
  parseJsonSafely,
  type FetchErrorKind,
} from "@/lib/errors";
import { formatDateShort } from "@/lib/format";
import {
  currentStreak,
  gamesLabel,
  groupByMonth,
  mergeScoreboardEvents,
  rateLabel,
  recentForm,
  recordLabel,
  scoreboardHighlights,
  totalsSentence,
} from "@/lib/scoreboard-digest";
import { AREA_LABELS } from "@/types/areas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ScoreboardBucket, ScoreboardEvent, UserScoreboard } from "@/lib/services/scoreboard";

type ResultFilter = "all" | "WIN" | "LOSS";
type SportOption = { key: string; label: string };
type ExtraEvents = { requestUrl: string; events: ScoreboardEvent[]; nextCursor: string | null | undefined };

/// Which dimension the breakdown card shows. The route sends all four at once;
/// rendering all four as separate tables put 30-odd rows of the same object
/// between the record and the games.
type Dimension = "sport" | "opponent" | "site" | "venue";

const INITIAL_LIMIT = 25;
const COLLAPSED_ROWS = 5;

const DIMENSIONS: Array<{ value: Dimension; label: string }> = [
  { value: "sport", label: "Sport" },
  { value: "opponent", label: "Opponent" },
  { value: "site", label: "Site" },
  { value: "venue", label: "Venue" },
];

/** Wins are the chart palette's "available" role, losses its "problem" role. */
const WIN_FILL = "var(--chart-2)";
const LOSS_FILL = "var(--chart-5)";

function dimensionRows(scoreboard: UserScoreboard, dimension: Dimension): ScoreboardBucket[] {
  if (dimension === "sport") return scoreboard.bySport;
  if (dimension === "opponent") return scoreboard.byOpponent;
  if (dimension === "site") return scoreboard.bySite;
  return scoreboard.byVenue;
}

function emptyDimensionLabel(dimension: Dimension, isFiltered: boolean): string {
  if (isFiltered) return "No games match these filters.";
  if (dimension === "sport") return "No sports with a resolved game yet.";
  if (dimension === "opponent") return "No opponents with a resolved game yet.";
  if (dimension === "site") return "No home, away, or neutral games yet.";
  return "No venues with a resolved game yet.";
}

function siteLabel(site: ScoreboardEvent["site"]): string {
  if (site === "HOME") return "Home";
  if (site === "AWAY") return "Away";
  if (site === "NEUTRAL") return "Neutral";
  return "Site unknown";
}

/** Where a game was played, readable without parsing the sentence. */
function SiteIcon({ site }: { site: ScoreboardEvent["site"] }) {
  const className = "size-3 shrink-0 text-muted-foreground/70";
  if (site === "HOME") return <Home className={className} aria-hidden="true" />;
  if (site === "AWAY") return <Route className={className} aria-hidden="true" />;
  return <Flag className={className} aria-hidden="true" />;
}

function matchupLabel(event: ScoreboardEvent): string {
  const sport = event.sportLabel ?? "Worked event";
  if (!event.opponent) return sport;
  return `${sport} ${event.site === "AWAY" ? "at" : "vs"} ${event.opponent}`;
}

function areaLabel(area: string): string {
  return AREA_LABELS[area as keyof typeof AREA_LABELS] ?? area;
}

function toSportOptions(buckets: ScoreboardBucket[]): SportOption[] {
  return buckets
    .filter((bucket): bucket is ScoreboardBucket & { key: string } => bucket.key !== null)
    .map((bucket) => ({ key: bucket.key, label: bucket.label }));
}

function resultVariant(result: ScoreboardEvent["result"]): "green" | "red" {
  return result === "WIN" ? "green" : "red";
}

/**
 * The record as a proportion. A number pair tells you the score; the bar tells
 * you the season at a glance, which is the whole job of a scoreboard. A minority
 * segment keeps a floor wide enough to see.
 */
function RecordMeter({ wins, losses }: { wins: number; losses: number }) {
  const games = wins + losses;
  const split = wins > 0 && losses > 0;
  const winShare = games > 0 ? Math.min(Math.max((wins / games) * 100, split ? 10 : 0), split ? 90 : 100) : 0;

  return (
    <div>
      <div className="flex h-2.5 gap-[3px] overflow-hidden" aria-hidden="true">
        {games === 0 ? (
          <div className="h-full w-full rounded-full bg-muted" />
        ) : (
          <>
            {wins > 0 ? (
              <div className="h-full rounded-full" style={{ width: `${winShare}%`, background: WIN_FILL }} />
            ) : null}
            {losses > 0 ? (
              <div className="h-full flex-1 rounded-full" style={{ background: LOSS_FILL }} />
            ) : null}
          </>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="size-[7px] rounded-full" style={{ background: WIN_FILL }} aria-hidden="true" />
          {wins} {wins === 1 ? "win" : "wins"}
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="size-[7px] rounded-full" style={{ background: LOSS_FILL }} aria-hidden="true" />
          {losses} {losses === 1 ? "loss" : "losses"}
        </span>
      </div>
      <span className="sr-only">
        {games === 0 ? "No resolved games yet" : `${wins} of ${games} games won`}
      </span>
    </div>
  );
}

/** Recent form, newest first — the question anyone with a record asks next. */
function FormStrip({ games }: { games: ScoreboardEvent[] }) {
  const streak = currentStreak(games);

  return (
    <div className="flex items-center justify-between gap-4 border-t pt-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Last {games.length}
        </p>
        {streak ? (
          <p
            className="mt-0.5 text-xs font-medium"
            style={{ color: streak.isWin ? "var(--green-text)" : "var(--red-text)" }}
          >
            {streak.label}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {games.map((game) => (
          <Badge key={game.id} variant={resultVariant(game.result)} size="sm" className="w-6 justify-center rounded-md">
            {game.result === "WIN" ? "W" : "L"}
          </Badge>
        ))}
      </div>
      <span className="sr-only">
        Last {games.length} games, newest first: {games.map((game) => (game.result === "WIN" ? "Win" : "Loss")).join(", ")}
        {streak ? `. ${streak.label}.` : ""}
      </span>
    </div>
  );
}

function SeasonCard({
  scoreboard,
  games,
  showsForm,
  isFiltered,
  seasonResolvedGames,
}: {
  scoreboard: UserScoreboard;
  games: ScoreboardEvent[];
  showsForm: boolean;
  isFiltered: boolean;
  seasonResolvedGames: number | null;
}) {
  const form = recentForm(games);
  const sentence = totalsSentence({
    eventsWorked: scoreboard.summary.eventsWorked,
    resolvedGames: scoreboard.summary.games,
    isFiltered,
    seasonResolvedGames,
  });

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {scoreboard.scope.label}
          </p>
          <div className="mt-1.5 flex items-baseline gap-3">
            <p className="text-4xl font-bold tracking-tight tabular-nums">{recordLabel(scoreboard.summary)}</p>
            <span className="text-sm text-muted-foreground">record</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums">{rateLabel(scoreboard.summary.winRate)}</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Win rate</p>
        </div>
      </div>

      <RecordMeter wins={scoreboard.summary.wins} losses={scoreboard.summary.losses} />

      {showsForm && form.length > 0 ? <FormStrip games={form} /> : null}

      <p className="text-xs text-muted-foreground">{sentence}</p>
    </div>
  );
}

function Highlights({ scoreboard }: { scoreboard: UserScoreboard }) {
  const highlights = scoreboardHighlights(scoreboard);
  if (highlights.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {highlights.map((highlight) => (
        <div key={highlight.id} className="rounded-xl border bg-muted/25 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {highlight.label}
          </p>
          <p className="mt-2 truncate text-sm font-semibold" title={highlight.value}>{highlight.value}</p>
          <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">{highlight.detail}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Length is how much of the season this row is; the split inside it is how that
 * went. One mark, both questions.
 */
function BucketBar({ row, maxGames }: { row: ScoreboardBucket; maxGames: number }) {
  const share = maxGames > 0 ? (row.games / maxGames) * 100 : 0;
  const winShare = row.games > 0 ? (row.wins / row.games) * 100 : 0;

  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className="flex h-full" style={{ width: `${Math.max(share, row.games > 0 ? 3 : 0)}%` }}>
        {row.wins > 0 ? <div className="h-full" style={{ width: `${winShare}%`, background: WIN_FILL }} /> : null}
        {row.losses > 0 ? <div className="h-full flex-1" style={{ background: LOSS_FILL }} /> : null}
      </div>
    </div>
  );
}

function BreakdownCard({
  scoreboard,
  isFiltered,
  dimension,
  onDimensionChange,
}: {
  scoreboard: UserScoreboard;
  isFiltered: boolean;
  dimension: Dimension;
  onDimensionChange: (next: Dimension) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = dimensionRows(scoreboard, dimension);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const maxGames = rows.reduce((max, row) => Math.max(max, row.games), 0);

  return (
    <Card elevation="flat" className="overflow-hidden">
      <CardHeader className="border-b border-border/50 px-3 py-3 sm:px-4">
        <ToggleGroup
          type="single"
          value={dimension}
          onValueChange={(value) => {
            if (!value) return;
            setExpanded(false);
            onDimensionChange(value as Dimension);
          }}
          aria-label="Breakdown dimension"
          className="w-full"
        >
          {DIMENSIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="h-10 flex-1 text-xs">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground sm:px-5">
            {emptyDimensionLabel(dimension, isFiltered)}
          </p>
        ) : (
          <>
            <div className="divide-y divide-border/40">
              {visible.map((row) => (
                <div
                  key={`${row.key ?? "unknown"}-${row.label}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm" title={row.label}>{row.label}</p>
                    <BucketBar row={row} maxGames={maxGames} />
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{recordLabel(row)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{rateLabel(row.winRate)}</p>
                    {/* The bar carries volume visually and is aria-hidden, so the
                        row still has to say how many games it covers. */}
                    <span className="sr-only">{gamesLabel(row.games)}</span>
                  </div>
                </div>
              ))}
            </div>
            {rows.length > COLLAPSED_ROWS ? (
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
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({ event, linkEvents }: { event: ScoreboardEvent; linkEvents: boolean }) {
  const areas = event.shiftAreas.map(areaLabel).join(", ");
  const content = (
    <>
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 pt-0.5 text-center">
        <Badge variant={resultVariant(event.result)} size="sm" className="size-7 justify-center rounded-full p-0">
          {event.result === "WIN" ? "W" : "L"}
        </Badge>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatDateShort(event.startsAt, event.allDay)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{matchupLabel(event)}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <SiteIcon site={event.site} />
          <span className="truncate">{siteLabel(event.site)} · {event.venue ?? "Venue not recorded"}</span>
        </p>
        {areas ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{areas}</p> : null}
      </div>
    </>
  );
  const className = "flex min-h-16 items-start gap-3 px-4 py-3 sm:px-5";

  if (!linkEvents) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Link
      href={`/events/${event.id}`}
      className={`${className} transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
    >
      {content}
    </Link>
  );
}

function GamesCard({
  events,
  total,
  hasFilters,
  refreshing,
  nextCursor,
  loadingMore,
  loadMoreError,
  loadMore,
  clearFilters,
  linkEvents,
}: {
  events: ScoreboardEvent[];
  total: number;
  hasFilters: boolean;
  refreshing: boolean;
  nextCursor: string | null | undefined;
  loadingMore: boolean;
  loadMoreError: FetchErrorKind | null;
  loadMore: () => void;
  clearFilters: () => void;
  linkEvents: boolean;
}) {
  const months = groupByMonth(events);

  return (
    <Card elevation="flat" className="overflow-hidden">
      <CardHeader className="border-b border-border/50 px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
            Resolved games
          </CardTitle>
          {refreshing ? (
            <span className="text-xs text-muted-foreground">Refreshing…</span>
          ) : events.length > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {events.length >= total ? events.length : `${events.length} of ${total}`}
            </span>
          ) : null}
        </div>
      </CardHeader>
      {events.length > 0 ? (
        <CardContent className="p-0">
          {months.map((month) => (
            <div key={month.key}>
              {/* A season reads by month; a flat run of rows does not say when the busy stretch was. */}
              <p className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-5">
                {month.label}
              </p>
              <div className="divide-y divide-border/40">
                {month.games.map((event) => <EventRow key={event.id} event={event} linkEvents={linkEvents} />)}
              </div>
            </div>
          ))}
          {nextCursor ? (
            <div className="border-t border-border/40 p-3">
              {loadMoreError ? (
                <div
                  role="alert"
                  className="flex flex-col items-center justify-between gap-2 rounded-md bg-muted/45 px-3 py-2 text-center sm:flex-row sm:text-left"
                >
                  <p className="text-xs text-muted-foreground">
                    {loadMoreError === "network"
                      ? "Couldn’t reach the server. The games already shown are still here."
                      : "Couldn’t load more games. The games already shown are still here."}
                  </p>
                  <Button variant="outline" className="h-10" onClick={loadMore}>Try again</Button>
                </div>
              ) : (
                <div className="text-center">
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={loadMore}
                    disabled={refreshing}
                    loading={loadingMore}
                  >
                    Show more games
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      ) : (
        <CardContent className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Trophy className="size-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium">{hasFilters ? "No games match these filters" : "No resolved games on record"}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {hasFilters
              ? "Try another result or sport filter."
              : "Completed events with a recorded result will appear here when this person has worked them."}
          </p>
          {hasFilters ? (
            <Button variant="ghost" className="h-10" onClick={clearFilters}>Clear filters</Button>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

/** The real layout in grey: a spinner says "wait", this says what is coming. */
function ScoreboardSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border p-5 sm:p-6">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-3 h-9 w-32" />
        <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
        <div className="mt-3 flex justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="mt-5 h-3 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div key={tile} className="rounded-xl border p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((card) => (
          <div key={card} className="rounded-xl border p-4">
            <Skeleton className="h-8 w-full" />
            <div className="mt-4 flex flex-col gap-4">
              {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-9 w-full" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UserScoreboardTab({
  userId,
  returnTo,
  linkEvents = true,
}: {
  userId: string;
  returnTo?: string;
  linkEvents?: boolean;
}) {
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [sportFilter, setSportFilter] = useState("all");
  const [dimension, setDimension] = useState<Dimension>("sport");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<FetchErrorKind | null>(null);
  const [extraEvents, setExtraEvents] = useState<ExtraEvents>({ requestUrl: "", events: [], nextCursor: undefined });
  // The route applies `sportCode` and `result` to its own breakdowns, so the
  // sports in a filtered response are only the ones that survived the filter.
  // Reading the dropdown out of that response collapsed it to the sport already
  // chosen -- and a wins-only read dropped a winless sport entirely, leaving the
  // trigger on its placeholder while a sport filter was still running. Hold the
  // list from an unfiltered read instead, the way the native screen does.
  const [sportOptions, setSportOptions] = useState<SportOption[]>([]);
  // Resolved games in the whole season, kept from an unfiltered read: a filtered
  // response only knows its own subtotal, and the season card has to be able to
  // say what fraction of the season is on screen.
  const [seasonResolvedGames, setSeasonResolvedGames] = useState<number | null>(null);
  const scoreboardReturnTo = returnTo ?? `/users/${userId}?tab=scoreboard`;

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: String(INITIAL_LIMIT) });
    if (resultFilter !== "all") params.set("result", resultFilter);
    if (sportFilter !== "all") params.set("sportCode", sportFilter);
    return `/api/users/${userId}/scoreboard?${params.toString()}`;
  }, [resultFilter, sportFilter, userId]);
  const loadingMoreRef = useRef(false);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const requestUrlRef = useRef(requestUrl);

  const { data, loading, refreshing, error, reload } = useFetch<UserScoreboard>({
    url: requestUrl,
    returnTo: scoreboardReturnTo,
    keepPreviousData: true,
    refetchOnFocus: false,
    transform: (json) => (json.data as UserScoreboard),
  });

  useEffect(() => {
    requestUrlRef.current = requestUrl;
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    setExtraEvents({ requestUrl, events: [], nextCursor: undefined });

    return () => loadMoreAbortRef.current?.abort();
  }, [requestUrl]);

  const isUnfiltered = resultFilter === "all" && sportFilter === "all";

  useEffect(() => {
    // `keepPreviousData` keeps the last response on screen while a changed URL
    // refetches, so a settled read is the only one whose filters are known to
    // match the controls.
    if (!data || !isUnfiltered || loading || refreshing) return;
    const next = toSportOptions(data.bySport);
    // Same sports in the same order means the same list; replacing it would
    // re-render every consumer for nothing.
    const signature = (options: SportOption[]) => options.map((option) => option.key).join("|");
    setSportOptions((current) => (signature(current) === signature(next) ? current : next));
    setSeasonResolvedGames(data.summary.games);
  }, [data, isUnfiltered, loading, refreshing]);

  const isCurrentPage = extraEvents.requestUrl === requestUrl;
  const events = useMemo(
    () => mergeScoreboardEvents(data?.events ?? [], isCurrentPage ? extraEvents.events : []),
    [data?.events, extraEvents.events, isCurrentPage],
  );
  const nextCursor = isCurrentPage && extraEvents.nextCursor !== undefined
    ? extraEvents.nextCursor
    : data?.nextCursor;

  const loadMore = useCallback(async () => {
    if (!nextCursor || refreshing || loadingMoreRef.current) return;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(`${requestUrl}&offset=${encodeURIComponent(nextCursor)}`, {
        signal: controller.signal,
      });
      if (handleAuthRedirect(res, scoreboardReturnTo)) return;
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<{ data?: UserScoreboard }>(res);
      const page = json?.data;
      if (!page) throw new Error("server");
      if (controller.signal.aborted || requestUrlRef.current !== requestUrl) return;
      setExtraEvents((current) => current.requestUrl === requestUrl
        ? {
            requestUrl,
            events: mergeScoreboardEvents(current.events, page.events),
            nextCursor: page.nextCursor,
          }
        : current);
    } catch (caught) {
      if (isAbortError(caught) || requestUrlRef.current !== requestUrl) return;
      setLoadMoreError(classifyError(caught));
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [nextCursor, refreshing, requestUrl, scoreboardReturnTo]);

  const clearFilters = useCallback(() => {
    setResultFilter("all");
    setSportFilter("all");
  }, []);

  if (loading && !data) return <ScoreboardSkeleton />;

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Scoreboard unavailable</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col gap-3">
          <p>We couldn’t load this profile’s worked-game record.</p>
          <Button variant="outline" onClick={reload} className="h-10 w-fit">Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  const hasFilters = resultFilter !== "all" || sportFilter !== "all";
  // With no filter on, this response is the unfiltered read, so the list comes
  // straight from it and the control does not flicker in on first paint.
  const listedSports = isUnfiltered ? toSportOptions(data.bySport) : sportOptions;
  // A selected code the held list does not carry still has to name itself. The
  // trigger falling back to "All sports" would report a filter that is not the
  // one in effect.
  const selectedIsListed = sportFilter === "all" || listedSports.some((option) => option.key === sportFilter);
  const sportChoices: SportOption[] = selectedIsListed
    ? listedSports
    : [...listedSports, { key: sportFilter, label: sportFilter }];

  return (
    <div className="flex flex-col gap-5">
      <SeasonCard
        scoreboard={data}
        games={events}
        // A run of results only means something when every result is eligible;
        // under a Wins filter "last five" is five wins by construction.
        showsForm={resultFilter === "all"}
        isFiltered={hasFilters}
        seasonResolvedGames={seasonResolvedGames}
      />

      {/* Orientation, not analysis: once the reader has narrowed to one sport or
          one result, they are past the point these three facts help with. */}
      {hasFilters ? null : <Highlights scoreboard={data} />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/40 py-2.5">
        <ToggleGroup
          type="single"
          value={resultFilter}
          onValueChange={(value) => value && setResultFilter(value as ResultFilter)}
          aria-label="Filter scoreboard results"
          className="min-h-10"
        >
          <ToggleGroupItem value="all" className="h-10 text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="WIN" className="h-10 text-xs">Wins</ToggleGroupItem>
          <ToggleGroupItem value="LOSS" className="h-10 text-xs">Losses</ToggleGroupItem>
        </ToggleGroup>
        {sportChoices.length > 0 ? (
          <Select value={sportFilter} onValueChange={setSportFilter}>
            <SelectTrigger className="h-10 w-[190px] text-xs" aria-label="Filter scoreboard sport">
              <SelectValue placeholder="All sports" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sports</SelectItem>
              {sportChoices.map((sport) => (
                <SelectItem key={sport.key} value={sport.key}>{sport.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <BreakdownCard
          scoreboard={data}
          isFiltered={hasFilters}
          dimension={dimension}
          onDimensionChange={setDimension}
        />
        <GamesCard
          events={events}
          total={data.summary.games}
          hasFilters={hasFilters}
          refreshing={refreshing}
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          loadMore={loadMore}
          clearFilters={clearFilters}
          linkEvents={linkEvents}
        />
      </div>
    </div>
  );
}
