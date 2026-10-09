import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forbiddenReleaseTerms, groupReleases, releaseSlug, releases } from "@/lib/releases";
// @ts-expect-error -- plain ESM script without type declarations
import { isRealIsoDate, releaseEntryProblems } from "../scripts/check-release-note.mjs";

const releasesLayoutSource = readFileSync("src/app/(public)/releases/layout.tsx", "utf8");
const releasesPageSource = readFileSync("src/app/(public)/releases/page.tsx", "utf8");
const platforms = new Set(["Web", "iOS", "Kiosk", "macOS"]);
const types = new Set(["feature", "improvement", "fixes"]);

describe("public release notes", () => {
  it("has releases with valid ISO dates, newest first", () => {
    expect(releases.length).toBeGreaterThan(20);
    for (const release of releases) {
      expect(isRealIsoDate(release.date), release.date).toBe(true);
    }
    const dates = releases.map((release) => release.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("gives every release a unique anchor and complete fields", () => {
    const slugs = releases.map(releaseSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const release of releases) {
      expect(release.title.trim().length).toBeGreaterThan(3);
      expect(release.summary.trim().length).toBeGreaterThan(20);
      expect(types.has(release.type)).toBe(true);
      expect(release.platforms.length).toBeGreaterThan(0);
      for (const platform of release.platforms) expect(platforms.has(platform)).toBe(true);
    }
  });

  it("holds every release, including the backfill, to the release-note contract", () => {
    const failures = releases
      .map((release) => ({ release: `${release.date} ${release.title}`, problems: releaseEntryProblems(release) }))
      .filter((result) => result.problems.length > 0);
    expect(failures).toEqual([]);
  });

  it("groups every release into exactly one day", () => {
    const grouped = groupReleases(releases).flatMap((month) => month.days.flatMap((day) => day.releases));
    expect(grouped).toHaveLength(releases.length);
  });

  it("keeps release copy public-safe", () => {
    const corpus = JSON.stringify(releases).toLowerCase();
    expect(corpus).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
    expect(corpus).not.toMatch(/\$\d/);
    for (const term of forbiddenReleaseTerms) {
      expect(corpus).not.toContain(term.toLowerCase());
    }
  });

  it("stays static and pinned to light tokens", () => {
    expect(releasesLayoutSource).toContain('data-theme="light"');
    expect(releasesLayoutSource).toContain('colorScheme: "light"');
    expect(releasesPageSource).not.toContain("fetch(");
    expect(releasesPageSource).not.toContain("prisma");
  });
});

describe("public release feed", () => {
  it("serves an RSS feed of the latest releases with escaped content", async () => {
    const { GET } = await import("@/app/(public)/releases/feed.xml/route");
    const response = GET();
    expect(response.headers.get("Content-Type")).toContain("application/rss+xml");
    const xml = await response.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.match(/<item>/g)?.length).toBe(Math.min(50, releases.length));
    expect(xml).toContain(`/releases#${releaseSlug(releases[0]!)}`);
    expect(xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("shows recent releases first and collapses older history", () => {
    const feedSource = readFileSync("src/components/public-showroom/ReleasesFeed.tsx", "utf8");
    expect(feedSource).toContain("isRecentRelease");
    expect(feedSource).toContain("Show {hiddenCount} earlier");
    expect(feedSource).toContain("<details");
  });
});
