import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("earned badge celebration", () => {
  it("polls from a per-user cursor without replaying badge history", () => {
    const shell = source("src/components/AppShell.tsx");
    // Namespaced per signed-in user so one person's cursor cannot suppress
    // another's celebration on a shared machine.
    expect(shell).toContain("gear-tracker:badge-reward-cursor:${rewardUserId}");
    expect(shell).toContain("/api/badges/recent");
    expect(shell).toContain("setEarnedBadgeQueue");
    expect(shell).toContain("current.slice(1)");
    expect(shell).toContain("response.status === 400 && after");
    expect(shell).toContain("memoryCursor = null");
    expect(shell).toContain("if (!hasRewardCursor())");
    const foregroundRefresh = shell.slice(shell.indexOf("async function refreshBadgeRewards"));
    expect(foregroundRefresh.indexOf("await loadEarnedBadges()"))
      .toBeLessThan(foregroundRefresh.indexOf('/api/badges/events/app-open'));
  });

  it("renders a queued, reduced-motion-safe reward dialog", () => {
    const celebration = source("src/components/badges/BadgeEarnedCelebration.tsx");
    expect(celebration).toContain("Badge earned");
    expect(celebration).toContain("motion-reduce:animate-none");
    expect(celebration).toContain("motion-safe:animate-in");
    expect(celebration).toContain("Next badge");
  });
});
