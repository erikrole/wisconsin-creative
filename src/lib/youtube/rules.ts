// Pure, deterministic metadata rules shared by the server and the editor UI.
// No AI model or generated prose: descriptions are either verbatim recap
// sentences or fixed templates. See docs/YOUTUBE_FORMATS.md.

import type { Game, RecapDocument, VideoSnapshot } from "./types";

export const DESCRIPTION_FOOTER = "More from Wisconsin Athletics: uwbadgers.com\n#Badgers #OnWisconsin";
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5000;
const CHICAGO = "America/Chicago";

// ---------------------------------------------------------------- dates

/** Strict yyyy-MM-dd parse at UTC midnight. Rejects impossible dates such as Feb. 30. */
export function parseDay(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The America/Chicago calendar day of an instant. */
export function chicagoDay(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CHICAGO, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The instant of midnight in Chicago at the start of a calendar day. */
function chicagoMidnight(day: string): Date {
  const utcMidnight = parseDay(day)!;
  // Find the Chicago wall-clock offset at that moment, then correct once more
  // in case the offset differs across a DST change.
  let guess = utcMidnight.getTime();
  for (let i = 0; i < 2; i += 1) {
    const local = new Date(new Date(guess).toLocaleString("en-US", { timeZone: CHICAGO }) + " UTC").getTime();
    guess += utcMidnight.getTime() - local;
  }
  return new Date(guess);
}

export const LibraryWindow = {
  days: 30,
  cutoff(now: Date): Date {
    const today = parseDay(chicagoDay(now))!;
    return chicagoMidnight(formatDay(new Date(today.getTime() - 29 * 86_400_000)));
  },
  contains(instant: Date, now: Date): boolean {
    return instant.getTime() >= LibraryWindow.cutoff(now).getTime() && instant.getTime() <= now.getTime();
  },
  /** Schedule lookup window: the anchor day plus two days either side. */
  datesAround(day: string): string[] {
    const anchor = parseDay(day);
    if (!anchor) return [];
    return [-2, -1, 0, 1, 2].map((offset) => formatDay(new Date(anchor.getTime() + offset * 86_400_000)));
  },
};

const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

export function longDate(day: string): string | null {
  const date = parseDay(day);
  return date ? `${LONG_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}` : null;
}

/** AP style used in titles: `Sept. 26, 2026`. */
export function apDate(day: string): string | null {
  const date = parseDay(day);
  return date ? `${AP_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}` : null;
}

// ---------------------------------------------------------------- descriptions

export function removeOpeningDateline(text: string): string {
  return text.replace(/^\p{Lu}[\p{Lu}\p{M} .’'-]{1,70},\s*[A-Za-z.]{2,24}(?:\s+[A-Za-z.]{2,24})?\s*(?:[—–]|\s--?\s)\s*/u, "");
}

export function assembleDescription(paragraphs: string[]): string {
  return [...paragraphs.map((p) => p.trim()).filter(Boolean), DESCRIPTION_FOOTER].join("\n\n");
}

export function descriptionProblems(text: string): string[] {
  const issues: string[] = [];
  if (!text.trim()) issues.push("Draft is empty.");
  if (text.length > DESCRIPTION_MAX) issues.push("Description exceeds 5,000 characters.");
  if (text.includes("<") || text.includes(">")) issues.push("YouTube descriptions cannot contain angle brackets.");
  if (!text.endsWith(DESCRIPTION_FOOTER)) issues.push("Restore the Wisconsin Athletics footer.");
  return issues;
}

export function titleProblems(title: string): string[] {
  const issues: string[] = [];
  if (!title.trim()) issues.push("Title is empty.");
  if (title.length > TITLE_MAX) issues.push("Title exceeds 100 characters.");
  if (title.includes("<") || title.includes(">")) issues.push("YouTube titles cannot contain angle brackets.");
  return issues;
}

/** Initial excerpt: the first two paragraphs, up to ~190 words, never time-sensitive copy. */
export function initialSelection(doc: RecapDocument): string[] {
  const ids: string[] = [];
  let words = 0;
  for (const sentence of doc.sentences) {
    if (sentence.paragraph >= 2 || sentence.isTimeSensitive) continue;
    const count = sentence.text.split(/\s+/).filter(Boolean).length;
    if (words + count <= 190) {
      ids.push(sentence.id);
      words += count;
    }
  }
  return ids;
}

/** Verbatim excerpt in source order. Only the opening dateline is removed. */
export function descriptionFromSelection(doc: RecapDocument, selected: Iterable<string>): string {
  const ids = new Set(selected);
  const chosen = doc.sentences.filter((s) => ids.has(s.id) && !s.isTimeSensitive);
  if (chosen.length === 0) return "";
  const openingId = doc.sentences[0]?.id;
  const groups = new Map<number, string[]>();
  for (const sentence of chosen) {
    const text = sentence.id === openingId ? removeOpeningDateline(sentence.text) : sentence.text;
    groups.set(sentence.paragraph, [...(groups.get(sentence.paragraph) ?? []), text]);
  }
  return assembleDescription([...groups.keys()].sort((a, b) => a - b).map((key) => groups.get(key)!.join(" ")));
}

// ---------------------------------------------------------------- titles

export function checkedTitle(title: string): string {
  return title
    .replace(/\bpost[ -]+game\b/gi, "Postgame")
    .replace(/\s*\|\|\s*/g, " || ")
    .trim();
}

// ---------------------------------------------------------------- classification

export const SPORTS = [
  "Women's Basketball", "Men's Basketball", "Women's Hockey", "Men's Hockey", "Women's Soccer", "Men's Soccer",
  "Women's Tennis", "Men's Tennis", "Women's Golf", "Men's Golf", "Volleyball", "Football", "Softball", "Wrestling",
  "Rowing", "Cross Country", "Track and Field",
];
export const UNASSIGNED = "Unassigned";

/** Videos the user marked as never-touch. */
export const PROTECTED_VIDEO_IDS = new Set(["Bge051LX6DM", "Dj6ZKiRqx5w"]);

export interface VideoIdentity {
  sport: string;
  opponent: string;
  gameDate: string | null;
  hold: string | null;
  excluded: boolean;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function sportFromTitle(title: string): string {
  const lower = title.toLowerCase().replace(/’/g, "'");
  const matches = SPORTS.filter((sport) => new RegExp(`\\b${escapeRegExp(sport.toLowerCase())}\\b`).test(lower));
  return matches.length === 1 && matches[0] ? matches[0] : UNASSIGNED;
}

export function usesManualReview(title: string): boolean {
  const lower = title.toLowerCase();
  return !lower.includes("highlight") || ["cinematic", "motivational", "media day", "exhibition", "scrimmage"].some((word) => lower.includes(word));
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const FULL_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Reads `Sept. 26, 2026`, `Oct 1 2026` or `October 1, 2026`; null when the text is not a real date. */
export function dayFromTitleDate(text: string): string | null {
  const match = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const word = match[1].toLowerCase();
  const month = MONTHS[word] ?? FULL_MONTHS.indexOf(word);
  if (month == null || month < 0) return null;
  const day = `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return parseDay(day) ? day : null;
}

/** Conservative, explicit identity extraction. No sport inference from opponents or descriptions. */
export function identifyVideo(video: { snapshot: VideoSnapshot; publishedAt: Date }, now: Date): VideoIdentity {
  const { snapshot } = video;
  const sport = sportFromTitle(snapshot.title);
  const held = (hold: string, excluded = true): VideoIdentity => ({ sport, opponent: "", gameDate: null, hold, excluded });
  if (PROTECTED_VIDEO_IDS.has(snapshot.id)) return held("This football description is protected from changes.");
  if (!snapshot.isPublic && (snapshot.status?.publishAt != null || snapshot.status?.uploadStatus !== "processed")) {
    return held("This upload is scheduled or still processing. Check it in YouTube Studio.");
  }
  if (snapshot.isLive !== false) return held("Live and upcoming broadcasts are excluded.");
  if (!LibraryWindow.contains(video.publishedAt, now)) return held("Outside the recent 30-day library. Older backfill is not enabled.");
  if (usesManualReview(snapshot.title)) return { sport, opponent: "", gameDate: null, hold: null, excluded: false };

  const opponent = /\b(?:vs\.?|versus|at)\s+(.+?)(?=\s*\||\s+[-–—]\s+(?:Game\s+)?Highlights|$)/i.exec(snapshot.title)?.[1]?.trim() ?? "";
  if (!opponent) return held("The opponent is not clear in the title. Match needs review.", false);
  const dateText = /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4})\b/i.exec(snapshot.title)?.[1];
  let gameDate: string | null = null;
  if (dateText) {
    gameDate = dayFromTitleDate(dateText);
    if (!gameDate) return held("The game date in the title could not be read.", false);
  }
  return { sport, opponent, gameDate, hold: sport === UNASSIGNED ? "Choose the official game to confirm the sport." : null, excluded: false };
}

// ---------------------------------------------------------------- schedule matching

export type MatchResult =
  | { kind: "matched"; game: Game }
  | { kind: "missing" }
  | { kind: "ambiguous"; games: Game[] }
  | { kind: "dateConflict" }
  | { kind: "missingRecap"; game: Game };

export const MATCH_LABELS: Record<MatchResult["kind"], string> = {
  matched: "Matched to schedule",
  missing: "No matching game",
  ambiguous: "Ambiguous match",
  dateConflict: "Date conflict",
  missingRecap: "Missing recap",
};

const canonicalSport = (value: string) =>
  value.toLowerCase().replace("wisconsin ", "").replace("women's volleyball", "volleyball").trim();
const canonicalOpponent = (value: string) => {
  const text = value.toLowerCase().trim();
  return ({ "uw-milwaukee": "milwaukee", "uw milwaukee": "milwaukee" } as Record<string, string>)[text] ?? text;
};

export function resolveGame(input: { sport: string; opponent: string; gameDate: string | null; uploadDate: string; games: Game[] }): MatchResult {
  const upload = parseDay(input.uploadDate);
  if (!input.sport || !input.opponent || !upload) return { kind: "missing" };
  const eligible = input.games.filter(
    (game) => canonicalSport(game.sport) === canonicalSport(input.sport) && canonicalOpponent(game.opponent) === canonicalOpponent(input.opponent),
  );
  const withinTwoDays = (day: Date) => Math.abs(day.getTime() - upload.getTime()) <= 2 * 86_400_000;
  let candidates: Game[];
  if (input.gameDate != null) {
    const anchor = parseDay(input.gameDate);
    if (!anchor || !withinTwoDays(anchor)) return { kind: "dateConflict" };
    candidates = eligible.filter((game) => game.date === input.gameDate);
  } else {
    candidates = eligible.filter((game) => {
      const day = parseDay(game.date);
      return day != null && withinTwoDays(day);
    });
  }
  const unique = [...new Map(candidates.map((game) => [game.id, game])).values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const game = unique[0];
  if (!game) return { kind: "missing" };
  if (unique.length > 1) return { kind: "ambiguous", games: unique };
  return game.recapUrl ? { kind: "matched", game } : { kind: "missingRecap", game };
}

// ---------------------------------------------------------------- press conferences

export interface ConferenceCoach {
  id: string;
  name: string;
  sport: string;
  sourceUrl: string;
}

// Checked against the official UWBadgers staff directory on 2026-10-02.
export const CONFERENCE_COACHES: ConferenceCoach[] = [
  { id: "football", name: "Luke Fickell", sport: "Football", sourceUrl: "https://uwbadgers.com/sports/football/coaches" },
  { id: "volleyball", name: "Kelly Sheffield", sport: "Volleyball", sourceUrl: "https://uwbadgers.com/sports/womens-volleyball/coaches" },
  { id: "mhockey", name: "Mike Hastings", sport: "Men's Hockey", sourceUrl: "https://uwbadgers.com/staff-directory/mike-hastings/1016" },
  { id: "whockey", name: "Mark Johnson", sport: "Women's Hockey", sourceUrl: "https://uwbadgers.com/sports/womens-ice-hockey/coaches" },
  { id: "mbasketball", name: "Greg Gard", sport: "Men's Basketball", sourceUrl: "https://uwbadgers.com/staff-directory/Greg-Gard/246" },
  { id: "wbasketball", name: "Robin Pingeton", sport: "Women's Basketball", sourceUrl: "https://uwbadgers.com/staff-directory/robin-pingeton/1198" },
];

export type ConferenceKind = "Weekly" | "Postgame";

export function isConference(title: string): boolean {
  const text = title.toLowerCase();
  return text.includes("conference") || text.includes("media availability");
}

export function conferenceKind(title: string): ConferenceKind {
  return /post[ -]?(?:game|match)/i.test(title) ? "Postgame" : "Weekly";
}

/** Template description. Postgame wording needs an official game and never states a result. */
export function conferenceDescription(speakers: Iterable<string>, kind: ConferenceKind, game: Game | null): string | null {
  const chosen = new Set(speakers);
  const coaches = CONFERENCE_COACHES.filter((coach) => chosen.has(coach.id));
  if (coaches.length === 0) return null;
  if (kind === "Postgame" && !game) return null;
  const names = coaches.map((coach, index) => `${index === 0 ? "Head" : "head"} ${coach.sport.toLowerCase()} coach ${coach.name}`);
  const subject = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "meets" : "meet";
  let ending = ".";
  if (kind === "Postgame" && game) {
    const date = longDate(game.date);
    if (!date || !game.opponent) return null;
    ending = ` following Wisconsin's game against ${game.opponent} on ${date}.`;
  }
  return assembleDescription([`${subject} ${verb} with the media${ending}`]);
}

// ---------------------------------------------------------------- playlists

/** Up to three existing channel playlists matching the sport and year (or a conference playlist). */
export function suggestPlaylists<T extends { title: string }>(playlists: T[], sport: string, day: string, conference: boolean): T[] {
  if (sport === UNASSIGNED) return [];
  const year = day.slice(0, 4);
  const sportPattern = new RegExp(`\\b${escapeRegExp(sport.toLowerCase())}`);
  const isConferenceList = (item: T) => conference && item.title.toLowerCase().includes("conference");
  return playlists
    .filter((item) => {
      const name = item.title.toLowerCase().replace(/’/g, "'");
      return sportPattern.test(name) && (name.includes(year) || isConferenceList(item));
    })
    .sort((a, b) => {
      const left = isConferenceList(a), right = isConferenceList(b);
      if (left !== right) return left ? -1 : 1;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    })
    .slice(0, 3);
}

// ---------------------------------------------------------------- chapters

export interface Chapter {
  seconds: number;
  label: string;
}

/** YouTube chapters: at least three, first at 0:00, each at least 10 seconds long. */
export function chaptersValid(chapters: Chapter[], duration: number): boolean {
  if (chapters.length < 3 || chapters[0]?.seconds !== 0) return false;
  return chapters.every((chapter, index) => {
    const end = chapters[index + 1]?.seconds ?? duration;
    return chapter.label.trim() !== "" && end - chapter.seconds >= 10;
  });
}
