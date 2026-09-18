import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");

describe("native Schedule MVP parity", () => {
  it("does not crash when one person has two shifts on the same event", () => {
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    expect(schedule).not.toContain("Dictionary(uniqueKeysWithValues: fetchedShifts.map");
    expect(schedule).toContain("orderedPersonalShiftsByEvent");
    expect(schedule).toContain("extraShiftAreasByEventId");
  });

  it("collapses combined source events onto the canonical row", () => {
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    const calendarRoute = source("src/app/api/calendar-events/route.ts");
    expect(models).toContain("var combinedIntoId: String?");
    expect(models).toContain("func collapsedCombinedScheduleEvents");
    expect(models).toContain("combinedMemberCount");
    expect(schedule).toContain("collapsedCombinedScheduleEvents(fetchedEvents)");
    expect(schedule).toContain("events · shared crew");
    expect(calendarRoute).toContain("combinedIntoId: null");
  });

  it("lets staff publish now or apply an ended-event correction", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    expect(apiClient).toContain("func publishWorkingSchedule");
    expect(apiClient).toContain("/api/shift-groups/\\(shiftGroupId)/publish");
    expect(eventDetail).toContain("case publishNow");
    expect(eventDetail).toContain("Apply correction now");
    expect(eventDetail).toContain("Nobody is notified.");
    const review = eventDetail.slice(
      eventDetail.indexOf("private var workingScheduleReviewCard"),
      eventDetail.indexOf("private var crewBody"),
    );
    expect(review.indexOf("Apply correction now")).toBeGreaterThan(0);
    expect(review.indexOf("Apply correction now")).toBeLessThan(review.indexOf('Label("Undo"'));
  });

  it("pauses native student claims while a private crew edit exists", () => {
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const listRoute = source("src/app/api/shift-groups/route.ts");
    expect(models).toContain("var claimsPaused: Bool?");
    expect(eventDetail).toContain("!claimsPaused");
    expect(eventDetail).toContain("Staff are updating this crew");
    expect(listRoute).toContain("claimsPaused: Boolean(g.workingCopy)");
  });

  it("keeps pause, combined, and trade-count cues from lying", () => {
    const list = source("src/app/(app)/schedule/_components/ListView.tsx");
    const data = source("src/hooks/use-schedule-data.ts");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    expect(list).toContain("eventSpansMultipleDays");
    expect(list).toContain("<ClaimsPausedNotice");
    expect(data).toContain('throw new Error("trade count fetch failed")');
    expect(eventDetail).toContain("myShifts: [MyShift]");
    expect(eventDetail).toContain("multiAssignmentSubtitle");
  });
});
