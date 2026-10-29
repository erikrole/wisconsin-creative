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

export const MAX_CREW_TAGS = 4;

/** One position label and the part of the event it covers (null = the whole event). */
export type CrewTagValue = { label: string | null; half: CrewHalf | null };

/** Drop empty tags and cap the list. The first tag is mirrored to the legacy crewLabel/crewHalf columns. */
export function normalizeCrewTags(tags: ReadonlyArray<CrewTagValue> | null | undefined): CrewTagValue[] {
  return (tags ?? [])
    .map((tag) => ({ label: normalizeCrewLabel(tag.label), half: tag.half ?? null }))
    .filter((tag) => tag.label !== null || tag.half !== null)
    .slice(0, MAX_CREW_TAGS);
}

/** The assignment's tags, falling back to the single label/half saved before multiple tags existed. */
export function crewTagsOf(assignment: {
  crewTags?: unknown;
  crewLabel?: string | null;
  crewHalf?: CrewHalf | null;
}): CrewTagValue[] {
  if (Array.isArray(assignment.crewTags)) return normalizeCrewTags(assignment.crewTags as CrewTagValue[]);
  return normalizeCrewTags([{ label: assignment.crewLabel ?? null, half: assignment.crewHalf ?? null }]);
}
