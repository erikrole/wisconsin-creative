import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("student availability profile UI", () => {
  it("summarizes availability by operational scheduling impact", () => {
    const tab = source("src/app/(app)/users/[id]/UserAvailabilityTab.tsx");

    expect(tab).toContain("function AvailabilityImpactSummary");
    expect(tab).toContain("const approvedTimeOffCount = blocks.filter(isApprovedTimeOff).length");
    expect(tab).toContain("const advisoryConflictCount = blocks.filter(isAdvisoryConflict).length");
    expect(tab).toContain("const preferenceCount = blocks.filter(isPreference).length");
    expect(tab).toContain("const today = localDateValue();");
    expect(tab).toContain("blockIntent(block) === \"TIME_OFF\" && blockStatus(block) === \"DENIED\"");
    expect(tab).toContain("Approved time off is blocking. Other availability stays visible as staff-reviewed guidance.");
    expect(tab).toContain("Blocks assignment, pickup, trade, and call-window changes.");
    expect(tab).toContain("Warns assignment, auto-fill, and Trade Board review.");
    expect(tab).toContain("Improves candidate fit when staff review coverage.");
  });

  it("keeps the profile buckets broad enough for weekly and dated availability signals", () => {
    const tab = source("src/app/(app)/users/[id]/UserAvailabilityTab.tsx");

    expect(tab).toContain("Weekly class schedule");
    expect(tab).toContain("One-off days and ranges");
    expect(tab).toContain("No repeating class, preference, or weekly time-off signals.");
    expect(tab).toContain("No dated conflicts, preferences, or time-off requests.");
    expect(tab).toContain("Next dated exception:");
  });
});
