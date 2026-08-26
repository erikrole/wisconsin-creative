import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyBulkShortageRecovery,
  buildAvailabilityReview,
  getAvailabilityWarningTotal,
  getStep2PrimaryActionLabel,
} from "@/components/booking-wizard/flow-summary";
import { applyDurationPreservingStartChange } from "@/components/create-booking/date-duration";

const wizardStep1Source = readFileSync(
  join(process.cwd(), "src/components/booking-wizard/WizardStep1.tsx"),
  "utf8",
);

const baseCounts = {
  conflictCount: 0,
  upcomingCommitmentCount: 0,
  turnaroundRiskCount: 0,
  bulkTurnaroundRiskCount: 0,
};

describe("booking create UX helpers", () => {
  it("counts all selected availability warnings, not only hard conflicts", () => {
    expect(getAvailabilityWarningTotal({
      conflictCount: 1,
      upcomingCommitmentCount: 2,
      turnaroundRiskCount: 3,
      bulkTurnaroundRiskCount: 4,
    })).toBe(10);
  });

  it("labels selected advisory warnings before review", () => {
    expect(getStep2PrimaryActionLabel({
      ...baseCounts,
      itemCount: 3,
      unresolvedAssetCount: 0,
      upcomingCommitmentCount: 1,
      bulkTurnaroundRiskCount: 1,
    })).toBe("Review with warnings (3 items)");
  });

  it("keeps unresolved selected items blocking before review", () => {
    expect(getStep2PrimaryActionLabel({
      ...baseCounts,
      itemCount: 0,
      unresolvedAssetCount: 2,
    })).toBe("Remove unavailable items");
  });

  it("keeps empty selections tied to selection instead of category browsing", () => {
    expect(getStep2PrimaryActionLabel({
      ...baseCounts,
      itemCount: 0,
      unresolvedAssetCount: 0,
    })).toBe("Select equipment");
  });

  it("does not show an availability review when no warnings are present", () => {
    expect(buildAvailabilityReview(baseCounts)).toBeNull();
  });

  it("uses conflict copy for hard availability conflicts", () => {
    const review = buildAvailabilityReview({
      ...baseCounts,
      conflictCount: 1,
      upcomingCommitmentCount: 1,
    });

    expect(review).toMatchObject({
      tone: "conflict",
      title: "Resolve availability conflicts",
      total: 2,
      advisoryCount: 1,
    });
    expect(review?.description).toContain("Remove the conflicted items");
  });

  it("uses advisory copy for next-use and turnaround warnings", () => {
    const review = buildAvailabilityReview({
      ...baseCounts,
      upcomingCommitmentCount: 1,
      turnaroundRiskCount: 1,
      bulkTurnaroundRiskCount: 1,
    });

    expect(review).toMatchObject({
      tone: "advisory",
      title: "Availability warnings noted",
      total: 3,
      advisoryCount: 3,
      turnaroundCount: 2,
    });
    expect(review?.description).toContain("do not block creation");
  });

  it("preserves the booking duration when the start time changes", () => {
    const next = applyDurationPreservingStartChange(
      { startsAt: "2026-07-07T10:00", endsAt: "2026-07-08T10:00" },
      "2026-07-07T12:30",
    );

    expect(next).toEqual({
      startsAt: "2026-07-07T12:30",
      endsAt: "2026-07-08T12:30",
    });
  });

  it("does not hide an already-invalid date window when the start time changes", () => {
    const next = applyDurationPreservingStartChange(
      { startsAt: "2026-07-08T10:00", endsAt: "2026-07-07T10:00" },
      "2026-07-08T12:30",
    );

    expect(next).toEqual({
      startsAt: "2026-07-08T12:30",
      endsAt: "2026-07-07T10:00",
    });
  });
});

describe("WizardStep1 event selection contract", () => {
  it("imports and renders an explicit Checkbox affordance for event rows", () => {
    expect(wizardStep1Source).toMatch(
      /import \{ Checkbox \} from "@\/components\/ui\/checkbox"/,
    );
    expect(wizardStep1Source).toMatch(/<Checkbox\b/);
  });

  it("does not hard-disable event rows so the cap toast stays reachable", () => {
    // The event-row mapping must not render a disabled control that blocks
    // toggleEvent — cap feedback lives in toggleEvent and must remain reachable.
    const rowMapping = wizardStep1Source.slice(
      wizardStep1Source.indexOf("events.map((ev)"),
    );
    expect(rowMapping).not.toMatch(/disabled=\{disabled\}/);
    expect(rowMapping).toMatch(/aria-disabled=/);
    expect(rowMapping).toMatch(/onKeyDown=/);
  });

  it("keeps selected-event chips that remove events on click", () => {
    expect(wizardStep1Source).toMatch(/form\.selectedEvents\.map\(\(ev\) =>/);
    expect(wizardStep1Source).toMatch(/aria-label=\{`Remove \$\{ev\.opponent/);
  });

  it("uses full event summaries for non-game linked events with sport metadata", () => {
    expect(wizardStep1Source).toContain("function eventSummaryLabel(ev: CalendarEvent)");
    expect(wizardStep1Source).toContain("return ev.summary;");
    expect(wizardStep1Source).toContain("const eventLabel = `${eventDateLabel(ev, true)} ${eventSummaryLabel(ev)}`");
    expect(wizardStep1Source).not.toContain("ev.opponent ?? (ev.sportCode ? sportLabel(ev.sportCode) : ev.summary)");
  });
});

describe("applyBulkShortageRecovery", () => {
  it("clamps a selected bulk quantity down to the available stock", () => {
    const result = applyBulkShortageRecovery(
      [{ bulkSkuId: "sku-aa", quantity: 5 }],
      [{ bulkSkuId: "sku-aa", requested: 5, available: 2 }],
    );

    expect(result.nextBulkItems).toEqual([{ bulkSkuId: "sku-aa", quantity: 2 }]);
    expect(result.adjustedCount).toBe(1);
    expect(result.messages).toHaveLength(1);
  });

  it("removes a selected bulk row when nothing is available", () => {
    const result = applyBulkShortageRecovery(
      [{ bulkSkuId: "sku-aa", quantity: 3 }],
      [{ bulkSkuId: "sku-aa", requested: 3, available: 0 }],
    );

    expect(result.nextBulkItems).toEqual([]);
    expect(result.adjustedCount).toBe(1);
  });

  it("treats a negative available count as zero and removes the row", () => {
    const result = applyBulkShortageRecovery(
      [{ bulkSkuId: "sku-aa", quantity: 3 }],
      [{ bulkSkuId: "sku-aa", requested: 3, available: -4 }],
    );

    expect(result.nextBulkItems).toEqual([]);
    expect(result.adjustedCount).toBe(1);
  });

  it("ignores shortage rows for SKUs that are not selected", () => {
    const result = applyBulkShortageRecovery(
      [{ bulkSkuId: "sku-aa", quantity: 3 }],
      [{ bulkSkuId: "sku-zz", requested: 9, available: 0 }],
    );

    expect(result.nextBulkItems).toEqual([{ bulkSkuId: "sku-aa", quantity: 3 }]);
    expect(result.adjustedCount).toBe(0);
    expect(result.messages).toHaveLength(0);
  });

  it("preserves unrelated selected bulk rows while clamping the affected one", () => {
    const result = applyBulkShortageRecovery(
      [
        { bulkSkuId: "sku-aa", quantity: 5 },
        { bulkSkuId: "sku-bb", quantity: 2 },
      ],
      [{ bulkSkuId: "sku-aa", requested: 5, available: 1 }],
    );

    expect(result.nextBulkItems).toEqual([
      { bulkSkuId: "sku-aa", quantity: 1 },
      { bulkSkuId: "sku-bb", quantity: 2 },
    ]);
    expect(result.adjustedCount).toBe(1);
  });

  it("never increases a selected quantity above what was requested", () => {
    const result = applyBulkShortageRecovery(
      [{ bulkSkuId: "sku-aa", quantity: 2 }],
      [{ bulkSkuId: "sku-aa", requested: 2, available: 8 }],
    );

    expect(result.nextBulkItems).toEqual([{ bulkSkuId: "sku-aa", quantity: 2 }]);
    expect(result.adjustedCount).toBe(0);
  });

  it("uses the provided SKU name lookup in recovery messages", () => {
    const result = applyBulkShortageRecovery(
      [{ bulkSkuId: "sku-aa", quantity: 5 }],
      [{ bulkSkuId: "sku-aa", requested: 5, available: 2 }],
      (id) => (id === "sku-aa" ? "AA Battery" : undefined),
    );

    expect(result.messages[0]).toContain("AA Battery");
  });
});
