import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("dashboard row rails", () => {
  it("limits sibling separators to the top border so later left rails keep their color", () => {
    const bookingRow = source("src/app/(app)/dashboard/booking-row.tsx");
    const teamActivity = source("src/app/(app)/dashboard/team-activity-column.tsx");

    expect(bookingRow).toContain("[&+&]:border-t-border/40");
    expect(bookingRow).not.toContain("[&+&]:border-border/40");
    expect(teamActivity).toContain("[&+&]:border-t-border/40");
    expect(teamActivity).not.toContain("[&+&]:border-border/40");
  });
});
