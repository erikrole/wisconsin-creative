import { scheduleSportFamily } from "@/lib/schedule-sport-family";

// Muted, distinguishable hues. A sport keeps its colour everywhere, and a
// men's and women's team of the same sport share one (via the sport family).
const SPORT_HUES = [210, 150, 30, 275, 0, 180, 330, 95, 245, 55] as const;

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Stable dot colour for a sport code, or null when there is no sport. */
export function sportDotColor(code: string | null | undefined): string | null {
  const family = scheduleSportFamily(code);
  if (!family) return null;
  return `hsl(${SPORT_HUES[hash(family) % SPORT_HUES.length]} 55% 48%)`;
}
