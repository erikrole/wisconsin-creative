import type { CalendarEventSite } from "@prisma/client";

export const SITE_LABELS: Record<CalendarEventSite, string> = {
  HOME: "Home",
  AWAY: "Away",
  NEUTRAL: "Neutral",
};

export function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function siteLabel(site: CalendarEventSite | null): string {
  return site ? SITE_LABELS[site] : "Unknown site";
}

/**
 * Standard winning percentage, with a tie counting as half a win. Returns
 * null when no games have been played rather than dividing by zero.
 */
export function winRate(wins: number, losses: number, ties: number): number | null {
  const games = wins + losses + ties;
  if (games === 0) return null;
  return Math.round(((wins + ties / 2) / games) * 1000) / 10;
}
