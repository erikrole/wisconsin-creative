import { describe, expect, it } from "vitest";
import type { AdminFixTodayQueue } from "@/lib/admin-fix-today";
import {
  normalizeFixTodayQueue,
  normalizeHygieneQueue,
  sortOpsChecks,
  summarizeOpsChecks,
  type HygieneQueuePayload,
  type OpsCheck,
} from "@/lib/ops-checks";

function fixTodayQueue(overrides: Partial<AdminFixTodayQueue> = {}): AdminFixTodayQueue {
  return {
    generatedAt: "2026-07-12T12:00:00.000Z",
    totals: { openItems: 3, activeChecks: 2, checksNeedingWork: 1, criticalChecks: 1 },
    sections: [
      {
        key: "overdue-checkouts",
        title: "Overdue gear",
        description: "Open checkouts past their return time.",
        count: 3,
        severity: "critical",
        href: "/bookings?tab=checkouts&filter=overdue",
        ctaLabel: "Review overdue",
        samples: [
          { id: "b1", label: "REF-1 / Football", detail: "Jane / due Jul 11", href: "/checkouts/b1" },
        ],
      },
      {
        key: "license-expirations",
        title: "License expirations",
        description: "Active license codes expiring soon.",
        count: 0,
        severity: "info",
        href: "/licenses",
        ctaLabel: "Open licenses",
        samples: [],
      },
    ],
    partialFailures: [],
    ...overrides,
  };
}

function hygieneQueue(overrides: Partial<HygieneQueuePayload> = {}): HygieneQueuePayload {
  return {
    generatedAt: "2026-07-12T12:00:00.000Z",
    totals: { openIssues: 4, activeChecks: 3, checksNeedingWork: 2 },
    issues: [
      {
        key: "duplicate-scan-identity",
        title: "Duplicate scan identity",
        description: "The same physical scan value appears across multiple item identities.",
        count: 2,
        samples: [
          { id: "SCAN-1", label: "SCAN-1", detail: "2 appearances", href: "/items?q=SCAN-1" },
        ],
      },
      {
        key: "low-bulk-stock",
        title: "Item families below threshold",
        description: "Low stock makes picker guidance less reliable.",
        count: 1,
        samples: [],
      },
      {
        key: "missing-image",
        title: "Missing image",
        description: "Photos make confirmation faster.",
        count: 1,
        samples: [],
      },
    ],
    partialFailures: [],
    ...overrides,
  };
}

describe("normalizeFixTodayQueue", () => {
  it("maps sections into operations-lane checks without dropping fields", () => {
    const checks = normalizeFixTodayQueue(fixTodayQueue());

    expect(checks).toHaveLength(2);
    expect(checks[0]).toEqual({
      key: "overdue-checkouts",
      lane: "operations",
      title: "Overdue gear",
      description: "Open checkouts past their return time.",
      count: 3,
      severity: "critical",
      href: "/bookings?tab=checkouts&filter=overdue",
      ctaLabel: "Review overdue",
      samples: [
        { id: "b1", label: "REF-1 / Football", detail: "Jane / due Jul 11", href: "/checkouts/b1" },
      ],
    });
  });
});

describe("normalizeHygieneQueue", () => {
  it("drops the duplicated low-bulk-stock check", () => {
    const checks = normalizeHygieneQueue(hygieneQueue());

    expect(checks.map((check) => check.key)).toEqual(["duplicate-scan-identity", "missing-image"]);
  });

  it("attaches severity and repair routing from check meta", () => {
    const checks = normalizeHygieneQueue(hygieneQueue());
    const duplicate = checks.find((check) => check.key === "duplicate-scan-identity");
    const missingImage = checks.find((check) => check.key === "missing-image");

    expect(duplicate).toMatchObject({
      lane: "hygiene",
      severity: "critical",
      href: "/items",
      ctaLabel: "Review matching items",
    });
    expect(missingImage).toMatchObject({ severity: "info", ctaLabel: "Open items" });
  });

  it("routes support-family hygiene checks to the right repair surfaces", () => {
    const checks = normalizeHygieneQueue(hygieneQueue({
      issues: [
        {
          key: "units-missing-product",
          title: "Family units missing product",
          description: "Assign products under the family.",
          count: 3,
          samples: [],
        },
        {
          key: "serialized-support-pool-candidates",
          title: "Serialized support gear to review as families",
          description: "Review tripods and light kits.",
          count: 4,
          samples: [],
        },
      ],
    }));

    expect(checks.find((check) => check.key === "units-missing-product")).toMatchObject({
      severity: "warning",
      href: "/bulk-inventory",
      ctaLabel: "Assign products",
    });
    expect(checks.find((check) => check.key === "serialized-support-pool-candidates")).toMatchObject({
      severity: "info",
      href: "/items",
      ctaLabel: "Review support gear",
    });
  });

  it("falls back to safe defaults for unknown check keys", () => {
    const checks = normalizeHygieneQueue(hygieneQueue({
      issues: [
        {
          key: "brand-new-check",
          title: "Brand new check",
          description: "Added by a future slice.",
          count: 5,
          samples: [],
        },
      ],
    }));

    expect(checks[0]).toMatchObject({
      key: "brand-new-check",
      lane: "hygiene",
      severity: "info",
      href: "/items",
      ctaLabel: "Open items",
    });
  });
});

describe("sortOpsChecks", () => {
  it("puts checks with open work first, then sorts by severity, count, and title", () => {
    const checks: OpsCheck[] = [
      { key: "clean-critical", lane: "operations", title: "A clean", description: "", count: 0, severity: "critical", href: "/x", ctaLabel: "Go", samples: [] },
      { key: "info-open", lane: "hygiene", title: "Info open", description: "", count: 9, severity: "info", href: "/x", ctaLabel: "Go", samples: [] },
      { key: "warning-big", lane: "operations", title: "Warning big", description: "", count: 4, severity: "warning", href: "/x", ctaLabel: "Go", samples: [] },
      { key: "warning-small", lane: "operations", title: "Warning small", description: "", count: 2, severity: "warning", href: "/x", ctaLabel: "Go", samples: [] },
      { key: "critical-open", lane: "operations", title: "Critical open", description: "", count: 1, severity: "critical", href: "/x", ctaLabel: "Go", samples: [] },
    ];

    expect(sortOpsChecks(checks).map((check) => check.key)).toEqual([
      "critical-open",
      "warning-big",
      "warning-small",
      "info-open",
      "clean-critical",
    ]);
  });

  it("does not mutate the input array", () => {
    const checks = normalizeFixTodayQueue(fixTodayQueue());
    const snapshot = checks.map((check) => check.key);
    sortOpsChecks(checks);

    expect(checks.map((check) => check.key)).toEqual(snapshot);
  });
});

describe("summarizeOpsChecks", () => {
  it("computes merged totals across both lanes", () => {
    const checks = [
      ...normalizeFixTodayQueue(fixTodayQueue()),
      ...normalizeHygieneQueue(hygieneQueue()),
    ];

    expect(summarizeOpsChecks(checks)).toEqual({
      openItems: 6,
      activeChecks: 4,
      checksNeedingWork: 3,
      criticalChecks: 2,
    });
  });

  it("reports zeroes for an empty queue", () => {
    expect(summarizeOpsChecks([])).toEqual({
      openItems: 0,
      activeChecks: 0,
      checksNeedingWork: 0,
      criticalChecks: 0,
    });
  });
});
