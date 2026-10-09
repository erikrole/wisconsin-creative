import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forbiddenReleaseTerms, groupReleases, releaseSlug, releases } from "@/lib/releases";

const releasesLayoutSource = readFileSync("src/app/(public)/releases/layout.tsx", "utf8");
const releasesPageSource = readFileSync("src/app/(public)/releases/page.tsx", "utf8");
const platforms = new Set(["Web", "iOS", "Kiosk", "macOS"]);
const types = new Set(["feature", "improvement", "fixes"]);

describe("public release notes", () => {
  it("has releases with valid ISO dates, newest first", () => {
    expect(releases.length).toBeGreaterThan(20);
    for (const release of releases) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${release.date}T12:00:00Z`))).toBe(false);
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
