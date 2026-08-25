import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  automaticCheckoutRuleKeys,
  automaticMeasuredRuleKeys,
  automaticReturnRuleKeys,
  automaticShiftRuleKeys,
  automaticTradeRuleKeys,
} from "@/lib/badges/automatic-rules";
import { isHiddenUntilEarnedBadge } from "@/lib/badges/display";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

const seed = source("prisma/seed.mjs");
const migration = source("prisma/migrations/0127_badge_catalog_expansion/migration.sql");
const evaluator = source("src/lib/badges/evaluator.ts");
const queries = source("src/lib/badges/queries.ts");
const nativeProfile = source("ios/Wisconsin/Views/UserDetailView.swift");

const NEW_BADGE_KEYS = [
  "checkout_sprint",
  "checkout_calendar",
  "on_time_clean",
  "return_steady",
  "category_combo",
  "return_no_intervention",
  "shift_cross_training",
  "shift_schedule_span",
  "trade_two_way",
  "family_archivist",
  "battery_bank",
  "lens_library",
  "audio_aisle",
  "lighting_grid",
  "family_mixer",
  "full_rig_heavy",
  "gear_volume_150",
  "mixed_inventory",
  "kit_variety",
  "checkout_month_streak",
  "home_and_away",
  "schedule_spectrum",
  "away_win",
  "result_site_sweep",
  "long_day_crew",
  "reservation_event",
  "distinct_event_loadout",
  "multi_event",
  "full_context_loadout",
  "shift_loadout_heavy",
  "result_sweep",
  "winning_record",
  "win_streak",
  "bounce_back",
  "battle_tested",
  "home_field",
  "neutral_ground",
  "venue_hopper",
  "venue_regular",
  "opponent_rollcall",
  "rivalry_rematch",
  "site_sweep",
  "oops_damaged",
  "oops_missing",
  "running_late",
  "due_date_dancer",
  "calendar_tetris",
  "midnight_oil",
  "weekend_warrior",
  "leap_day",
] as const;

const MEASURED_RULE_KEYS = [
  "checkout_week_burst",
  "checkout_months",
  "checkout_categories_4",
  "checkout_distinct_families",
  "checkout_full_rig_heavy",
  "checkout_item_volume",
  "checkout_mixed_inventory",
  "checkout_distinct_kits",
  "checkout_consecutive_months",
  "checkout_event_linked",
  "checkout_multiple_events",
  "checkout_from_reservation",
  "checkout_for_shift",
  "checkout_reserved_event",
  "checkout_distinct_events",
  "checkout_full_context",
  "checkout_for_shift_heavy",
  "return_reported",
  "return_damaged",
  "return_missing",
  "return_late",
  "return_due_date_changed",
  "return_on_time_clean",
  "return_clean_streak",
  "return_no_intervention",
  "trade_both_sides",
  "shift_wins",
  "shift_losses",
  "shift_home",
  "shift_neutral",
  "shift_venues",
  "shift_same_venue",
  "shift_opponents",
  "shift_same_opponent",
  "shift_conflicts",
  "shift_sport_area_pairs",
  "shift_months",
  "shift_home_and_away",
  "shift_spectrum",
  "shift_away_wins",
  "shift_result_sites",
  "shift_early_late_mix",
  "shift_scored_sports",
  "shift_winning_record",
  "shift_win_streak",
  "shift_bounce_back",
  "shift_battle_tested",
  "shift_sites",
] as const;

const HIDDEN_NEW_KEYS = [
  "oops_damaged",
  "oops_missing",
  "running_late",
  "due_date_dancer",
  "calendar_tetris",
  "midnight_oil",
  "weekend_warrior",
  "leap_day",
] as const;

function seedDefinition(key: string) {
  const start = seed.indexOf(`key: "${key}"`);
  const end = seed.indexOf("\n  },", start);
  return seed.slice(start, end);
}

describe("50-badge catalog expansion", () => {
  it("keeps exactly the requested 50 keys aligned between seed and migration", () => {
    expect(new Set(NEW_BADGE_KEYS).size).toBe(50);

    const firstNewDefinition = seed.indexOf('key: "checkout_sprint"');
    const seedExpansion = seed.slice(firstNewDefinition, seed.indexOf("\n];", firstNewDefinition));
    const seedKeys = Array.from(seedExpansion.matchAll(/key: "([^"]+)"/g), (match) => match[1]);
    expect(seedKeys).toEqual(NEW_BADGE_KEYS);

    const migrationKeys = Array.from(
      migration.matchAll(/\('seed_badge_[^']+', '([^']+)'/g),
      (match) => match[1],
    );
    expect(migrationKeys).toEqual(NEW_BADGE_KEYS);
  });

  it("does not reintroduce the rejected low-rung ladder entries", () => {
    const firstNewDefinition = seed.indexOf('key: "checkout_sprint"');
    const seedExpansion = seed.slice(firstNewDefinition, seed.indexOf("\n];", firstNewDefinition));

    for (const key of [
      "checkout_2",
      "on_time_3",
      "damage_free_3",
      "shift_5",
      "trade_2",
      "first_win",
      "first_loss",
      "event_ready",
      "event_regular",
      "doubleheader_3",
    ]) {
      expect(seedExpansion).not.toContain(`key: "${key}"`);
    }
  });

  it("makes every new definition automatic and keeps rule keys earnable", () => {
    for (const key of NEW_BADGE_KEYS) {
      const definition = seedDefinition(key);
      expect(definition).toMatch(/trigger: "(checkout:opened|checkout:returned|shift:completed|trade:completed|app:opened)"/);
      expect(definition).not.toContain('trigger: "manual"');
      expect(migration).toContain(`'${key}'`);
    }

    expect(migration).not.toContain("'manual'");

    const registeredRuleKeys = new Set<string>([
      ...automaticCheckoutRuleKeys,
      ...automaticReturnRuleKeys,
      ...automaticShiftRuleKeys,
      ...automaticTradeRuleKeys,
    ]);
    for (const ruleKey of MEASURED_RULE_KEYS) {
      expect(registeredRuleKeys.has(ruleKey)).toBe(true);
      expect(automaticMeasuredRuleKeys.has(ruleKey)).toBe(true);
    }
    expect(evaluator).toContain('ruleKey: "local_hour_0"');
    expect(evaluator).toContain('ruleKey: "local_weekend"');
    expect(evaluator).toContain('ruleKey: "local_leap_day"');
  });

  it("uses the same checkout and return evidence for awards and progress", () => {
    for (const field of [
      "eventId: true",
      "sourceReservationId: true",
      "shiftAssignmentId: true",
      "events: { select: { eventId: true } }",
      "postedByUserId: true",
      "checkinReports: { select: { id: true, type: true } }",
      "dueDateChanges: { select: { id: true }, take: 1 }",
    ]) {
      expect(evaluator).toContain(field);
      expect(queries).toContain(field);
    }
  });

  it("uses one shared reader for schedule evidence on both paths", () => {
    // Schedule evidence now includes admin-added workers, so its
    // select lives once rather than being mirrored in two files.
    const workedEvidence = source("src/lib/badges/worked-evidence.ts");
    for (const field of ["hasConflict: true", "result: true", "site: true", "locationId: true", "opponent: true"]) {
      expect(workedEvidence).toContain(field);
    }
    expect(evaluator).toContain("loadWorkedShiftEvidence");
    expect(queries).toContain("loadWorkedShiftEvidence");
  });

  it("keeps problem outcomes and time surprises hidden on web and iOS", () => {
    for (const key of HIDDEN_NEW_KEYS) {
      expect(isHiddenUntilEarnedBadge(key)).toBe(true);
      expect(nativeProfile).toContain(`"${key}"`);
    }
  });

  it("does not invent app-open history during migration", () => {
    const appOpenTail = migration.slice(migration.indexOf("-- App-open surprises"));
    expect(appOpenTail).not.toContain("badge_event_receipts");
    expect(appOpenTail).toContain("no history is invented");
  });
});
