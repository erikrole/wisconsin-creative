export const VENUE_TONE_VALUES = ["home", "away", "neutral", "non-game"] as const;
export type VenueTone = (typeof VENUE_TONE_VALUES)[number];
export type VenueFilter = "all" | VenueTone;
export type CalendarEventSiteValue = "HOME" | "AWAY" | "NEUTRAL";

type VenueToneStyle = {
  label: string;
  badgeVariant: "green" | "orange" | "gray";
  railClass: string;
  solidClass: string;
  surfaceClass: string;
  activeTabClass: string;
};

export const VENUE_FILTER_OPTIONS: Array<{ value: VenueFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "home", label: "Home" },
  { value: "away", label: "Away" },
  { value: "neutral", label: "Neutral" },
  { value: "non-game", label: "Non-game" },
];

export const VENUE_TONES: Record<VenueTone, VenueToneStyle> = {
  home: {
    label: "Home",
    badgeVariant: "green",
    railClass: "border-l-[var(--green)]",
    solidClass: "bg-[var(--green)]",
    surfaceClass: "bg-[var(--green)]/10 hover:bg-[var(--green)]/18",
    activeTabClass: "bg-[var(--green)]/15 text-[var(--green-text)]",
  },
  away: {
    label: "Away",
    badgeVariant: "orange",
    railClass: "border-l-[var(--orange)]",
    solidClass: "bg-[var(--orange)]",
    surfaceClass: "bg-[var(--orange)]/10 hover:bg-[var(--orange)]/18",
    activeTabClass: "bg-[var(--orange)]/15 text-[var(--orange-text)]",
  },
  neutral: {
    label: "Neutral",
    badgeVariant: "gray",
    railClass: "border-l-muted-foreground/35",
    solidClass: "bg-muted-foreground/55",
    surfaceClass: "bg-muted/50 hover:bg-muted",
    activeTabClass: "bg-muted text-foreground",
  },
  // Non-game keeps its own label and filter, but not its own color: it is the
  // absence of a venue direction, same as neutral. It used to paint rails and
  // surfaces with `--blue` while its badge stayed gray -- one concept wearing
  // two colors in a single object -- and blue is what the gear domain uses for
  // active custody, so it was borrowed from a vocabulary it has no part in.
  "non-game": {
    label: "Non-game",
    badgeVariant: "gray",
    railClass: "border-l-muted-foreground/35",
    solidClass: "bg-muted-foreground/55",
    surfaceClass: "bg-muted/50 hover:bg-muted",
    activeTabClass: "bg-muted text-foreground",
  },
};

export function venueToneFromIsHome(isHome: boolean | null | undefined): Exclude<VenueTone, "non-game"> {
  if (isHome === true) return "home";
  if (isHome === false) return "away";
  return "neutral";
}

export function isHomeFromVenueTone(tone: VenueTone): boolean | null {
  if (tone === "home") return true;
  if (tone === "away") return false;
  return null;
}

/** Store the same venue direction used by Schedule as the event's canonical site. */
export function siteFromVenueTone(tone: VenueTone): CalendarEventSiteValue | null {
  if (tone === "home") return "HOME";
  if (tone === "away") return "AWAY";
  if (tone === "neutral") return "NEUTRAL";
  return null;
}

function venueToneFromSite(site: CalendarEventSiteValue): Exclude<VenueTone, "non-game"> {
  if (site === "HOME") return "home";
  if (site === "AWAY") return "away";
  return "neutral";
}

export function venueToneFromEvent(event: {
  isHome?: boolean | null;
  site?: CalendarEventSiteValue | null;
  opponent?: string | null;
  summary?: string | null;
  rawSummary?: string | null;
}): VenueTone {
  if (!event.opponent) return "non-game";
  if (event.site) return venueToneFromSite(event.site);
  const title = event.rawSummary ?? event.summary ?? "";
  const prefix = title.match(/^\s*\[([HAN])\]/i)?.[1]?.toUpperCase();
  if (prefix === "H") return "home";
  if (prefix === "A") return "away";
  if (prefix === "N") return "neutral";
  return venueToneFromIsHome(event.isHome);
}

/**
 * The site an event's stored evidence implies, for the write paths that have to
 * persist one.
 *
 * `isHome` is a nullable boolean, so it cannot tell a neutral-site game apart
 * from an unclassifiable one -- that ambiguity is the whole reason `site`
 * exists. Anything deriving a site from `isHome` alone reintroduces it and
 * turns every neutral game into an unknown one. Route the derivation through
 * `venueToneFromEvent` instead, so a stored site still wins and the fallback
 * says what Schedule has always displayed for the same row.
 */
export function resolvedEventSite(event: {
  isHome?: boolean | null;
  site?: CalendarEventSiteValue | null;
  opponent?: string | null;
  summary?: string | null;
  rawSummary?: string | null;
}): CalendarEventSiteValue | null {
  return siteFromVenueTone(venueToneFromEvent(event));
}

export function venueBadgeVariant(isHome: boolean | null | undefined): VenueToneStyle["badgeVariant"] {
  return VENUE_TONES[venueToneFromIsHome(isHome)].badgeVariant;
}

export function venueFilterActiveClass(value: VenueFilter): string {
  if (value === "all") return "bg-background text-foreground";
  return VENUE_TONES[value].activeTabClass;
}
