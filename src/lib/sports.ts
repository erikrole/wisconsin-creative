/** UW Athletics sport codes — all 23 varsity sports */
export const SPORT_CODES = [
  // ── Men's Sports (11) ──
  { code: "MBB", label: "Men's Basketball" },
  { code: "MXC", label: "Men's Cross Country" },
  { code: "FB", label: "Football" },
  { code: "MGOLF", label: "Men's Golf" },
  { code: "MHKY", label: "Men's Hockey" },
  { code: "MROW", label: "Men's Rowing" },
  { code: "MSOC", label: "Men's Soccer" },
  { code: "MSWIM", label: "Men's Swimming & Diving" },
  { code: "MTEN", label: "Men's Tennis" },
  { code: "MTRACK", label: "Men's Track & Field" },
  { code: "WRES", label: "Wrestling" },
  // ── Women's Sports (12) ──
  { code: "WBB", label: "Women's Basketball" },
  { code: "WXC", label: "Women's Cross Country" },
  { code: "WGOLF", label: "Women's Golf" },
  { code: "WHKY", label: "Women's Hockey" },
  { code: "LROW", label: "Lightweight Rowing" },
  { code: "WROW", label: "Women's Rowing" },
  { code: "WSOC", label: "Women's Soccer" },
  { code: "SB", label: "Softball" },
  { code: "WSWIM", label: "Women's Swimming & Diving" },
  { code: "WTEN", label: "Women's Tennis" },
  { code: "WTRACK", label: "Women's Track & Field" },
  { code: "VB", label: "Volleyball" },
] as const;

export type SportCode = (typeof SPORT_CODES)[number]["code"];
export const SPORT_CODE_SET = new Set<string>(SPORT_CODES.map((sport) => sport.code));

export const BIG_SIX_SPORT_CODES = ["FB", "MBB", "WBB", "MHKY", "WHKY", "VB"] as const;
export const BIG_SIX_SPORT_CODE_SET = new Set<string>(BIG_SIX_SPORT_CODES);
export const VARSITY_OWNERSHIP_AREAS = ["VIDEO", "PHOTO", "GRAPHICS"] as const;

export function isBigSixSportCode(value: string | null | undefined): boolean {
  return Boolean(value && BIG_SIX_SPORT_CODE_SET.has(normalizeSportCode(value)));
}

export function isVarsityOwnershipArea(value: string): value is (typeof VARSITY_OWNERSHIP_AREAS)[number] {
  return (VARSITY_OWNERSHIP_AREAS as readonly string[]).includes(value);
}

export function normalizeSportCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isSportCode(value: string): value is SportCode {
  return SPORT_CODE_SET.has(normalizeSportCode(value));
}

/** Legacy code aliases — maps old ungendered codes to labels for backward compat */
const LEGACY_LABELS: Record<string, string> = {
  SWIM: "Swimming & Diving",
  TF: "Track & Field",
  XC: "Cross Country",
  GOLF: "Golf",
  ROW: "Rowing",
  TEN: "Tennis",
  GYM: "Gymnastics",
  BASE: "Baseball",
};

export function sportLabel(code: string): string {
  const normalized = normalizeSportCode(code);
  return (
    SPORT_CODES.find((s) => s.code === normalized)?.label ??
    LEGACY_LABELS[normalized] ??
    code
  );
}

/**
 * Generate a checkout title from an event.
 * - Home: "{sportCode} vs {opponent}"
 * - Away: "{sportCode} at {opponent}"
 * - Neutral/unknown: "{sportCode} vs {opponent} (Neutral)"
 */
export function generateEventTitle(
  sportCode: string,
  opponent: string | null | undefined,
  isHome: boolean | null | undefined
): string {
  const opp = opponent || "TBD";
  if (isHome === true) return `${sportCode} vs ${opp}`;
  if (isHome === false) return `${sportCode} at ${opp}`;
  return `${sportCode} vs ${opp} (Neutral)`;
}
