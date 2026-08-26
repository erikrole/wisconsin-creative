import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS kiosk idle sleep mode", () => {
  it("uses cost-bounded idle polling while retaining a manual refresh and durable device health check", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");

    expect(idle).toContain("private let refreshInterval: TimeInterval = 5 * 60");
    expect(idle).toContain('Image(systemName: "arrow.clockwise")');
    expect(idle).toContain('accessibilityLabel("Refresh kiosk data")');
    expect(idle).toContain(".task { await loadAll() }");
    expect(store).toContain("private static let heartbeatInterval: UInt64 = 300_000_000_000");
    // The heartbeat interval is chosen per cycle now, not fixed. A hard 5-minute
    // beat ran regardless of use and pinned the Neon compute endpoint awake,
    // which defeated the idle gating this same test asserts above.
    expect(store).toContain("Task.sleep(nanoseconds: interval)");
    expect(store).toContain("private static let heartbeatIdleInterval: UInt64 = 3_600_000_000_000");
  });

  it("does not expose the debug sleep control on the idle screen", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");

    expect(idle).not.toContain("debugSleepModeButton");
    expect(idle).not.toContain("debugForcesSleepMode");
    expect(idle).not.toContain("Enable debug night mode");
    expect(store).not.toContain("clearSleepModeDismissal");
  });

  it("keeps sleep dismissal across idle navigation and preserves readable overlay text", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const sleepView = source("ios/Wisconsin/Kiosk/KioskSleepModeView.swift");
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");
    const operatorHub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
    const success = source("ios/Wisconsin/Kiosk/KioskSuccessView.swift");

    expect(store).toContain("var sleepDismissedUntil: Date?");
    expect(store).toContain("func deferSleepMode(for duration: TimeInterval = 10 * 60)");
    expect(idle).toContain("store.sleepDismissedUntil");
    expect(idle).toContain("store.deferSleepMode(for: sleepWakeDuration)");
    expect(idle).toContain('if standby.reason == "night_hours", !Self.isLocalNightHours(Date())');
    expect(idle).toContain('return isLocallyIdleWindow(dashboard, standby: standby) ? "idle_window" : "active_window"');
    expect(idle).toContain('guard sleepModeReason != "active_window" else { return false }');
    expect(idle).toContain("hour >= 22 || hour < 6");
    expect(operatorHub).toContain("store.deferSleepMode()");
    expect(success).toContain("store.deferSleepMode()");
    expect(sleepView).toContain("Color.white.opacity(0.64)");
    expect(sleepView).not.toContain("Color.white.opacity(0.13)");
    expect(sleepView).not.toContain("Color.white.opacity(0.09)");
  });
});
