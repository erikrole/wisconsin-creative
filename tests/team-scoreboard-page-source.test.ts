import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("team Scoreboard page source contract", () => {
  it("renders a playful, explorable aggregate page with recoverable states and team semantics", () => {
    const page = source("src/app/(app)/scoreboard/page.tsx");
    const layout = source("src/app/(app)/scoreboard/layout.tsx");
    const client = source("src/app/(app)/scoreboard/TeamScoreboardClient.tsx");
    const leaderboard = source("src/app/(app)/scoreboard/ScoreboardLeaderboard.tsx");
    const explore = source("src/app/(app)/scoreboard/ScoreboardExplore.tsx");
    const compare = source("src/app/(app)/scoreboard/ScoreboardCompare.tsx");
    const facts = source("src/app/(app)/scoreboard/ScoreboardFunFacts.tsx");

    expect(page).toContain('title="Scoreboard"');
    expect(page).not.toContain("2026-27 stats");
    expect(layout).toContain("wc-fresh");
    expect(layout).toContain("--font-lato");
    expect(client).toContain("function scoreboardUrl");
    expect(client).toContain("url: apiUrl");
    expect(client).toContain("ScoreboardLoadingState");
    expect(client).toContain("ScoreboardErrorState");
    expect(client).toContain("The shared Scoreboard could not be loaded.");
    expect(client).not.toContain("Unable to load this report");
    expect(client).toContain("No Scoreboard credits yet");
    expect(client).toContain("No matching Scoreboard results");
    expect(client).toContain("No matching people");
    expect(client).toContain("Events covered");
    expect(client).toContain("Work credits");
    expect(client).toContain("Team record");
    expect(client).toContain("Contributors");
    expect(client).toContain("Find a person on the Scoreboard");
    expect(client).toContain("writeTeamScoreboardSearchParams");
    expect(client).toContain("OperationalActiveFilterChips");
    expect(client).toContain("Sport, venue, opponent, and site combine");
    expect(client).toContain("All events, one shared Scoreboard");
    expect(client).toContain("Filter Scoreboard by ${label.toLowerCase()}");
    expect(client).toContain('aria-label="Filter Scoreboard by sport"');
    expect(client).toContain('allLabel: "All venues"');
    expect(client).toContain('allLabel: "All opponents"');
    expect(client).toContain('allLabel: "All sites"');
    expect(client).toContain('aria-label="Rank leaderboard"');
    expect(client).toContain("How these numbers count");
    expect(client).toContain("scoreboardFunFacts(data, currentUserId)");
    expect(client).toContain("<ScoreboardCompare");
    expect(client).toContain("<ScoreboardExplore");
    expect(client).not.toContain("bg-[var(--orange-bg)]");
    expect(client).not.toContain("bg-[var(--red-bg)]");
    expect(client).not.toContain("text-[var(--red-text)]");

    // Interaction: live re-ranking, rows that open in place, head-to-head, and
    // an explorer whose rows filter the whole page. Motion respects reduced motion.
    expect(leaderboard).toContain('layout={reduced ? false : "position"}');
    expect(leaderboard).toContain("aria-expanded={expanded}");
    expect(leaderboard).toContain("Not ranked yet");
    expect(explore).toContain('aria-label="Explore by"');
    expect(explore).toContain("onSelect(dimension, selected ? SCOREBOARD_ALL_FILTER : value)");
    expect(compare).toContain("Head to head");
    expect(compare).toContain('aria-label="Swap sides"');
    expect(facts).toContain("Did you know");
    for (const file of [leaderboard, compare, facts]) expect(file).toContain("useReducedMotion");
  });

  it("links leaderboard identity only to the dedicated shared Scoreboard detail", () => {
    const client = source("src/app/(app)/scoreboard/TeamScoreboardClient.tsx");
    const leaderboard = source("src/app/(app)/scoreboard/ScoreboardLeaderboard.tsx");

    expect(client).toContain("personScoreboardPath(userId, filters, sort)");
    expect(leaderboard).toContain("href={hrefForPerson(person.userId)}");
    for (const file of [client, leaderboard]) {
      expect(file).not.toContain('href={`/staff/${person.userId}');
      expect(file).not.toContain("email");
      expect(file).not.toContain("primaryArea");
    }
  });

  it("loads only minimal identity for cross-user detail and suppresses protected event links", () => {
    const detail = source("src/app/(app)/scoreboard/[id]/page.tsx");
    const tab = source("src/app/(app)/staff/[id]/UserScoreboardTab.tsx");

    expect(detail).toContain("canReadSharedScoreboard");
    expect(detail).toContain("id: true");
    expect(detail).toContain("name: true");
    expect(detail).toContain("avatarUrl: true");
    expect(detail).toContain("active: true");
    expect(detail).toContain("hiddenFromRoster: true");
    expect(detail).not.toContain("email: true");
    expect(detail).toContain("linkEvents={false}");
    expect(detail).toContain("teamScoreboardPath");
    expect(detail).toContain("DetailPageHeader");
    expect(tab).toContain("linkEvents?: boolean");
    expect(tab).toContain("returnTo?: string");
    expect(tab).toContain("writePersonScoreboardSearchParams");
  });
});
