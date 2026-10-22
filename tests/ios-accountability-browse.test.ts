import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");
const list = () => source("ios/Wisconsin/Views/AccountabilityView.swift");
const person = () => source("ios/Wisconsin/Views/AccountabilityPersonView.swift");
const models = () => source("ios/Wisconsin/Models/AccountabilityModels.swift");
const client = () => source("ios/Wisconsin/Core/APIClient.swift");

describe("iOS Accountability browse", () => {
  it("adds a read-only row for internal roles and keeps collaborators off it", () => {
    const menu = browse();
    const internalRows = menu.slice(
      menu.indexOf('guard session.currentUser?.role == "COLLABORATOR" else {'),
      menu.indexOf("let capabilities"),
    );

    expect(internalRows).toContain("[.scoreboard, .accountability, .items, .kits, .guides, .brandAssets, .blasts, .whatsNew, .licenses, .sharedLogins, .users, .gearPicks]");
    expect(menu).toContain('case .accountability: "Accountability"');
    expect(menu).toContain("Late returns and overdue gear");
    expect(menu).toContain("AccountabilityView(wrapsInNavigationStack: false)");
    expect(menu).toContain('case .users: "Staff"');

    const collaboratorRows = menu.slice(
      menu.indexOf("let capabilities"),
      menu.indexOf("var body: some View"),
    );
    expect(collaboratorRows).not.toContain(".accountability");
    expect(collaboratorRows).toContain(".scoreboard");
  });

  it("reads the shared accountability route and does not export or exclude", () => {
    const screen = list();
    const api = client();
    const catalog = models();

    expect(screen).toContain("var wrapsInNavigationStack = true");
    expect(screen).toContain("accountabilityReport(");
    expect(screen).toContain("AccountabilityPersonView(userId: route.userId, model: model)");
    expect(screen).toContain(".navigationDestination(for: BookingRouteId.self)");
    expect(screen).toContain("guard appState.resetTab == 2 else { return }");
    expect(screen).toContain("The list is unchanged.");
    expect(screen).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(screen).not.toMatch(/format=csv|manage_exclusions|excludeBooking/);
    expect(screen).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);

    expect(api).toContain('path: "/api/accountability"');
    expect(api).toContain("AccountabilityQuery.items(scope: scope, sort: sort)");
    expect(catalog).toContain('URLQueryItem(name: "sort", value: sort.rawValue)');
    expect(catalog).toContain('self == .allTime ? "all" : nil');
    expect(catalog).not.toContain('name: "format"');
    expect(catalog).not.toContain('name: "locationId"');
    expect(catalog).not.toContain('name: "state"');
    expect(catalog).not.toContain('name: "users"');
  });

  it("reads as a plain record, not a ranking", () => {
    const screen = list();
    const catalog = models();

    expect(screen).toContain('Section("Your record")');
    expect(screen).toContain('Section("Overdue now")');
    expect(screen).toContain("NavigationLink(value: BookingRouteId(id: entry.incident.bookingId))");
    expect(screen).toContain('"Repeat late returns"');
    expect(screen).toContain(") late once");
    expect(screen).toContain("Show only repeat late returns");
    expect(screen).toContain("report.overdueNow()");
    expect(screen).not.toMatch(/You are /);
    expect(screen).not.toMatch(/rank|Rank|ordinal|Ordinal|"#\\\(/);
    expect(catalog).not.toMatch(/accountabilityOrdinal|func rank\(/);
    expect(catalog).toContain("limit: Int = 5");
    expect(catalog).toContain("lateEventCount >= 2");
    expect(catalog).toContain('case .events: "Times late"');
  });

  it("opens a checkout from a person's late returns", () => {
    const screen = person();

    expect(screen).toContain("NavigationLink(value: BookingRouteId(id: incident.bookingId))");
    expect(screen).toContain("StatusPill(label: incident.style.label, tone: incident.style.tone)");
    expect(screen).toContain('Text("Checkouts")');
    expect(screen).toContain("Changing it stays on the checkout screen.");
    expect(screen).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(screen).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);
  });
});
