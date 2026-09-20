import { describe, expect, it } from "vitest";

import {
  automaticMeasuredRuleKeys,
  returnAutomaticRuleCounts,
  type ReturnBadgeEvidence,
} from "@/lib/badges/automatic-rules";
import { isHiddenUntilEarnedBadge } from "@/lib/badges/display";
import { source } from "./_helpers/source";

const TZ = "America/Chicago";

function completed(overrides: {
  startsAt: string;
  endsAt: string;
  completedAt?: string | null;
  updatedAt?: string;
  reported?: boolean;
  reportTypes?: Array<"DAMAGED" | "LOST">;
  dueDateChanged?: boolean;
}): ReturnBadgeEvidence {
  const reportTypes = overrides.reportTypes ?? (overrides.reported ? ["DAMAGED"] : []);
  return {
    startsAt: new Date(overrides.startsAt),
    endsAt: new Date(overrides.endsAt),
    updatedAt: new Date(overrides.updatedAt ?? overrides.completedAt ?? overrides.endsAt),
    completedAt: overrides.completedAt === null ? null : new Date(overrides.completedAt ?? overrides.endsAt),
    checkinReports: reportTypes.map((type, index) => ({ id: `report-${index + 1}`, type })),
    dueDateChanges: overrides.dueDateChanged ? [{ id: "due-date-1" }] : [],
  };
}

describe("return moment rule counts", () => {
  it("counts a week-long custody only when nothing was reported", () => {
    const counts = returnAutomaticRuleCounts([
      completed({ startsAt: "2026-08-01T15:00:00.000Z", endsAt: "2026-08-10T15:00:00.000Z", completedAt: "2026-08-09T15:00:00.000Z" }),
      completed({ startsAt: "2026-08-01T15:00:00.000Z", endsAt: "2026-08-10T15:00:00.000Z", completedAt: "2026-08-09T15:00:00.000Z", reported: true }),
      // Six days is not a long haul.
      completed({ startsAt: "2026-08-01T15:00:00.000Z", endsAt: "2026-08-10T15:00:00.000Z", completedAt: "2026-08-07T15:00:00.000Z" }),
    ], TZ);

    expect(counts.get("return_long_haul")).toBe(1);
  });

  it("counts a long haul that came back late", () => {
    // The evaluator runs this lane above the on-time early return, so a late
    // long custody still earns. Nothing about this badge claims punctuality.
    const counts = returnAutomaticRuleCounts([
      completed({ startsAt: "2026-08-01T15:00:00.000Z", endsAt: "2026-08-08T15:00:00.000Z", completedAt: "2026-08-12T15:00:00.000Z" }),
    ], TZ);

    expect(counts.get("return_long_haul")).toBe(1);
  });

  it("measures the same-day turnaround in institution time", () => {
    const counts = returnAutomaticRuleCounts([
      // Out 9 a.m. and back 6 p.m. the same local day.
      completed({ startsAt: "2026-08-10T14:00:00.000Z", endsAt: "2026-08-10T23:00:00.000Z", completedAt: "2026-08-10T23:00:00.000Z" }),
      // Out 8 p.m. local, back 9 a.m. the next local morning.
      completed({ startsAt: "2026-08-11T01:00:00.000Z", endsAt: "2026-08-11T20:00:00.000Z", completedAt: "2026-08-11T14:00:00.000Z" }),
    ], TZ);

    expect(counts.get("return_same_day")).toBe(1);
  });

  it("counts a buzzer beater only at or before the due moment", () => {
    const counts = returnAutomaticRuleCounts([
      // Two minutes to spare.
      completed({ startsAt: "2026-08-10T14:00:00.000Z", endsAt: "2026-08-10T20:00:00.000Z", completedAt: "2026-08-10T19:58:00.000Z" }),
      // Exactly on the due moment.
      completed({ startsAt: "2026-08-11T14:00:00.000Z", endsAt: "2026-08-11T20:00:00.000Z", completedAt: "2026-08-11T20:00:00.000Z" }),
      // Six minutes early is not a buzzer beater.
      completed({ startsAt: "2026-08-12T14:00:00.000Z", endsAt: "2026-08-12T20:00:00.000Z", completedAt: "2026-08-12T19:54:00.000Z" }),
      // Three minutes late still counts as on time under the 15-minute grace,
      // but the buzzer had already sounded.
      completed({ startsAt: "2026-08-13T14:00:00.000Z", endsAt: "2026-08-13T20:00:00.000Z", completedAt: "2026-08-13T20:03:00.000Z" }),
    ], TZ);

    expect(counts.get("return_buzzer_beater")).toBe(2);
  });

  it("recognizes damage, missing gear, late returns, and due-date changes", () => {
    const counts = returnAutomaticRuleCounts([
      completed({
        startsAt: "2026-08-10T14:00:00.000Z",
        endsAt: "2026-08-10T20:00:00.000Z",
        completedAt: "2026-08-10T20:01:00.000Z",
        reportTypes: ["DAMAGED"],
      }),
      completed({
        startsAt: "2026-08-11T14:00:00.000Z",
        endsAt: "2026-08-11T20:00:00.000Z",
        completedAt: "2026-08-11T20:20:00.000Z",
        reportTypes: ["LOST"],
      }),
      completed({
        startsAt: "2026-08-12T14:00:00.000Z",
        endsAt: "2026-08-12T20:00:00.000Z",
        completedAt: "2026-08-12T20:01:00.000Z",
        dueDateChanged: true,
      }),
    ], TZ);

    expect(counts.get("return_reported")).toBe(2);
    expect(counts.get("return_damaged")).toBe(1);
    expect(counts.get("return_missing")).toBe(1);
    expect(counts.get("return_late")).toBe(1);
    expect(counts.get("return_due_date_changed")).toBe(1);
  });

  it("measures clean timing and the longest uninterrupted return streak", () => {
    const counts = returnAutomaticRuleCounts([
      completed({ startsAt: "2026-08-01T14:00:00.000Z", endsAt: "2026-08-01T20:00:00.000Z", completedAt: "2026-08-01T19:00:00.000Z" }),
      completed({ startsAt: "2026-08-02T14:00:00.000Z", endsAt: "2026-08-02T20:00:00.000Z", completedAt: "2026-08-02T19:00:00.000Z" }),
      // A late, rescheduled return breaks the clean streak and is not clean timing.
      completed({
        startsAt: "2026-08-03T14:00:00.000Z",
        endsAt: "2026-08-03T20:00:00.000Z",
        completedAt: "2026-08-03T21:00:00.000Z",
        dueDateChanged: true,
      }),
      completed({ startsAt: "2026-08-04T14:00:00.000Z", endsAt: "2026-08-04T20:00:00.000Z", completedAt: "2026-08-04T19:00:00.000Z" }),
      completed({ startsAt: "2026-08-05T14:00:00.000Z", endsAt: "2026-08-05T20:00:00.000Z", completedAt: "2026-08-05T19:00:00.000Z" }),
      completed({ startsAt: "2026-08-06T14:00:00.000Z", endsAt: "2026-08-06T20:00:00.000Z", completedAt: "2026-08-06T19:00:00.000Z" }),
    ], TZ);

    expect(counts.get("return_on_time_clean")).toBe(5);
    expect(counts.get("return_clean_streak")).toBe(3);
    expect(counts.get("return_no_intervention")).toBe(5);
  });

  it("falls back to updatedAt for rows returned before completedAt existed", () => {
    const counts = returnAutomaticRuleCounts([
      completed({
        startsAt: "2026-08-10T14:00:00.000Z",
        endsAt: "2026-08-10T20:00:00.000Z",
        completedAt: null,
        updatedAt: "2026-08-10T19:57:00.000Z",
      }),
    ], TZ);

    expect(counts.get("return_buzzer_beater")).toBe(1);
    expect(counts.get("return_same_day")).toBe(1);
  });

  it("reports zero rather than nothing for someone with no returns", () => {
    const counts = returnAutomaticRuleCounts([], TZ);

    expect(counts.get("return_long_haul")).toBe(0);
    expect(counts.get("return_same_day")).toBe(0);
    expect(counts.get("return_buzzer_beater")).toBe(0);
    expect(counts.get("return_reported")).toBe(0);
    expect(counts.get("return_damaged")).toBe(0);
    expect(counts.get("return_missing")).toBe(0);
    expect(counts.get("return_late")).toBe(0);
    expect(counts.get("return_due_date_changed")).toBe(0);
    expect(counts.get("return_on_time_clean")).toBe(0);
    expect(counts.get("return_clean_streak")).toBe(0);
    expect(counts.get("return_no_intervention")).toBe(0);
  });

  it("registers every new rule as measured so profile progress can derive it", () => {
    for (const ruleKey of [
      "return_long_haul",
      "return_same_day",
      "return_buzzer_beater",
      "return_reported",
      "return_damaged",
      "return_missing",
      "return_late",
      "return_due_date_changed",
      "return_on_time_clean",
      "return_clean_streak",
      "return_no_intervention",
    ]) {
      expect(automaticMeasuredRuleKeys.has(ruleKey)).toBe(true);
    }
  });
});

describe("return moment catalog", () => {
  const migration = source("prisma/migrations/0119_badge_return_moment/migration.sql");
  const seed = source("prisma/seed.mjs");
  const evaluator = source("src/lib/badges/evaluator.ts");
  const queries = source("src/lib/badges/queries.ts");

  it("seeds three definitions on the return trigger", () => {
    for (const [key, ruleKey] of [
      ["long_haul", "return_long_haul"],
      ["round_trip", "return_same_day"],
      ["buzzer_beater", "return_buzzer_beater"],
    ]) {
      expect(migration).toContain(`'${key}'`);
      expect(migration).toContain(`'${ruleKey}'`);
      expect(seed).toContain(`key: "${key}"`);
      expect(seed).toContain(`ruleKey: "${ruleKey}"`);
    }
    expect(migration).toContain("'checkout:returned'");
  });

  it("credits return outcomes to the current custodian", () => {
    // The v6 ownership rule splits credit: the opener keeps checkout breadth,
    // the person holding the booking at return owns the return outcome.
    expect(migration).toContain('b."requester_user_id"');
    expect(migration).not.toContain("badge_event_receipts");
  });

  it("evaluates the return rules above the on-time early return", () => {
    const returnHandler = evaluator.slice(
      evaluator.indexOf("export async function onCheckoutReturned"),
      evaluator.indexOf("function appDateAndHour"),
    );
    const measuredCall = returnHandler.indexOf("returnAutomaticRuleCounts");
    const earlyReturn = returnHandler.indexOf("if (!event.wasOnTime)");

    expect(measuredCall).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(measuredCall).toBeLessThan(earlyReturn);
  });

  it("selects the same return columns for awards and for profile progress", () => {
    for (const field of [
      "startsAt: true",
      "checkinReports: { select: { id: true, type: true } }",
      "dueDateChanges: { select: { id: true }, take: 1 }",
    ]) {
      expect(evaluator).toContain(field);
      expect(queries).toContain(field);
    }
  });

  it("keeps the buzzer beater hidden until it is earned", () => {
    expect(isHiddenUntilEarnedBadge("buzzer_beater")).toBe(true);
    expect(isHiddenUntilEarnedBadge("long_haul")).toBe(false);
  });
});
