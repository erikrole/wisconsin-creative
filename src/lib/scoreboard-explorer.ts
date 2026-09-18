export const SCOREBOARD_ALL_FILTER = "__all__";

export type TeamScoreboardSortKey = "events" | "wins" | "rate";
export type TeamScoreboardFilterKey = "sportCode" | "venue" | "opponent" | "site";
export type TeamScoreboardFilterState = Record<TeamScoreboardFilterKey, string>;

export const TEAM_SCOREBOARD_FILTER_KEYS: TeamScoreboardFilterKey[] = [
  "sportCode",
  "venue",
  "opponent",
  "site",
];

export const EMPTY_TEAM_SCOREBOARD_FILTERS: TeamScoreboardFilterState = {
  sportCode: SCOREBOARD_ALL_FILTER,
  venue: SCOREBOARD_ALL_FILTER,
  opponent: SCOREBOARD_ALL_FILTER,
  site: SCOREBOARD_ALL_FILTER,
};

const SITE_VALUES = new Set(["HOME", "AWAY", "NEUTRAL"]);

export type PersonScoreboardResultFilter = "all" | "WIN" | "LOSS" | "TIE";
export type PersonScoreboardSiteFilter = "all" | "HOME" | "AWAY" | "NEUTRAL";

export type PersonScoreboardFilterState = {
  result: PersonScoreboardResultFilter;
  sport: string;
  site: PersonScoreboardSiteFilter;
};

export const EMPTY_PERSON_SCOREBOARD_FILTERS: PersonScoreboardFilterState = {
  result: "all",
  sport: "all",
  site: "all",
};

type SearchReader = Pick<URLSearchParams, "get">;

export function parseTeamScoreboardFilters(params: SearchReader): TeamScoreboardFilterState {
  const next = { ...EMPTY_TEAM_SCOREBOARD_FILTERS };
  for (const key of TEAM_SCOREBOARD_FILTER_KEYS) {
    const value = params.get(key)?.trim() ?? "";
    if (!value || value === SCOREBOARD_ALL_FILTER) continue;
    if (key === "site" && !SITE_VALUES.has(value)) continue;
    next[key] = value;
  }
  return next;
}

export function parseTeamScoreboardSort(params: SearchReader): TeamScoreboardSortKey {
  const value = params.get("rank");
  return value === "wins" || value === "rate" || value === "events" ? value : "events";
}

export function writeTeamScoreboardSearchParams(
  params: URLSearchParams,
  filters: TeamScoreboardFilterState,
  sort: TeamScoreboardSortKey,
) {
  for (const key of TEAM_SCOREBOARD_FILTER_KEYS) {
    const value = filters[key];
    if (!value || value === SCOREBOARD_ALL_FILTER) params.delete(key);
    else params.set(key, value);
  }
  if (sort === "events") params.delete("rank");
  else params.set("rank", sort);
}

export function teamScoreboardApiUrl(filters: TeamScoreboardFilterState): string {
  const query = new URLSearchParams();
  writeTeamScoreboardSearchParams(query, filters, "events");
  query.delete("rank");
  const serialized = query.toString();
  return serialized ? `/api/scoreboard?${serialized}` : "/api/scoreboard";
}

export function teamScoreboardPath(
  filters: TeamScoreboardFilterState,
  sort: TeamScoreboardSortKey = "events",
): string {
  const params = new URLSearchParams();
  writeTeamScoreboardSearchParams(params, filters, sort);
  const serialized = params.toString();
  return serialized ? `/scoreboard?${serialized}` : "/scoreboard";
}

export function personScoreboardPath(
  userId: string,
  filters: TeamScoreboardFilterState,
  sort: TeamScoreboardSortKey = "events",
): string {
  const params = new URLSearchParams();
  writeTeamScoreboardSearchParams(params, filters, sort);
  const serialized = params.toString();
  return serialized ? `/scoreboard/${userId}?${serialized}` : `/scoreboard/${userId}`;
}

export function filtersFromTeamScoreboardResponse(filters: {
  sportCode: string | null;
  venue: string | null;
  opponent: string | null;
  site: string | null;
}): TeamScoreboardFilterState {
  return {
    sportCode: filters.sportCode?.trim() || SCOREBOARD_ALL_FILTER,
    venue: filters.venue?.trim() || SCOREBOARD_ALL_FILTER,
    opponent: filters.opponent?.trim() || SCOREBOARD_ALL_FILTER,
    site: filters.site && SITE_VALUES.has(filters.site) ? filters.site : SCOREBOARD_ALL_FILTER,
  };
}

export function teamScoreboardFiltersEqual(
  left: TeamScoreboardFilterState,
  right: TeamScoreboardFilterState,
): boolean {
  return TEAM_SCOREBOARD_FILTER_KEYS.every((key) => left[key] === right[key]);
}

export function scoreboardPersonMatches(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

export function parsePersonScoreboardFilters(params: SearchReader): PersonScoreboardFilterState {
  const result = params.get("result");
  const site = params.get("site");
  const sport = params.get("sportCode")?.trim() ?? "";
  return {
    result: result === "WIN" || result === "LOSS" || result === "TIE" ? result : "all",
    sport: sport && sport !== "all" ? sport : "all",
    site: site === "HOME" || site === "AWAY" || site === "NEUTRAL" ? site : "all",
  };
}

export function writePersonScoreboardSearchParams(
  params: URLSearchParams,
  filters: PersonScoreboardFilterState,
) {
  if (filters.result === "all") params.delete("result");
  else params.set("result", filters.result);
  if (filters.sport === "all") params.delete("sportCode");
  else params.set("sportCode", filters.sport);
  if (filters.site === "all") params.delete("site");
  else params.set("site", filters.site);
}

export function personScoreboardHasFilters(filters: PersonScoreboardFilterState): boolean {
  return filters.result !== "all" || filters.sport !== "all" || filters.site !== "all";
}
