import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  automaticMeasuredRuleKeys,
  shiftAutomaticRuleCounts,
  type ShiftBadgeEvidence,
} from "@/lib/badges/automatic-rules";

const TZ = "America/Chicago";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function assignment(overrides: {
  start: string;
  end: string;
  callStart?: string | null;
  callEnd?: string | null;
  hasConflict?: boolean;
  area?: string;
  sportCode?: string | null;
  isHome?: boolean | null;
  result?: string | null;
  site?: string | null;
  locationId?: string | null;
  opponent?: string | null;
}): ShiftBadgeEvidence {
  return {
    callStartsAt: overrides.callStart ? new Date(overrides.callStart) : null,
    callEndsAt: overrides.callEnd ? new Date(overrides.callEnd) : null,
    hasConflict: overrides.hasConflict ?? false,
    shift: {
      startsAt: new Date(overrides.start),
      endsAt: new Date(overrides.end),
      callStartsAt: null,
      callEndsAt: null,
      area: overrides.area ?? "VIDEO",
      shiftGroup: {
        event: {
          isHome: overrides.isHome ?? true,
          sportCode: overrides.sportCode ?? null,
          result: overrides.result ?? null,
          site: overrides.site ?? null,
          locationId: overrides.locationId ?? null,
          opponent: overrides.opponent ?? null,
        },
      },
    },
  };
}

describe("shift breadth rule counts", () => {
  it("counts distinct sports without splitting on case or padding", () => {
    const counts = shiftAutomaticRuleCounts([
      assignment({ start: "2026-08-10T18:00:00.000Z", end: "2026-08-10T22:00:00.000Z", sportCode: "MBB" }),
      assignment({ start: "2026-09-10T18:00:00.000Z", end: "2026-09-10T22:00:00.000Z", sportCode: " mbb " }),
      assignment({ start: "2026-10-10T18:00:00.000Z", end: "2026-10-10T22:00:00.000Z", sportCode: "WVB" }),
      assignment({ start: "2026-11-10T18:00:00.000Z", end: "2026-11-10T22:00:00.000Z", sportCode: null }),
    ], TZ);

    expect(counts.get("shift_sports")).toBe(2);
  });

  it("counts distinct crew areas", () => {
    const counts = shiftAutomaticRuleCounts([
      assignment({ start: "2026-08-10T18:00:00.000Z", end: "2026-08-10T22:00:00.000Z", area: "VIDEO" }),
      assignment({ start: "2026-09-10T18:00:00.000Z", end: "2026-09-10T22:00:00.000Z", area: "VIDEO" }),
      assignment({ start: "2026-10-10T18:00:00.000Z", end: "2026-10-10T22:00:00.000Z", area: "PHOTO" }),
      assignment({ start: "2026-11-10T18:00:00.000Z", end: "2026-11-10T22:00:00.000Z", area: "LIVE_PRODUCTION" }),
    ], TZ);

    expect(counts.get("shift_areas")).toBe(3);
  });

  it("groups doubleheader days in institution time, not UTC", () => {
    // 23:00Z and 02:00Z the next UTC day are 6 p.m. and 9 p.m. the same local
    // evening. Grouping on the UTC date would score this as two single days.
    const counts = shiftAutomaticRuleCounts([
      assignment({ start: "2026-08-10T23:00:00.000Z", end: "2026-08-11T01:00:00.000Z" }),
      assignment({ start: "2026-08-11T02:00:00.000Z", end: "2026-08-11T04:00:00.000Z" }),
      assignment({ start: "2026-09-15T18:00:00.000Z", end: "2026-09-15T20:00:00.000Z" }),
    ], TZ);

    expect(counts.get("shift_doubleheader_days")).toBe(1);
  });

  it("counts a night that reached 10 p.m. local and one that crossed midnight", () => {
    const counts = shiftAutomaticRuleCounts([
      // 10:30 p.m. local.
      assignment({ start: "2026-08-10T23:00:00.000Z", end: "2026-08-11T03:30:00.000Z" }),
      // Ends 12:30 a.m. local the next day, so the end hour never reaches 22.
      assignment({ start: "2026-09-10T23:00:00.000Z", end: "2026-09-11T05:30:00.000Z" }),
      // Wraps at 5 p.m. local.
      assignment({ start: "2026-10-10T18:00:00.000Z", end: "2026-10-10T22:00:00.000Z" }),
    ], TZ);

    expect(counts.get("shift_after_22")).toBe(2);
  });

  it("counts schedule result, site, mapped venue, opponent, and conflicts", () => {
    const counts = shiftAutomaticRuleCounts([
      assignment({
        start: "2026-08-10T18:00:00.000Z",
        end: "2026-08-10T20:00:00.000Z",
        result: "WIN",
        site: "HOME",
        locationId: "venue-1",
        opponent: "Rival A",
        hasConflict: true,
      }),
      assignment({
        start: "2026-09-10T18:00:00.000Z",
        end: "2026-09-10T20:00:00.000Z",
        result: "LOSS",
        site: "NEUTRAL",
        locationId: "venue-2",
        opponent: "Rival B",
      }),
      assignment({
        start: "2026-10-10T18:00:00.000Z",
        end: "2026-10-10T20:00:00.000Z",
        result: "WIN",
        site: "HOME",
        locationId: "venue-1",
        opponent: " rival a ",
      }),
      assignment({
        start: "2026-11-10T18:00:00.000Z",
        end: "2026-11-10T20:00:00.000Z",
        site: "AWAY",
        locationId: "venue-3",
        opponent: "Rival B",
      }),
    ], TZ);

    expect(counts.get("shift_wins")).toBe(2);
    expect(counts.get("shift_losses")).toBe(1);
    expect(counts.get("shift_home")).toBe(2);
    expect(counts.get("shift_neutral")).toBe(1);
    expect(counts.get("shift_venues")).toBe(3);
    expect(counts.get("shift_same_venue")).toBe(2);
    expect(counts.get("shift_opponents")).toBe(2);
    expect(counts.get("shift_same_opponent")).toBe(2);
    expect(counts.get("shift_conflicts")).toBe(1);
  });

  it("recognizes sustained schedule depth and a real winning sequence", () => {
    const counts = shiftAutomaticRuleCounts([
      assignment({ start: "2026-08-01T08:00:00.000Z", end: "2026-08-01T12:00:00.000Z", result: "LOSS", site: "HOME", sportCode: "MFB", area: "VIDEO" }),
      assignment({ start: "2026-08-01T10:00:00.000Z", end: "2026-08-01T14:00:00.000Z", result: "LOSS", site: "AWAY", sportCode: "MFB", area: "VIDEO" }),
      assignment({ start: "2026-08-02T18:00:00.000Z", end: "2026-08-03T04:00:00.000Z", result: "WIN", site: "AWAY", sportCode: "MBB", area: "PHOTO" }),
      assignment({ start: "2026-08-03T18:00:00.000Z", end: "2026-08-04T04:00:00.000Z", result: "WIN", site: "HOME", sportCode: "WVB", area: "LIVE_PRODUCTION" }),
      assignment({ start: "2026-09-03T18:00:00.000Z", end: "2026-09-04T04:00:00.000Z", result: "WIN", site: "NEUTRAL", sportCode: "SOC", area: "VIDEO" }),
      assignment({ start: "2026-09-04T18:00:00.000Z", end: "2026-09-05T04:00:00.000Z", result: "WIN", site: "AWAY", sportCode: "HOCK", area: "PHOTO" }),
      assignment({ start: "2026-10-05T18:00:00.000Z", end: "2026-10-06T04:00:00.000Z", result: "WIN", site: "HOME", sportCode: "MFB", area: "LIVE_PRODUCTION" }),
      assignment({ start: "2026-10-06T10:00:00.000Z", end: "2026-10-06T14:00:00.000Z", result: "WIN", site: "AWAY", sportCode: "MBB", area: "VIDEO" }),
      assignment({ start: "2026-11-07T11:00:00.000Z", end: "2026-11-07T15:00:00.000Z", result: "WIN", site: "HOME", sportCode: "WVB", area: "PHOTO" }),
      assignment({ start: "2026-11-08T18:00:00.000Z", end: "2026-11-09T04:00:00.000Z", result: "LOSS", site: "AWAY", sportCode: "SOC", area: "LIVE_PRODUCTION" }),
      assignment({ start: "2026-12-09T18:00:00.000Z", end: "2026-12-10T04:00:00.000Z", result: "WIN", site: "HOME", sportCode: "HOCK", area: "VIDEO" }),
      assignment({ start: "2026-12-10T18:00:00.000Z", end: "2026-12-11T04:00:00.000Z", result: "WIN", site: "AWAY", sportCode: "MFB", area: "PHOTO" }),
    ], TZ);

    expect(counts.get("shift_sport_area_pairs")).toBe(11);
    expect(counts.get("shift_months")).toBe(5);
    expect(counts.get("shift_home_and_away")).toBe(1);
    expect(counts.get("shift_spectrum")).toBe(1);
    expect(counts.get("shift_away_wins")).toBe(4);
    expect(counts.get("shift_result_sites")).toBe(1);
    expect(counts.get("shift_early_late_mix")).toBe(1);
    expect(counts.get("shift_scored_sports")).toBe(5);
    expect(counts.get("shift_winning_record")).toBe(1);
    expect(counts.get("shift_win_streak")).toBe(7);
    expect(counts.get("shift_bounce_back")).toBe(1);
    expect(counts.get("shift_battle_tested")).toBe(1);
    expect(counts.get("shift_sites")).toBe(3);
  });

  it("prefers the assignment call window over the shift window", () => {
    const counts = shiftAutomaticRuleCounts([
      assignment({
        start: "2026-08-10T18:00:00.000Z",
        end: "2026-08-11T04:00:00.000Z",
        callEnd: "2026-08-10T22:00:00.000Z",
      }),
    ], TZ);

    // The shift row would have qualified at 11 p.m. local; this person's own
    // call ended at 5 p.m.
    expect(counts.get("shift_after_22")).toBe(0);
  });

  it("reports zero rather than nothing when a person has no assignments", () => {
    // A missing key would leave the profile with no progress row at all, which
    // renders as an unknowable goal instead of 0/8.
    const counts = shiftAutomaticRuleCounts([], TZ);

    expect(counts.get("shift_sports")).toBe(0);
    expect(counts.get("shift_areas")).toBe(0);
    expect(counts.get("shift_doubleheader_days")).toBe(0);
    expect(counts.get("shift_after_22")).toBe(0);
    expect(counts.get("shift_wins")).toBe(0);
    expect(counts.get("shift_losses")).toBe(0);
    expect(counts.get("shift_home")).toBe(0);
    expect(counts.get("shift_neutral")).toBe(0);
    expect(counts.get("shift_venues")).toBe(0);
    expect(counts.get("shift_same_venue")).toBe(0);
    expect(counts.get("shift_opponents")).toBe(0);
    expect(counts.get("shift_same_opponent")).toBe(0);
    expect(counts.get("shift_conflicts")).toBe(0);
    expect(counts.get("shift_sport_area_pairs")).toBe(0);
    expect(counts.get("shift_months")).toBe(0);
    expect(counts.get("shift_home_and_away")).toBe(0);
    expect(counts.get("shift_spectrum")).toBe(0);
    expect(counts.get("shift_away_wins")).toBe(0);
    expect(counts.get("shift_result_sites")).toBe(0);
    expect(counts.get("shift_early_late_mix")).toBe(0);
    expect(counts.get("shift_scored_sports")).toBe(0);
    expect(counts.get("shift_winning_record")).toBe(0);
    expect(counts.get("shift_win_streak")).toBe(0);
    expect(counts.get("shift_bounce_back")).toBe(0);
    expect(counts.get("shift_battle_tested")).toBe(0);
    expect(counts.get("shift_sites")).toBe(0);
  });

  it("registers every new rule as measured so profile progress can derive it", () => {
    for (const ruleKey of [
      "shift_sports",
      "shift_areas",
      "shift_doubleheader_days",
      "shift_after_22",
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
    ]) {
      expect(automaticMeasuredRuleKeys.has(ruleKey)).toBe(true);
    }
  });
});

describe("shift breadth catalog", () => {
  const migration = source("prisma/migrations/0117_badge_shift_breadth/migration.sql");
  const seed = source("prisma/seed.mjs");

  it("seeds four definitions the evaluator can award", () => {
    for (const [key, ruleKey] of [
      ["season_pass", "shift_sports"],
      ["utility_crew", "shift_areas"],
      ["doubleheader", "shift_doubleheader_days"],
      ["under_the_lights", "shift_after_22"],
    ]) {
      expect(migration).toContain(`'${key}'`);
      expect(migration).toContain(`'${ruleKey}'`);
      expect(seed).toContain(`key: "${key}"`);
      expect(seed).toContain(`ruleKey: "${ruleKey}"`);
    }

    // `awardMeasuredRuleBadges` only looks at MILESTONE definitions carrying a
    // threshold on this trigger. Any other triple is unearnable.
    expect(migration).toContain("'MILESTONE'::\"BadgeCategory\"");
    expect(migration).toContain("'shift:completed'");
    expect(migration).not.toContain("'manual'");
  });

  it("backfills historical qualifiers from the same scope the evaluator uses", () => {
    expect(migration).toContain("'DIRECT_ASSIGNED'::\"ShiftAssignmentStatus\"");
    expect(migration).toContain("'CONFIRMED'::\"CalendarEventStatus\"");
    expect(migration).toContain('e."ends_at" < CURRENT_TIMESTAMP');
    expect(migration).toContain("ON CONFLICT (\"user_id\", \"definition_id\") DO NOTHING");
    // Archived events still count, matching onShiftsWorked.
    expect(migration).not.toContain("archived_at");
  });
});

describe("shift breadth evidence selects", () => {
  const evaluator = source("src/lib/badges/evaluator.ts");
  const queries = source("src/lib/badges/queries.ts");
  const workedEvidence = source("src/lib/badges/worked-evidence.ts");

  it("selects every derived column once, in the shared reader", () => {
    // One select feeds one derivation. Two hand-written copies used to feed it,
    // and if they drifted a badge awarded but showed no progress, or showed
    // progress it could never complete.
    for (const field of [
      "hasConflict: true",
      "callEndsAt: true",
      "endsAt: true",
      "area: true",
      "sportCode: true",
      "result: true",
      "site: true",
      "locationId: true",
      "opponent: true",
    ]) {
      expect(workedEvidence).toContain(field);
    }
  });

  it("reads awards and profile progress through that one reader", () => {
    for (const consumer of [evaluator, queries]) {
      expect(consumer).toContain("loadWorkedShiftEvidence");
      // No local re-query: drift is impossible if there is nothing to drift from.
      expect(consumer).not.toContain("shiftAssignment.findMany");
    }
  });
});
