import releaseEntries from "./releases.json";

export type ReleasePlatform = "Web" | "iOS" | "Kiosk" | "macOS";

export type ReleaseType = "feature" | "improvement" | "fixes";

export type Release = {
  /** ISO date (YYYY-MM-DD) the work landed on main; the PR merge date when `pr` is set. */
  date: string;
  title: string;
  type: ReleaseType;
  summary: string;
  details?: string[];
  platforms: ReleasePlatform[];
  /** Merged pull request this release maps to, when there is one. */
  pr?: number;
  /** Only for real tagged builds. */
  version?: string;
};

export type ReleaseDay = {
  date: string;
  releases: Release[];
};

export type ReleaseMonth = {
  key: string;
  label: string;
  days: ReleaseDay[];
};

/** Newest first. Edit `releases.json` to add a release. */
export const releases: Release[] = releaseEntries as Release[];

/** Terms that must never appear in public release copy. */
export const forbiddenReleaseTerms = [
  "incident",
  "exploit",
  "vulnerab",
  "cve-",
  "csp",
  "nonce",
  "secret",
  "api key",
  "prisma",
  "migration",
  "erole",
];

export function releaseSlug(release: Pick<Release, "date" | "title">) {
  const title = release.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${release.date}-${title}`;
}

export function formatReleaseDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function groupReleases(entries: Release[]): ReleaseMonth[] {
  const months: ReleaseMonth[] = [];
  for (const release of entries) {
    const key = release.date.slice(0, 7);
    let month = months.at(-1);
    if (!month || month.key !== key) {
      month = {
        key,
        label: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
          new Date(`${key}-15T12:00:00Z`),
        ),
        days: [],
      };
      months.push(month);
    }
    let day = month.days.at(-1);
    if (!day || day.date !== release.date) {
      day = { date: release.date, releases: [] };
      month.days.push(day);
    }
    day.releases.push(release);
  }
  return months;
}
