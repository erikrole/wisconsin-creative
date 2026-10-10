import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS event detail unreleased crew", () => {
  it("does not offer Claim while staff have not released the crew", () => {
    const model = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const view = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    expect(model).toContain("var publication: EventShiftGroupPublication?");
    expect(view).toContain("private var crewUnreleased: Bool");
    expect(view).toContain("!claimsPaused, !crewUnreleased");
    expect(view).toContain("onRequest: crewUnreleased ? nil");
  });
});
