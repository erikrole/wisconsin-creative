import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOOTBALL_STAFFING_SHEET_SOURCE } from "@/lib/football-staffing-sheet";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  mutate: vi.fn(),
  eventEndsAt: vi.fn(),
  editor: vi.fn(),
  enqueue: vi.fn(),
  publish: vi.fn(),
  badge: vi.fn(),
}));

vi.mock("@/lib/services/football-staffing-sheet-preview", () => ({
  previewFootballStaffingSheet: mocks.preview,
}));
vi.mock("@/lib/services/schedule-working-copy", () => ({
  mutateWorkingSchedule: mocks.mutate,
  getWorkingScheduleEventEndsAt: mocks.eventEndsAt,
  getWorkingScheduleEditor: mocks.editor,
}));
vi.mock("@/lib/schedule-auto-release", () => ({ enqueuePendingScheduleRelease: mocks.enqueue }));
vi.mock("@/lib/services/schedule-publication", () => ({ publishShiftGroup: mocks.publish }));
vi.mock("@/lib/badges", () => ({ badges: { onShiftsWorked: mocks.badge } }));

import { applyReviewedFootballStaffingSheet } from "@/lib/services/football-staffing-sheet-apply";

const sourceFingerprint = "a".repeat(64);
const reviewFingerprint = "b".repeat(64);
const requestBase = {
  sportCode: "FB" as const,
  source: {
    sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
    tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
    range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
  },
  tsv: "snapshot",
  sourceFingerprint,
  reviewFingerprint,
};

function previewRow(overrides: Record<string, unknown> = {}) {
  return {
    kind: "DIRECT_ASSIGNMENT",
    sourceA1: "B2",
    sourceRaw: "Alice Example",
    role: "SLOW1",
    eventId: "event-1",
    eventSummary: "FB vs Miami",
    eventStartsAt: "2026-08-30T17:00:00.000Z",
    eventOpponent: "Miami",
    eventIsHome: true,
    shiftGroupId: "group-1",
    workingVersion: 3,
    userId: "alice",
    userName: "Alice Example",
    assignedSlotKey: null,
    openSlots: [{ key: "shift-1", area: "VIDEO", workerType: "FT" }],
    currentRoleHolders: [],
    canApply: true,
    reason: "Choose the exact Staff slot for Alice Example.",
    ...overrides,
  };
}

describe("reviewed Football staffing-sheet apply", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.preview.mockResolvedValue({ sourceFingerprint, reviewFingerprint, applyRows: [previewRow()] });
    mocks.eventEndsAt.mockResolvedValue(new Date("2099-09-01T20:00:00.000Z"));
    mocks.enqueue.mockResolvedValue({ at: new Date("2099-09-01T19:00:00.000Z"), runId: "run-1" });
    mocks.mutate.mockResolvedValue({ workingVersion: 4 });
  });

  it("replays the preview and stages one exact slot with provenance", async () => {
    await applyReviewedFootballStaffingSheet({
      ...requestBase,
      selection: {
        kind: "ASSIGN_ROLE",
        sourceA1: "B2",
        eventId: "event-1",
        userId: "alice",
        slotKey: "shift-1",
        expectedVersion: 3,
      },
    }, { id: "admin-1", role: "ADMIN" });

    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ tsv: "snapshot" }));
    expect(mocks.enqueue).toHaveBeenCalledWith({ shiftGroupId: "group-1", version: 4 });
    expect(mocks.mutate).toHaveBeenCalledWith(
      "group-1",
      3,
      expect.objectContaining({
        type: "applyFootballSheetAssignment",
        slotKey: "shift-1",
        userId: "alice",
        role: "SLOW1",
        proof: expect.objectContaining({ sourceA1: "B2", sourceFingerprint, reviewFingerprint }),
      }),
      { id: "admin-1", role: "ADMIN" },
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("rejects source or review drift before scheduling or mutation", async () => {
    mocks.preview.mockResolvedValue({ sourceFingerprint: "c".repeat(64), reviewFingerprint, applyRows: [previewRow()] });
    await expect(applyReviewedFootballStaffingSheet({
      ...requestBase,
      selection: {
        kind: "ASSIGN_ROLE",
        sourceA1: "B2",
        eventId: "event-1",
        userId: "alice",
        slotKey: "shift-1",
        expectedVersion: 3,
      },
    }, { id: "admin-1", role: "ADMIN" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("rejects a slot that was not part of the reviewed options", async () => {
    await expect(applyReviewedFootballStaffingSheet({
      ...requestBase,
      selection: {
        kind: "ASSIGN_ROLE",
        sourceA1: "B2",
        eventId: "event-1",
        userId: "alice",
        slotKey: "shift-other",
        expectedVersion: 3,
      },
    }, { id: "admin-1", role: "ADMIN" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("cannot turn a blocked source state into an apply command", async () => {
    mocks.preview.mockResolvedValue({ sourceFingerprint, reviewFingerprint, applyRows: [] });
    await expect(applyReviewedFootballStaffingSheet({
      ...requestBase,
      selection: {
        kind: "ASSIGN_ROLE",
        sourceA1: "B2",
        eventId: "event-1",
        userId: "alice",
        slotKey: "shift-1",
        expectedVersion: 3,
      },
    }, { id: "admin-1", role: "ADMIN" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("stages an explicit dash only as role-metadata clearing", async () => {
    mocks.preview.mockResolvedValue({
      sourceFingerprint,
      reviewFingerprint,
      applyRows: [previewRow({
        kind: "INTENTIONALLY_UNSTAFFED",
        sourceRaw: "-",
        userId: null,
        userName: null,
        openSlots: [],
        currentRoleHolders: [{ slotKey: "shift-2", userId: "bob", userName: "Bob Example" }],
      })],
    });
    await applyReviewedFootballStaffingSheet({
      ...requestBase,
      selection: {
        kind: "CLEAR_ROLE",
        sourceA1: "B2",
        eventId: "event-1",
        expectedVersion: 3,
      },
    }, { id: "admin-1", role: "ADMIN" });

    expect(mocks.mutate).toHaveBeenCalledWith(
      "group-1",
      3,
      expect.objectContaining({ type: "clearFootballSheetRole", role: "SLOW1" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("uses the existing silent backfill publication boundary for an ended event", async () => {
    mocks.eventEndsAt.mockResolvedValue(new Date("2020-09-01T20:00:00.000Z"));
    mocks.publish.mockResolvedValue({ affectedUserIds: ["alice"] });
    mocks.editor.mockResolvedValue({ workingVersion: 4, publishedVersion: 4 });

    const result = await applyReviewedFootballStaffingSheet({
      ...requestBase,
      selection: {
        kind: "ASSIGN_ROLE",
        sourceA1: "B2",
        eventId: "event-1",
        userId: "alice",
        slotKey: "shift-1",
        expectedVersion: 3,
      },
    }, { id: "admin-1", role: "ADMIN" });

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.mutate).toHaveBeenCalledWith(
      "group-1",
      3,
      expect.anything(),
      { id: "admin-1", role: "ADMIN" },
      null,
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      "group-1",
      "admin-1",
      4,
      "ADMIN",
      { clearNotificationPending: true },
    );
    expect(mocks.badge).toHaveBeenCalledWith({ userId: "alice" }, { notify: false });
    expect(result).toEqual({ workingVersion: 4, publishedVersion: 4 });
  });
});
