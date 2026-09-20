import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function json<T>(relativeFile: string): T {
  return JSON.parse(source(relativeFile)) as T;
}

function pngDimensions(relativeFile: string) {
  const data = readFileSync(path.join(process.cwd(), relativeFile));
  expect(data.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

describe("iOS launch experience", () => {
  it("keeps a required UILaunchScreen without treating it as a brand splash", () => {
    const project = source("ios/project.yml");
    const plist = source("ios/Wisconsin/Supporting/Info.plist");
    const kioskPlist = source("ios/Wisconsin/KioskOnly/Info.plist");

    expect(project).toMatch(/UILaunchScreen:\n\s+UIColorName: LaunchBackground\n\s+UISupportedInterfaceOrientations:/);
    expect(project).toMatch(/UILaunchScreen:\n\s+UIColorName: KioskLaunchBackground\n/);
    expect(project).not.toContain("UIImageName: LaunchLockup");
    expect(plist).toMatch(
      /<key>UILaunchScreen<\/key>\s*<dict>\s*<key>UIColorName<\/key>\s*<string>LaunchBackground<\/string>\s*<\/dict>/,
    );
    expect(plist).not.toContain("LaunchLockup");
    expect(kioskPlist).toMatch(
      /<key>UILaunchScreen<\/key>\s*<dict>\s*<key>UIColorName<\/key>\s*<string>KioskLaunchBackground<\/string>\s*<\/dict>/,
    );
    expect(kioskPlist).not.toContain("LaunchLockup");
  });

  it("ships native-resolution Motion W assets for sign-in, not a launch lockup", () => {
    const mark = json<{ images: Array<{ filename?: string; scale: string }> }>(
      "ios/Wisconsin/Assets.xcassets/Badgers.imageset/Contents.json",
    );

    expect(mark.images.map(({ filename, scale }) => ({ filename, scale }))).toEqual([
      { filename: "Badgers.png", scale: "1x" },
      { filename: "Badgers@2x.png", scale: "2x" },
      { filename: "Badgers@3x.png", scale: "3x" },
    ]);
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/Badgers.imageset/Badgers.png")).toEqual({ width: 72, height: 72 });
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/Badgers.imageset/Badgers@2x.png")).toEqual({ width: 144, height: 144 });
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/Badgers.imageset/Badgers@3x.png")).toEqual({ width: 216, height: 216 });
    expect(existsSync("ios/Wisconsin/Assets.xcassets/LaunchLockup.imageset")).toBe(false);
  });

  it("matches the system frame to Home's grouped background", () => {
    const background = json<{
      colors: Array<{ color: { components: Record<string, string> }; appearances?: Array<{ value: string }> }>;
    }>("ios/Wisconsin/Assets.xcassets/LaunchBackground.colorset/Contents.json");
    const kioskBackground = json<{
      colors: Array<{ color: { components: Record<string, string> } }>;
    }>("ios/Wisconsin/Assets.xcassets/KioskLaunchBackground.colorset/Contents.json");
    const launch = source("ios/Wisconsin/Views/LaunchView.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const kioskDesign = source("ios/Wisconsin/Kiosk/KioskDesign.swift");

    expect(background.colors[0]?.appearances).toBeUndefined();
    expect(background.colors[0]?.color.components).toMatchObject({
      red: "0.949",
      green: "0.949",
      blue: "0.969",
      alpha: "1.000",
    });
    expect(background.colors[1]?.appearances?.[0]?.value).toBe("dark");
    expect(background.colors[1]?.color.components).toMatchObject({
      red: "0.000",
      green: "0.000",
      blue: "0.000",
      alpha: "1.000",
    });
    expect(home).toContain("Color(.systemGroupedBackground)");
    expect(launch).toContain("Color(.systemGroupedBackground)");
    expect(launch).not.toContain("BrandSplashScene(");
    expect(launch).not.toContain('Image("LaunchLockup")');
    expect(launch).toContain("struct BrandSplashScene");
    expect(launch).toContain('Image("Badgers")');
    expect(kioskBackground.colors[0]?.color.components).toMatchObject({
      red: "0.043",
      green: "0.043",
      blue: "0.051",
      alpha: "1.000",
    });
    expect(kioskDesign).toContain("static let base = Color(red: 11 / 255, green: 11 / 255, blue: 13 / 255)");
  });

  it("does not cover inactive snapshots with a splash or privacy lock", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const kiosk = source("ios/Wisconsin/Kiosk/KioskShellView.swift");

    expect(app).not.toContain("WindowLaunchStillHost");
    expect(app).not.toContain("WindowPrivacyShieldHost");
    expect(app).not.toContain('UIImage(named: "LaunchLockup")');
    expect(app).not.toContain('UIImage(systemName: "lock.shield.fill")');
    expect(kiosk).not.toContain('Image("LaunchLockup")');
    expect(kiosk).toContain("Resuming kiosk");
  });

  it("delays truthful progress copy and cancels cleanly on fast restores", () => {
    const launch = source("ios/Wisconsin/Views/LaunchView.swift");

    expect(launch).toContain('case .checking: "Checking your session"');
    expect(launch).toContain('case .stillChecking: "Still checking your session"');
    expect(launch).toContain("try await Task.sleep(for: .milliseconds(650))");
    expect(launch).toContain("try await Task.sleep(for: .seconds(3.35))");
    expect(launch.match(/catch \{\n\s+return\n\s+\}/g)).toHaveLength(2);
    expect(launch).toContain("if reduceMotion");
    expect(launch).toContain(".accessibilityElement(children: .ignore)");
    expect(launch).toContain(".accessibilityLabel(accessibilityStatus)");
  });

  it("reserves the crimson lockup for sign-in and does not delay optimistic sessions", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const session = source("ios/Wisconsin/Core/SessionStore.swift");
    const login = source("ios/Wisconsin/Views/LoginView.swift");
    const passwordSetup = source("ios/Wisconsin/Views/PasswordSetupView.swift");
    const launch = source("ios/Wisconsin/Views/LaunchView.swift");

    expect(app).toMatch(/if session\.isRestoring \{\s+LaunchView\(\)/);
    expect(session).toMatch(
      /if !AppRuntimeMode\.isPerformanceTesting,[\s\S]*?currentUser = snapshot\s+isRestoring = false/,
    );
    expect(login).toContain("BrandSplashScene()");
    expect(login).toContain('BrandSplashLockup(subtitle: "Sign in to your account")');
    expect(passwordSetup).toContain("BrandSplashScene()");
    expect(passwordSetup).toContain('BrandSplashLockup(subtitle: "Set your password")');
    expect(passwordSetup).not.toContain("LinearGradient(");
    expect(launch).toContain("struct BrandSplashLockup");
    expect(launchMinimumDurationTokens(app + session)).toEqual([]);
  });
});

function launchMinimumDurationTokens(sourceText: string) {
  return ["minimumSplashDuration", "minimumLaunchDuration", "holdLaunchScreen"].filter(
    (token) => sourceText.includes(token),
  );
}
