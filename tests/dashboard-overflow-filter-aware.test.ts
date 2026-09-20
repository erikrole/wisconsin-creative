import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const COLUMNS = [
  "src/app/(app)/dashboard/team-activity-column.tsx",
  "src/app/(app)/dashboard/my-gear-column.tsx",
] as const;

describe("dashboard overflow links are filter-aware", () => {
  it("columns accept a hasActiveFilter prop", () => {
    for (const file of COLUMNS) {
      const component = source(file);
      expect(component).toContain("hasActiveFilter: boolean");
      expect(component).toContain("hasActiveFilter");
    }
  });

  it("the dashboard page passes hasActiveFilter into both columns", () => {
    const page = source("src/app/(app)/page.tsx");
    const occurrences = page.match(/hasActiveFilter=\{filters\.hasActiveFilter\}/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("overflow footers guard on hasActiveFilter, not only activeSport", () => {
    for (const file of COLUMNS) {
      const component = source(file);
      // Every `View all`/overflow footer must be gated on the filter-aware signal.
      expect(component).toContain("!hasActiveFilter && data.");
      // No footer total guard should rely on the narrow sport-only signal.
      expect(component).not.toContain("!activeSport && data.");
    }
  });
});
