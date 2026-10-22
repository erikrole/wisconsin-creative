import { cleanSourceSummary, normalizeOpponentName } from "@/lib/schedule-event-identity";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";
import { SPORT_CODE_SET, generateEventTitle, sportLabel } from "@/lib/sports";

/** A legacy "(Neutral)" tag; the neutral site belongs in the event detail, not the title. */
const NEUTRAL_SUFFIX = /\s*\(neutral\)\s*$/i;

/**
 * The one booking-title scheme: "<Sport name> vs|at <Opponent>".
 *
 * Older bookings stored the short sport code ("MSOC vs Evansville") while
 * Schedule shows the sport name ("Men's Soccer vs Evansville"). A leading
 * sport code is expanded so every surface reads the same.
 */
function expandLeadingSportCode(title: string): string {
  return SPORT_CODE_SET.has(title) ? sportLabel(title) : title;
}

/**
 * Display-only booking title. Strips imported UW prefixes, expands sport codes
 * to sport names, and for game titles ("<sport> vs|at <opponent>") cleans the
 * opponent the way Schedule does: no ranking, no "University of", no promotion
 * qualifier ("- Homecoming"), no legacy "(Neutral)" tag. Titles that are not
 * games keep their dashes ("Media Day - Kohl Center"), and nothing here
 * rewrites stored or audit values.
 */
export function displayBookingTitle(title: string): string {
  const cleaned = cleanSourceSummary(title);
  const game = cleaned.match(/^(.+?)\s+(vs\.?|at)\s+(.+)$/i);
  if (game) {
    const [, sport = "", word = "vs", rawOpponent = ""] = game;
    const opponent = (normalizeOpponentName(rawOpponent.replace(NEUTRAL_SUFFIX, "")) ?? "").split(" - ")[0]?.trim();
    if (opponent) {
      return normalizeTeamAbbreviations(
        `${expandLeadingSportCode(sport)} ${word.toLowerCase().replace(".", "")} ${opponent}`,
      );
    }
  }
  return normalizeTeamAbbreviations(expandLeadingSportCode(cleaned.replace(NEUTRAL_SUFFIX, "")));
}

/**
 * The title a new booking tied to an event is saved with. Games use the
 * scheme ("Men's Soccer vs Evansville"); anything else keeps the event's own
 * summary, cleaned for display.
 */
export function eventBookingTitle(event: {
  summary: string;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
}, fallbackSportCode?: string | null): string {
  const sportCode = event.sportCode || fallbackSportCode;
  return displayBookingTitle(
    event.opponent && sportCode ? generateEventTitle(sportCode, event.opponent, event.isHome) : event.summary,
  );
}
