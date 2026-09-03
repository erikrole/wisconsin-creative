import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("combined Schedule events source contract", () => {
  it("keeps combine preview-first, suggested, and reversible in the Schedule control room", () => {
    const page = source("src/app/(app)/schedule/page.tsx");
    const dialog = source("src/app/(app)/schedule/_components/CombineEventsDialog.tsx");
    const route = source("src/app/api/calendar-events/combine/route.ts");
    const eventDetail = source("src/app/(app)/events/[id]/page.tsx");

    expect(page).toContain("<CombineEventsDialog");
    expect(page).toContain("Combine events");
    expect(page).toContain("related event");
    expect(page).toContain("dismissCombineSuggestion");
    expect(dialog).toContain("Review combination");
    expect(dialog).toContain("Suggested pairs");
    expect(dialog).toContain("Same day, sport, venue, and overlapping time.");
    expect(dialog).toContain("void review([suggestion.first.id, suggestion.second.id])");
    expect(dialog).toContain("Both source events stay in the system.");
    expect(dialog).toContain("No assigned or published crew is removed.");
    expect(dialog).toContain("assignedCrewCount");
    expect(route).toContain('requirePermission(user.role, "shift", "manage")');
    expect(route).toContain("expectedSecondaryWorkingVersion");
    expect(route).toContain("export const DELETE");
    expect(route).toContain("uncombineScheduleEvents");
    expect(eventDetail).toContain("One shared crew covers both source events.");
    expect(eventDetail).toContain("Undo combination");
    expect(eventDetail).toContain("combinedSourceTime(sourceEvent)");
  });
});
