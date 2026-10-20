import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

/**
 * Browse > What's new lists every announcement a person could have been
 * shown, so an announcement stays reachable after the splash is dismissed.
 */
describe("iOS What's new (announcement history)", () => {
  const route = source("src/app/api/announcements/history/route.ts");
  const client = source("ios/Wisconsin/Core/APIClient.swift");
  const models = source("ios/Wisconsin/Models/AnnouncementModels.swift");
  const view = source("ios/Wisconsin/Views/Announcements/WhatsNewView.swift");
  const browse = source("ios/Wisconsin/Views/BrowseView.swift");
  const splash = source("ios/Wisconsin/Views/Announcements/AnnouncementSplashSheet.swift");

  it("reads a view-permission history route scoped to this role and platform", () => {
    expect(route).toContain('requirePermission(user.role, "announcement", "view")');
    expect(route).toContain("publishedAt: { lte: now }");
    expect(route).toContain("{ roles: { has: user.role } }");
    expect(route).toContain("dismissals: { where: { userId: user.id }");
    expect(client).toContain('path: "/api/announcements/history"');
    expect(client).toContain("func announcementHistory() async throws -> [AnnouncementHistoryEntry]");
  });

  it("decodes history rows through the splash decoder so blocks stay in sync", () => {
    expect(models).toContain("struct AnnouncementHistoryEntry");
    expect(models).toContain("announcement = try ActiveAnnouncement(from: decoder)");
    expect(models).toContain("var isUnseen: Bool { seenAt == nil }");
  });

  it("lives under Browse > Work for staff and students, not collaborators", () => {
    const staffRows = browse.slice(browse.indexOf("var rows: [BrowseDestination]"), browse.indexOf("if isStaffOrAdmin"));
    expect(staffRows).toContain(".whatsNew");
    const collaboratorRows = browse.slice(browse.indexOf("let capabilities = Set("), browse.indexOf("var body: some View"));
    expect(collaboratorRows).not.toContain(".whatsNew");
    expect(browse).toContain("case .blasts, .whatsNew: .work");
    expect(browse).toContain("WhatsNewView(wrapsInNavigationStack: false)");
  });

  it("reopens the same sheet the splash used and routes its button the same way", () => {
    expect(view).toContain("AnnouncementSplashSheet(");
    expect(view).toContain("openAnnouncementTarget(of: entry.announcement, appState: appState, openURL: openURL)");
    expect(splash).toContain("func openAnnouncementTarget(of announcement: ActiveAnnouncement");
    expect(view).toContain(".refreshable { await vm.load(forceRefresh: true) }");
    expect(view).not.toContain("Timer");
    // A server without the route yet reads as "nothing yet", not an error.
    expect(view).toContain("catch APIError.notFound");
    expect(view).toContain("catch APIError.httpError(statusCode: 405, _)");
  });
});
