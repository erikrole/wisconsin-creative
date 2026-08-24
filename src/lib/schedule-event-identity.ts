import { normalizeTeamAbbreviations } from "./title-normalization";
import { SPORT_CODES, SPORT_CODE_SET } from "./sports";

/** Known team-name prefixes to strip from ICS summaries (case-insensitive). */
const SOURCE_TEAM_PREFIXES = ["Wisconsin Athletics", "Wisconsin Badgers"];

/** Words that are event metadata, not opponent identity. */
const TRAILING_EVENT_TYPE_PATTERN =
  /\s*\((home|away|neutral|exhibition|scrimmage)\)\s*$/i;

/** Common source spelling aliases for venue/location text. */
const VENUE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bWis\./gi, "WI"],
  [/\bWisc\./gi, "WI"],
  [/\bMcclimon\b/gi, "McClimon"],
];

export function cleanSourceSummary(raw: string): string {
  let cleaned = raw.trim().replace(/^\s*\[[A-Z]\]\s*/i, "");
  for (const prefix of SOURCE_TEAM_PREFIXES) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.slice(prefix.length).trim().replace(/^[-–—:]\s*/, "");
      break;
    }
  }

  const normalized = cleaned
    .replace(TRAILING_EVENT_TYPE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || raw.trim();
}

/** Source-provided W-L-T marker on a raw ICS summary, e.g. "[W] MBB vs Purdue". */
const RESULT_MARKER_PATTERN = /^\s*\[(W|L|T)\](\s|$)/i;

/**
 * Read the W-L-T outcome from a raw (uncleaned) ICS summary.
 * Mirrors the backfill in migration 0106 so freshly synced rows and
 * historically backfilled rows agree on what counts as evidence.
 * `cleanSourceSummary` strips this marker from the display title, so the raw
 * summary is the only place it survives. A missing marker means unknown,
 * never a loss.
 */
export function parseEventResult(rawSummary: string | null | undefined): "WIN" | "LOSS" | "TIE" | null {
  if (!rawSummary) return null;
  const match = rawSummary.match(RESULT_MARKER_PATTERN);
  if (!match) return null;
  const marker = match[1]!.toUpperCase(); // capture group present when match succeeds
  if (marker === "W") return "WIN";
  if (marker === "L") return "LOSS";
  return "TIE";
}

export function normalizeOpponentName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const [primary = "", ...qualifierParts] = raw
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s*[-–—]\s+/);

  let cleaned = primary
    .replace(/^(?:#\d+|No\.?\s*\d+|RV)\s+/i, "")
    .replace(/^University of\s+/i, "")
    .replace(/\s+University$/i, "")
    .replace(TRAILING_EVENT_TYPE_PATTERN, "")
    .trim();

  if (!cleaned) cleaned = primary.trim();

  const qualifier = qualifierParts.join(" - ").trim();
  return [normalizeTeamAbbreviations(cleaned), normalizeTeamAbbreviations(qualifier)]
    .filter(Boolean)
    .join(" - ") || null;
}

export function normalizeVenueText(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let cleaned = raw.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of VENUE_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  cleaned = cleaned
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

/**
 * Return the venue component shown on Schedule and profile scoreboard surfaces.
 * Imported calendar locations commonly include a leading or trailing city/state
 * qualifier; that qualifier is useful source evidence but not part of the venue
 * name an operator scans for.
 */
export function scheduleVenueDisplayName(raw: string | null | undefined): string | null {
  const normalized = normalizeVenueText(raw);
  if (!normalized) return null;

  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0];
  if (!first) return normalized;
  if (parts.length < 2) return first;

  // A location with only "City, ST" has no venue component to remove.
  if (parts.length === 2 && isVenueStateToken(parts[1]!)) return parts.join(", ");

  // The feed most often uses "City, ST, Venue".
  if (parts.length >= 3 && isVenueStateToken(parts[1]!)) return parts[2] ?? first;

  // Some sources use "Venue, City, ST". For any other malformed shape, keep
  // the leading component instead of confidently displaying the wrong value.
  return first;
}

function isVenueStateToken(token: string): boolean {
  return /^[A-Z]{2}$/.test(token) || /^[A-Za-z]{1,6}\.$/.test(token);
}

export function buildVenueSearchText(...values: Array<string | null | undefined>): string {
  return values
    .map((value) => normalizeVenueText(value) ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ── Sport code extraction from ICS summaries ──

/** Build a map from lowercase sport label → code for label-based matching */
const LABEL_TO_CODE = new Map<string, string>(
  SPORT_CODES.map((s) => [s.label.toLowerCase(), s.code]),
);

/**
 * Try to match a sport label at the start of a summary string.
 * Returns the code and the remainder after the label, or null.
 */
function matchSportLabel(summary: string): { code: string; rest: string } | null {
  const lower = summary.toLowerCase();
  // Sort labels longest-first so "Women's Swimming & Diving" matches before "Women's Swimming"
  const sorted = [...LABEL_TO_CODE.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [label, code] of sorted) {
    if (lower.startsWith(label)) {
      return { code, rest: summary.slice(label.length).trim() };
    }
  }
  return null;
}

/**
 * Extracts sport code, opponent, and home/away from an event summary.
 * Patterns matched:
 *   "{SPORT_CODE} vs {opponent}"  → isHome = true
 *   "{SPORT_CODE} at {opponent}"  → isHome = false
 *   "{SPORT_CODE} vs {opponent} (Neutral)" → isHome = null
 *   "{SPORT_CODE} - {description}" → sport only, no opponent
 *   "{Sport Label} vs/at {opponent}" → matched by label (e.g. "Women's Tennis at Purdue")
 */
export function extractSportInfo(summary: string): {
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
} {
  const trimmed = summary.trim();

  // Try matching "{CODE} vs/at {opponent}" pattern
  const codeMatch = trimmed.match(/^(\w+)\s+(vs\.?|at)\s+(.+?)(?:\s*\(Neutral\))?$/i);
  if (codeMatch) {
    const code = codeMatch[1]!.toUpperCase(); // capture groups present when match succeeds
    if (SPORT_CODE_SET.has(code)) {
      const prep = codeMatch[2]!.toLowerCase().replace(".", "");
      const opponent = normalizeOpponentName(codeMatch[3]!.trim());
      const isNeutral = /\(Neutral\)/i.test(trimmed);
      return {
        sportCode: code,
        opponent,
        isHome: isNeutral ? null : prep === "vs" ? true : false,
      };
    }
  }

  // Try matching sport code at start of summary with other separator
  const dashMatch = trimmed.match(/^(\w+)\s*[-\u2013\u2014:]\s*(.+)$/);
  if (dashMatch) {
    const code = dashMatch[1]!.toUpperCase(); // capture group present when match succeeds
    if (SPORT_CODE_SET.has(code)) {
      return { sportCode: code, opponent: null, isHome: null };
    }
  }

  // Try matching just a sport code as prefix (e.g., "MBB Practice")
  const prefixMatch = trimmed.match(/^(\w+)\s/);
  if (prefixMatch) {
    const code = prefixMatch[1]!.toUpperCase(); // capture group present when match succeeds
    if (SPORT_CODE_SET.has(code)) {
      return { sportCode: code, opponent: null, isHome: null };
    }
  }

  // Try matching by sport label (e.g., "Women's Tennis at Purdue")
  const labelMatch = matchSportLabel(trimmed);
  if (labelMatch) {
    const rest = labelMatch.rest;
    const vsAtMatch = rest.match(/^(vs\.?|at)\s+(.+?)(?:\s*\(Neutral\))?$/i);
    if (vsAtMatch) {
      const prep = vsAtMatch[1]!.toLowerCase().replace(".", ""); // capture groups present when match succeeds
      const opponent = normalizeOpponentName(vsAtMatch[2]!.trim());
      const isNeutral = /\(Neutral\)/i.test(rest);
      return {
        sportCode: labelMatch.code,
        opponent,
        isHome: isNeutral ? null : prep === "vs" ? true : false,
      };
    }
    // Label matched but no vs/at — just a sport event
    return { sportCode: labelMatch.code, opponent: null, isHome: null };
  }

  return { sportCode: null, opponent: null, isHome: null };
}

// ── Hardcoded home-location detection ──

/** Known Wisconsin facility keywords (case-insensitive substring match). */
const HOME_VENUE_KEYWORDS = [
  "camp randall",
  "kohl center",
  "field house",
  "labahn",
  "goodman",
  "mcClimon",
  "soderholm",
  "nielsen",
  "university ridge",
  "zimmer",
  "porter boathouse",
];

/**
 * Returns true if the raw ICS location text indicates a home event.
 * Rule: "Madison, WI" in text OR any known Wisconsin facility keyword.
 */
export function isHomeLocationText(locationText: string): boolean {
  const lower = normalizeVenueText(locationText)?.toLowerCase() ?? "";
  if (lower.includes("madison, wi")) return true;
  return HOME_VENUE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Full source-event classification: the single derivation shared by ICS sync
 * and by any repair that rebuilds a row from its stored raw evidence. Keeping
 * one implementation is the point — a second copy is how a repaired row starts
 * disagreeing with a freshly synced one.
 *
 * `isHome` is preserved exactly as sync has always computed it. `site` reports
 * the same finding with the ambiguity removed: `isHome === null` means both
 * "neutral site" and "no idea", and those count very differently.
 */
export function classifySourceEvent(input: {
  rawSummary: string;
  rawLocationText?: string | null;
  mappedIsHomeVenue?: boolean | null;
}): {
  summary: string;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  site: "HOME" | "AWAY" | "NEUTRAL" | null;
  result: "WIN" | "LOSS" | "TIE" | null;
} {
  const summary = cleanSourceSummary(input.rawSummary);
  const result = parseEventResult(input.rawSummary);
  const { sportCode, opponent, isHome: summaryIsHome } = extractSportInfo(summary);
  // Read neutral evidence off the raw title: cleanSourceSummary strips a
  // trailing "(Neutral)", so by the cleaned stage the signal is gone.
  const explicitlyNeutral = /\(Neutral\)/i.test(input.rawSummary);

  let isHome = summaryIsHome;
  let site: "HOME" | "AWAY" | "NEUTRAL" | null =
    explicitlyNeutral ? "NEUTRAL" : summaryIsHome === null ? null : summaryIsHome ? "HOME" : "AWAY";

  const locationText = normalizeVenueText(input.rawLocationText) || "";
  if (locationText) {
    const homeByLocation = input.mappedIsHomeVenue === true || isHomeLocationText(locationText);
    if (isHome === null) {
      isHome = homeByLocation;
      if (!explicitlyNeutral) site = homeByLocation ? "HOME" : "AWAY";
    } else if (isHome === true && !homeByLocation) {
      // Summary says "vs" but the venue is not ours — a neutral site.
      isHome = null;
      site = "NEUTRAL";
    }
  }

  return { summary, sportCode, opponent, isHome, site, result };
}
