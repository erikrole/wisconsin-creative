import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

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
  it("keeps the system launch frame content-neutral before the app scene loads", () => {
    const project = source("ios/project.yml");
    const plist = source("ios/Wisconsin/Supporting/Info.plist");

    expect(project).toMatch(/UILaunchScreen:\n\s+UIColorName: LaunchBackground/);
    expect(project).not.toContain("UIImageName: LaunchLockup");
    expect(plist).toMatch(
      /<key>UILaunchScreen<\/key>[\s\S]*?<key>UIColorName<\/key>\s*<string>LaunchBackground<\/string>/,
    );
    expect(plist).not.toContain("<key>UIImageName</key>");
  });

  it("ships native-resolution Motion W and launch-lockup assets", () => {
    const mark = json<{ images: Array<{ filename?: string; scale: string }> }>(
      "ios/Wisconsin/Assets.xcassets/Badgers.imageset/Contents.json",
    );
    const lockup = json<{ images: Array<{ filename?: string; scale: string }> }>(
      "ios/Wisconsin/Assets.xcassets/LaunchLockup.imageset/Contents.json",
    );

    expect(mark.images.map(({ filename, scale }) => ({ filename, scale }))).toEqual([
      { filename: "Badgers.png", scale: "1x" },
      { filename: "Badgers@2x.png", scale: "2x" },
      { filename: "Badgers@3x.png", scale: "3x" },
    ]);
    expect(lockup.images.map(({ filename, scale }) => ({ filename, scale }))).toEqual([
      { filename: "LaunchLockup.png", scale: "1x" },
      { filename: "LaunchLockup@2x.png", scale: "2x" },
      { filename: "LaunchLockup@3x.png", scale: "3x" },
    ]);

    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/Badgers.imageset/Badgers.png")).toEqual({ width: 72, height: 72 });
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/Badgers.imageset/Badgers@2x.png")).toEqual({ width: 144, height: 144 });
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/Badgers.imageset/Badgers@3x.png")).toEqual({ width: 216, height: 216 });
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/LaunchLockup.imageset/LaunchLockup.png")).toEqual({ width: 270, height: 118 });
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/LaunchLockup.imageset/LaunchLockup@2x.png")).toEqual({ width: 540, height: 236 });
    expect(pngDimensions("ios/Wisconsin/Assets.xcassets/LaunchLockup.imageset/LaunchLockup@3x.png")).toEqual({ width: 810, height: 354 });
  });

  it("keeps the system frame and SwiftUI scene on one first-frame color", () => {
    const background = json<{
      colors: Array<{ color: { components: Record<string, string> } }>;
    }>("ios/Wisconsin/Assets.xcassets/LaunchBackground.colorset/Contents.json");
    const brand = source("ios/Wisconsin/Core/Brand.swift");
    const launch = source("ios/Wisconsin/Views/LaunchView.swift");

    expect(background.colors[0]?.color.components).toMatchObject({
      red: "0.078",
      green: "0.043",
      blue: "0.063",
      alpha: "1.000",
    });
    expect(brand).toContain(
      "static let brandSplashTop = Color(red: 0.078, green: 0.043, blue: 0.063)",
    );
    expect(launch).toContain("Color.brandSplashTop");
    expect(launch).toContain("BrandSplashScene(accentOpacity: accentsVisible ? 1 : 0)");
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

  it("shares one destination backdrop without delaying optimistic sessions", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const session = source("ios/Wisconsin/Core/SessionStore.swift");
    const login = source("ios/Wisconsin/Views/LoginView.swift");
    const passwordSetup = source("ios/Wisconsin/Views/PasswordSetupView.swift");

    expect(app).toMatch(/if session\.isRestoring \{\s+LaunchView\(\)/);
    expect(session).toMatch(
      /if !AppRuntimeMode\.isPerformanceTesting,[\s\S]*?currentUser = snapshot\s+isRestoring = false/,
    );
    expect(login).toContain("BrandSplashScene()");
    expect(passwordSetup).toContain("BrandSplashScene()");
    expect(passwordSetup).not.toContain("LinearGradient(");
    expect(launchMinimumDurationTokens(app + session)).toEqual([]);
  });
});

function launchMinimumDurationTokens(sourceText: string) {
  return ["minimumSplashDuration", "minimumLaunchDuration", "holdLaunchScreen"].filter(
    (token) => sourceText.includes(token),
  );
}
