import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk windowing cleanup", () => {
  it("locks the kiosk to landscape and declares the full-screen requirement", () => {
    const project = source("ios/project.yml");
    const plist = source("ios/Wisconsin/KioskOnly/Info.plist");
    const kioskTarget = project.slice(
      project.indexOf("  WisconsinKiosk:\n"),
      project.indexOf("  WisconsinTests:\n"),
    );

    // iPadOS requires every orientation UNLESS the app declares it needs the
    // full screen. The 2026-07-09 cleanup dropped UIRequiresFullScreen while
    // the kiosk still declared all four orientations, which was correct then;
    // the 2026-07-27 landscape lock makes it required again. The two settings
    // are a pair — asserting them together stops one being changed alone.
    expect(kioskTarget).toContain("UIRequiresFullScreen: true");
    expect(plist).toContain("UIRequiresFullScreen");

    // Landscape only. Every layout in the kiosk is a two-column landscape
    // task, and the counter iPad is mounted. Portrait was supported but
    // nothing was ever verified against it.
    for (const orientation of [
      "UIInterfaceOrientationLandscapeLeft",
      "UIInterfaceOrientationLandscapeRight",
    ]) {
      expect(kioskTarget).toContain(orientation);
      expect(plist).toContain(orientation);
    }
    // Note the trailing quote/newline: "…Portrait" is a prefix of
    // "…PortraitUpsideDown", so a bare substring check would pass either way.
    expect(plist).not.toContain("UIInterfaceOrientationPortrait<");
    expect(plist).not.toContain("UIInterfaceOrientationPortraitUpsideDown");
    expect(kioskTarget).not.toContain("UIInterfaceOrientationPortrait\n");
    expect(kioskTarget).not.toContain("UIInterfaceOrientationPortraitUpsideDown");
  });

  it("keeps the kiosk usable in compact and resized scenes", () => {
    const app = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");
    const chrome = source("ios/Wisconsin/Kiosk/KioskChrome.swift");
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const returned = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");
    const hub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");

    expect(app).toContain(".windowResizability(.contentMinSize)");
    expect(app).toContain(".frame(minWidth: 640, minHeight: 540)");
    expect(chrome).toContain("struct KioskAdaptiveSplit<Primary: View, Secondary: View>: View");
    expect(chrome).toContain("proxy.size.width < KioskLayout.compactBreakpoint");
    expect(chrome).toContain("primary(true)");
    expect(chrome).toContain("secondary(true)");
    expect(checkout).toContain("KioskAdaptiveSplit { _ in");
    expect(checkout).toContain("KioskSideRail(isCompact: isCompact)");
    expect(pickup).toContain("KioskAdaptiveSplit { _ in");
    expect(pickup).toContain("KioskSideRail(isCompact: isCompact)");
    expect(returned).toContain("KioskAdaptiveSplit { _ in");
    expect(returned).toContain("KioskSideRail(isCompact: isCompact)");
    // The user hub is deliberately NOT an adaptive split. Its 60/40 layout gave
    // an "Coming Up" empty state half the iPad while truncating booking item
    // names on the left, so it became one full-width prioritized column that
    // narrows without needing a second pane. Scan screens above still split --
    // they have a genuine two-surface job (scan zone plus running rail).
    expect(hub).not.toContain("KioskAdaptiveSplit");
    expect(hub).toContain("private var hubContent: some View");
    expect(hub).toContain("ScrollView {");
  });

  it("resolves the scanner suppression default inside the main-actor gate", () => {
    const scanner = source("ios/Wisconsin/Shared/HIDScannerField.swift");

    expect(scanner).toContain("static func suppressScannerFocus(for duration: TimeInterval? = nil)");
    expect(scanner).toContain("let duration = duration ?? defaultSuppressionDuration");
    expect(scanner).not.toContain("TimeInterval = defaultSuppressionDuration");
  });
});
