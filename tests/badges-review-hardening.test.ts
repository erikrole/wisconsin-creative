import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { badgeIcon, badgeIconNames } from "@/components/badges/badge-artwork";
import {
  badgeRarityMedallionClass,
  getBadgeRarityDetail,
  isHiddenUntilEarnedBadge,
  RARITY_PROVING_PERIOD_MS,
} from "@/lib/badges/display";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/** Every icon name the seeded catalog and the custom-badge picker can produce. */
function catalogIconNames(): string[] {
  const icons = new Set<string>();
  const migrationsDir = path.join(process.cwd(), "prisma/migrations");
  for (const dir of readdirSync(migrationsDir)) {
    if (!/badge/i.test(dir)) continue;
    const sql = readFileSync(path.join(migrationsDir, dir, "migration.sql"), "utf8");
    for (const line of sql.split("\n")) {
      const row = line.trim();
      if (!row.startsWith("('seed_badge_") && !row.startsWith("('badge_")) continue;
      const quoted = [...row.matchAll(/'([^']*)'/g)].map((match) => match[1]);
      if (quoted[4]) icons.add(quoted[4]);
    }
  }
  const display = source("src/lib/badges/display.ts");
  const start = display.indexOf("export const customBadgeIconOptions");
  for (const match of display.slice(start, display.indexOf("] as const;", start)).matchAll(/"([A-Za-z0-9]+)"/g)) {
    if (match[1]) icons.add(match[1]);
  }
  return [...icons].sort();
}

describe("web badge artwork is one system", () => {
  it("answers every catalog icon with a real glyph", () => {
    const names = catalogIconNames();
    expect(names.length).toBeGreaterThan(15);
    expect(names.filter((name) => !badgeIconNames.includes(name))).toEqual([]);
  });

  it("keeps one icon table on the web, not one per surface", () => {
    // The defect this guards is the one iOS was fixed for in July: the badge
    // shelf and the reward celebration each carried their own Lucide table, so
    // they were free to drift apart glyph by glyph.
    const tabbed = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");
    const celebration = source("src/components/badges/BadgeEarnedCelebration.tsx");
    const declaration = "const iconMap: Record<string, ComponentType<{ className?: string }>>";
    expect(tabbed).not.toContain(declaration);
    expect(celebration).not.toContain(declaration);
    expect(tabbed).toContain('from "@/components/badges/badge-artwork"');
    expect(celebration).toContain('from "@/components/badges/badge-artwork"');
  });

  it("draws one disc, not four silhouettes that render as one", () => {
    // The shape map this replaces claimed coin/hex/shield/stack, but the rim,
    // the rarity ring, and the shadow all belonged to a rounded rect and the
    // shape survived only as a faint SVG outline inside it -- at 48px, `hex`
    // was `rounded-[1.35rem]`, i.e. a circle. Four shapes, one appearance, and
    // a divergence from iOS, which dropped the same silhouettes in July.
    const medallion = source("src/components/badges/BadgeMedallion.tsx");
    expect(medallion).toContain("rounded-full");
    expect(medallion).not.toContain("shapePath");
    expect(medallion).not.toContain("BadgeMedallionShape");

    for (const file of [
      "src/app/(app)/users/[id]/UserBadgesTab.tsx",
      "src/app/(app)/users/[id]/page.tsx",
      "src/components/badges/BadgeEarnedCelebration.tsx",
      "src/components/badges/badge-artwork.ts",
    ]) {
      expect(source(file)).not.toContain("badgeMedallionShape");
    }
  });

  it("keeps the earned glyph readable on every rarity disc", () => {
    // The disc is a saturated fill under a *white* glyph, so its colours are
    // chosen against white, not against the page. `--orange` (#f59e0b) carries
    // white at 2.2:1 -- under the 3:1 WCAG non-text minimum -- which is why the
    // discs have their own tokens rather than reusing the semantic palette.
    const css = source("src/app/globals.css");
    for (const token of [
      "--badge-common",
      "--badge-uncommon",
      "--badge-rare",
      "--badge-legendary",
    ]) {
      expect(css).toContain(`${token}: #`);
      expect(css).toContain(`${token}-deep: #`);
    }

    for (const rarity of ["Common", "Uncommon", "Rare", "Legendary"] as const) {
      expect(badgeRarityMedallionClass(rarity, true)).toContain("text-white");
    }
    // Locked keeps the muted wash that carries its own dimmed glyph.
    expect(badgeRarityMedallionClass("Legendary", false)).toContain("text-muted-foreground");
  });

  it("falls back to one shared trophy rather than nothing", () => {
    const fallback = badgeIcon("NotARealLucideIcon");
    expect(fallback).toBeDefined();
    expect(badgeIcon(null)).toBe(fallback);
    expect(badgeIcon(undefined)).toBe(fallback);
    expect(badgeIcon("PackageCheck")).not.toBe(fallback);
  });
});

describe("badge revoke targets the award row", () => {
  it("serves the StudentBadge id alongside the definition id", () => {
    const queries = source("src/lib/badges/queries.ts");
    // The profile mapper keys every row by `definition.id`. Revoke resolves a
    // `StudentBadge`, so without this field the tab had nothing correct to send.
    expect(queries).toContain("awardId: award?.id ?? null,");
  });

  it("sends the award id, never the definition id", () => {
    const tabbed = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");
    // The defect this guards: `/api/badges/award/${badge.id}` posted a
    // `BadgeDefinition` id to a route that looks up a `StudentBadge` by id, so
    // every revoke in the badge tab 404'd with "Badge award not found".
    expect(tabbed).not.toContain("/api/badges/award/${badge.id}");
    expect(tabbed).toContain("/api/badges/award/${awardId}");
    expect(tabbed).toContain("const awardId = badge.awardId;");
  });
});

describe("app open stays a foreground event", () => {
  it("does not re-bootstrap the reward poll on navigation", () => {
    const shell = source("src/components/AppShell.tsx");
    // The defect this guards: `pathname` sat in this effect's dependency list,
    // so every client-side navigation tore the poll down and re-ran its
    // bootstrap -- three reward reads plus a POST to the app-open evaluator,
    // which opens a Serializable transaction on any day a rule matches.
    expect(shell).toContain("}, [isRolePreview, rewardUserId]);");
    expect(shell).toContain("rewardPathRef.current");
    expect(shell).not.toContain("}, [isRolePreview, pathname, user]);");
  });
});

describe("badge catalog listing keeps surprises hidden", () => {
  it("filters hidden definitions out of the shared catalog route", () => {
    const route = source("src/app/api/badges/route.ts");
    // Every other badge surface filters hidden keys client-side. This listing
    // had no filter at all, so it handed any signed-in user the name and
    // description of every unearned easter egg.
    expect(route).toContain("isHiddenUntilEarnedBadge");
    expect(isHiddenUntilEarnedBadge("go_to_bed")).toBe(true);
    expect(isHiddenUntilEarnedBadge("holiday_hours")).toBe(true);
  });
});

describe("rarity counts one population", () => {
  it("measures holders against the same roster it divides by", () => {
    const queries = source("src/lib/badges/queries.ts");
    // `eligible` is `user.active === true`. Counting every award row against
    // that denominator let a badge held mostly by departed students report a
    // share above 1.0 and read as Common.
    const holderBlocks = [...queries.matchAll(/groupBy\(\{\s*by: \["definitionId"\],([\s\S]*?)\}\)/g)];
    expect(holderBlocks.length).toBe(2);
    for (const block of holderBlocks) {
      expect(block[1]).toContain("user: { active: true }");
    }
  });
});

describe("app open cannot be minted by a formatting failure", () => {
  it("reads an unreadable hour as -1, not midnight", () => {
    const evaluator = source("src/lib/badges/evaluator.ts");
    // `Number("")` is `0`, which is exactly what `local_hour_0` matches on.
    expect(evaluator).toContain('hour: Number(value("hour") || -1),');
    expect(evaluator).not.toContain('hour: Number(value("hour")),');
  });
});

describe("a badge shelf stays readable at catalog scale", () => {
  const tab = () => source("src/app/(app)/users/[id]/UserBadgesTab.tsx");

  it("collapses a long shelf instead of rendering all 98 tiles", () => {
    // The flat always-visible shelf was designed against a 30-badge catalog.
    // The catalog is 115 definitions now; 98 are visible once the v8 expansion
    // deploys, which is 23 rows at the widest breakpoint. Gear Flow and
    // Teamwork carry 36 tiles each.
    const source_ = tab();
    expect(source_).toContain("const SHELF_PREVIEW_COUNT = 10;");
    expect(source_).toContain("filteredBadges.slice(0, SHELF_PREVIEW_COUNT)");
    // A filter is the reader narrowing on purpose -- never collapse on top of it.
    expect(source_).toContain('const collapsible = filter === "all" && filteredBadges.length > SHELF_PREVIEW_COUNT;');
  });

  it("previews the goals in reach, not whatever the catalog sorted first", () => {
    // Collapsing is only worth doing if the visible rows are the useful ones.
    const source_ = tab();
    expect(source_).toContain("const aStarted = hasProgress(a) && a.progressCurrent! > 0;");
    expect(source_).toContain("if (aShare !== bShare) return bShare - aShare;");
  });

  it("reports hidden awards once per page, not once per shelf", () => {
    // Four shelves held a hidden definition, so four identical "Surprise
    // awards" tiles rendered on one screen for a count the summary band
    // already reports.
    const source_ = tab();
    expect(source_).not.toContain("function SurpriseTile");
    expect(source_).not.toContain("showSurpriseTile");
    expect(source_).toContain("hidden until earned.");
  });

  it("tells a locked badge what earns it", () => {
    // `25 required` never said twenty-five of what, and the sentence that does
    // was already in the payload.
    const source_ = tab();
    expect(source_).toContain("if (badge.description) return badge.description;");
    expect(source_).not.toContain("${badge.threshold} required");
    // Two reserved lines, so a row of tiles keeps one baseline.
    expect(source_).toContain("line-clamp-2 min-h-8");
  });

  it("leads the summary band with the count, not a percentage of a catalog built to be unearned", () => {
    const source_ = tab();
    expect(source_).toContain('{earned === 1 ? "badge" : "badges"}');
    expect(source_).not.toContain("{completion}%");
    // The proportion still rides along on the bar.
    expect(source_).toContain("<Progress value={completion}");
  });
});

describe("rarity says when it is a guess", () => {
  const base = {
    key: "checkout_sprint",
    category: "CHECKOUT",
    kind: "COUNT",
    trigger: "checkout:opened",
    threshold: 5,
  };
  const now = new Date("2026-08-27T12:00:00Z");
  const old = new Date(now.getTime() - RARITY_PROVING_PERIOD_MS - 86_400_000);

  it("marks a rating provisional while nobody holds the badge", () => {
    const detail = getBadgeRarityDetail({ ...base, holders: 0, eligible: 40, createdAt: old }, now);
    expect(detail.provisional).toBe(true);
  });

  it("marks a rating provisional inside the proving period", () => {
    // The v8 expansion adds 50 definitions at once, so a large share of the
    // catalog sits in this window at launch.
    const fresh = new Date(now.getTime() - 6 * 86_400_000);
    const detail = getBadgeRarityDetail({ ...base, holders: 3, eligible: 40, createdAt: fresh }, now);
    expect(detail.provisional).toBe(true);
  });

  it("does not hedge a rating it actually measured", () => {
    const detail = getBadgeRarityDetail({ ...base, holders: 2, eligible: 40, createdAt: old }, now);
    expect(detail.provisional).toBe(false);
    expect(detail.rarity).toBe("Rare");
  });

  it("serves the flag rather than leaving each client to re-derive it", () => {
    expect(source("src/lib/badges/queries.ts")).toContain("rarityProvisional: rarityDetail.provisional,");
    // And the tab must actually say so, in both places rarity appears.
    const tab = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");
    expect(tab).toContain('if (badge.rarityProvisional) return "Too new to rate by scarcity yet";');
    expect(tab).toContain("`${rarity} (provisional)`");
  });
});
