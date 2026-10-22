import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isOfficialGame, mergeSnapshotCrew, nextResultHistory } from "@/lib/services/game-snapshots";

const now = new Date("2026-11-02T08:00:00.000Z");
const earlier = new Date("2026-10-30T08:00:00.000Z");

describe("mergeSnapshotCrew", () => {
  const live = { name: "Ava", source: "assignment" as const, area: null, crewLabel: null, attended: null };

  it("keeps people who left the live crew instead of erasing them", () => {
    const stored = [
      { ...live, userId: "a", leftAt: null },
      { ...live, userId: "b", name: "Ben", leftAt: null },
    ];
    const merged = mergeSnapshotCrew(stored, [{ ...live, userId: "a" }], now);
    expect(merged).toEqual([
      { ...live, userId: "a", leftAt: null },
      { ...live, userId: "b", name: "Ben", leftAt: now.toISOString() },
    ]);
  });

  it("keeps the first leftAt and clears it when someone comes back", () => {
    const gone = [{ ...live, userId: "b", name: "Ben", leftAt: earlier.toISOString() }];
    expect(mergeSnapshotCrew(gone, [], now)[0]?.leftAt).toBe(earlier.toISOString());
    expect(mergeSnapshotCrew(gone, [{ ...live, userId: "b", name: "Ben" }], now)[0]?.leftAt).toBeNull();
  });
});

describe("nextResultHistory", () => {
  it("records a result once and logs corrections", () => {
    const first = nextResultHistory([], "WIN", earlier);
    expect(first).toEqual({ history: [{ result: "WIN", at: earlier.toISOString() }], changed: true });
    expect(nextResultHistory(first.history, "WIN", now).changed).toBe(false);
    const corrected = nextResultHistory(first.history, "LOSS", now);
    expect(corrected.history).toHaveLength(2);
    expect(corrected.history[1]).toEqual({ result: "LOSS", at: now.toISOString() });
  });

  it("does not log an unknown result for a game that never had one", () => {
    expect(nextResultHistory([], null, now)).toEqual({ history: [], changed: false });
  });
});

describe("game snapshot capture contract", () => {
  it("matches the official-record exclusions", () => {
    expect(isOfficialGame("[W] FB vs Iowa")).toBe(true);
    expect(isOfficialGame("MHKY Exhibition vs Calgary")).toBe(false);
    expect(isOfficialGame("Spring Scrimmage")).toBe(false);
    expect(isOfficialGame("Alumni Match")).toBe(false);
  });

  it("runs nightly, reads every person regardless of visibility, and never deletes", () => {
    const service = readFileSync("src/lib/services/game-snapshots.ts", "utf8");
    const cron = readFileSync("src/app/api/cron/morning-refresh/route.ts", "utf8");
    expect(cron).toContain("captureGameSnapshots(now");
    expect(service).not.toContain("hiddenFromRoster");
    expect(service).not.toContain("active: true");
    expect(service).not.toContain("archivedAt");
    expect(service).not.toMatch(/gameSnapshot\.delete/);
  });
});
