import { describe, expect, it } from "vitest";
import {
  ACCOUNTABILITY_JEERS,
  accountabilityLeaderboardFingerprint,
  selectAccountabilityJeers,
} from "@/lib/accountability-jeers";

const leaderboard = [
  {
    userId: "user-1",
    active: true,
    lateEventCount: 4,
    activeOverdueCount: 0,
    lastIncidentAt: "2026-08-20T12:00:00.000Z",
  },
  {
    userId: "user-2",
    active: true,
    lateEventCount: 3,
    activeOverdueCount: 1,
    lastIncidentAt: "2026-08-19T12:00:00.000Z",
  },
  {
    userId: "user-3",
    active: false,
    lateEventCount: 2,
    activeOverdueCount: 0,
    lastIncidentAt: "2026-08-18T12:00:00.000Z",
  },
];

describe("Accountability jeer rotation", () => {
  it("keeps an exact 50-line deck with no duplicate copy", () => {
    expect(ACCOUNTABILITY_JEERS).toHaveLength(50);
    expect(new Set(ACCOUNTABILITY_JEERS).size).toBe(50);
    expect(ACCOUNTABILITY_JEERS.every((line) => line.trim() === line && line.length > 0)).toBe(true);
  });

  it("deals three unique lines deterministically for the same shared leaderboard", () => {
    const first = selectAccountabilityJeers(leaderboard);
    const second = selectAccountabilityJeers(structuredClone(leaderboard));

    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    expect(second).toEqual(first);
  });

  it("changes the fingerprint and draw when meaningful leaderboard state changes", () => {
    const changed = structuredClone(leaderboard);
    changed[1]!.lateEventCount += 1;

    expect(accountabilityLeaderboardFingerprint(changed)).not.toBe(
      accountabilityLeaderboardFingerprint(leaderboard),
    );
    expect(selectAccountabilityJeers(changed)).not.toEqual(selectAccountabilityJeers(leaderboard));
  });

  it("changes the shared draw when the ranking order changes", () => {
    const reordered = [leaderboard[1]!, leaderboard[0]!, leaderboard[2]!];

    expect(selectAccountabilityJeers(reordered)).not.toEqual(selectAccountabilityJeers(leaderboard));
  });

  it("does not churn copy for clock-driven late-hour changes", () => {
    const first = leaderboard.map((person) => ({ ...person, totalLateHours: 10 }));
    const later = leaderboard.map((person) => ({ ...person, totalLateHours: 11 }));

    expect(selectAccountabilityJeers(first)).toEqual(selectAccountabilityJeers(later));
  });
});
