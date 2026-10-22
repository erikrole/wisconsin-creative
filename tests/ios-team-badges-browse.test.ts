import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");
const view = () => source("ios/Wisconsin/Views/TeamBadgesView.swift");
const models = () => source("ios/Wisconsin/Models/TeamBadgeModels.swift");
const client = () => apiClientSource();

describe("iOS team badge shelf", () => {
  it("adds a staff-only Badges row and leaves collaborators off it", () => {
    const menu = browse();
    const internalRows = menu.slice(
      menu.indexOf('guard session.currentUser?.role == "COLLABORATOR" else {'),
      menu.indexOf("let capabilities"),
    );

    expect(internalRows).toContain("[.scoreboard, .accountability, .items, .kits, .guides, .brandAssets, .blasts, .whatsNew, .licenses, .sharedLogins, .users, .gearPicks]");
    expect(internalRows).toContain("rows.insert(.batteries, at: 5)");
    expect(internalRows).toContain("rows.append(.badges)");
    expect(internalRows).toContain("rows.append(.reports)");
    expect(internalRows.indexOf("rows.append(.badges)")).toBeLessThan(internalRows.indexOf("rows.append(.reports)"));
    expect(internalRows).toContain("if isStaffOrAdmin {");
    expect(menu).toContain('case .badges: "Badges"');
    expect(menu).toContain("Recognition and staff awards");
    expect(menu).toContain("TeamBadgesView(wrapsInNavigationStack: false)");
    expect(menu).toContain('case .badges: "medal"');
    expect(menu).toContain("case .badges: Color.statusText(.purple)");

    const collaboratorRows = menu.slice(
      menu.indexOf("let capabilities"),
      menu.indexOf("var body: some View"),
    );
    expect(collaboratorRows).not.toContain(".badges");
  });

  it("reads the manual catalog and does not award", () => {
    const api = client();
    const screen = view();

    expect(api).toContain("func teamBadgeCatalog()");
    expect(api).toContain('path: "/api/badges"');
    expect(api).toContain('URLQueryItem(name: "manualOnly", value: "true")');
    expect(screen).toContain("teamBadgeCatalog()");
    expect(screen).toContain("BadgeArtwork.symbolName(for: badge.icon)");
    expect(screen).toContain("BadgeReportView()");
    expect(screen).toContain('Label("View report"');
    expect(screen).toContain("Awarding a group stays on the web.");
    expect(screen).toContain('Text("Manual badges")');
    expect(screen).toContain("var wrapsInNavigationStack = true");
    expect(screen).toContain("@ViewBuilder");
    expect(screen).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(screen).not.toContain("/api/badges/award");
    expect(screen).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);
  });

  it("keeps the catalog fields the website serves", () => {
    const catalog = models();

    expect(catalog).toContain("struct TeamBadgeDefinition");
    expect(catalog).toContain("struct TeamBadgeCatalog");
    expect(catalog).toContain("let disabled: Bool?");
    expect(catalog).toContain("let threshold: Int?");
    expect(catalog).toContain("let ruleKey: String?");
    expect(catalog).toContain("var categoryLabel: String");
    expect(catalog).toContain('split(separator: "_")');
  });
});
