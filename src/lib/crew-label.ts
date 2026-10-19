export const CREW_LABEL_MAX_LENGTH = 24;

export const CREW_HALVES = ["FIRST", "SECOND"] as const;
export type CrewHalf = (typeof CREW_HALVES)[number];

const HALF_SHORT: Record<CrewHalf, string> = { FIRST: "1st half", SECOND: "2nd half" };

export function crewHalfLabel(half: CrewHalf | null | undefined): string | null {
  return half ? HALF_SHORT[half] : null;
}

/** Trim and collapse whitespace; an empty tag is no tag. */
export function normalizeCrewLabel(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim().slice(0, CREW_LABEL_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/** "SLOW1 · 1st half", or whichever part is set. null when neither is. */
export function crewTagText(
  label: string | null | undefined,
  half: CrewHalf | null | undefined,
): string | null {
  const parts = [label?.trim() || null, crewHalfLabel(half)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
