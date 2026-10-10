// Server-only: official UWBadgers schedule and recap pages. Only HTTPS
// uwbadgers.com URLs are requested, redirects must stay on that host, and
// responses are size-limited. Nothing here writes anywhere.

import { extractRecap, RECAP_MAX_BYTES } from "./recap";
import { parseDay } from "./rules";
import { YouTubeToolError, type Game, type RecapDocument } from "./types";

const ORIGIN = "https://uwbadgers.com";
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export function allowedUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.toLowerCase() === "uwbadgers.com" && !url.username && !url.password && (url.port === "" || url.port === "443");
}

async function get(target: string, fetcher: typeof fetch, expectHtml = false): Promise<string> {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!allowedUrl(url)) throw new YouTubeToolError("Only official HTTPS UWBadgers URLs are supported.");
    const response = await fetcher(url, {
      headers: { "User-Agent": "WisconsinCreative/1.0 (YouTube metadata review)" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      url = new URL(location, url).toString();
      continue;
    }
    if (response.status !== 200) throw new YouTubeToolError("UWBadgers did not return a successful response. The saved source was kept.");
    if (expectHtml && !(response.headers.get("content-type") ?? "").includes("html")) {
      throw new YouTubeToolError("The recap URL did not return an HTML page.");
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > RECAP_MAX_BYTES) throw new YouTubeToolError("UWBadgers response exceeded the size limit.");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > RECAP_MAX_BYTES) throw new YouTubeToolError("UWBadgers response exceeded the size limit.");
    return text;
  }
  throw new YouTubeToolError("UWBadgers redirected too many times or left the official site.");
}

interface ScheduleEvent {
  id?: number | string;
  date?: string;
  atVs?: string;
  sport?: { title?: string } | null;
  opponent?: { title?: string } | null;
  result?: { recap?: { url?: string | null } | null } | null;
}

/**
 * Games grouped by the calendar day that lists them. The calendar API returns
 * about a week per request; a multi-day event is listed under each day it
 * spans and keeps its own start date.
 */
export function parseSchedule(json: unknown): Map<string, Game[]> {
  if (!Array.isArray(json)) throw new YouTubeToolError("UWBadgers returned an unexpected schedule.");
  const days = new Map<string, Game[]>();
  for (const day of json as Array<{ date?: string; events?: ScheduleEvent[] }>) {
    const listed = day.date?.slice(0, 10) ?? "";
    if (!parseDay(listed)) continue;
    const games = days.get(listed) ?? [];
    for (const event of day.events ?? []) {
      const date = event.date?.slice(0, 10) ?? "";
      const sport = event.sport?.title, opponent = event.opponent?.title;
      if (event.id == null || !parseDay(date) || !sport || !opponent) continue;
      const recapPath = event.result?.recap?.url;
      let recapUrl: string | null = null;
      if (recapPath) {
        try {
          const url = new URL(recapPath, ORIGIN);
          if (allowedUrl(url) && url.pathname.startsWith("/news/")) recapUrl = url.toString();
        } catch {
          recapUrl = null;
        }
      }
      const atVs = event.atVs === "at" || event.atVs === "vs" ? event.atVs : null;
      games.push({ id: String(event.id), date, sport, opponent, recapUrl, atVs });
    }
    days.set(listed, games);
  }
  return days;
}

export interface ScheduleSource {
  games(date: string): Promise<Game[]>;
  recap(url: string): Promise<RecapDocument>;
}

/**
 * One schedule source per refresh. Each calendar response covers several days,
 * so every day it returns is cached and later dates in that span cost nothing.
 */
export function createScheduleSource(fetcher: typeof fetch = fetch): ScheduleSource {
  const days = new Map<string, Game[]>();
  const inflight = new Map<string, Promise<Game[]>>();
  return {
    async games(date) {
      if (!parseDay(date)) throw new YouTubeToolError("Invalid schedule date.");
      const cached = days.get(date);
      if (cached) return cached;
      let pending = inflight.get(date);
      if (!pending) {
        pending = (async () => {
          const text = await get(`${ORIGIN}/api/v2/Calendar/events?date=${date}`, fetcher);
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            throw new YouTubeToolError("UWBadgers returned an unreadable schedule.");
          }
          for (const [day, games] of parseSchedule(json)) days.set(day, games);
          if (!days.has(date)) days.set(date, []);
          return days.get(date)!;
        })();
        inflight.set(date, pending);
      }
      try {
        return await pending;
      } finally {
        inflight.delete(date);
      }
    },
    async recap(url) {
      if (!allowedUrl(url) || !new URL(url).pathname.startsWith("/news/")) throw new YouTubeToolError("No official recap URL is available.");
      return extractRecap(await get(url, fetcher, true), url);
    },
  };
}
