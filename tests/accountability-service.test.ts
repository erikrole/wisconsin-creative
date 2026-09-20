import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findMany: vi.fn(), groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("@/lib/services/checkout-policies", () => ({
  loadCheckoutPolicies: vi.fn(),
}));

import { db } from "@/lib/db";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import {
  excludeBookingFromAccountability,
  getAccountabilityReport,
  restoreBookingToAccountability,
} from "@/lib/services/accountability";

type TestBookingRow = {
  status?: string;
  custodyScope?: string;
  completedAt?: Date | null;
  requester: { id: string };
  location: { id: string; name: string };
  accountabilityExclusion?: { restoredAt: Date | null } | null;
};

function bookingRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.booking.findMany>>;
}

function tally(rows: TestBookingRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.requester.id, (counts.get(row.requester.id) ?? 0) + 1);
  }
  return [...counts].map(([requesterUserId, count]) => ({
    requesterUserId,
    _count: { _all: count },
  }));
}

/**
 * The service now issues three distinct booking reads -- the DISTINCT ON
 * location lookup, the capped row scan, and the per-user aggregates -- so the
 * mock dispatches on the query shape instead of returning one fixed payload.
 */
function setBookings(rows: Awaited<ReturnType<typeof db.booking.findMany>>) {
  const all = rows as unknown as TestBookingRow[];
  vi.mocked(db.booking.findMany).mockImplementation((async (args: { distinct?: unknown }) =>
    args?.distinct ? all.map((row) => ({ location: row.location })) : rows) as never);

  const eligible = all.filter(
    (row) =>
      row.custodyScope !== "SHARED" &&
      !(row.accountabilityExclusion && row.accountabilityExclusion.restoredAt === null),
  );
  vi.mocked(db.booking.groupBy).mockImplementation((async (args: {
    where?: { AND?: Array<{ status?: unknown }> };
  }) =>
    args?.where?.AND?.[1]?.status
      ? tally(eligible.filter((row) => row.status === "COMPLETED" && Boolean(row.completedAt)))
      : tally(eligible)) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCheckoutPolicies).mockResolvedValue({
    defaultLoanDays: 7,
    gracePeriodHours: 1,
    maxItemsPerUser: null,
  });
});

describe("accountability service", () => {
  it("excludes and restores inside SERIALIZABLE transactions with audit evidence", async () => {
    const tx = {
      booking: {
        findUnique: vi.fn().mockResolvedValue({
          id: "booking-1",
          kind: "CHECKOUT",
          title: "Camera checkout",
          accountabilityExclusion: null,
        }),
      },
      bookingAccountabilityExclusion: {
        upsert: vi.fn().mockResolvedValue({
          id: "ex-1",
          bookingId: "booking-1",
          reason: "TEST_DATA",
          note: "Seed record",
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: "ex-1",
          bookingId: "booking-1",
          reason: "TEST_DATA",
          note: "Seed record",
          restoredAt: null,
          booking: { title: "Camera checkout" },
        }),
        update: vi.fn().mockResolvedValue({ id: "ex-1", restoredAt: new Date() }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await excludeBookingFromAccountability({
      bookingId: "booking-1",
      reason: "TEST_DATA",
      note: "Seed record",
      actorId: "admin-1",
      actorRole: "ADMIN",
    });
    expect(tx.bookingAccountabilityExclusion.upsert).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "accountability_excluded",
        entityId: "booking-1",
      }),
    });
    expect(db.$transaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );

    await restoreBookingToAccountability({
      bookingId: "booking-1",
      actorId: "admin-1",
      actorRole: "ADMIN",
    });
    expect(tx.bookingAccountabilityExclusion.update).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
      data: expect.objectContaining({
        restoredByUserId: "admin-1",
        restoredAt: expect.any(Date),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: "accountability_restored",
        entityId: "booking-1",
      }),
    });
  });

  it("ranks by late incidents and ignores active exclusions", async () => {
    setBookings(bookingRows([
      {
        id: "late-resolved",
        kind: "CHECKOUT",
        title: "Returned camera",
        status: "COMPLETED",
        endsAt: new Date("2026-08-10T10:00:00.000Z"),
        completedAt: new Date("2026-08-10T13:30:00.000Z"),
        requester: {
          id: "user-1",
          name: "Alex Student",
          avatarUrl: "/avatars/alex.jpg",
          active: true,
          primaryArea: "VIDEO",
        },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [{ asset: { assetTag: "CAM-1", name: "Camera" } }],
        bulkItems: [],
      },
      {
        id: "late-active",
        kind: "CHECKOUT",
        title: "Open camera",
        status: "OPEN",
        endsAt: new Date("2026-08-11T10:00:00.000Z"),
        completedAt: null,
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [{ plannedQuantity: 2, checkedOutQuantity: 2, bulkSku: { name: "Battery" } }],
      },
      {
        id: "excluded",
        kind: "CHECKOUT",
        title: "Test checkout",
        status: "COMPLETED",
        endsAt: new Date("2026-08-01T10:00:00.000Z"),
        completedAt: new Date("2026-08-03T10:00:00.000Z"),
        requester: { id: "user-2", name: "Test User", active: false, primaryArea: null },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: {
          id: "ex-1",
          reason: "TEST_DATA",
          note: null,
          excludedAt: new Date("2026-08-04T10:00:00.000Z"),
          restoredAt: null,
          excludedBy: { id: "admin-1", name: "Admin" },
          restoredBy: null,
        },
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026, incidentState: "all", userState: "all" },
      new Date("2026-08-11T14:30:00.000Z"),
    );

    expect(report.methodology.gracePeriodHours).toBe(1);
    expect(report.leaderboard).toHaveLength(1);
    expect(report.leaderboard[0]).toMatchObject({
      name: "Alex Student",
      avatarUrl: "/avatars/alex.jpg",
      lateEventCount: 2,
      activeOverdueCount: 1,
      totalLateHours: 7,
      onTimeRate: null,
    });
    expect(report.leaderboard[0]?.incidents[0]?.itemSummary).toBe("Battery x2");
    expect(report.excluded).toEqual([
      expect.objectContaining({ bookingId: "excluded", reason: "TEST_DATA" }),
    ]);
    expect(report.metrics.excludedRecords).toBe(1);
  });

  it("aggregates per-person totals in Postgres and caps the row scan", async () => {
    setBookings(bookingRows([
      {
        id: "late-resolved",
        kind: "CHECKOUT",
        title: "Returned camera",
        status: "COMPLETED",
        endsAt: new Date("2026-08-10T10:00:00.000Z"),
        completedAt: new Date("2026-08-10T13:30:00.000Z"),
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026 },
      new Date("2026-08-11T14:30:00.000Z"),
    );

    // Per-user checkout and completed totals are counted by the database.
    expect(db.booking.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["requesterUserId"], _count: { _all: true } }),
    );
    expect(vi.mocked(db.booking.groupBy).mock.calls).toHaveLength(2);

    // The row scan is bounded and asks for one extra row to detect truncation.
    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5001, select: expect.any(Object) }),
    );
    // Item names are no longer dragged through the scan; they come from the
    // narrow second pass keyed by booking id.
    const scanCall = vi
      .mocked(db.booking.findMany)
      .mock.calls.find(([args]) => (args as { take?: number })?.take === 5001)?.[0] as {
      select: Record<string, unknown>;
    };
    expect(scanCall.select).not.toHaveProperty("serializedItems");
    expect(scanCall.select).not.toHaveProperty("bulkItems");

    // The location dropdown uses a pushed-down DISTINCT ON, not a `some` subquery.
    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ["locationId"],
        orderBy: { locationId: "asc" },
      }),
    );

    expect(report.truncated).toBe(false);
    expect(report.scanLimit).toBe(5000);
    expect(report.leaderboard[0]).toMatchObject({ checkoutCount: 1, completedCount: 1 });
  });

  it("ranks by volume or by total late time depending on the sort", async () => {
    // Frequent is late four times but briefly; Severe is late once for two days.
    const rows = bookingRows([
      ...[1, 2, 3, 4].map((day) => ({
        id: `frequent-${day}`,
        kind: "CHECKOUT",
        title: `Frequent ${day}`,
        status: "COMPLETED",
        endsAt: new Date(`2026-08-0${day}T10:00:00.000Z`),
        completedAt: new Date(`2026-08-0${day}T13:00:00.000Z`),
        requester: { id: "frequent", name: "Frequent Flyer", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      })),
      {
        id: "severe-1",
        kind: "CHECKOUT",
        title: "Severe 1",
        status: "COMPLETED",
        endsAt: new Date("2026-08-05T10:00:00.000Z"),
        completedAt: new Date("2026-08-07T10:00:00.000Z"),
        requester: { id: "severe", name: "Severe Holder", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      },
    ]);

    setBookings(rows);
    const byVolume = await getAccountabilityReport(
      { startYear: 2026, sort: "events" },
      new Date("2026-08-11T14:30:00.000Z"),
    );
    expect(byVolume.leaderboard.map((person) => person.name)).toEqual([
      "Frequent Flyer",
      "Severe Holder",
    ]);

    setBookings(rows);
    const byTime = await getAccountabilityReport(
      { startYear: 2026, sort: "time" },
      new Date("2026-08-11T14:30:00.000Z"),
    );
    expect(byTime.leaderboard.map((person) => person.name)).toEqual([
      "Severe Holder",
      "Frequent Flyer",
    ]);
    expect(byTime.leaderboard[0]).toMatchObject({
      totalLateHours: 47,
      worstLateHours: 47,
      lateEventCount: 1,
    });
    expect(byTime.metrics.totalLateHours).toBe(55);
  });

  it("does not count returns inside the configured grace period as late", async () => {
    setBookings(bookingRows([
      {
        id: "on-time",
        kind: "CHECKOUT",
        title: "Grace return",
        status: "COMPLETED",
        endsAt: new Date("2026-08-10T10:00:00.000Z"),
        completedAt: new Date("2026-08-10T10:45:00.000Z"),
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026 },
      new Date("2026-08-11T14:30:00.000Z"),
    );
    expect(report.leaderboard).toEqual([]);
    expect(report.metrics.lateEvents).toBe(0);
  });

  it("counts an overdue extension against the prior due time", async () => {
    setBookings(bookingRows([
      {
        id: "extended-after-due",
        kind: "CHECKOUT",
        title: "Extended camera",
        status: "COMPLETED",
        endsAt: new Date("2026-08-12T18:00:00.000Z"),
        completedAt: new Date("2026-08-12T17:00:00.000Z"),
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [{
          id: "change-1",
          bookingId: "extended-after-due",
          actorUserId: "staff-1",
          previousEndsAt: new Date("2026-08-10T10:00:00.000Z"),
          nextEndsAt: new Date("2026-08-12T18:00:00.000Z"),
          changedAt: new Date("2026-08-10T13:30:00.000Z"),
        }],
        serializedItems: [],
        bulkItems: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026, incidentState: "extended" },
      new Date("2026-08-13T12:00:00.000Z"),
    );

    expect(report.leaderboard).toHaveLength(1);
    expect(report.leaderboard[0]).toMatchObject({
      lateEventCount: 1,
      totalLateHours: 3,
      activeOverdueCount: 0,
    });
    expect(report.leaderboard[0]?.incidents).toEqual([
      expect.objectContaining({
        incidentId: "change-1",
        state: "extended",
        dueAt: "2026-08-10T10:00:00.000Z",
        extendedAt: "2026-08-10T13:30:00.000Z",
        extendedTo: "2026-08-12T18:00:00.000Z",
        lateHours: 3,
      }),
    ]);
  });

  it("counts currently overdue checkouts against the on-time rate", async () => {
    setBookings(bookingRows([
      ...[1, 2, 3].map((day) => ({
        id: `on-time-${day}`,
        kind: "CHECKOUT",
        title: `On time ${day}`,
        status: "COMPLETED",
        endsAt: new Date(`2026-08-0${day}T10:00:00.000Z`),
        completedAt: new Date(`2026-08-0${day}T10:30:00.000Z`),
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      })),
      {
        id: "still-out",
        kind: "CHECKOUT",
        title: "Still out",
        status: "OPEN",
        endsAt: new Date("2026-08-04T10:00:00.000Z"),
        completedAt: null,
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026 },
      new Date("2026-08-11T14:30:00.000Z"),
    );

    expect(report.leaderboard).toHaveLength(1);
    expect(report.leaderboard[0]).toMatchObject({
      completedCount: 3,
      activeOverdueCount: 1,
      onTimeRate: 75,
    });
  });

  it("does not rank shared travel-case custody against the retained requester", async () => {
    setBookings(bookingRows([
      {
        id: "shared-late",
        kind: "CHECKOUT",
        title: "Football Travel Case",
        status: "OPEN",
        custodyScope: "SHARED",
        endsAt: new Date("2026-08-01T10:00:00.000Z"),
        completedAt: null,
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026 },
      new Date("2026-08-11T14:30:00.000Z"),
    );
    expect(report.leaderboard).toEqual([]);
  });

  it("puts currently overdue receipts ahead of older resolved history", async () => {
    setBookings(bookingRows([
      {
        id: "resolved-old",
        kind: "CHECKOUT",
        title: "Returned camera",
        status: "COMPLETED",
        endsAt: new Date("2026-08-01T10:00:00.000Z"),
        completedAt: new Date("2026-08-03T10:00:00.000Z"),
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      },
      {
        id: "active-now",
        kind: "CHECKOUT",
        title: "Still out",
        status: "OPEN",
        endsAt: new Date("2026-08-10T10:00:00.000Z"),
        completedAt: null,
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [],
        serializedItems: [],
        bulkItems: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026 },
      new Date("2026-08-11T14:30:00.000Z"),
    );
    expect(report.leaderboard[0]?.incidents.map((incident) => incident.state)).toEqual([
      "active",
      "resolved",
    ]);
  });

  it("does not count an extension made inside the configured grace period", async () => {
    setBookings(bookingRows([
      {
        id: "extended-in-grace",
        kind: "CHECKOUT",
        title: "Grace extension",
        status: "OPEN",
        endsAt: new Date("2026-08-12T18:00:00.000Z"),
        completedAt: null,
        requester: { id: "user-1", name: "Alex Student", active: true, primaryArea: "VIDEO" },
        location: { id: "main", name: "Main Cage" },
        accountabilityExclusion: null,
        dueDateChanges: [{
          id: "change-2",
          bookingId: "extended-in-grace",
          actorUserId: "staff-1",
          previousEndsAt: new Date("2026-08-10T10:00:00.000Z"),
          nextEndsAt: new Date("2026-08-12T18:00:00.000Z"),
          changedAt: new Date("2026-08-10T10:45:00.000Z"),
        }],
        serializedItems: [],
        bulkItems: [],
      },
    ]));

    const report = await getAccountabilityReport(
      { startYear: 2026, incidentState: "extended" },
      new Date("2026-08-11T12:00:00.000Z"),
    );
    expect(report.leaderboard).toEqual([]);
  });
});
