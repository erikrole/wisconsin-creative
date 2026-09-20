import { SPORT_CODE_SET } from "./sports";

const LOWERCASE_TITLE_WORDS = new Set([
  "a", "an", "and", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "vs", "with",
]);

/**
 * Team abbreviations that are conventionally written as all caps.
 * Keep this explicit so ordinary team names such as Iowa still title-case.
 */
const TEAM_ABBREVIATION_TERMS = new Set([
  "ASU", "BYU", "CSU", "ECU", "ETSU", "FAU", "FGCU", "FIU", "LSU", "LIU", "NIU", "NDSU", "ODU",
  "OSU", "SDSU", "SFA", "SIU", "SIUE", "SMU", "TCU", "UAB", "UCF", "UCLA", "UIC", "UMBC", "UMKC",
  "UNLV", "USC", "USF", "UTEP", "UTRGV", "UTSA", "VCU", "WKU", "WSU",
]);

/** USPS postal abbreviations for the 50 states. */
export const STATE_ABBREVIATION_TERMS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY",
]);

/**
 * Terms that are always written in full caps, regardless of how they were typed or imported.
 * Sport codes are handled separately via SPORT_CODE_SET. Only add terms that are never a
 * normal English word in lowercase, otherwise ordinary titles get shouted at.
 */
const ALWAYS_UPPERCASE_TERMS = new Set([
  // Conference and governing bodies
  "B1G", "NCAA", "BTN",
  // Volleyball organizations
  "AVCA",
  // Broadcast and media partners
  "ESPN", "FS1", "CBS", "NBC", "ABC",
  // Gear and production shorthand
  "AV", "TV", "LED", "SDI", "XLR", "USB", "HDMI", "DSLR", "DJI", "4K", "UHD", "HD",
  // Program shorthand
  "UW", "NIL", "VIP", "UX",
  // "AD" is always athletic director in this product, never the article "ad".
  "AD",
]);

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function isStateAbbreviationToken(value: string, word: string, offset: number, normalizedCode: string) {
  if (!STATE_ABBREVIATION_TERMS.has(normalizedCode)) return false;
  if (word === normalizedCode) return true;

  // A parenthesized two-letter code is unambiguous even when imported as
  // title case, e.g. "Saint Mary's (Ca)".
  const before = value.slice(0, offset);
  const after = value.slice(offset + word.length);
  return /\(\s*$/u.test(before) && /^\s*\)/u.test(after);
}

/** Correct known team abbreviations in legacy display values without changing other words. */
export function normalizeTeamAbbreviations(value: string): string {
  return value.replace(WORD_PATTERN, (word) => {
    const possessive = /^(.+)(['’])s$/iu.exec(word);
    const stem = possessive?.[1] ?? word;
    const normalizedStem = stem.toUpperCase();
    if (!TEAM_ABBREVIATION_TERMS.has(normalizedStem)) return word;
    return possessive ? `${normalizedStem}${possessive[2]}s` : normalizedStem;
  });
}

/** Standardize an operational title while preserving UW sport codes and camel-cased product names. */
function normalizeOperationalTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  const words = [...title.matchAll(WORD_PATTERN)];

  return title.replace(WORD_PATTERN, (word, offset: number) => {
    const normalizedCode = word.toUpperCase();
    if (isStateAbbreviationToken(title, word, offset, normalizedCode)) return normalizedCode;
    if (SPORT_CODE_SET.has(normalizedCode) || TEAM_ABBREVIATION_TERMS.has(normalizedCode)) return normalizedCode;
    if (ALWAYS_UPPERCASE_TERMS.has(normalizedCode)) return normalizedCode;

    // "b1g's" / "uw's" keep the term uppercase and the possessive lowercase.
    const possessive = /^(.+)(['’])s$/iu.exec(word);
    if (possessive) {
      const stem = (possessive[1] ?? "").toUpperCase();
      if (SPORT_CODE_SET.has(stem) || TEAM_ABBREVIATION_TERMS.has(stem) || ALWAYS_UPPERCASE_TERMS.has(stem)) {
        return `${stem}${possessive[2]}s`;
      }
    }

    const wordIndex = words.findIndex((match) => match.index === offset);
    const lower = word.toLocaleLowerCase("en-US");
    const isEdgeWord = wordIndex === 0 || wordIndex === words.length - 1;
    if (!isEdgeWord && LOWERCASE_TITLE_WORDS.has(lower)) return lower;

    if (/\p{Ll}.*\p{Lu}/u.test(word)) return word;
    return lower.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("en-US"));
  });
}

export const normalizeBookingTitle = normalizeOperationalTitle;
export const normalizeManualEventTitle = normalizeOperationalTitle;
