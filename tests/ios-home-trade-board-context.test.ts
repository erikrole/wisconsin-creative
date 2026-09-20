import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const HOME = "ios/Wisconsin/Views/HomeView.swift";
const TRADE = "ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift";

describe("iOS Home trade board context", () => {
  it("hands the trade board a real shift list", () => {
    const home = source(HOME);

    // The regression: Home opened the shared sheet with `myShifts: []`, so Post
    // a Trade had nothing to offer even though the identical sheet worked when
    // opened from Schedule.
    expect(home).not.toContain("myShifts: [],");
    expect(home).toContain("myShifts: tradeMyShifts");
    expect(home).toContain("await APIClient.shared.myShifts(userId: userId)");
  });

  it("loads that list with the sheet rather than on every Home render", () => {
    const home = source(HOME);

    // Home is the app's landing screen; a screen most people never open should
    // not add a request to it.
    expect(home).toContain(".task { await loadTradeMyShifts() }");
    expect(home).toContain("guard tradeMyShifts.isEmpty");
  });

  it("keeps the post step the only thing that depends on it", () => {
    const trade = source(TRADE);

    // Browse and claim must keep working when the list fails to load, which is
    // what makes a quiet failure the right call in `loadTradeMyShifts`.
    expect(trade).toContain("PostTradeSheet(myShifts: myShifts, wrapsInNavigationStack: false)");
  });
});
