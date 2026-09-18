import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("badge MVP polish", () => {
  it("keeps category collector and three-site scoreboard earnable after reseed", () => {
    const seed = source("prisma/seed.mjs");
    const migration = source("prisma/migrations/0147_badge_mvp_repair/migration.sql");

    const categoryDefinition = seed.slice(
      seed.indexOf('key: "category_collector"'),
      seed.indexOf('key: "event_hero"'),
    );
    expect(categoryDefinition).toContain('ruleKey: "category_collector"');

    const siteDefinition = seed.slice(
      seed.indexOf('key: "result_site_sweep"'),
      seed.indexOf('key: "long_day_crew"'),
    );
    expect(siteDefinition).toContain("threshold: 1");
    expect(siteDefinition).not.toContain("threshold: 3");

    expect(migration).toContain("SET \"rule_key\" = 'category_collector'");
    expect(migration).toContain('SET "threshold" = 1');
    expect(migration).toContain("WHERE \"key\" = 'result_site_sweep'");
  });

  it("closes reservation and crew checkout coverage with existing measured rules", () => {
    const seed = source("prisma/seed.mjs");
    const migration = source("prisma/migrations/0147_badge_mvp_repair/migration.sql");
    const rules = source("src/lib/badges/automatic-rules.ts");

    for (const key of ["plan_ahead", "crew_checkout"]) {
      expect(seed).toContain(`key: "${key}"`);
      expect(migration).toContain(`'${key}'`);
    }
    expect(seed).toContain('ruleKey: "checkout_from_reservation"');
    expect(seed).toContain('ruleKey: "checkout_for_shift"');
    expect(rules).toContain('increment(counts, "checkout_from_reservation")');
    expect(rules).toContain('increment(counts, "checkout_for_shift")');
    expect(migration).toContain('custody_scope" = \'PERSON\'');
  });

  it("keeps hidden manuals awardable without leaking easter eggs", () => {
    const route = source("src/app/api/badges/route.ts");
    expect(route).toContain("manualOnly && definition.trigger === \"manual\"");
    expect(route).toContain("trigger: definition.trigger");
  });

  it("hides the student Award badge action and shows the on-time streak", () => {
    const page = source("src/app/(app)/users/[id]/page.tsx");
    const tab = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");
    const awardItem = page.slice(
      Math.max(0, page.indexOf("Award badge") - 280),
      page.indexOf("Award badge"),
    );
    expect(awardItem).toContain('currentUserRole === "ADMIN"');
    expect(awardItem).not.toContain("isSelf");
    expect(tab).toContain("OnTimeStreakRow");
    expect(tab).toContain("on-time returns in a row");
  });

  it("sends a celebration back to the shelf", () => {
    const celebration = source("src/components/badges/BadgeEarnedCelebration.tsx");
    const shell = source("src/components/AppShell.tsx");
    expect(celebration).toContain("See on shelf");
    expect(celebration).toContain("onViewShelf");
    expect(shell).toContain("/users/${rewardUserId}?tab=badges");
  });
});
