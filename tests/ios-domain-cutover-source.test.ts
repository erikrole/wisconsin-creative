import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function swiftFiles(dir = path.join(process.cwd(), "ios/Wisconsin")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return swiftFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith(".swift")) return [fullPath];
    return [];
  });
}

function relative(file: string) {
  return path.relative(process.cwd(), file);
}

describe("iOS production domain cutover", () => {
  it("centralizes the public app host and documents the legacy host explicitly", () => {
    const environment = source("ios/Wisconsin/Shared/AppEnvironment.swift");

    expect(environment).toContain('static let canonicalHost = "wisconsincreative.com"');
    expect(environment).toContain('static let legacyHost = "gear.erikrole.com"');
    expect(environment).toContain('static let appReviewHost = "review.wisconsincreative.com"');
    expect(environment).toContain('static let appReviewEmail = "appreview@wisconsincreative.com"');
    expect(environment).toContain('"jordan.lee.demo@wisc.edu"');
    expect(environment).toContain('"alex.rivera.demo@wisc.edu"');
    expect(environment).toContain("appReviewTestEmails.contains(normalized)");
    expect(environment).toContain('static let baseURL = URL(string: "https://\\(canonicalHost)")!');
    expect(environment).toContain("static let origin = baseURL.absoluteString");
    expect(environment).toContain("static var activeAPIBaseURL: URL");
    expect(environment).toContain("static var activeAPIOrigin: String");
    expect(environment).toContain('return URL(string: "webcal://\\(canonicalHost)\\(normalizedPath)")');
  });

  it("routes only explicit review identities to the isolated review host", () => {
    const environment = source("ios/Wisconsin/Shared/AppEnvironment.swift");

    expect(environment).not.toContain("hasSuffix");
    expect(environment).not.toContain("@wisc.edu\") ? appReviewHost");
  });

  it("keeps app, kiosk, recovery, profile, licenses, and calendar URLs on the shared host config", () => {
    expect(source("ios/Wisconsin/Core/APIClient.swift")).toContain("private var baseURL: URL { AppEnvironment.activeAPIBaseURL }");
    expect(source("ios/Wisconsin/Core/APIClient.swift")).toContain(
      'req.setValue(AppEnvironment.activeAPIOrigin, forHTTPHeaderField: "Origin")',
    );
    expect(source("ios/Wisconsin/Core/APIClient.swift")).toContain(
      "let nextHost = AppEnvironment.apiHost(forLoginEmail: email)",
    );
    expect(source("ios/Wisconsin/Core/APIClient.swift")).toContain(
      "AppEnvironment.resetActiveAPIHost()",
    );

    expect(source("ios/Wisconsin/Kiosk/KioskAPIClient.swift")).toContain(
      "static let host = AppEnvironment.canonicalHost",
    );
    expect(source("ios/Wisconsin/Kiosk/KioskAPIClient.swift")).toContain(
      "private let baseURL = AppEnvironment.baseURL",
    );
    expect(source("ios/Wisconsin/Views/LoginView.swift")).toContain("NativeForgotPasswordView(initialEmail: email)");
    expect(source("ios/Wisconsin/Views/LoginView.swift")).not.toContain("forgotPasswordURL");
    expect(source("ios/Wisconsin/Views/LoginView.swift")).toContain("NativeRegistrationView(initialEmail: email)");
    expect(source("ios/Wisconsin/Views/LoginView.swift")).not.toContain("registerURL");
    expect(source("ios/Wisconsin/Views/ProfileView.swift")).toContain(
      "private static let manageAccountURL = AppEnvironment.baseURL",
    );
    expect(source("ios/Wisconsin/Views/LicensesView.swift")).toContain(
      'private static let webManagementURL = AppEnvironment.url(path: "/licenses")',
    );
    expect(source("ios/Wisconsin/Views/ScheduleView.swift")).toContain(
      'AppEnvironment.webcalURL(path: "/api/shifts/ics/\\(activeToken)")',
    );
  });

  it("includes the shared host config in the kiosk target", () => {
    const project = source("ios/project.yml");

    expect(project).toMatch(/WisconsinKiosk:[\s\S]*?- path: Wisconsin\/Shared/);
  });

  it("does not leave old production host literals scattered through Swift source", () => {
    const offenders = swiftFiles()
      .filter((file) => source(relative(file)).includes("gear.erikrole.com"))
      .map(relative);

    expect(offenders).toEqual(["ios/Wisconsin/Shared/AppEnvironment.swift"]);
  });
});
