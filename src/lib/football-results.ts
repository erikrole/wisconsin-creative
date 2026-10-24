import { z } from "zod";
import { normalizeOpponentName } from "@/lib/schedule-event-identity";

const score = z.number().int().min(0).max(200);
// Only ESPN reports these; UW rows carry the empty defaults. Older stored snapshots parse unchanged.
const poll = z.number().int().min(1).max(25).nullable().default(null);
const footballObservationSchema = z.object({
  version: z.literal(1),
  provider: z.enum(["UW", "ESPN"]),
  externalId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  opponent: z.string().min(1),
  site: z.enum(["HOME", "AWAY", "NEUTRAL"]),
  final: z.boolean(),
  wisconsin: score.nullable(),
  opponentScore: score.nullable(),
  outcome: z.enum(["WIN", "LOSS", "TIE"]).nullable(),
  sourceUrl: z.string().url(),
  /** AP/Coaches poll rank when the game was played; null means unranked. */
  wisconsinRank: poll,
  opponentRank: poll,
  /** Extra periods played: 0 in regulation, 1 for one overtime. */
  overtimes: z.number().int().min(0).max(12).default(0),
  /** TV networks ESPN lists for the game, for example ["NBC"] or ["BTN"]. */
  networks: z.array(z.string().min(1).max(24)).max(6).default([]),
});
export type FootballObservation = z.infer<typeof footballObservationSchema>;
type Provider = FootballObservation["provider"];

/** Mid-August through January. Outside it the daily cron returns before any fetch or database work. */
export function isFootballSeason(now: Date): boolean {
  const month = now.getUTCMonth() + 1; const day = now.getUTCDate();
  return month >= 9 || month === 1 && day <= 20 || month === 8 && day >= 15;
}

export function footballScheduleUrl(provider: Provider, year: number, postseason = false): string {
  return provider === "UW"
    ? `https://uwbadgers.com/sports/football/schedule/${year}`
    : `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/275/schedule?season=${year}&seasontype=${postseason ? 3 : 2}`;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function numericScore(value: unknown): number | null {
  // Empty strings, null, booleans and partial scores must not turn into zero.
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  const parsed = score.safeParse(number);
  return parsed.success ? parsed.data : null;
}

function outcome(us: number | null, them: number | null): FootballObservation["outcome"] {
  if (us === null || them === null) return null;
  return us > them ? "WIN" : us < them ? "LOSS" : "TIE";
}

function footballOpponentKey(name: string | null): string {
  const normalized = normalizeOpponentName(name)?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  // Explicit spelling aliases, never fuzzy or date-only matching.
  return ({ pennst: "pennstate", michiganst: "michiganstate", ohiost: "ohiostate" } as Record<string, string>)[normalized] ?? normalized;
}

export function footballDate(date: Date, allDay = false): string {
  return allDay ? date.toISOString().slice(0, 10) : new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function checkedObservations(rows: FootballObservation[], year: number, allowEmpty = false): FootballObservation[] {
  const unique = new Map<string, FootballObservation>();
  for (const input of rows) {
    const row = footballObservationSchema.parse(input);
    const gameYear = Number(row.date.slice(0, 4));
    if (gameYear !== year && !(gameYear === year + 1 && row.date.slice(5, 7) === "01")) continue;
    const existing = unique.get(row.externalId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw new Error("Conflicting duplicate games in schedule");
    unique.set(row.externalId, row);
  }
  if ((!allowEmpty && unique.size === 0) || unique.size > 32) throw new Error("Football schedule was empty or unexpectedly large");
  return [...unique.values()];
}

/** UW's published Nuxt payload is a flattened JSON graph; never execute page scripts. */
export function parseUwFootballSchedule(html: string, year: number): FootballObservation[] {
  const script = html.match(/<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) throw new Error("UW football schedule format was not recognized");
  const pool = z.array(z.unknown()).parse(JSON.parse(script));
  const value = (ref: unknown): unknown => typeof ref === "number" && Number.isInteger(ref) && ref >= 0 ? pool[ref] : undefined;
  const rows: FootballObservation[] = [];
  for (const item of pool) {
    const node = object(item);
    if (node.opponent === undefined || node.date === undefined || node.game_state_display === undefined) continue;
    const id = value(node.id);
    if (!(typeof id === "number" || typeof id === "string") || !/^\d+$/.test(String(id))) continue;
    const opponent = value(object(value(node.opponent)).title);
    const date = value(node.date);
    const site = ({ H: "HOME", A: "AWAY", N: "NEUTRAL" } as const)[String(value(node.location_indicator)) as "H" | "A" | "N"];
    if (typeof opponent !== "string" || typeof date !== "string" || !site) throw new Error("UW game identity is incomplete");
    const result = object(value(node.result));
    const isFinal = value(node.game_state_display) === "GAMECOMPLETE";
    const us = isFinal ? numericScore(value(result.team_score)) : null;
    const them = isFinal ? numericScore(value(result.opponent_score)) : null;
    const reportedOutcome = ({ W: "WIN", L: "LOSS", T: "TIE" } as const)[String(value(result.status)) as "W" | "L" | "T"] ?? null;
    if (isFinal && (us === null || them === null || outcome(us, them) !== reportedOutcome)) throw new Error("UW final score is incomplete or inconsistent");
    rows.push({ version: 1, provider: "UW", externalId: String(id), date: date.slice(0, 10),
      opponent, site, final: isFinal, wisconsin: us, opponentScore: them, outcome: isFinal ? reportedOutcome : null,
      sourceUrl: `https://uwbadgers.com/game-center/${id}`,
      wisconsinRank: null, opponentRank: null, overtimes: 0, networks: [] });
  }
  return checkedObservations(rows, year);
}

/** ESPN marks unranked teams 99; only 1-25 is a real poll rank. */
function espnRank(competitor: Record<string, unknown>): number | null {
  const parsed = poll.safeParse(object(competitor.curatedRank).current);
  return parsed.success ? parsed.data : null;
}

/** Regulation is four periods; every period after that is an overtime. */
function espnOvertimes(status: unknown): number {
  const period = Number(object(status).period);
  return Number.isInteger(period) && period > 4 ? Math.min(period - 4, 12) : 0;
}

function espnNetworks(broadcasts: unknown): string[] {
  if (!Array.isArray(broadcasts)) return [];
  const names = broadcasts.flatMap((item) => {
    const name = object(object(item).media).shortName;
    return typeof name === "string" && name.trim() && name.length <= 24 && object(object(item).type).shortName === "TV" ? [name.trim()] : [];
  });
  return [...new Set(names)].slice(0, 6);
}

/**
 * A rank is the poll the game was played under. Once a rank is stored, a later
 * refresh keeps it, because ESPN's curated rank follows the current week's poll.
 */
export function mergeFootballObservation(previous: unknown, next: FootballObservation): FootballObservation {
  const parsed = footballObservationSchema.safeParse(previous);
  if (!parsed.success || parsed.data.provider !== next.provider || parsed.data.externalId !== next.externalId
    || !parsed.data.final || !next.final) return next;
  return { ...next, wisconsinRank: parsed.data.wisconsinRank, opponentRank: parsed.data.opponentRank };
}

export function parseEspnFootballSchedule(payload: unknown, year: number, allowEmpty = false): FootballObservation[] {
  const root = object(payload);
  if (String(object(root.team).id) !== "275" || Number(object(root.season).year) !== year || !Array.isArray(root.events)) {
    throw new Error("ESPN football season or team did not match");
  }
  const rows: FootballObservation[] = [];
  for (const item of root.events) {
    const event = object(item);
    if (!Array.isArray(event.competitions) || event.competitions.length !== 1) throw new Error("ESPN competition is ambiguous");
    const competition = object(event.competitions[0]);
    const competitors = z.array(z.record(z.string(), z.unknown())).length(2).parse(competition.competitors);
    const ours = competitors.filter((row) => String(object(row.team).id) === "275");
    const opponents = competitors.filter((row) => String(object(row.team).id) !== "275");
    if (ours.length !== 1 || opponents.length !== 1) throw new Error("ESPN game teams did not match");
    const us = ours[0]!; const them = opponents[0]!;
    const status = object(object(competition.status).type);
    const final = status.completed === true && status.state === "post" && status.name === "STATUS_FINAL";
    const ourScore = final ? numericScore(object(us.score).value ?? us.score) : null;
    const theirScore = final ? numericScore(object(them.score).value ?? them.score) : null;
    const date = new Date(String(event.date));
    const opponent = object(them.team).location;
    const site = competition.neutralSite === true ? "NEUTRAL" : us.homeAway === "home" ? "HOME" : us.homeAway === "away" ? "AWAY" : null;
    if (!Number.isFinite(date.getTime()) || typeof opponent !== "string" || !site || (final && (ourScore === null || theirScore === null))) {
      throw new Error("ESPN game identity or final score is incomplete");
    }
    rows.push({ version: 1, provider: "ESPN", externalId: String(event.id), date: footballDate(date),
      opponent, site, final, wisconsin: ourScore, opponentScore: theirScore, outcome: outcome(ourScore, theirScore),
      sourceUrl: `https://www.espn.com/college-football/game/_/gameId/${event.id}`,
      wisconsinRank: espnRank(us), opponentRank: espnRank(them),
      overtimes: final ? espnOvertimes(competition.status) : 0, networks: espnNetworks(competition.broadcasts) });
  }
  return checkedObservations(rows, year, allowEmpty);
}

export type FootballEventIdentity = {
  sportCode: string | null; opponent: string | null; site: string | null;
  startsAt: Date; allDay: boolean; rawStartsAt: Date | null; rawAllDay: boolean | null;
  result: string | null;
};

export function matchesFootballGame(event: FootballEventIdentity, row: FootballObservation): boolean {
  return event.sportCode === "FB" && Boolean(footballOpponentKey(event.opponent))
    && footballOpponentKey(event.opponent) === footballOpponentKey(row.opponent)
    && footballDate(event.rawStartsAt ?? event.startsAt, event.rawAllDay ?? event.allDay) === row.date
    && event.site === row.site;
}

type StoredObservation = {
  provider: Provider; externalId: string; snapshot: unknown;
  observedAt: Date; lastAttemptAt: Date; lastError: string | null;
};
export type FootballScore = {
  status: "verified" | "pending" | "disputed";
  wisconsin: number | null; opponent: number | null; margin: number | null;
  stale: boolean;
  sources: Array<{ provider: Provider; url: string; observedAt: string }>;
  /** ESPN extras, present once the score is verified. */
  details: FootballGameDetails | null;
};
export type FootballGameDetails = { wisconsinRank: number | null; opponentRank: number | null; overtimes: number; networks: string[] };

/** Read-time identity matching also hides scores after a Schedule correction. */
export function footballScoreForEvent(event: FootballEventIdentity, observations: StoredObservation[] = [], now = new Date()): FootballScore | null {
  if (event.sportCode !== "FB") return null;
  const parsed = observations.map((observation) => ({ observation, parsed: footballObservationSchema.safeParse(observation.snapshot) }));
  const valid = parsed.flatMap(({ observation, parsed: result }) => result.success && result.data.provider === observation.provider
    && result.data.externalId === observation.externalId ? [{ ...observation, data: result.data }] : []);
  const trusted = (provider: Provider) => {
    const row = valid.find((candidate) => candidate.provider === provider);
    return row && matchesFootballGame(event, row.data) && row.lastError !== "identity_changed" && row.lastError !== "ambiguous_match" ? row : null;
  };
  // The UW Athletics score is the one shown. ESPN only adds rank, overtime and TV, and
  // a disagreement between the two never hides or replaces the UW score.
  const uw = trusted("UW");
  if (!uw || !uw.data.final || uw.data.wisconsin === null || uw.data.opponentScore === null) return null;
  const espn = trusted("ESPN");
  const espnFinal = espn?.data.final ? espn.data : null;
  const used = [uw, ...(espn ? [espn] : [])];
  const sources = used.map(({ data, observedAt }) => ({ provider: data.provider,
    // Derive outbound links from validated IDs, never trust snapshot URLs.
    url: data.provider === "UW" ? `https://uwbadgers.com/game-center/${data.externalId}` : `https://www.espn.com/college-football/game/_/gameId/${data.externalId}`,
    observedAt: observedAt.toISOString() }));
  const stale = used.some((row) => Boolean(row.lastError) || now.getTime() - row.observedAt.getTime() > 48 * 60 * 60 * 1000);
  return { status: "verified", wisconsin: uw.data.wisconsin, opponent: uw.data.opponentScore, margin: uw.data.wisconsin - uw.data.opponentScore, stale, sources,
    details: espnFinal ? { wisconsinRank: espnFinal.wisconsinRank, opponentRank: espnFinal.opponentRank, overtimes: espnFinal.overtimes, networks: espnFinal.networks } : null };
}
