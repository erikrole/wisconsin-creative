import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(file, "utf8");
}

describe("team Scoreboard page source contract", () => {
  it("renders a first-class aggregate page with recoverable states and team semantics", () => {
    const page = source("src/app/(app)/scoreboard/page.tsx");
    const client = source("src/app/(app)/scoreboard/TeamScoreboardClient.tsx");

    expect(page).toContain('title="Scoreboard"');
    expect(page).toContain("Stack sport, venue, opponent, and site filters");
    expect(page).not.toContain("2026-27 stats");
    expect(client).toContain("function scoreboardUrl");
    expect(client).toContain("url: apiUrl");
    expect(client).toContain("ReportLoadingState");
    expect(client).toContain("ReportErrorState");
    expect(client).toContain("No Scoreboard credits yet");
    expect(client).toContain("No matching Scoreboard results");
    expect(client).toContain("Events covered");
    expect(client).toContain("Work credits");
    expect(client).toContain("Team record");
    expect(client).toContain("Contributors");
    expect(client).toContain('type SortKey = "events" | "wins" | "rate"');
    expect(client).toContain('type FilterKey = "sportCode" | "venue" | "opponent" | "site"');
    expect(client).toContain("OperationalActiveFilterChips");
    expect(client).toContain("Sport, venue, opponent, and site combine");
    expect(client).toContain("Snapshot");
    expect(client).toContain("All events, one shared Scoreboard");
    expect(client).toContain("Most events");
    expect(client).toContain('title="At venues"');
    expect(client).toContain('title="Against teams"');
    expect(client).toContain('title="By site"');
    expect(client).toContain("Filter Scoreboard by ${label.toLowerCase()}");
    expect(client).toContain('allLabel: "All sports"');
    expect(client).toContain('allLabel: "All venues"');
    expect(client).toContain('allLabel: "All opponents"');
    expect(client).toContain('allLabel: "All sites"');
    expect(client).toContain('aria-label="Rank leaderboard"');
    expect(client).toContain('className="h-10');
  });

  it("links leaderboard identity only to the dedicated shared Scoreboard detail", () => {
    const client = source("src/app/(app)/scoreboard/TeamScoreboardClient.tsx");

    expect(client).toContain('href={`/scoreboard/${person.userId}`}');
    expect(client).not.toContain('href={`/users/${person.userId}');
    expect(client).not.toContain("email");
    expect(client).not.toContain("primaryArea");
  });

  it("loads only minimal identity for cross-user detail and suppresses protected event links", () => {
    const detail = source("src/app/(app)/scoreboard/[id]/page.tsx");
    const tab = source("src/app/(app)/users/[id]/UserScoreboardTab.tsx");

    expect(detail).toContain("canReadSharedScoreboard");
    expect(detail).toContain("id: true");
    expect(detail).toContain("name: true");
    expect(detail).toContain("avatarUrl: true");
    expect(detail).toContain("active: true");
    expect(detail).toContain("hiddenFromRoster: true");
    expect(detail).not.toContain("email: true");
    expect(detail).toContain("linkEvents={false}");
    expect(tab).toContain("linkEvents?: boolean");
    expect(tab).toContain("returnTo?: string");
  });
});
