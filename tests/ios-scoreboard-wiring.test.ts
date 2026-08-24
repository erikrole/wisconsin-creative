import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("native Scoreboard wiring", () => {
  it("loads the universal aggregate route without a People capability gate", () => {
    const client = source("ios/Wisconsin/Core/APIClient.swift");
    const appTabs = source("ios/Wisconsin/Views/AppTabView.swift");
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");
    const teamView = source("ios/Wisconsin/Views/TeamScoreboardView.swift");

    expect(client).toContain('request(path: "/api/scoreboard", queryItems: items)');
    expect(client).toContain('.init(name: "sportCode", value: sportCode)');
    expect(client).toContain('.init(name: "venue", value: venue)');
    expect(client).toContain('.init(name: "opponent", value: opponent)');
    expect(client).toContain('.init(name: "site", value: site)');
    expect(appTabs).toContain('TabSection("Team")');
    expect(appTabs).toContain('Tab("Scoreboard", systemImage: "trophy", value: 8)');
    expect(appTabs).toContain("TeamScoreboardView()");
    expect(appTabs).toContain("horizontalSizeClass == .regular");
    expect(appTabs).toContain("if !isCollaborator {");
    expect(browse).toContain("return [.scoreboard]");
    expect(browse).toContain("TeamScoreboardView(wrapsInNavigationStack: false)");
    expect(teamView).toContain("ScoreboardView(userId: row.person.userId)");
    expect(teamView).toContain("Picker(\"Venue\", selection: $filters.venue)");
    expect(teamView).toContain("Picker(\"Opponent\", selection: $filters.opponent)");
    expect(teamView).toContain("Picker(\"Site\", selection: $filters.site)");
    expect(teamView).toContain("Selections stack. Every total, breakdown, and leaderboard row uses the same combination.");
    expect(teamView).toContain('Text("Snapshot")');
    expect(teamView).toContain("All events, one shared Scoreboard");
    expect(teamView).toContain('LabeledContent("Most events")');
    expect(teamView).toContain("breakdownSection(\"At venues\"");
    expect(teamView).toContain("breakdownSection(\"Against teams\"");
    expect(teamView).toContain(".task(id: filters)");
    expect(teamView).not.toMatch(/UserDetailView\(/);
    expect(teamView).not.toContain("AppUser");
  });

  it("uses the authenticated profile Scoreboard route with server-owned filters", () => {
    const client = source("ios/Wisconsin/Core/APIClient.swift");

    expect(client).toContain('path: "/api/users/\\(userId)/scoreboard"');
    expect(client).toContain("season: String? = nil");
    expect(client).toContain("if let season, !season.isEmpty");
    expect(client).not.toContain('season: String = "2026-27"');
    expect(client).toContain('.init(name: "sportCode", value: sportCode)');
    expect(client).toContain('.init(name: "result", value: result)');
    expect(client).toContain('.init(name: "offset", value: "\\(offset)")');
  });

  it("exposes the same read-only screen from both native profile surfaces", () => {
    expect(source("ios/Wisconsin/Views/ProfileView.swift")).toContain("ScoreboardView(userId: userId)");
    expect(source("ios/Wisconsin/Views/UserDetailView.swift")).toContain("ScoreboardLinkCard(userId: detail.id)");
    expect(source("ios/Wisconsin/Views/ScoreboardView.swift")).toContain("struct ScoreboardView: View");
  });

  it("keeps the sport filter switchable after a sport is chosen", () => {
    const view = source("ios/Wisconsin/Views/ScoreboardView.swift");

    // The route filters its own breakdowns, so the menu has to remember the
    // unfiltered sport list instead of reading it back out of a filtered read.
    expect(view).toContain("@State private var sportMenuOptions: [ScoreboardBucket] = []");
    expect(view).toContain("sportOptions: sportMenuOptions");
    expect(view).toContain("if wasUnfiltered {");
  });

  it("drops a page that a filter change has already outrun", () => {
    const view = source("ios/Wisconsin/Views/ScoreboardView.swift");

    expect(view).toContain("guard !Task.isCancelled, requestKey == queryKey else { return }");
    // The cursor is an offset; anything else has to end the list.
    expect(source("ios/Wisconsin/Models/ScoreboardModels.swift")).toContain(
      "var nextOffset: Int? { nextCursor.flatMap(Int.init) }",
    );
  });

  it("names the Scoreboard entry the same way on both profile surfaces", () => {
    const view = source("ios/Wisconsin/Views/ScoreboardView.swift");

    expect(view).toContain("enum ScoreboardLink {");
    expect(source("ios/Wisconsin/Views/ProfileView.swift")).toContain("subtitle: ScoreboardLink.subtitle");
    expect(view).toContain("Text(ScoreboardLink.subtitle)");
    // The season is server-owned, so neither entry hard-codes a year.
    expect(view).not.toContain("2026–27 record");
  });

  it("keeps the season's shape client-side rather than inventing server fields", () => {
    const models = source("ios/Wisconsin/Models/ScoreboardModels.swift");

    // Recency, streaks, and month grouping are all derived from the game list
    // the route already returns -- no new API surface.
    expect(models).toContain("enum ScoreboardDigest {");
    expect(models).toContain("static func months(");
    expect(models).toContain("static func streak(");
    expect(models).toContain("var highlights: [ScoreboardHighlight]");
    // A run of one is not a streak.
    expect(models).toContain("return run >= 2 ?");
  });

  it("says what a filtered view covers next to the numbers it qualifies", () => {
    const view = source("ios/Wisconsin/Views/ScoreboardView.swift");

    // The season total comes from an unfiltered read; a filtered response only
    // knows its own subtotal.
    expect(view).toContain("@State private var seasonResolvedGames: Int?");
    expect(view).toContain("seasonResolvedGames = fetched.summary.games");
    expect(view).toContain("Filtered to \\(shown) of the season's \\(seasonResolvedGames) resolved. ");
    expect(view).toContain("Events worked counts all \\(worked).");
  });

  it("paints the record with chart fills, not status text colours", () => {
    const view = source("ios/Wisconsin/Views/ScoreboardView.swift");

    // docs/COLOR_SYSTEM.md: filled marks use chartFill; statusText is for the
    // numbers beside them.
    expect(view).toContain("Color.chartFill(.available)");
    expect(view).toContain("Color.chartFill(.problem)");
    expect(view).not.toContain("Rectangle().fill(Color.statusText");
  });

  it("does not add custody actions to the Scoreboard screen", () => {
    const view = source("ios/Wisconsin/Views/ScoreboardView.swift")
      + source("ios/Wisconsin/Views/TeamScoreboardView.swift");

    expect(view).not.toContain("createReservation");
    expect(view).not.toContain("checkout");
    expect(view).not.toContain("checkin");
  });
});
