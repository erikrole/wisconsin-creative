import { describe, expect, it } from "vitest";
import { availabilityToday, isAvailabilityHistory } from "@/lib/student-availability-display";
import { source } from "./_helpers/source";

describe("student availability profile UI", () => {
  it("uses Madison's date even when the instant is already tomorrow in UTC", () => {
    expect(availabilityToday(new Date("2026-10-30T02:00:00Z"))).toBe("2026-10-29");
  });

  it.each([
    [{ kind: "AD_HOC", date: "2026-10-20", dateEndsOn: "2026-10-29" }, false],
    [{ kind: "AD_HOC", date: "2026-10-20", dateEndsOn: "2026-10-28" }, true],
    [{ kind: "WEEKLY", semesterEndsOn: "2026-10-28" }, true],
    [{ kind: "WEEKLY", semesterStartsOn: "2027-01-01" }, false],
    [{ kind: "AD_HOC", date: "2026-11-20", intent: "TIME_OFF", status: "DENIED" }, true],
    [{ kind: "WEEKLY" }, false],
  ])("separates expired or denied entries from current guidance: %j", (block, expected) => {
    expect(isAvailabilityHistory({ ...block, startsAt: "09:00", endsAt: "10:00" }, "2026-10-29")).toBe(expected);
  });

  it("summarizes availability by operational scheduling impact", () => {
    const tab = source("src/app/(app)/staff/[id]/UserAvailabilityTab.tsx");

    expect(tab).toContain("blockIntent(block) === \"TIME_OFF\" && blockStatus(block) === \"DENIED\"");
    expect(tab).toContain("Approved time off is blocking. Other availability stays visible as staff-reviewed guidance.");
    expect(tab).toContain("Blocks assignment, pickup, trade, and call-window changes.");
    expect(tab).toContain("Warns assignment, auto-fill, and Trade Board review.");
    expect(tab).toContain("Improves candidate fit when staff review coverage.");
  });

  it("keeps the profile buckets broad enough for weekly and dated availability signals", () => {
    const tab = source("src/app/(app)/staff/[id]/UserAvailabilityTab.tsx");

    expect(tab).toContain("Weekly class schedule");
    expect(tab).toContain("One-off days and ranges");
    expect(tab).toContain("No repeating class, preference, or weekly time-off signals.");
    expect(tab).toContain("No dated conflicts, preferences, or time-off requests.");
    expect(tab).toContain("Next dated exception:");
  });
});
