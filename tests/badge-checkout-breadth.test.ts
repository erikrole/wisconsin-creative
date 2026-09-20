import { describe, expect, it } from "vitest";

import {
  automaticMeasuredRuleKeys,
  checkoutAutomaticRuleCounts,
  type CheckoutBadgeEvidence,
} from "@/lib/badges/automatic-rules";
import { isHiddenUntilEarnedBadge } from "@/lib/badges/display";
import { source } from "./_helpers/source";

const TZ = "America/Chicago";

function category(name: string, parent?: string) {
  return { id: `cat-${parent ?? name}`, name, parent: parent ? { name: parent } : null };
}

function checkout(overrides: {
  startsAt: string;
  kitId?: string | null;
  eventId?: string | null;
  events?: string[];
  sourceReservationId?: string | null;
  shiftAssignmentId?: string | null;
  assets?: Array<{ assetId: string; family: string }>;
  bulk?: Array<{ family: string; quantity: number }>;
}): CheckoutBadgeEvidence {
  return {
    startsAt: new Date(overrides.startsAt),
    kitId: overrides.kitId ?? null,
    eventId: overrides.eventId ?? null,
    events: (overrides.events ?? []).map((eventId) => ({ eventId })),
    sourceReservationId: overrides.sourceReservationId ?? null,
    shiftAssignmentId: overrides.shiftAssignmentId ?? null,
    serializedItems: (overrides.assets ?? []).map((item) => ({
      assetId: item.assetId,
      asset: { category: category(item.family) },
    })),
    bulkItems: (overrides.bulk ?? []).map((item) => ({
      checkedOutQuantity: item.quantity,
      bulkSku: { categoryRel: category(item.family) },
    })),
  };
}

describe("checkout breadth rule counts", () => {
  it("counts distinct serialized items across every credited checkout", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout({ startsAt: "2026-08-10T18:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }, { assetId: "a2", family: "lenses" }] }),
      checkout({ startsAt: "2026-08-20T18:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }, { assetId: "a3", family: "audio" }] }),
    ], TZ);

    expect(counts.get("checkout_distinct_assets")).toBe(3);
  });

  it("tracks the most-repeated single item, not the total", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout({ startsAt: "2026-08-10T18:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }] }),
      checkout({ startsAt: "2026-08-20T18:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }] }),
      checkout({ startsAt: "2026-08-30T18:00:00.000Z", assets: [{ assetId: "a2", family: "cameras" }] }),
    ], TZ);

    expect(counts.get("checkout_same_asset")).toBe(2);
  });

  it("groups weeks on a Monday anchor in institution time", () => {
    // Sunday 8 p.m. local and the Monday after it are different weeks; the
    // Saturday before shares a week with that Sunday.
    const counts = checkoutAutomaticRuleCounts([
      // Sat 2026-08-08 local.
      checkout({ startsAt: "2026-08-08T18:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }] }),
      // Sun 2026-08-09 20:00 local, still the same Monday-anchored week.
      checkout({ startsAt: "2026-08-10T01:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }] }),
      // Mon 2026-08-10 local, a new week.
      checkout({ startsAt: "2026-08-10T18:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }] }),
    ], TZ);

    expect(counts.get("checkout_weeks")).toBe(2);
  });

  it("counts only checkouts built from a saved kit", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout({ startsAt: "2026-08-10T18:00:00.000Z", kitId: "kit-1", assets: [{ assetId: "a1", family: "cameras" }] }),
      checkout({ startsAt: "2026-08-20T18:00:00.000Z", assets: [{ assetId: "a2", family: "cameras" }] }),
    ], TZ);

    expect(counts.get("checkout_from_kit")).toBe(1);
  });

  it("counts an all-battery run from bulk pieces that were handed out", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout({ startsAt: "2026-08-10T18:00:00.000Z", bulk: [{ family: "batteries", quantity: 8 }] }),
      // Batteries plus a camera is a normal checkout, not a battery run.
      checkout({ startsAt: "2026-08-20T18:00:00.000Z", assets: [{ assetId: "a1", family: "cameras" }], bulk: [{ family: "batteries", quantity: 4 }] }),
      // Nothing was actually handed out, so there is no run to recognise.
      checkout({ startsAt: "2026-08-30T18:00:00.000Z", bulk: [{ family: "batteries", quantity: 0 }] }),
    ], TZ);

    expect(counts.get("checkout_batteries_only")).toBe(1);
  });

  it("leaves the existing family and breadth rules unchanged", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout({
        startsAt: "2026-08-10T18:00:00.000Z",
        assets: [
          { assetId: "a1", family: "cameras" },
          { assetId: "a2", family: "lenses" },
          { assetId: "a3", family: "audio" },
        ],
      }),
    ], TZ);

    expect(counts.get("checkout_full_rig")).toBe(1);
    expect(counts.get("category_collector")).toBe(3);
  });

  it("counts event, reservation, and shift links from credited checkout rows", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout({
        startsAt: "2026-08-10T18:00:00.000Z",
        eventId: "event-1",
        events: ["event-1", "event-2"],
        sourceReservationId: "reservation-1",
        shiftAssignmentId: "assignment-1",
      }),
      checkout({
        startsAt: "2026-08-11T18:00:00.000Z",
        eventId: "event-3",
      }),
      checkout({ startsAt: "2026-08-12T18:00:00.000Z" }),
    ], TZ);

    expect(counts.get("checkout_event_linked")).toBe(2);
    expect(counts.get("checkout_multiple_events")).toBe(1);
    expect(counts.get("checkout_from_reservation")).toBe(1);
    expect(counts.get("checkout_for_shift")).toBe(1);
  });

  it("measures sustained breadth and full context instead of a raw checkout ladder", () => {
    const counts = checkoutAutomaticRuleCounts([
      checkout({
        startsAt: "2026-01-12T18:00:00.000Z",
        kitId: "kit-1",
        eventId: "event-1",
        events: ["event-1", "event-2"],
        sourceReservationId: "reservation-1",
        shiftAssignmentId: "assignment-1",
        assets: [
          { assetId: "a1", family: "cameras" },
          { assetId: "a2", family: "lenses" },
          { assetId: "a3", family: "audio" },
          { assetId: "a4", family: "lighting" },
          { assetId: "a5", family: "tripods" },
          { assetId: "a6", family: "batteries" },
          { assetId: "a7", family: "gimbal" },
          { assetId: "a8", family: "power" },
          { assetId: "a9", family: "cameras" },
          { assetId: "a10", family: "lenses" },
        ],
        bulk: [{ family: "batteries", quantity: 5 }],
      }),
      checkout({
        startsAt: "2026-01-13T18:00:00.000Z",
        kitId: "kit-2",
        eventId: "event-3",
        assets: [{ assetId: "a11", family: "cameras" }],
      }),
      checkout({
        startsAt: "2026-01-14T18:00:00.000Z",
        kitId: "kit-3",
        eventId: "event-4",
        assets: [{ assetId: "a12", family: "lenses" }],
      }),
      checkout({
        startsAt: "2026-01-15T18:00:00.000Z",
        eventId: "event-5",
        assets: [{ assetId: "a13", family: "audio" }],
      }),
      checkout({
        startsAt: "2026-01-16T18:00:00.000Z",
        assets: [{ assetId: "a14", family: "lighting" }],
      }),
      checkout({ startsAt: "2026-02-10T18:00:00.000Z", eventId: "event-6" }),
      checkout({ startsAt: "2026-03-10T18:00:00.000Z", eventId: "event-7" }),
      checkout({ startsAt: "2026-04-10T18:00:00.000Z", eventId: "event-8" }),
    ], TZ);

    expect(counts.get("checkout_week_burst")).toBe(5);
    expect(counts.get("checkout_months")).toBe(4);
    expect(counts.get("checkout_consecutive_months")).toBe(4);
    expect(counts.get("checkout_categories_4")).toBe(1);
    expect(counts.get("checkout_distinct_families")).toBe(8);
    expect(counts.get("checkout_distinct_kits")).toBe(3);
    expect(counts.get("checkout_full_rig_heavy")).toBe(1);
    expect(counts.get("checkout_item_volume")).toBe(19);
    expect(counts.get("checkout_mixed_inventory")).toBe(1);
    expect(counts.get("checkout_reserved_event")).toBe(1);
    expect(counts.get("checkout_distinct_events")).toBe(8);
    expect(counts.get("checkout_full_context")).toBe(1);
    expect(counts.get("checkout_for_shift_heavy")).toBe(1);
  });

  it("reports zero rather than nothing for someone with no checkouts", () => {
    const counts = checkoutAutomaticRuleCounts([], TZ);

    expect(counts.get("checkout_distinct_assets")).toBe(0);
    expect(counts.get("checkout_weeks")).toBe(0);
    expect(counts.get("checkout_from_kit")).toBe(0);
    expect(counts.get("checkout_same_asset")).toBe(0);
    expect(counts.get("checkout_batteries_only")).toBe(0);
    expect(counts.get("checkout_event_linked")).toBe(0);
    expect(counts.get("checkout_multiple_events")).toBe(0);
    expect(counts.get("checkout_from_reservation")).toBe(0);
    expect(counts.get("checkout_for_shift")).toBe(0);
    expect(counts.get("checkout_week_burst")).toBe(0);
    expect(counts.get("checkout_months")).toBe(0);
    expect(counts.get("checkout_categories_4")).toBe(0);
    expect(counts.get("checkout_distinct_families")).toBe(0);
    expect(counts.get("checkout_full_rig_heavy")).toBe(0);
    expect(counts.get("checkout_item_volume")).toBe(0);
    expect(counts.get("checkout_mixed_inventory")).toBe(0);
    expect(counts.get("checkout_distinct_kits")).toBe(0);
    expect(counts.get("checkout_consecutive_months")).toBe(0);
    expect(counts.get("checkout_reserved_event")).toBe(0);
    expect(counts.get("checkout_distinct_events")).toBe(0);
    expect(counts.get("checkout_full_context")).toBe(0);
    expect(counts.get("checkout_for_shift_heavy")).toBe(0);
  });

  it("registers every new rule as measured so profile progress can derive it", () => {
    for (const ruleKey of [
      "checkout_distinct_assets",
      "checkout_weeks",
      "checkout_from_kit",
      "checkout_same_asset",
      "checkout_batteries_only",
      "checkout_event_linked",
      "checkout_multiple_events",
      "checkout_from_reservation",
      "checkout_for_shift",
      "checkout_week_burst",
      "checkout_months",
      "checkout_categories_4",
      "checkout_distinct_families",
      "checkout_full_rig_heavy",
      "checkout_item_volume",
      "checkout_mixed_inventory",
      "checkout_distinct_kits",
      "checkout_consecutive_months",
      "checkout_reserved_event",
      "checkout_distinct_events",
      "checkout_full_context",
      "checkout_for_shift_heavy",
    ]) {
      expect(automaticMeasuredRuleKeys.has(ruleKey)).toBe(true);
    }
  });
});

describe("checkout breadth catalog", () => {
  const migration = source("prisma/migrations/0118_badge_checkout_breadth/migration.sql");
  const seed = source("prisma/seed.mjs");

  it("seeds five definitions the evaluator can award", () => {
    for (const [key, ruleKey] of [
      ["deep_inventory", "checkout_distinct_assets"],
      ["regular_rotation", "checkout_weeks"],
      ["kit_complete", "checkout_from_kit"],
      ["old_faithful", "checkout_same_asset"],
      ["battery_run", "checkout_batteries_only"],
    ]) {
      expect(migration).toContain(`'${key}'`);
      expect(migration).toContain(`'${ruleKey}'`);
      expect(seed).toContain(`key: "${key}"`);
      expect(seed).toContain(`ruleKey: "${ruleKey}"`);
    }
  });

  it("backfills from credited receipts, not from whoever owns the booking today", () => {
    expect(migration).toContain('r."event_type" = \'checkout_opened\'');
    expect(migration).not.toContain("requester_user_id");
    expect(migration).toContain('i."checked_out_quantity" > 0');
  });

  it("keeps the two surprises out of the locked grid until they are earned", () => {
    expect(isHiddenUntilEarnedBadge("old_faithful")).toBe(true);
    expect(isHiddenUntilEarnedBadge("battery_run")).toBe(true);
    expect(isHiddenUntilEarnedBadge("deep_inventory")).toBe(false);
  });
});

describe("checkout breadth evidence selects", () => {
  const evaluator = source("src/lib/badges/evaluator.ts");
  const queries = source("src/lib/badges/queries.ts");

  it("selects the same new columns for awards and for profile progress", () => {
    for (const field of ["startsAt: true", "kitId: true", "assetId: true"]) {
      expect(evaluator).toContain(field);
      expect(queries).toContain(field);
    }
    expect(evaluator).toContain("checkoutAutomaticRuleCounts(creditedCheckouts, env.appTimezone)");
    expect(queries).toContain("checkoutAutomaticRuleCounts(creditedCheckoutRows, env.appTimezone)");
  });
});
