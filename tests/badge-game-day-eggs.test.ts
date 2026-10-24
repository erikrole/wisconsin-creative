import { describe, expect, it } from "vitest";

import {
  automaticMeasuredRuleKeys,
  checkoutAutomaticRuleCounts,
  shiftAutomaticRuleCounts,
  type CheckoutBadgeEvidence,
  type ShiftBadgeEvidence,
} from "@/lib/badges/automatic-rules";
import { isHiddenUntilEarnedBadge } from "@/lib/badges/display";
import { source } from "./_helpers/source";

const TZ = "America/Chicago";

function game(overrides: {
  start: string;
  sportCode?: string | null;
  isHome?: boolean | null;
  site?: string | null;
  opponent?: string | null;
  summary?: string | null;
}): ShiftBadgeEvidence {
  const startsAt = new Date(overrides.start);
  return {
    callStartsAt: null,
    callEndsAt: null,
    shift: {
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      callStartsAt: null,
      callEndsAt: null,
      area: "VIDEO",
      shiftGroup: {
        event: {
          isHome: overrides.isHome ?? true,
          sportCode: overrides.sportCode === undefined ? "FB" : overrides.sportCode,
          site: overrides.site ?? null,
          opponent: overrides.opponent ?? null,
          summary: overrides.summary ?? null,
        },
      },
    },
  };
}

function checkout(startsAt: string): CheckoutBadgeEvidence {
  return { startsAt: new Date(startsAt), kitId: null, serializedItems: [], bulkItems: [] };
}

describe("game-day and calendar badges", () => {
  it("counts home football games for Fifth Quarter, ignoring away games and other sports", () => {
    const counts = shiftAutomaticRuleCounts([
      game({ start: "2026-09-05T17:00:00.000Z" }),
      game({ start: "2026-09-12T17:00:00.000Z", site: "HOME", isHome: null }),
      game({ start: "2026-09-19T17:00:00.000Z", isHome: false, site: "AWAY" }),
      game({ start: "2026-09-26T17:00:00.000Z", sportCode: "VB" }),
      game({ start: "2026-10-03T17:00:00.000Z", sportCode: " fb " }),
    ], TZ);

    expect(counts.get("shift_home_football")).toBe(3);
  });

  it("finds the Axe game home or away, and only in football", () => {
    const counts = shiftAutomaticRuleCounts([
      game({ start: "2026-11-28T18:00:00.000Z", opponent: "Minnesota", isHome: false, site: "AWAY" }),
      game({ start: "2026-02-01T18:00:00.000Z", opponent: "Minnesota", sportCode: "MBB" }),
      game({ start: "2026-09-05T17:00:00.000Z", opponent: "Minnesota State" }),
      game({ start: "2025-11-29T18:00:00.000Z", opponent: "#21 Minnesota Golden Gophers" }),
    ], TZ);

    // Basketball against Minnesota and a different school both miss.
    expect(counts.get("shift_axe_game")).toBe(2);
  });

  it("spots Homecoming from the football game's calendar title", () => {
    const counts = shiftAutomaticRuleCounts([
      game({ start: "2026-10-10T17:00:00.000Z", summary: "Football vs. Iowa (Homecoming)" }),
      game({ start: "2026-10-10T17:00:00.000Z", summary: "Volleyball Homecoming", sportCode: "VB" }),
      game({ start: "2026-10-17T17:00:00.000Z", summary: "Football vs. Purdue" }),
    ], TZ);

    expect(counts.get("shift_homecoming")).toBe(1);
  });

  it("awards Pi Day on March 14 in institution time, not UTC", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout("2027-03-14T19:00:00.000Z"),
      // 11 p.m. on March 13 in Madison is already March 14 in UTC.
      checkout("2027-03-14T04:30:00.000Z"),
      checkout("2027-03-15T04:30:00.000Z"),
    ], TZ);

    expect(counts.get("checkout_pi_day")).toBe(2);
  });

  it("registers every new rule, keeps the surprises hidden on web and iOS, and ships them in one migration", () => {
    for (const ruleKey of ["shift_home_football", "shift_axe_game", "shift_homecoming", "checkout_pi_day"]) {
      expect(automaticMeasuredRuleKeys.has(ruleKey)).toBe(true);
    }

    const nativeProfile = source("ios/Wisconsin/Views/UserDetailView.swift");
    for (const key of ["axe_crew", "homecoming", "pi_day"]) {
      expect(isHiddenUntilEarnedBadge(key)).toBe(true);
      expect(nativeProfile).toContain(`"${key}"`);
    }
    expect(isHiddenUntilEarnedBadge("fifth_quarter")).toBe(false);

    const migration = source("prisma/migrations/0205_badge_game_day_eggs/migration.sql");
    const seed = source("prisma/seed.mjs");
    for (const key of ["on_time_100", "shift_100", "fifth_quarter", "axe_crew", "homecoming", "pi_day"]) {
      expect(migration).toContain(`'seed_badge_${key}', '${key}'`);
      expect(seed).toContain(`key: "${key}"`);
    }

    // The Homecoming rule reads the title on both the award and progress paths.
    expect(source("src/lib/badges/worked-evidence.ts").match(/summary: true/g)).toHaveLength(2);
  });
});
