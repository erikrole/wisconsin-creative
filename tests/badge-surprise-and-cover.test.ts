import { describe, expect, it } from "vitest";

import {
  automaticMeasuredRuleKeys,
  tradeAutomaticRuleCounts,
  type TradeBadgeEvidence,
} from "@/lib/badges/automatic-rules";
import { isHiddenUntilEarnedBadge } from "@/lib/badges/display";
import { source } from "./_helpers/source";

function trade(overrides: {
  postedBy?: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  shiftStartsAt: string;
}): TradeBadgeEvidence {
  return {
    postedByUserId: overrides.postedBy ?? null,
    claimedByUserId: overrides.claimedBy,
    claimedAt: overrides.claimedAt ? new Date(overrides.claimedAt) : null,
    shiftAssignment: { shift: { startsAt: new Date(overrides.shiftStartsAt) } },
  };
}

describe("short notice trade cover", () => {
  it("credits the claimer, not the poster", () => {
    const counts = tradeAutomaticRuleCounts([
      trade({ claimedBy: "user-1", claimedAt: "2026-08-10T12:00:00.000Z", shiftStartsAt: "2026-08-10T18:00:00.000Z" }),
      // Posted by user-1 and covered by somebody else. The cover is theirs.
      trade({ claimedBy: "user-2", claimedAt: "2026-08-11T12:00:00.000Z", shiftStartsAt: "2026-08-11T18:00:00.000Z" }),
    ], "user-1");

    expect(counts.get("trade_short_notice")).toBe(1);
  });

  it("counts only claims inside the last day before the shift", () => {
    const counts = tradeAutomaticRuleCounts([
      // Six hours of notice.
      trade({ claimedBy: "user-1", claimedAt: "2026-08-10T12:00:00.000Z", shiftStartsAt: "2026-08-10T18:00:00.000Z" }),
      // Exactly 24 hours still counts.
      trade({ claimedBy: "user-1", claimedAt: "2026-08-11T18:00:00.000Z", shiftStartsAt: "2026-08-12T18:00:00.000Z" }),
      // Three days of notice is planning, not cover.
      trade({ claimedBy: "user-1", claimedAt: "2026-08-10T18:00:00.000Z", shiftStartsAt: "2026-08-13T18:00:00.000Z" }),
    ], "user-1");

    expect(counts.get("trade_short_notice")).toBe(2);
  });

  it("ignores a claim recorded after the shift already started", () => {
    // Almost always paperwork written up afterward, which the data cannot tell
    // apart from someone stepping in mid-shift.
    const counts = tradeAutomaticRuleCounts([
      trade({ claimedBy: "user-1", claimedAt: "2026-08-10T20:00:00.000Z", shiftStartsAt: "2026-08-10T18:00:00.000Z" }),
      trade({ claimedBy: "user-1", claimedAt: null, shiftStartsAt: "2026-08-11T18:00:00.000Z" }),
    ], "user-1");

    expect(counts.get("trade_short_notice")).toBe(0);
  });

  it("registers the rule as measured", () => {
    expect(automaticMeasuredRuleKeys.has("trade_short_notice")).toBe(true);
  });

  it("recognizes someone who works both sides of a trade", () => {
    const counts = tradeAutomaticRuleCounts([
      trade({ postedBy: "user-1", claimedBy: "user-2", claimedAt: null, shiftStartsAt: "2026-08-10T18:00:00.000Z" }),
      trade({ postedBy: "user-2", claimedBy: "user-1", claimedAt: "2026-08-11T12:00:00.000Z", shiftStartsAt: "2026-08-11T18:00:00.000Z" }),
    ], "user-1");

    expect(counts.get("trade_both_sides")).toBe(1);
  });
});

describe("app open easter eggs", () => {
  const evaluator = source("src/lib/badges/evaluator.ts");

  it("keeps the original receipt prefix for the 2 a.m. rule", () => {
    // Renaming it to match the rule key would orphan every receipt already
    // written and let a previously claimed day be claimed again.
    expect(evaluator).toContain('receiptPrefix: "local-hour-2"');
  });

  it("evaluates every matching rule rather than the first", () => {
    const handler = evaluator.slice(evaluator.indexOf("export async function onAppOpened"));
    expect(handler).toContain("APP_OPEN_RULES.filter");
    expect(handler).toContain("for (const rule of matched)");
    // A claimed receipt for one rule must not abandon the others.
    expect(handler).toContain("continue");
  });

  it("derives the weekday from the institution calendar date", () => {
    expect(evaluator).toContain("weekday: new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()");
  });
});

describe("final catalog", () => {
  const seed = source("prisma/seed.mjs");
  const appOpenMigration = source("prisma/migrations/0120_badge_app_open_eggs/migration.sql");
  const tradeMigration = source("prisma/migrations/0122_badge_short_notice/migration.sql");

  it("seeds the two app-open surprises with no threshold", () => {
    for (const [key, ruleKey] of [
      ["take_thirteen", "local_friday_13"],
      ["holiday_hours", "local_holiday"],
    ]) {
      expect(appOpenMigration).toContain(`'${key}'`);
      expect(appOpenMigration).toContain(`'${ruleKey}'`);
      expect(seed).toContain(`key: "${key}"`);
      expect(seed).toContain(`ruleKey: "${ruleKey}"`);
    }
    expect(appOpenMigration).toContain('RULE\'::"BadgeKind"');
  });

  it("does not invent app-open history", () => {
    // Receipts only exist from the moment the rule ships. Backfilling would
    // award a surprise for a date nobody was there for.
    expect(appOpenMigration).not.toContain("student_badges");
  });

  it("seeds short notice on the trade trigger with a claimer-side backfill", () => {
    expect(tradeMigration).toContain("'short_notice'");
    expect(tradeMigration).toContain("'trade_short_notice'");
    expect(tradeMigration).toContain('t."claimed_by_user_id"');
    expect(tradeMigration).toContain("INTERVAL '24 hours'");
    expect(seed).toContain('key: "short_notice"');
  });

  it("hides every surprise until it is earned", () => {
    for (const key of ["take_thirteen", "holiday_hours", "buzzer_beater", "old_faithful", "battery_run", "go_to_bed"]) {
      expect(isHiddenUntilEarnedBadge(key)).toBe(true);
    }
    for (const key of ["short_notice", "season_pass", "deep_inventory"]) {
      expect(isHiddenUntilEarnedBadge(key)).toBe(false);
    }
  });
});
