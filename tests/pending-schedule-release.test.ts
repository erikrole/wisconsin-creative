import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  publishShiftGroup: vi.fn(),
  createInitialNotifications: vi.fn(),
  notifyWorkers: vi.fn(),
  notifyFollowers: vi.fn(),
  onShiftsWorked: vi.fn(),
  recordBulkOutcome: vi.fn(),
}));

vi.mock("workflow", () => ({ sleep: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    shiftGroupWorkingCopy: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@/lib/services/schedule-publication", () => ({
  publishShiftGroup: mocks.publishShiftGroup,
}));
vi.mock("@/lib/services/notifications", () => ({
  createPublishedShiftGroupNotifications: mocks.createInitialNotifications,
  notifyPublishedShiftGroupWorkers: mocks.notifyWorkers,
  notifyPublishedScheduleFollowers: mocks.notifyFollowers,
}));
vi.mock("@/lib/services/bulk-schedule-assignment", () => ({
  recordBulkScheduleReleaseOutcome: mocks.recordBulkOutcome,
}));
vi.mock("@/lib/badges", () => ({
  badges: { onShiftsWorked: mocks.onShiftsWorked },
}));

import { releasePendingScheduleVersion } from "@/workflows/pending-schedule-release";

describe("pending schedule release step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
    mocks.findUnique.mockResolvedValue({
      version: 4,
      updatedById: "staff-1",
      updatedBy: { role: "STAFF" },
      shiftGroup: { event: { endsAt: new Date("2026-09-01T20:00:00.000Z") } },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing when a newer edit superseded the sleeping version", async () => {
    await expect(releasePendingScheduleVersion("group-1", 3)).resolves.toEqual({
      status: "superseded",
      shiftGroupId: "group-1",
      expectedVersion: 3,
    });
    expect(mocks.publishShiftGroup).not.toHaveBeenCalled();
  });

  it("releases only the exact stored version and sends one changed-worker batch", async () => {
    mocks.publishShiftGroup.mockResolvedValue({
      before: { publishedAt: "2026-08-07T12:00:00.000Z" },
      after: { publishedVersion: 7 },
      publishedSnapshotChanged: true,
      affectedUserIds: ["student-1"],
    });

    await expect(releasePendingScheduleVersion("group-1", 4)).resolves.toMatchObject({ status: "released" });
    expect(mocks.publishShiftGroup).toHaveBeenCalledWith("group-1", "staff-1", 4, "STAFF");
    expect(mocks.notifyWorkers).toHaveBeenCalledWith("group-1", ["student-1"]);
    expect(mocks.notifyFollowers).toHaveBeenCalledWith("group-1");
    expect(mocks.createInitialNotifications).not.toHaveBeenCalled();
  });

  it("suppresses event-level worker notifications for a bulk release and records the batch outcome", async () => {
    mocks.publishShiftGroup.mockResolvedValue({
      before: { publishedAt: "2026-08-07T12:00:00.000Z" },
      after: {},
      workingVersion: 1,
      publishedSnapshotChanged: true,
      affectedUserIds: ["student-1"],
    });

    await expect(releasePendingScheduleVersion("group-1", 4, "batch-1")).resolves.toMatchObject({ status: "released" });
    expect(mocks.createInitialNotifications).not.toHaveBeenCalled();
    expect(mocks.notifyWorkers).not.toHaveBeenCalled();
    expect(mocks.notifyFollowers).toHaveBeenCalledWith("group-1");
    expect(mocks.recordBulkOutcome).toHaveBeenCalledWith({
      batchId: "batch-1",
      shiftGroupId: "group-1",
      expectedVersion: 4,
      status: "RELEASED",
      releasedVersion: 1,
    });
  });

  it("publishes a release that wakes after the event ended without notifying anyone", async () => {
    mocks.findUnique.mockResolvedValue({
      version: 4,
      updatedById: "staff-1",
      updatedBy: { role: "STAFF" },
      shiftGroup: { event: { endsAt: new Date("2026-08-01T20:00:00.000Z") } },
    });
    mocks.publishShiftGroup.mockResolvedValue({
      before: { publishedAt: "2026-08-07T12:00:00.000Z" },
      after: {},
      publishedSnapshotChanged: true,
      affectedUserIds: ["student-1"],
    });

    await expect(releasePendingScheduleVersion("group-1", 4)).resolves.toMatchObject({ status: "released" });
    expect(mocks.publishShiftGroup).toHaveBeenCalledWith(
      "group-1",
      "staff-1",
      4,
      "STAFF",
      { clearNotificationPending: true },
    );
    expect(mocks.createInitialNotifications).not.toHaveBeenCalled();
    expect(mocks.notifyWorkers).not.toHaveBeenCalled();
    expect(mocks.notifyFollowers).not.toHaveBeenCalled();
    expect(mocks.onShiftsWorked).toHaveBeenCalledWith({ userId: "student-1" }, { notify: false });
  });

  it("records a silent ended-event bulk release as released", async () => {
    mocks.findUnique.mockResolvedValue({
      version: 4,
      updatedById: "staff-1",
      updatedBy: { role: "STAFF" },
      shiftGroup: { event: { endsAt: new Date("2026-08-01T20:00:00.000Z") } },
    });
    mocks.publishShiftGroup.mockResolvedValue({
      before: { publishedAt: "2026-08-07T12:00:00.000Z" },
      after: {},
      workingVersion: 4,
      publishedSnapshotChanged: true,
      affectedUserIds: ["student-1"],
    });

    await expect(releasePendingScheduleVersion("group-1", 4, "batch-1")).resolves.toMatchObject({ status: "released" });
    expect(mocks.notifyFollowers).not.toHaveBeenCalled();
    expect(mocks.onShiftsWorked).toHaveBeenCalledWith({ userId: "student-1" }, { notify: false });
    expect(mocks.recordBulkOutcome).toHaveBeenCalledWith({
      batchId: "batch-1",
      shiftGroupId: "group-1",
      expectedVersion: 4,
      status: "RELEASED",
      releasedVersion: 4,
    });
  });

  it("records a superseded bulk item when the sleeping release finds a newer version", async () => {
    await expect(releasePendingScheduleVersion("group-1", 3, "batch-1")).resolves.toMatchObject({ status: "superseded" });
    expect(mocks.recordBulkOutcome).toHaveBeenCalledWith({
      batchId: "batch-1",
      shiftGroupId: "group-1",
      expectedVersion: 3,
      status: "SUPERSEDED",
    });
  });

  it("persists a permanent validation blocker on the same pending version", async () => {
    mocks.publishShiftGroup.mockRejectedValue(new HttpError(409, "Resolve the active trade first."));

    await expect(releasePendingScheduleVersion("group-1", 4)).resolves.toMatchObject({
      status: "blocked",
      error: "Resolve the active trade first.",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { shiftGroupId: "group-1", version: 4 },
      data: { autoReleaseError: "Resolve the active trade first." },
    });
  });

  describe("run ownership", () => {
    // Publish and discard delete the draft, and the next one restarts at
    // version 1. An old run matching on version alone would publish it early.
    beforeEach(() => {
      mocks.findUnique.mockResolvedValue({
        version: 1,
        autoReleaseRunId: "run-new",
        updatedById: "staff-1",
        updatedBy: { role: "STAFF" },
        shiftGroup: { event: { endsAt: new Date("2026-09-01T20:00:00.000Z") } },
      });
    });

    it("stands down when a recreated draft reuses the version but belongs to a newer run", async () => {
      await expect(releasePendingScheduleVersion("group-1", 1, undefined, "run-old")).resolves.toEqual({
        status: "superseded",
        shiftGroupId: "group-1",
        expectedVersion: 1,
      });
      expect(mocks.publishShiftGroup).not.toHaveBeenCalled();
    });

    it("records a superseded bulk item for a run that no longer owns the draft", async () => {
      await releasePendingScheduleVersion("group-1", 1, "batch-1", "run-old");
      expect(mocks.recordBulkOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: "SUPERSEDED" }));
    });

    it("releases the draft its own run owns and re-checks ownership inside publish", async () => {
      mocks.publishShiftGroup.mockResolvedValue({
        before: { publishedAt: "2026-08-07T12:00:00.000Z" },
        after: {},
        publishedSnapshotChanged: false,
        affectedUserIds: [],
      });

      await expect(releasePendingScheduleVersion("group-1", 1, undefined, "run-new"))
        .resolves.toMatchObject({ status: "released" });
      expect(mocks.publishShiftGroup).toHaveBeenCalledWith(
        "group-1",
        "staff-1",
        1,
        "STAFF",
        { expectedAutoReleaseRunId: "run-new" },
      );
    });

    it("does not stamp a blocker on a draft another run took over mid-publish", async () => {
      mocks.findUnique
        .mockResolvedValueOnce({
          version: 1,
          autoReleaseRunId: "run-new",
          updatedById: "staff-1",
          updatedBy: { role: "STAFF" },
          shiftGroup: { event: { endsAt: new Date("2026-09-01T20:00:00.000Z") } },
        })
        .mockResolvedValueOnce({ version: 1, autoReleaseRunId: "run-newer" });
      mocks.publishShiftGroup.mockRejectedValue(
        new HttpError(409, "This automatic release was superseded by a newer schedule draft."),
      );

      await expect(releasePendingScheduleVersion("group-1", 1, undefined, "run-new"))
        .resolves.toMatchObject({ status: "superseded" });
      expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it("scopes a persisted blocker to the owning run", async () => {
      mocks.publishShiftGroup.mockRejectedValue(new HttpError(409, "Resolve the active trade first."));

      await expect(releasePendingScheduleVersion("group-1", 1, undefined, "run-new"))
        .resolves.toMatchObject({ status: "blocked" });
      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: { shiftGroupId: "group-1", version: 1, autoReleaseRunId: "run-new" },
        data: { autoReleaseError: "Resolve the active trade first." },
      });
    });
  });
});
