import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// Single owner for the Xcode toolchain and deployment-target pins that used
// to be asserted redundantly in ios-27-native-chrome, ios-swiftui-performance,
// ios-api-contract, and ios-main-kiosk-target-split.
describe("iOS toolchain pins", () => {
  it("builds with the iOS 27 Xcode toolchain", () => {
    const project = source("ios/project.yml");

    expect(project).toContain('xcodeVersion: "27.0"');
  });

  it("keeps every target on the iOS 26 deployment floor", () => {
    const project = source("ios/project.yml");
    const appTarget = project.slice(
      project.indexOf("  Wisconsin:\n"),
      project.indexOf("  WisconsinKiosk:\n"),
    );
    const kioskTarget = project.slice(
      project.indexOf("  WisconsinKiosk:\n"),
      project.indexOf("  WisconsinTests:\n"),
    );
    const testsTarget = project.slice(project.indexOf("  WisconsinTests:\n"));

    expect(appTarget).toContain('deploymentTarget: "26.0"');
    expect(kioskTarget).toContain('deploymentTarget: "26.0"');
    expect(kioskTarget).not.toContain('deploymentTarget: "17.0"');
    expect(testsTarget).toContain('deploymentTarget: "26.0"');
  });
});
