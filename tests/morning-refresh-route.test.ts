import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron", () => ({
  withCron:
    (handler: (req: Request) => Promise<Response>) =>
    (req: Request) =>
      handler(req),
}));

vi.mock("@/lib/db", () => ({
  db: {
    calendarSource: { findMany: vi.fn() },
    calendarEvent: { updateMany: vi.fn() },
    shiftGroup: { findMany: vi.fn(), updateMany: vi.fn() },
    productEvent: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/services/calendar-sync", () => ({
  syncCalendarSource: vi.fn(),
}));

vi.mock("@/lib/services/calendar-sync-health", () => ({
  updateCalendarSyncHealth: vi.fn(),
}));

vi.mock("@/lib/services/shift-generation", () => ({
  generateShiftsForNewEvents: vi.fn(),
}));

vi.mock("@/lib/services/shift-trades", () => ({
  expireOpenTrades: vi.fn(),
}));

vi.mock("@/lib/services/pending-pickup-expiry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/pending-pickup-expiry")>();
  return {
    ...actual,
    expirePickupNoShows: vi.fn(),
  };
});

vi.mock("@/lib/services/firmware-watch", () => ({
  pollFirmwareWatchTargets: vi.fn(),
}));

vi.mock("@/lib/services/schedule-automation", () => ({
  getScheduleAutomationDigest: vi.fn(),
}));

vi.mock("@/lib/services/companion-projection", () => ({
  refreshCompanionProjection: vi.fn(),
}));

vi.mock("@/lib/services/signatures", () => ({
  cleanupPendingSignatureArtifacts: vi.fn(),
}));

vi.mock("@/lib/badges", () => ({
  badgesEnabled: vi.fn(),
  badges: { onShiftsWorked: vi.fn() },
}));

vi.mock("@/lib/badges/worked-evidence", () => ({
  recentlyWorkedEventUsers: vi.fn(),
}));

import { db } from "@/lib/db";
import { syncCalendarSource } from "@/lib/services/calendar-sync";
import { updateCalendarSyncHealth } from "@/lib/services/calendar-sync-health";
import { generateShiftsForNewEvents } from "@/lib/services/shift-generation";
import { expireOpenTrades } from "@/lib/services/shift-trades";
import { expirePickupNoShows } from "@/lib/services/pending-pickup-expiry";
import { pollFirmwareWatchTargets } from "@/lib/services/firmware-watch";
import { getScheduleAutomationDigest } from "@/lib/services/schedule-automation";
import { refreshCompanionProjection } from "@/lib/services/companion-projection";
import { cleanupPendingSignatureArtifacts } from "@/lib/services/signatures";
import { badges, badgesEnabled } from "@/lib/badges";
import { recentlyWorkedEventUsers } from "@/lib/badges/worked-evidence";
import { GET } from "@/app/api/cron/morning-refresh/route";

const mockDb = db as unknown as {
  calendarSource: { findMany: ReturnType<typeof vi.fn> };
  calendarEvent: { updateMany: ReturnType<typeof vi.fn> };
  shiftGroup: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  productEvent: { deleteMany: ReturnType<typeof vi.fn> };
};

function request() {
  return new Request("https://app.example.com/api/cron/morning-refresh");
}

describe("morning refresh cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb.calendarSource.findMany.mockResolvedValue([]);
    mockDb.calendarEvent.updateMany.mockResolvedValue({ count: 0 });
    mockDb.shiftGroup.findMany.mockResolvedValue([]);
    mockDb.shiftGroup.updateMany.mockResolvedValue({ count: 0 });
    mockDb.productEvent.deleteMany.mockResolvedValue({ count: 0 });
    vi.mocked(syncCalendarSource).mockResolvedValue({ added: 0, updated: 0, cancelled: 0, skipped: 0, errors: [] });
    vi.mocked(generateShiftsForNewEvents).mockResolvedValue({ groupsCreated: 0, shiftsCreated: 0 });
    vi.mocked(updateCalendarSyncHealth).mockResolvedValue({
      sourceId: "source-1",
      sourceName: "UW Badgers",
      consecutiveFailures: 0,
      failed: false,
      notificationsCreated: 0,
    });
    vi.mocked(expireOpenTrades).mockResolvedValue({ expired: 1 });
    vi.mocked(expirePickupNoShows).mockResolvedValue({
      scanned: 2,
      expired: 1,
      failed: 0,
      cutoff: new Date("2026-05-11T12:00:00.000Z"),
      errors: {},
    });
    vi.mocked(pollFirmwareWatchTargets).mockResolvedValue({
      checked: 1,
      changed: 1,
      baselined: 0,
      failed: 0,
      skipped: 0,
      notificationsCreated: 2,
      errors: [],
    });
    vi.mocked(getScheduleAutomationDigest).mockResolvedValue({
      generatedAt: "2026-05-13T12:00:00.000Z",
      window: {
        startsAt: null,
        endsAt: null,
        includePast: false,
        includeArchived: false,
        sportCode: null,
      },
      metrics: {
        openSlots: 0,
        eventsWithoutCrew: 0,
        pendingRequests: 0,
        conflicts: 0,
        gearGaps: 0,
        readyToPublish: 0,
        autoFillCandidates: 0,
        staleSources: 0,
        sourceErrors: 0,
        staleTrades: 0,
        syncEventsAdded: 0,
        syncEventsUpdated: 0,
        syncGroupsCreated: 0,
        syncShiftsCreated: 0,
        shiftGroupsArchived: 0,
        eventsArchived: 0,
        tradesExpired: 1,
        pendingPickupsExpired: 1,
      },
      cards: [],
      partialFailures: [],
    });
    vi.mocked(refreshCompanionProjection).mockResolvedValue({} as never);
    vi.mocked(cleanupPendingSignatureArtifacts).mockResolvedValue({ abandoned: 0, attempted: 0, deleted: 0 });
    vi.mocked(badgesEnabled).mockReturnValue(false);
    vi.mocked(recentlyWorkedEventUsers).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stale trade and pending pickup maintenance results", async () => {
    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.tradesExpired).toBe(1);
    expect(body.pendingPickups).toMatchObject({ scanned: 2, expired: 1, failed: 0 });
    expect(body.firmwareWatch).toMatchObject({ checked: 1, changed: 1, notificationsCreated: 2 });
    expect(body.scheduleAutomation).toMatchObject({
      metrics: expect.objectContaining({ tradesExpired: 1, pendingPickupsExpired: 1 }),
    });
    expect(body.maintenanceFailures).toEqual([]);
    expect(refreshCompanionProjection).toHaveBeenCalledTimes(1);
    expect(refreshCompanionProjection).toHaveBeenCalledWith({ notify: true });
    expect(getScheduleAutomationDigest).toHaveBeenCalledWith(expect.objectContaining({
      maintenance: expect.objectContaining({
        tradesExpired: 1,
        pendingPickupsExpired: 1,
      }),
    }));
  });

  it("reports maintenance failures without throwing away the cron response", async () => {
    vi.mocked(expirePickupNoShows).mockRejectedValue(new Error("expiry failed"));

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.tradesExpired).toBe(1);
    expect(body.pendingPickups).toMatchObject({ scanned: 0, expired: 0, failed: 1 });
    expect(body.maintenanceFailures).toEqual(["pendingPickups"]);
    expect(refreshCompanionProjection).not.toHaveBeenCalled();
  });

  it("skips projection publication when pickup expiry made no changes", async () => {
    vi.mocked(expirePickupNoShows).mockResolvedValue({
      scanned: 2,
      expired: 0,
      failed: 0,
      cutoff: new Date("2026-05-11T12:00:00.000Z"),
      errors: {},
    });

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(refreshCompanionProjection).not.toHaveBeenCalled();
  });

  it("keeps recently added-worker badge recognition fully silent", async () => {
    vi.mocked(badgesEnabled).mockReturnValue(true);
    vi.mocked(recentlyWorkedEventUsers).mockResolvedValue([
      { userId: "scheduled-user", hasAddedWorker: false, hasBackfilledAssignment: false },
      { userId: "backfilled-user", hasAddedWorker: true, hasBackfilledAssignment: false },
      { userId: "late-assigned-user", hasAddedWorker: false, hasBackfilledAssignment: true },
    ]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.shiftBadgeUsers).toBe(3);
    expect(badges.onShiftsWorked).toHaveBeenNthCalledWith(
      1,
      { userId: "scheduled-user" },
      { notify: true },
    );
    expect(badges.onShiftsWorked).toHaveBeenNthCalledWith(
      2,
      { userId: "backfilled-user" },
      { notify: false },
    );
    expect(badges.onShiftsWorked).toHaveBeenNthCalledWith(
      3,
      { userId: "late-assigned-user" },
      { notify: false },
    );
  });

  it("reports projection publication failure separately from committed expiry", async () => {
    vi.mocked(refreshCompanionProjection).mockRejectedValue(new Error("Redis unavailable"));

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.pendingPickups).toMatchObject({ scanned: 2, expired: 1, failed: 0 });
    expect(body.maintenanceFailures).toEqual(["companionProjection"]);
  });

  it("reports firmware watch failures without blocking other daily maintenance", async () => {
    vi.mocked(pollFirmwareWatchTargets).mockRejectedValue(new Error("firmware source failed"));

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.tradesExpired).toBe(1);
    expect(body.pendingPickups).toMatchObject({ scanned: 2, expired: 1, failed: 0 });
    expect(body.firmwareWatch).toMatchObject({ checked: 0, failed: 1, notificationsCreated: 0 });
    expect(body.maintenanceFailures).toEqual(["firmwareWatch"]);
  });

  it("reports returned calendar sync errors and records source health", async () => {
    mockDb.calendarSource.findMany.mockResolvedValue([
      { id: "source-1", name: "UW Badgers" },
    ]);
    vi.mocked(syncCalendarSource).mockResolvedValue({
      added: 0,
      updated: 0,
      cancelled: 0,
      skipped: 0,
      errors: [],
      error: "HTTP 500",
    });
    vi.mocked(updateCalendarSyncHealth).mockResolvedValue({
      sourceId: "source-1",
      sourceName: "UW Badgers",
      consecutiveFailures: 3,
      failed: true,
      notificationsCreated: 1,
    });

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncResults).toEqual([
      expect.objectContaining({
        sourceId: "source-1",
        sourceName: "UW Badgers",
        error: "HTTP 500",
        consecutiveFailures: 3,
        adminNotificationsCreated: 1,
      }),
    ]);
    expect(updateCalendarSyncHealth).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: "source-1",
      sourceName: "UW Badgers",
      result: expect.objectContaining({ error: "HTTP 500" }),
    }));
  });

  it("syncs calendar sources with bounded concurrency and reports carry-over", async () => {
    mockDb.calendarSource.findMany.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({ id: `source-${i}`, name: `Source ${i}` })),
    );
    let inFlight = 0;
    let peakInFlight = 0;
    vi.mocked(syncCalendarSource).mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { added: 0, updated: 0, cancelled: 0, skipped: 0, errors: [] };
    });

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    // Serial would peak at 1; unbounded would peak at 7.
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(body.syncResults).toHaveLength(7);
    expect(body.sourcesProcessed).toBe(7);
    expect(body.sourcesSkipped).toBe(0);
    expect(body.shiftBadgeUsersRemaining).toBe(0);
    expect(body.deadlineExceeded).toBe(false);
  });

  it("stops the source loop at the deadline and carries the rest over", async () => {
    mockDb.calendarSource.findMany.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ id: `source-${i}`, name: `Source ${i}` })),
    );
    // Each batch burns more than the 8s budget, so only the first one runs.
    const realNow = Date.now;
    let ticks = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + (ticks += 5000));

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncResults.length).toBeLessThan(9);
    expect(body.sourcesSkipped).toBeGreaterThan(0);
    expect(body.syncResults.length + body.sourcesSkipped).toBe(9);
    expect(body.deadlineExceeded).toBe(true);
  });

  it("evaluates shift badges with bounded concurrency", async () => {
    vi.mocked(badgesEnabled).mockReturnValue(true);
    vi.mocked(recentlyWorkedEventUsers).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        userId: `user-${i}`,
        hasAddedWorker: false,
        hasBackfilledAssignment: false,
      })),
    );
    let inFlight = 0;
    let peakInFlight = 0;
    vi.mocked(badges.onShiftsWorked).mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return undefined as never;
    });

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(5);
    expect(body.shiftBadgeUsers).toBe(12);
    expect(body.shiftBadgeUsersRemaining).toBe(0);
  });

  it("reports automation digest failures without blocking other daily maintenance", async () => {
    vi.mocked(getScheduleAutomationDigest).mockRejectedValue(new Error("automation read failed"));

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.scheduleAutomation).toBeNull();
    expect(body.tradesExpired).toBe(1);
    expect(body.pendingPickups).toMatchObject({ scanned: 2, expired: 1, failed: 0 });
    expect(body.maintenanceFailures).toEqual(["scheduleAutomation"]);
  });
});
