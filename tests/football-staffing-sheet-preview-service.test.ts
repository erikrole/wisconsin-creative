import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOOTBALL_STAFFING_SHEET_SOURCE } from "@/lib/football-staffing-sheet";

const mocks = vi.hoisted(() => ({
  findUsers: vi.fn(),
  findEvents: vi.fn(),
  findGroups: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: mocks.findUsers },
    calendarEvent: { findMany: mocks.findEvents },
    shiftGroup: { findMany: mocks.findGroups },
  },
}));

import { previewFootballStaffingSheet } from "@/lib/services/football-staffing-sheet-preview";

const roleRows = [
  "Role", "SLOW1", "SLOW2", "BENCH", "ROAM1 (Action)", "ROAM2 (Color)",
  "ROAM3", "ROAM4", "PHOTO1", "PHOTO2", "PHOTO3", "PHOTO4", "SOCIAL",
];

function snapshot() {
  const headers = ["8/30 Miami", ...Array.from({ length: 11 }, (_, index) => `9/${index + 1} Opponent ${index + 1}`)];
  return [
    ["", ...headers],
    ...roleRows.map((role, rowIndex) => [role, ...headers.map((_, columnIndex) =>
      rowIndex === 1 && columnIndex === 0 ? "Alice Example" : "-",
    )]),
  ].map((row) => row.join("\t")).join("\n");
}

describe("Football staffing-sheet preview service", () => {
  beforeEach(() => {
    mocks.findUsers.mockReset();
    mocks.findEvents.mockReset();
    mocks.findGroups.mockReset();
    mocks.findUsers.mockResolvedValue([{
      id: "alice",
      name: "Alice Example",
      email: "alice@example.com",
      role: "STAFF",
      staffingType: "FT",
    }]);
    mocks.findEvents.mockResolvedValue([{
      id: "event-1",
      summary: "FB vs Miami",
      startsAt: new Date("2026-08-30T17:00:00.000Z"),
      sportCode: "FB",
      opponent: "Miami",
      isHome: true,
    }]);
    mocks.findGroups.mockResolvedValue([]);
  });

  it("uses only bounded visible-user and Football-event reads", async () => {
    const result = await previewFootballStaffingSheet({
      sportCode: "FB",
      source: {
        sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
        tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
        range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
      },
      tsv: snapshot(),
    });

    expect(mocks.findUsers).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, hiddenFromRoster: false },
      select: expect.objectContaining({ id: true, name: true, email: true, role: true, staffingType: true }),
    }));
    expect(mocks.findEvents).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sportCode: "FB", archivedAt: null, isHidden: false }),
      take: 500,
    }));
    expect(result.previewOnly).toBe(true);
    expect(result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.reviewFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary.resolvedDirectAssignments).toBe(1);
    expect(result.rowIssues).toEqual([expect.objectContaining({ kind: "UNRESOLVED_ROLE_ROW" })]);
  });

  it("returns only exact reviewed working-slot options in the fingerprinted preview", async () => {
    mocks.findEvents.mockResolvedValue([{
      id: "event-1",
      summary: "FB vs Miami",
      startsAt: new Date("2026-08-30T17:00:00.000Z"),
      sportCode: "FB",
      opponent: "Miami",
      isHome: true,
      shiftGroup: { id: "group-1" },
    }]);
    mocks.findGroups.mockResolvedValue([{
      id: "group-1",
      publishedAt: null,
      publishedVersion: 2,
      event: {
        id: "event-1",
        startsAt: new Date("2026-08-30T17:00:00.000Z"),
        endsAt: new Date("2026-08-30T21:00:00.000Z"),
        allDay: false,
        sportCode: "FB",
        opponent: "Miami",
        isHome: true,
      },
      shifts: [{
        id: "shift-1",
        createdAt: new Date("2026-08-01T12:00:00.000Z"),
        area: "VIDEO",
        workerType: "FT",
        startsAt: new Date("2026-08-30T17:00:00.000Z"),
        endsAt: new Date("2026-08-30T21:00:00.000Z"),
        callStartsAt: null,
        callEndsAt: null,
        notes: null,
        _count: { assignments: 0 },
        assignments: [],
      }],
      workingCopy: null,
    }]);

    const result = await previewFootballStaffingSheet({
      sportCode: "FB",
      source: {
        sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
        tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
        range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
      },
      tsv: snapshot(),
    });

    expect(mocks.findGroups).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["group-1"] } },
    }));
    expect(result.applyRows).toContainEqual(expect.objectContaining({
      kind: "DIRECT_ASSIGNMENT",
      sourceA1: "B3",
      eventId: "event-1",
      userId: "alice",
      workingVersion: 0,
      canApply: true,
      openSlots: [{ key: "shift-1", area: "VIDEO", workerType: "FT" }],
    }));
    expect(result.summary.applicableChanges).toBe(1);
  });

  it("changes the source and review fingerprints when the pasted snapshot changes", async () => {
    const first = await previewFootballStaffingSheet({
      sportCode: "FB",
      source: {
        sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
        tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
        range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
      },
      tsv: snapshot(),
    });
    const second = await previewFootballStaffingSheet({
      sportCode: "FB",
      source: {
        sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
        tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
        range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
      },
      tsv: snapshot().replace("Alice Example", "Bob Example"),
    });

    expect(second.sourceFingerprint).not.toBe(first.sourceFingerprint);
    expect(second.reviewFingerprint).not.toBe(first.reviewFingerprint);
  });
});
