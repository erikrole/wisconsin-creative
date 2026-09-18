import { cleanSourceSummary } from "@/lib/schedule-event-identity";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";

/**
 * Display-only booking title. Strips imported UW prefixes and dash
 * qualifiers the same way Schedule does, and corrects team abbreviations,
 * without rewriting stored or audit values.
 */
export function displayBookingTitle(title: string): string {
  const cleaned = cleanSourceSummary(title);
  const [primary = cleaned] = cleaned.split(/\s*[-–—]\s+/);
  return normalizeTeamAbbreviations(primary.trim() || cleaned);
}
