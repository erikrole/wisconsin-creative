import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

const migration = source("prisma/migrations/0100_badge_catalog_rebalance/migration.sql");
const seed = source("prisma/seed.mjs");
const evaluator = source("src/lib/badges/evaluator.ts");
const queries = source("src/lib/badges/queries.ts");
const automaticRules = source("src/lib/badges/automatic-rules.ts");
const rewardMigration = source("prisma/migrations/0110_badge_rewards/migration.sql");

describe("badge catalog rebalance", () => {
  it("fills the ladder gaps the award data exposed", () => {
    // 13 users had first_checkout, 3 had checkout_5, 0 had checkout_25.
    expect(migration).toContain("'checkout_10'");
    expect(migration).toContain("'on_time_25'");
    expect(migration).toContain("'scan_50'");
  });

  it("wires every new definition to a rule the evaluator can actually award", () => {
    // A definition whose (category, trigger, ruleKey) triple no evaluator call
    // matches is unearnable -- which is how the ten manual badges sat at zero.
    expect(migration).toContain("'damage_free_return'");
    expect(evaluator).toContain('ruleKey: "damage_free_return"');
    expect(evaluator).toContain("checkinReports: { none: {} }");

    expect(evaluator).toContain("checkoutAutomaticRuleCounts");
    expect(automaticRules).toContain('counts.set("category_collector", distinctCategoryIds.size)');
    expect(migration).toContain('"trigger" = \'checkout:opened\'');

    expect(evaluator).toContain("export async function onShiftsWorked");
    expect(evaluator).toContain('trigger: "shift:completed"');
  });

  it("reports progress from the counter the badge is actually about", () => {
    // category_collector and the damage-free badges hang off triggers that
    // already mean something else, so rule key has to be tested first or a
    // checkout total gets reported as category breadth.
    const chain = queries.slice(
      queries.indexOf("let current: number | null = null;"),
      queries.indexOf("if (current !== null)"),
    );
    expect(chain.indexOf('definition.ruleKey === "category_collector"')).toBeGreaterThan(-1);
    expect(chain.indexOf('definition.ruleKey === "category_collector"')).toBeLessThan(
      chain.indexOf('definition.trigger === "checkout:opened"'),
    );
    expect(chain.indexOf('definition.ruleKey === "damage_free_return"')).toBeLessThan(
      chain.indexOf('definition.trigger === "checkout:opened"'),
    );
    expect(chain).toContain('definition.trigger === "shift:completed"');
  });

  it("revives shift counts without reviving shift streaks", () => {
    const revive = migration.slice(migration.indexOf("-- ── 2."), migration.indexOf("-- ── 3."));
    expect(revive).toContain('"active" = true');
    expect(revive).toContain("'first_shift', 'shift_10', 'shift_50'");
    expect(revive).not.toContain("streak_shifts_5'");

    // Deriving from the database is what makes the nightly re-run a no-op.
    expect(evaluator).toContain("loadWorkedShiftEvidence(tx");
    // Archived events still count, or a worked-shift total would fall over time
    // and strand someone below a threshold they had already passed.
    const shiftFn = evaluator.slice(evaluator.indexOf("export async function onShiftsWorked"));
    expect(shiftFn.slice(0, shiftFn.indexOf("}\n\nexport"))).not.toContain("archivedAt");
  });

  it("retires the dead manual badges without deleting any award", () => {
    const retire = migration.slice(migration.indexOf("-- ── 4."));
    expect(retire).toContain('"active" = false');
    expect(retire).not.toContain("DELETE");
    for (const key of ["perfect_handoff", "clean_loop", "full_kit_no_misses", "semester_streak", "rookie_run", "reliable_regular", "clutch_cover"]) {
      expect(retire).toContain(`'${key}'`);
    }
    // The two genuine catch-alls stay, and so does the custom-badge path that
    // staff actually reached for.
    expect(retire).not.toContain("'above_and_beyond'");
    expect(retire).not.toContain("'event_hero'");
    expect(migration).not.toContain("custom_");
  });

  it("never deletes a badge definition or award", () => {
    expect(migration).not.toMatch(/\bDELETE\b/i);
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it("keeps reseeding aligned with the migrated catalog", () => {
    for (const key of ["checkout_10", "on_time_25", "scan_50", "damage_free_10", "damage_free_50"]) {
      expect(seed).toContain(`key: "${key}"`);
    }
    expect(seed).toContain('description: "Was assigned to a first completed event shift."');
    expect(seed).toContain('description: "Checked out gear from five different categories."');
    expect(seed).toContain("kind: BadgeKind.COUNT");
    expect(seed).toContain('trigger: "checkout:opened"');
    expect(seed).toContain("ruleKey: definition.ruleKey ?? null");

    const categoryDefinition = seed.slice(seed.indexOf('key: "category_collector"'), seed.indexOf('key: "event_hero"'));
    expect(categoryDefinition).toContain("kind: BadgeKind.COUNT");
    expect(categoryDefinition).toContain('threshold: 5');
    expect(categoryDefinition).not.toContain('trigger: "manual"');

    const retiredKeys = [
      "perfect_handoff",
      "clean_loop",
      "full_kit_no_misses",
      "semester_streak",
      "rookie_run",
      "reliable_regular",
      "clutch_cover",
    ];
    for (const key of retiredKeys) {
      const definitionStart = seed.indexOf(`key: "${key}"`);
      const definitionEnd = seed.indexOf("\n  },", definitionStart);
      const definition = seed.slice(definitionStart, definitionEnd);
      expect(definition).toContain("active: false");
      expect(definition).toContain("Retired: replaced by automatic recognition or unused in practice.");
    }
  });

  it("adds attainable bridge milestones while retiring scan goals", () => {
    for (const key of ["on_time_5", "scan_10", "shift_25", "trade_5"]) {
      expect(rewardMigration).toContain(`'${key}'`);
      expect(seed).toContain(`key: "${key}"`);
    }

    expect(rewardMigration).toContain("'first_scan', 'scan_10', 'scan_25', 'scan_50', 'scan_100', 'zero_errors'");
    expect(rewardMigration).toContain('"active" = false');
    for (const key of ["first_scan", "scan_10", "scan_25", "scan_50", "scan_100", "zero_errors"]) {
      const definitionStart = seed.indexOf(`key: "${key}"`);
      const definitionEnd = seed.indexOf("\n  },", definitionStart);
      expect(seed.slice(definitionStart, definitionEnd)).toContain("active: false");
    }
  });

  it("adds ten captured-data automatic awards and one hidden app-open easter egg", () => {
    for (const key of [
      "power_player",
      "glass_class",
      "sound_check",
      "rock_solid",
      "bright_spark",
      "kitchen_sink",
      "three_piece_suit",
      "heavy_lifter",
      "road_tested",
      "before_sunrise",
    ]) {
      expect(seed).toContain(`key: "${key}"`);
      expect(rewardMigration).toContain(`'${key}'`);
    }
    for (const ruleKey of [
      "checkout_family_batteries",
      "checkout_family_lenses",
      "checkout_family_audio",
      "checkout_support",
      "checkout_family_lighting",
      "checkout_families_5",
      "checkout_full_rig",
      "checkout_items_15",
      "shift_away_completed",
      "shift_before_7",
    ]) {
      expect(seed).toContain(`ruleKey: "${ruleKey}"`);
      expect(rewardMigration).toContain(`'${ruleKey}'`);
    }
    const automaticDefinitions = seed.slice(
      seed.indexOf('key: "power_player"'),
      seed.indexOf('key: "go_to_bed"'),
    );
    expect(automaticDefinitions).not.toContain('trigger: "manual"');
    expect(automaticDefinitions).toContain("kind: BadgeKind.COUNT");
    expect(rewardMigration).toContain("credited_booking_categories");
    expect(rewardMigration).toContain('i."checked_out_quantity" > 0');
    for (const [key, threshold] of [
      ['key: "power_player"', "threshold: 10"],
      ['key: "glass_class"', "threshold: 10"],
      ['key: "sound_check"', "threshold: 5"],
      ['key: "rock_solid"', "threshold: 3"],
      ['key: "bright_spark"', "threshold: 2"],
      ['key: "three_piece_suit"', "threshold: 3"],
      ['key: "road_tested"', "threshold: 3"],
      ['key: "before_sunrise"', "threshold: 2"],
    ] as const) {
      const definitionStart = seed.indexOf(key);
      const definitionEnd = seed.indexOf("\n  },", definitionStart);
      expect(seed.slice(definitionStart, definitionEnd)).toContain(threshold);
    }
    expect(rewardMigration).toContain("HAVING COUNT(DISTINCT c.family_name) >= 5");
    expect(rewardMigration).toContain("c.item_total >= 15");
    expect(rewardMigration).toContain("e.\"is_home\" = false");
    expect(rewardMigration).toContain("AT TIME ZONE 'America/Chicago'");
    expect(seed).toContain('key: "go_to_bed"');
    expect(seed).toContain('trigger: "app:opened"');
    expect(rewardMigration).toContain("'local_hour_2'");
  });

  it("freezes checkout credit through owner transfers and repairs completed progress", () => {
    expect(rewardMigration).toContain("a.\"action\" IN ('kiosk_checkout', 'kiosk_pickup')");
    expect(rewardMigration).toContain("a.\"action\" = 'owner_transferred'");
    expect(rewardMigration).toContain("a.\"before_json\" ->> 'requesterUserId'");
    expect(rewardMigration).toContain("a.\"created_at\" > o.opened_at");
    expect(rewardMigration).toContain("'checkout_opened'");
    expect(rewardMigration).toContain("ON CONFLICT (\"user_id\", \"definition_id\") DO NOTHING");
    expect(rewardMigration).toContain("FROM \"shift_assignments\"");
    expect(rewardMigration).toContain("category_counts");
  });
});
