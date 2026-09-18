import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/**
 * The one native badge icon map, shared by every surface that draws a badge.
 *
 * It lives in `Shared/BadgeEarnedCelebration.swift` because that file is a
 * member of both the Wisconsin and WisconsinKiosk targets.
 */
function sharedIconMap(): string {
  const shared = source("ios/Wisconsin/Shared/BadgeEarnedCelebration.swift");
  const start = shared.indexOf("static func symbolName(for lucideIcon: String) -> String {");
  const end = shared.indexOf('default: "trophy.fill"', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return shared.slice(start, end);
}

/**
 * Every icon name the badge catalog can hand to iOS.
 *
 * Two sources: the seeded definitions in the badge migrations, and the icons an
 * admin can pick when creating a custom badge. Both end up in
 * `BadgeDefinition.icon` as Lucide names, because the catalog was authored for
 * the web.
 */
function catalogIconNames(): string[] {
  const icons = new Set<string>();

  // Seeded rows. The insert lists columns in a fixed order and `icon` is the
  // fifth quoted value on each VALUES row.
  const migrationsDir = path.join(process.cwd(), "prisma/migrations");
  for (const dir of readdirSync(migrationsDir)) {
    if (!/badge/i.test(dir)) continue;
    const sql = readFileSync(path.join(migrationsDir, dir, "migration.sql"), "utf8");
    for (const line of sql.split("\n")) {
      const row = line.trim();
      if (!row.startsWith("('seed_badge_") && !row.startsWith("('badge_")) continue;
      const quoted = [...row.matchAll(/'([^']*)'/g)].map((match) => match[1]);
      const icon = quoted[4];
      if (icon) icons.add(icon);
    }
  }

  // Custom-badge picker options.
  const display = source("src/lib/badges/display.ts");
  const picker = display.slice(
    display.indexOf("export const customBadgeIconOptions"),
    display.indexOf("] as const;", display.indexOf("export const customBadgeIconOptions")),
  );
  for (const match of picker.matchAll(/"([A-Za-z0-9]+)"/g)) {
    const icon = match[1];
    if (icon) icons.add(icon);
  }

  return [...icons].filter(Boolean).sort();
}

describe("iOS badge icon coverage", () => {
  it("answers every catalog icon with a real SF Symbol", () => {
    const map = sharedIconMap();
    const names = catalogIconNames();
    // Sanity: the extractor found the catalog, not an empty set.
    expect(names.length).toBeGreaterThan(15);
    expect(names).toContain("PackageCheck");
    expect(names).toContain("ScanLine");

    // The defect this guards: iOS knew twelve names, the catalog used twenty
    // others, they overlapped on `Trophy`, and every other badge fell through
    // to `seal.fill` -- so a profile showed one glyph repeated.
    const unmapped = names.filter((name) => !map.includes(`case "${name}":`));
    expect(unmapped).toEqual([]);
  });

  it("keeps distinct badges on distinct symbols", () => {
    const symbols = [...sharedIconMap().matchAll(/case "[A-Za-z0-9]+": "([a-z0-9.]+)"/g)]
      .flatMap((match) => match[1] ? [match[1]] : []);
    expect(symbols.length).toBeGreaterThan(25);
    // A one-to-one map. Two badges sharing a symbol is a milder version of the
    // same bug: the shelf stops telling them apart.
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("draws every badge surface from the one shared map", () => {
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
    const shared = source("ios/Wisconsin/Shared/BadgeEarnedCelebration.swift");

    // The defect this guards: the profile badge page and the earned-badge
    // celebration each carried their own Lucide -> SF Symbol table. Twelve
    // catalog icons resolved differently between them, and none of the eleven
    // custom-badge picker icons existed in the celebration's copy, so every
    // custom award celebrated as a generic trophy and then changed picture on
    // the shelf.
    expect(detail).toContain("BadgeArtwork.symbolName(for: badge.icon)");
    expect(shared).toContain("var symbolName: String { BadgeArtwork.symbolName(for: icon) }");

    // Exactly one `case "Lucide": "sf.symbol"` table in the native badge code.
    const tableLine = /case "[A-Za-z0-9]+"(, "[A-Za-z0-9]+")*: "[a-z0-9.]+"/;
    expect(tableLine.test(detail)).toBe(false);
  });
});

describe("iOS badge display parity with the web tab", () => {
  it("hides the same surprise badges the web tab hides", () => {
    const display = source("src/lib/badges/display.ts");
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");

    const webList = display.slice(
      display.indexOf("const HIDDEN_BADGE_KEYS = new Set(["),
      display.indexOf("]);", display.indexOf("const HIDDEN_BADGE_KEYS")),
    );
    const nativeList = detail.slice(
      detail.indexOf("private let hiddenBadgeKeys: Set<String> = ["),
      detail.indexOf("]", detail.indexOf("private let hiddenBadgeKeys")),
    );

    const webKeys = [...webList.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]).sort();
    const nativeKeys = [...nativeList.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]).sort();

    expect(webKeys.length).toBeGreaterThan(5);
    // The defect this guards: iOS held four keys while the web held nine. One
    // stale constant spoiled every v7 easter egg on the phone, undercounted the
    // hidden tally, and made the same user's completion percentage disagree
    // between the two clients.
    expect(nativeKeys).toEqual(webKeys);
  });

  it("keeps the closest-to-earned row out of the hidden collection", () => {
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
    const closest = detail.slice(
      detail.indexOf("private var closestToEarned: UserBadge? {"),
      detail.indexOf("private var liveStreaks"),
    );
    // The server derives real progress for the hidden easter eggs too, so
    // picking from every badge would put a surprise badge's name and progress
    // bar on the profile card.
    expect(closest).toContain("profile.visibleBadges");
    expect(closest).not.toContain("profile.badges");
  });

  it("paints rarity from one palette across the celebration and the shelf", () => {
    const shared = source("ios/Wisconsin/Shared/BadgeEarnedCelebration.swift");
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");

    // The defect this guards: the celebration painted Common brand red and
    // Uncommon blue (matching the web medallion) while the badge page painted
    // the same two badges blue and green, so a badge changed colour between the
    // moment it was earned and the shelf it landed on.
    expect(shared).toContain("enum BadgeRarity");
    expect(shared).toContain("var accent: Color {");
    expect(shared).toContain("var accentColor: Color { badgeRarity.accent }");
    expect(detail).toContain("badge.rarity.accent");
    // No second rarity table on the page. `case .legendary:` only ever opens a
    // rarity switch, so its absence is the check.
    expect(detail).not.toContain("enum BadgeRarity");
    expect(detail).not.toContain("case .legendary:");
  });

  it("shows manual award attribution and retired history the way the web does", () => {
    const models = source("ios/Wisconsin/Models/Models.swift");
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
    const badgesTab = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");
    const queries = source("src/lib/badges/queries.ts");

    // Served on every award row, and previously dropped on the floor by iOS.
    expect(queries).toContain("awardedByName: award?.awardedBy?.name ?? null");
    expect(badgesTab).toContain("badge.awardedByName");
    expect(models).toContain("let awardedByName: String?");
    expect(detail).toContain("badge.awardedByName");

    // Retirement is `active = false`, never a delete, so an earned badge can
    // outlive its goal. Both clients say so.
    expect(badgesTab).toContain('<Badge variant="gray">Retired</Badge>');
    expect(detail).toContain('BadgeChip(text: "Retired", tone: .gray)');
  });

  it("keeps the native gallery on the same shelf contract as the web tab", () => {
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const tab = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");

    expect(detail).toContain('if trigger == "checkout:returned" { return .reliability }');
    expect(detail).toContain('if trigger == "checkout:opened" { return .gearFlow }');
    expect(detail).toContain("private static let shelfPreviewCount = 10");
    expect(detail).toContain("sortedForDisplay");
    expect(detail).toContain("Show \\(hiddenGalleryCount(for: section)) more");
    expect(detail).toContain("Too new to rate by scarcity yet");
    expect(detail).toContain("rarityChipTitle");
    expect(models).toContain("let rarityProvisional: Bool?");
    expect(tab).toContain("OnTimeStreakRow");
    expect(tab).toContain("liveStreaks");
  });
});
