import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS main app and kiosk target split", () => {
  it("keeps kiosk sources split while both apps use the iOS 26 baseline", () => {
    const project = source("ios/project.yml");
    const mainTarget = project.slice(
      project.indexOf("  Wisconsin:"),
      project.indexOf("  WisconsinKiosk:"),
    );
    const kioskTarget = project.slice(project.indexOf("  WisconsinKiosk:"));

    expect(mainTarget).toContain("- Kiosk/**");
    expect(mainTarget).toContain("- KioskOnly/**");
    expect(kioskTarget).toContain("- path: Wisconsin/KioskOnly");
    expect(kioskTarget).toContain("- path: Wisconsin/Kiosk");
    expect(mainTarget).toContain('deploymentTarget: "26.0"');
    expect(kioskTarget).toContain('deploymentTarget: "26.0"');
    expect(kioskTarget).not.toContain('deploymentTarget: "17.0"');
  });

  it("does not expose kiosk launch routes from the main app shell or Settings", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const delegate = source("ios/Wisconsin/App/AppDelegate.swift");
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");

    expect(app).not.toContain("KioskStore");
    expect(app).not.toContain("KioskShellView");
    // `onOpenURL` switches on `url.host`, so the kiosk exclusion has to match
    // the case form as well as the old equality form.
    expect(app).not.toContain('url.host == "kiosk"');
    expect(app).not.toContain('case "kiosk"');
    expect(app).toContain('case "booking":');

    expect(settings).not.toContain("KioskStore");
    expect(settings).not.toContain("Kiosk Mode");
    expect(settings).not.toContain("enterKiosk");
    expect(settings).not.toContain("Scanner Debugger");
    expect(settings).not.toContain("Link Sticker Codes");
    expect(settings).not.toContain("Staff Tools");

    expect(delegate).not.toContain("sharedKioskStore");
    expect(delegate).toContain("return .all");
  });
});
