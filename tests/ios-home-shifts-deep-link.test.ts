import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const APP_STATE = "ios/Wisconsin/Core/AppState.swift";
const HOME = "ios/Wisconsin/Views/HomeView.swift";
const SCHEDULE = "ios/Wisconsin/Views/ScheduleView.swift";

describe("iOS Home shifts deep link", () => {
  it("carries the scope hint across the tab switch", () => {
    const appState = source(APP_STATE);

    // Mirrors `pendingBookingsScope`, which does the same job for the Bookings
    // tab: a dashboard tile whose count is scoped should open a screen scoped
    // the same way.
    expect(appState).toContain("var pendingScheduleMyShifts = false");
    // Cleared with the other pending signals so a stale hint cannot survive a
    // sign-out and re-apply itself to the next person.
    expect(appState).toContain("pendingScheduleMyShifts = false");
  });

  it("sets the hint from every shifts affordance on Home", () => {
    const home = source(HOME);

    // Both the Shifts stat tile and the "N more shifts in Schedule" overflow
    // route through openSchedule, and both counts are personal.
    expect(home.match(/appState\.pendingScheduleMyShifts = true/g)).toHaveLength(2);
    expect(home).not.toContain("openSchedule: { appState.selectedTab = 4 }");
  });

  it("applies and clears the hint in the schedule that owns the filter", () => {
    const schedule = source(SCHEDULE);

    expect(schedule).toContain("private func consumePendingMyShifts()");
    // Consumed, not observed: clearing the flag before applying it means a
    // later manual clear of the filter is not undone by a stale hint.
    expect(schedule).toContain("appState.pendingScheduleMyShifts = false\n        myShiftsOnly = true");
    // Read on appear as well as on change, because the tab switch and the flag
    // can arrive in either order.
    expect(schedule).toContain(".onChange(of: appState.pendingScheduleMyShifts)");
    expect(schedule).toContain("consumePendingMyShifts()\n                vm.cacheOwnerId = session.currentUser?.id");
  });

  it("lands on the list, where the filter is legible", () => {
    const schedule = source(SCHEDULE);
    const helper = schedule.slice(
      schedule.indexOf("private func consumePendingMyShifts()"),
      schedule.indexOf("private var canSeePastEvents"),
    );

    // Schedule is one master list now, so turning the filter on is the whole
    // landing; there is no mode to switch back to.
    expect(helper).toContain("myShiftsOnly = true");
    expect(schedule).not.toContain("viewMode");
  });
});
