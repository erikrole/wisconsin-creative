import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

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
    // Stale localStorage must not override a newer in-memory cursor, or a
    // dismissed popup can re-enter the queue on the next poll.
    expect(shell).toContain("storedTime > memoryTime");
    const foregroundRefresh = shell.slice(shell.indexOf("async function refreshBadgeRewards"));
    expect(foregroundRefresh.indexOf("await loadEarnedBadges()"))
      .toBeLessThan(foregroundRefresh.indexOf('/api/badges/events/app-open'));
  });

  it("claims celebrations server-side so kiosk, iOS, and web share one viewed state", () => {
    const queries = source("src/lib/badges/queries.ts");
    const migration = source("prisma/migrations/0163_badge_celebrated_at/migration.sql");
    expect(queries).toContain("celebratedAt: null");
    expect(queries).toContain("data: { celebratedAt: claimedAt }");
    expect(queries).toContain("withSerializationRetry");
    expect(migration).toContain('ADD COLUMN "celebrated_at"');
    expect(migration).toContain('SET "celebrated_at" = "awarded_at"');
  });

  it("renders a queued, reduced-motion-safe reward dialog", () => {
    const celebration = source("src/components/badges/BadgeEarnedCelebration.tsx");
    expect(celebration).toContain("Badge earned");
    expect(celebration).toContain("motion-reduce:animate-none");
    expect(celebration).toContain("motion-safe:animate-in");
    expect(celebration).toContain("Next badge");
    expect(celebration).toContain("See on shelf");
    expect(celebration).toContain('role="status"');
    expect(celebration).toContain('aria-live="polite"');
  });
});
