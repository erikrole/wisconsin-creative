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

describe("iOS Kiosk interruptions and sound (I3, I4, J4)", () => {
  const kit = source("ios/Wisconsin/Kiosk/KioskTaskKit.swift");
  const shell = source("ios/Wisconsin/Kiosk/KioskShellView.swift");
  const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");
  const app = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");

  it("I3 says a sleeping scanner inline on every scan stage, in grey, not as an error", () => {
    expect(kit).toContain('static let asleep = "Scanner is asleep. Press its trigger to wake it."');
    for (const file of ["KioskCheckoutView", "KioskPickupView", "KioskReturnView"]) {
      expect(source(`ios/Wisconsin/Kiosk/${file}.swift`)).toContain("return KioskScannerCopy.asleep");
    }
    const prompt = kit.slice(kit.indexOf("struct KioskScanPrompt"), kit.indexOf("enum KioskScannerCopy"));
    expect(prompt).not.toContain("KioskStatus.attention");
  });

  it("I4 counts down on a ring and says how long scans wait, from the store's own retention", () => {
    expect(store).toContain("static let cartRetention: TimeInterval = 20 * 60");
    expect(store).toContain("static var inactivityWarningSeconds: Int");
    expect(shell).toContain("let minutes = Int(KioskStore.cartRetention / 60)");
    expect(shell).toContain("tap your name to pick up where you left off.");
    expect(shell).toContain("private struct InactivityCountdownRing: View");
    expect(shell).toContain('Text("I\'m done for now")');
    expect(shell).toContain('Text("I\'m here")');
    expect(shell).toContain("KioskFeedbackSound.play(.warning)");
  });

  it("J4 plays each moment's sound and turns movement into 150 ms fades under Reduce Motion", () => {
    for (const cue of ["accept", "reject", "undo", "done", "badge", "attention", "warning"]) {
      expect(app).toContain(`case ${cue}`);
    }
    for (const file of ["KioskCheckoutView", "KioskPickupView", "KioskReturnView"]) {
      const view = source(`ios/Wisconsin/Kiosk/${file}.swift`);
      expect(view).toContain("KioskFeedbackSound.play(.accept)");
      expect(view).toContain("KioskFeedbackSound.play(.undo)");
      expect(view).toContain("KioskFeedbackSound.play(.attention)");
    }
    expect(source("ios/Wisconsin/Kiosk/KioskSuccessView.swift")).toContain(
      "KioskFeedbackSound.play(info.earnedBadges.isEmpty ? .done : .badge)",
    );
    expect(kit).toContain("static let fadeUnderReduceMotion = Animation.easeInOut(duration: 0.15)");
    for (const file of ["KioskSuccessView", "KioskPickupView", "KioskIdleView"]) {
      expect(source(`ios/Wisconsin/Kiosk/${file}.swift`)).not.toContain("reduceMotion ? nil :");
    }
  });

  it("captures I3 and I4 from DEBUG fixtures", () => {
    for (const scenario of ["scanner-asleep", "inactivity-checkout"]) {
      expect(app).toContain(`= "${scenario}"`);
    }
  });
});
