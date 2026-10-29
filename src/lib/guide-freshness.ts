/**
 * How fresh a guide is, in plain words. A guide someone has marked verified
 * reads "Verified 6 days ago"; one that was never verified falls back to its
 * last edit. Either one going untouched for STALE_AFTER_DAYS reads "Needs
 * review", which is the only state the library calls out in color.
 */
export const STALE_AFTER_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export type GuideFreshness = {
  label: string;
  stale: boolean;
  verified: boolean;
};

type FreshnessInput = {
  lastVerifiedAt: Date | string | null;
  updatedAt: Date | string;
};

export function relativeDays(from: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "a year ago" : `${years} years ago`;
}

export function guideFreshness(guide: FreshnessInput, now = new Date()): GuideFreshness {
  const verifiedAt = guide.lastVerifiedAt ? new Date(guide.lastVerifiedAt) : null;
  const reference = verifiedAt ?? new Date(guide.updatedAt);
  const stale = now.getTime() - reference.getTime() > STALE_AFTER_DAYS * DAY_MS;
  if (stale) return { label: "Needs review", stale: true, verified: Boolean(verifiedAt) };
  return {
    label: `${verifiedAt ? "Verified" : "Updated"} ${relativeDays(reference, now)}`,
    stale: false,
    verified: Boolean(verifiedAt),
  };
}
