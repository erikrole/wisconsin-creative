export const SPORT_PROGRAMS = ["men", "women"] as const;
type SportProgram = (typeof SPORT_PROGRAMS)[number];

/** UW Athletics sport codes — all 23 varsity sports */
export const SPORT_CODES = [
  { code: "MBB", label: "Men's Basketball", program: "men" },
  { code: "MXC", label: "Men's Cross Country", program: "men" },
  { code: "FB", label: "Football", program: "men" },
  { code: "MGOLF", label: "Men's Golf", program: "men" },
  { code: "MHKY", label: "Men's Hockey", program: "men" },
  { code: "MROW", label: "Men's Rowing", program: "men" },
  { code: "MSOC", label: "Men's Soccer", program: "men" },
  { code: "MSWIM", label: "Men's Swimming & Diving", program: "men" },
  { code: "MTEN", label: "Men's Tennis", program: "men" },
  { code: "MTRACK", label: "Men's Track & Field", program: "men" },
  { code: "WRES", label: "Wrestling", program: "men" },
  { code: "WBB", label: "Women's Basketball", program: "women" },
  { code: "WXC", label: "Women's Cross Country", program: "women" },
  { code: "WGOLF", label: "Women's Golf", program: "women" },
  { code: "WHKY", label: "Women's Hockey", program: "women" },
  { code: "LROW", label: "Lightweight Rowing", program: "women" },
  { code: "WROW", label: "Women's Rowing", program: "women" },
  { code: "WSOC", label: "Women's Soccer", program: "women" },
  { code: "SB", label: "Softball", program: "women" },
  { code: "WSWIM", label: "Women's Swimming & Diving", program: "women" },
  { code: "WTEN", label: "Women's Tennis", program: "women" },
  { code: "WTRACK", label: "Women's Track & Field", program: "women" },
  { code: "VB", label: "Volleyball", program: "women" },
] as const;

export type SportCode = (typeof SPORT_CODES)[number]["code"];
export const SPORT_CODE_SET = new Set<string>(SPORT_CODES.map((sport) => sport.code));

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

export function sportProgram(code: string): SportProgram | null {
  const normalized = normalizeSportCode(code);
  return SPORT_CODES.find((sport) => sport.code === normalized)?.program ?? null;
}

/** Short name for a gendered column: "Men's Basketball" → "Basketball". */
export function sportColumnLabel(code: string): string {
  const label = sportLabel(code);
  return label.replace(/^(Men's|Women's)\s+/, "");
}

export function sportsGroupedByProgram(allowedCodes?: ReadonlySet<string>) {
  const sports = allowedCodes
    ? SPORT_CODES.filter((sport) => allowedCodes.has(sport.code))
    : [...SPORT_CODES];
  return {
    men: sports.filter((sport) => sport.program === "men"),
    women: sports.filter((sport) => sport.program === "women"),
  };
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
