import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Kiosk checkout kits and interruptions (D3, E1–E3, I1)", () => {
  const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
  const details = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailsStep.swift");
  const harness = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");
  const script = source("scripts/kiosk-capture-scenarios.sh");

  it("D3 picks another date on a month grid with time chips, not the native picker", () => {
    expect(details).toContain("struct KioskMonthGrid: View");
    expect(details).toContain("KioskMonthGrid(monthStart: $monthStart, selectedDay: $day)");
    expect(details).not.toContain(".datePickerStyle(.graphical)");
    expect(details).toContain("count: 4), spacing: 8)");
  });

  it("I1 discards scans from a card with a red Discard, never a system dialog", () => {
    expect(checkout).not.toContain(".confirmationDialog(");
    expect(checkout).toContain('confirmTitle: "Discard"');
    expect(checkout).toContain("confirmRole: .destructive");
    expect(checkout).toContain("Nothing has been checked out yet. Put ");
    // The card must not leave the hidden scanner field armed behind it.
    expect(checkout).toContain("!showBackConfirm && !showKitPicker");
  });

  it("E1–E3 start kits on the scan screen for football crew and ask before leaving kit items", () => {
    expect(checkout).toContain("private var showsKitEntry: Bool");
    expect(checkout).toContain("KioskKitCopy.footballSportCode");
    expect(checkout).toContain("KioskKitPickSheet(");
    expect(checkout).toContain('" + \\(extras) extra"');
    expect(checkout).toContain('trailingNote: "Not in kit"');
    expect(checkout).toContain("still to scan: ");
    expect(checkout).toContain('overline: "Before you check out"');
    expect(checkout).toContain('Text("Check out without them")');
    // Role labels come from the kit's own name, not an invented role map.
    expect(checkout).not.toContain("kioskFootballGamedayKitLabel");
  });

  it("captures each frame from a DEBUG fixture", () => {
    for (const scenario of [
      "checkout-other-date",
      "checkout-discard",
      "kit-pick",
      "kit-session",
      "kit-finish-confirm",
    ]) {
      expect(harness).toContain(`= "${scenario}"`);
      expect(script).toContain(scenario);
    }
  });
});
