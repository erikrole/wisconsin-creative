import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadgeStreakType, Prisma } from "@prisma/client";

const { mockTx } = vi.hoisted(() => ({
  mockTx: {
    booking: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    badgeDefinition: {
      findMany: vi.fn(),
    },
    studentBadge: {
      createManyAndReturn: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
    badgeEventReceipt: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    badgeStreak: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    shiftTrade: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    shiftAssignment: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    eventWorker: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    _mockTx: mockTx,
  },
}));

import { db } from "@/lib/db";
import { onAppOpened, onCheckoutOpened, onCheckoutReturned, onShiftsWorked, onTradeCompleted } from "@/lib/badges/evaluator";

const dbMock = db as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Awards return the rows that were actually inserted, which is what drives
  // the earned-badge notification. Default to "nothing new was written".
  mockTx.studentBadge.createManyAndReturn.mockResolvedValue([]);
  mockTx.user.findUnique.mockResolvedValue({ notificationPrefs: null });
  mockTx.notification.createMany.mockResolvedValue({ count: 0 });
  mockTx.badgeEventReceipt.createMany.mockResolvedValue({ count: 1 });
  mockTx.badgeEventReceipt.findMany.mockResolvedValue([{ sourceKey: "booking-1" }]);
  mockTx.badgeStreak.upsert.mockResolvedValue({});
  mockTx.booking.findMany.mockResolvedValue([]);
  mockTx.booking.count.mockResolvedValue(0);
  mockTx.badgeDefinition.findMany.mockResolvedValue([]);
  mockTx.shiftAssignment.findMany.mockResolvedValue([]);
  mockTx.eventWorker.findMany.mockResolvedValue([]);
  mockTx.shiftTrade.findMany.mockResolvedValue([]);
});

describe("badge evaluator added-worker silence", () => {
  function assignment(eventId: string) {
    return {
      hasConflict: false,
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        startsAt: new Date("2026-08-10T18:00:00.000Z"),
        endsAt: new Date("2026-08-10T22:00:00.000Z"),
        callStartsAt: null,
        callEndsAt: null,
        area: "VIDEO",
        shiftGroup: { event: { id: eventId, isHome: true, sportCode: "MBB" } },
      },
    };
  }

  function addedWorker(eventId: string) {
    return {
      event: {
        id: eventId,
        startsAt: new Date("2026-09-10T18:00:00.000Z"),
        endsAt: new Date("2026-09-10T22:00:00.000Z"),
        allDay: false,
        isHome: true,
        sportCode: "MBB",
        result: null,
        site: "HOME",
        locationId: null,
        opponent: null,
      },
    };
  }

  beforeEach(() => {
    // Report every requested row as freshly inserted, so the notification step
    // is reached rather than short-circuiting on "nothing was written".
    mockTx.studentBadge.createManyAndReturn.mockImplementation(async ({ data }: {
      data: Array<{ definitionId: string }>;
    }) => data.map((row) => ({ id: `award-${row.definitionId}`, definitionId: row.definitionId })));
  });

  function notifiedBadgeNames() {
    return mockTx.notification.createMany.mock.calls.flatMap(
      (call: unknown[]) => (call[0] as { data: Array<{ body: string }> }).data.map((row) => row.body),
    );
  }

  it("stays silent for a badge only an added worker pushed the person over", async () => {
    mockTx.shiftAssignment.findMany.mockResolvedValue([assignment("event-1"), assignment("event-2"), assignment("event-3")]);
    mockTx.eventWorker.findMany.mockResolvedValue(
      Array.from({ length: 7 }, (_unused, index) => addedWorker(`added-event-${index}`)),
    );
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: { category?: string } }) => (
      where.category === "SHIFT"
        ? [
            { id: "shift-3", name: "Shift 3", threshold: 3 },
            { id: "shift-10", name: "Shift 10", threshold: 10 },
          ]
        : []
    ));

    await onShiftsWorked({ userId: "user-1" });

    // Both are earned: three assignments plus seven credits is ten worked events.
    const awarded = mockTx.studentBadge.createManyAndReturn.mock.calls
      .flatMap((call: unknown[]) => (call[0] as { data: Array<{ definitionId: string }> }).data.map((row) => row.definitionId));
    expect(awarded.sort()).toEqual(["shift-10", "shift-3"]);

    // Only the one the schedule alone already earned is announced.
    const notified = notifiedBadgeNames();
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("Shift 3");
  });

  it("keeps every badge award silent for an explicit backfill pass", async () => {
    mockTx.shiftAssignment.findMany.mockResolvedValue([assignment("event-1"), assignment("event-2"), assignment("event-3")]);
    mockTx.eventWorker.findMany.mockResolvedValue(
      Array.from({ length: 7 }, (_unused, index) => addedWorker(`added-event-${index}`)),
    );
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: { category?: string } }) => (
      where.category === "SHIFT"
        ? [
            { id: "shift-3", name: "Shift 3", threshold: 3 },
            { id: "shift-10", name: "Shift 10", threshold: 10 },
          ]
        : where.category === "MILESTONE"
          ? [{ id: "area-1", name: "Utility Crew", ruleKey: "shift_areas", threshold: 1 }]
        : []
    ));

    await onShiftsWorked({ userId: "user-1" }, { notify: false });

    const awarded = mockTx.studentBadge.createManyAndReturn.mock.calls
      .flatMap((call: unknown[]) => (call[0] as { data: Array<{ definitionId: string }> }).data.map((row) => row.definitionId));
    expect(awarded.sort()).toEqual(["area-1", "shift-10", "shift-3"]);
    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
    expect(mockTx.user.findUnique).not.toHaveBeenCalled();
  });

  it("notifies normally when the person has no added workers at all", async () => {
    mockTx.shiftAssignment.findMany.mockResolvedValue([assignment("event-1"), assignment("event-2"), assignment("event-3")]);
    mockTx.eventWorker.findMany.mockResolvedValue([]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: { category?: string } }) => (
      where.category === "SHIFT" ? [{ id: "shift-3", name: "Shift 3", threshold: 3 }] : []
    ));

    await onShiftsWorked({ userId: "user-1" });

    expect(notifiedBadgeNames()).toEqual([expect.stringContaining("Shift 3")]);
  });

  it("stays silent for a measured rule an added worker alone satisfied", async () => {
    // Two away events, both recorded as added workers: the away ladder is met, but
    // nothing on the schedule says so.
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);
    mockTx.eventWorker.findMany.mockResolvedValue([
      { ...addedWorker("away-1"), event: { ...addedWorker("away-1").event, site: "AWAY", isHome: false } },
      { ...addedWorker("away-2"), event: { ...addedWorker("away-2").event, site: "AWAY", isHome: false } },
    ]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: { category?: string } }) => (
      where.category === "MILESTONE"
        ? [{ id: "away-2", name: "Road Warrior", ruleKey: "shift_away_completed", threshold: 2 }]
        : []
    ));

    await onShiftsWorked({ userId: "user-1" });

    const awarded = mockTx.studentBadge.createManyAndReturn.mock.calls
      .flatMap((call: unknown[]) => (call[0] as { data: Array<{ definitionId: string }> }).data.map((row) => row.definitionId));
    expect(awarded).toEqual(["away-2"]);
    expect(notifiedBadgeNames()).toEqual([]);
  });

  it("keeps the silence durable rather than deferring it to the next pass", async () => {
    // The award row exists after the silent grant, so the nightly re-run
    // inserts nothing and therefore cannot notify late.
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);
    mockTx.eventWorker.findMany.mockResolvedValue([addedWorker("added-event-1")]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: { category?: string } }) => (
      where.category === "SHIFT" ? [{ id: "first-shift", name: "First Shift", threshold: 1 }] : []
    ));

    await onShiftsWorked({ userId: "user-1" });
    expect(notifiedBadgeNames()).toEqual([]);

    // Second pass: the row already exists, so nothing is returned as inserted.
    mockTx.studentBadge.createManyAndReturn.mockResolvedValue([]);
    await onShiftsWorked({ userId: "user-1" });
    expect(notifiedBadgeNames()).toEqual([]);
  });
});

describe("badge evaluator shift work", () => {
  it("awards shift badges from assignments to events that have ended", async () => {
    mockTx.shiftAssignment.findMany.mockResolvedValue(Array.from({ length: 10 }, () => ({
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        startsAt: new Date("2026-08-10T15:00:00.000Z"),
        endsAt: new Date("2026-08-10T19:00:00.000Z"),
        callStartsAt: null,
        callEndsAt: null,
        area: "VIDEO",
        shiftGroup: { event: { isHome: true, sportCode: "MBB" } },
      },
    })));
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }) => (
      where.category === "SHIFT" ? [{ id: "first-shift" }, { id: "shift-10" }] : []
    ));

    await onShiftsWorked({ userId: "user-1" });

    expect(mockTx.badgeDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          category: "SHIFT",
          trigger: "shift:completed",
          threshold: { not: null, lte: 10 },
        }),
      }),
    );
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", definitionId: "first-shift" },
        { userId: "user-1", definitionId: "shift-10" },
      ],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("counts archived events too", async () => {
    // `morning-refresh` stamps archivedAt on events older than four months as
    // list hygiene. Excluding them would make a worked-shift total fall over
    // time and strand someone below a threshold they had already passed.
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);
    mockTx.badgeDefinition.findMany.mockResolvedValue([]);

    await onShiftsWorked({ userId: "user-1" });

    const where = mockTx.shiftAssignment.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toBeDefined();
    expect(JSON.stringify(where)).not.toContain("archivedAt");
  });

  it("is safe to re-run nightly forever", async () => {
    // There is no sourceKey to dedupe on. Idempotency comes from counting the
    // database and writing with skipDuplicates, so a second pass over the same
    // shifts asks for exactly the same rows and changes nothing.
    mockTx.shiftAssignment.findMany.mockResolvedValue(Array.from({ length: 10 }, () => ({
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        startsAt: new Date("2026-08-10T15:00:00.000Z"),
        endsAt: new Date("2026-08-10T19:00:00.000Z"),
        callStartsAt: null,
        callEndsAt: null,
        area: "VIDEO",
        shiftGroup: { event: { isHome: true, sportCode: "MBB" } },
      },
    })));
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }) => (
      where.category === "SHIFT" ? [{ id: "first-shift" }, { id: "shift-10" }] : []
    ));

    await onShiftsWorked({ userId: "user-1" });
    await onShiftsWorked({ userId: "user-1" });

    const [first, second] = mockTx.studentBadge.createManyAndReturn.mock.calls;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).toEqual(first);
    expect(first?.[0]?.skipDuplicates).toBe(true);
  });

  it("awards away and early-call badges from completed shift data", async () => {
    process.env.APP_TIMEZONE = "America/Chicago";
    mockTx.shiftAssignment.findMany.mockResolvedValue([
      {
        callStartsAt: new Date("2026-08-10T10:30:00.000Z"),
        callEndsAt: null,
        shift: {
          startsAt: new Date("2026-08-10T13:00:00.000Z"),
          endsAt: new Date("2026-08-10T17:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "VIDEO",
          shiftGroup: { event: { isHome: false, sportCode: "MBB" } },
        },
      },
      {
        callStartsAt: new Date("2026-08-11T11:15:00.000Z"),
        callEndsAt: null,
        shift: {
          startsAt: new Date("2026-08-11T13:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "VIDEO",
          shiftGroup: { event: { isHome: false, sportCode: "MBB" } },
        },
      },
      {
        callStartsAt: new Date("2026-08-12T13:00:00.000Z"),
        callEndsAt: null,
        shift: {
          startsAt: new Date("2026-08-12T14:00:00.000Z"),
          endsAt: new Date("2026-08-12T17:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "VIDEO",
          shiftGroup: { event: { isHome: false, sportCode: "MBB" } },
        },
      },
    ]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }) => {
      if (where.category === "SHIFT") return [];
      if (where.category === "MILESTONE") {
        return [
          { id: "road-tested", ruleKey: "shift_away_completed", threshold: 3 },
          { id: "before-sunrise", ruleKey: "shift_before_7", threshold: 2 },
        ];
      }
      return [];
    });

    await onShiftsWorked({ userId: "user-1" });

    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", definitionId: "road-tested" },
        { userId: "user-1", definitionId: "before-sunrise" },
      ],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("awards shift breadth badges from the same nightly pass", async () => {
    process.env.APP_TIMEZONE = "America/Chicago";
    mockTx.shiftAssignment.findMany.mockResolvedValue([
      {
        callStartsAt: null,
        callEndsAt: null,
        shift: {
          startsAt: new Date("2026-08-10T23:00:00.000Z"),
          endsAt: new Date("2026-08-11T03:30:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "VIDEO",
          shiftGroup: { event: { isHome: true, sportCode: "MBB" } },
        },
      },
      {
        callStartsAt: null,
        callEndsAt: null,
        shift: {
          startsAt: new Date("2026-08-11T02:00:00.000Z"),
          endsAt: new Date("2026-08-11T04:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "PHOTO",
          shiftGroup: { event: { isHome: true, sportCode: "WVB" } },
        },
      },
    ]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }) => {
      if (where.category === "MILESTONE") {
        return [
          { id: "season-pass", ruleKey: "shift_sports", threshold: 8 },
          { id: "utility-crew", ruleKey: "shift_areas", threshold: 2 },
          { id: "doubleheader", ruleKey: "shift_doubleheader_days", threshold: 1 },
          { id: "under-the-lights", ruleKey: "shift_after_22", threshold: 1 },
        ];
      }
      return [];
    });

    await onShiftsWorked({ userId: "user-1" });

    // Season Pass stays locked at two sports; the other three are met, and the
    // two shifts land on one local evening despite spanning two UTC days.
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", definitionId: "utility-crew" },
        { userId: "user-1", definitionId: "doubleheader" },
        { userId: "user-1", definitionId: "under-the-lights" },
      ],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });
});

describe("badge evaluator checkout events", () => {
  it("awards checkout threshold badges from opened checkout count", async () => {
    mockTx.badgeEventReceipt.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({ sourceKey: `booking-${index + 1}` })),
    );
    mockTx.badgeDefinition.findMany.mockResolvedValue([
      { id: "first-checkout" },
      { id: "checkout-5" },
    ]);

    await onCheckoutOpened({
      userId: "user-1",
      bookingId: "booking-1",
      source: "kiosk_checkout",
      sourceKey: "caller-key-is-not-authoritative",
    });

    expect(mockTx.badgeEventReceipt.createMany).toHaveBeenCalledWith({
      data: [{
        userId: "user-1",
        eventType: "checkout_opened",
        sourceKey: "booking-1",
      }],
      skipDuplicates: true,
    });
    expect(mockTx.badgeEventReceipt.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        eventType: "checkout_opened",
      },
      select: { sourceKey: true },
    });
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", definitionId: "first-checkout" },
        { userId: "user-1", definitionId: "checkout-5" },
      ],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("counts serialized and bulk inventory toward category breadth", async () => {
    mockTx.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date("2026-08-10T18:00:00.000Z"),
        kitId: null,
        serializedItems: [{
          assetId: "asset-1",
          asset: { category: { id: "camera", name: "Cameras", parent: null } },
        }],
        bulkItems: [{
          checkedOutQuantity: 1,
          bulkSku: { categoryRel: { id: "audio", name: "Audio", parent: null } },
        }],
      },
    ]);
    mockTx.badgeDefinition.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "category-collector", ruleKey: "category_collector", threshold: 2 }]);

    await onCheckoutOpened({
      userId: "user-1",
      bookingId: "booking-1",
      source: "kiosk_checkout",
      sourceKey: "booking-1",
    });

    expect(mockTx.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        startsAt: true,
        kitId: true,
        eventId: true,
        sourceReservationId: true,
        shiftAssignmentId: true,
        events: { select: { eventId: true } },
        serializedItems: {
          select: {
            assetId: true,
            asset: {
              select: {
                category: { select: { id: true, name: true, parent: { select: { name: true } } } },
              },
            },
          },
        },
        bulkItems: {
          select: {
            checkedOutQuantity: true,
            bulkSku: {
              select: {
                categoryRel: { select: { id: true, name: true, parent: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }));
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ userId: "user-1", definitionId: "category-collector" }],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("awards automatic checkout challenges from the credited checkout contents", async () => {
    mockTx.badgeEventReceipt.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({ sourceKey: `booking-${index + 1}` })),
    );
    mockTx.booking.findMany.mockResolvedValue(Array.from({ length: 10 }, (_, bookingIndex) => {
      const categories = [
        { id: `battery-${bookingIndex}`, name: "Batteries" },
        { id: `lens-${bookingIndex}`, name: "Lenses" },
        ...(bookingIndex < 5 ? [{ id: `camera-${bookingIndex}`, name: "Cameras" }] : []),
        ...(bookingIndex < 5 ? [{ id: `audio-${bookingIndex}`, name: "Audio" }] : []),
        ...(bookingIndex < 3 ? [{ id: `tripod-${bookingIndex}`, name: "Tripods" }] : []),
        ...(bookingIndex < 2 ? [{ id: `light-${bookingIndex}`, name: "Lighting" }] : []),
      ];
      const serializedItems = categories.map((category) => ({
        assetId: `asset-${category.id}`,
        asset: { category: { ...category, parent: null } },
      }));
      if (bookingIndex === 0) {
        serializedItems.push(...Array.from({ length: 10 }, (_, itemIndex) => ({
          assetId: `asset-battery-extra-${itemIndex}`,
          asset: {
            category: {
              id: `battery-extra-${itemIndex}`,
              name: "Batteries",
              parent: null,
            },
          },
        })));
      }
      return {
        startsAt: new Date(Date.UTC(2026, 7, 10 + bookingIndex, 18)),
        kitId: null,
        serializedItems,
        bulkItems: [],
      };
    }));
    mockTx.badgeDefinition.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "power-player", ruleKey: "checkout_family_batteries", threshold: 10 },
        { id: "glass-class", ruleKey: "checkout_family_lenses", threshold: 10 },
        { id: "sound-check", ruleKey: "checkout_family_audio", threshold: 5 },
        { id: "rock-solid", ruleKey: "checkout_support", threshold: 3 },
        { id: "bright-spark", ruleKey: "checkout_family_lighting", threshold: 2 },
        { id: "kitchen-sink", ruleKey: "checkout_families_5", threshold: 1 },
        { id: "three-piece-suit", ruleKey: "checkout_full_rig", threshold: 3 },
        { id: "heavy-lifter", ruleKey: "checkout_items_15", threshold: 1 },
      ]);

    await onCheckoutOpened({
      userId: "user-1",
      bookingId: "booking-1",
      source: "kiosk_checkout",
      sourceKey: "booking-1",
    });

    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", definitionId: "power-player" },
        { userId: "user-1", definitionId: "glass-class" },
        { userId: "user-1", definitionId: "sound-check" },
        { userId: "user-1", definitionId: "rock-solid" },
        { userId: "user-1", definitionId: "bright-spark" },
        { userId: "user-1", definitionId: "kitchen-sink" },
        { userId: "user-1", definitionId: "three-piece-suit" },
        { userId: "user-1", definitionId: "heavy-lifter" },
      ],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("awards on-time count and streak badges once per source key", async () => {
    const now = new Date("2026-05-09T18:00:00.000Z");
    mockTx.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date("2026-05-09T15:00:00.000Z"),
        endsAt: new Date("2026-05-09T17:50:00.000Z"),
        updatedAt: now,
        completedAt: now,
        checkinReports: [],
      },
      {
        startsAt: new Date("2026-05-08T15:00:00.000Z"),
        endsAt: new Date("2026-05-08T18:00:00.000Z"),
        updatedAt: new Date("2026-05-08T18:20:00.000Z"),
        completedAt: new Date("2026-05-08T18:20:00.000Z"),
        checkinReports: [],
      },
    ]);
    // Keyed off the query rather than call order: `onCheckoutReturned` now runs
    // three award lanes -- on-time count, damage-free count, and the streak --
    // and an ordered mock queue silently mis-assigns them.
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.ruleKey === "on_time_return") return [{ id: "on-time-1" }];
      if (where.ruleKey === "on_time_return_streak") return [{ id: "streak-5" }];
      return [];
    });
    mockTx.booking.count.mockResolvedValue(0);
    mockTx.badgeStreak.findUnique.mockResolvedValue({
      current: 4,
      longest: 4,
      lastSourceKey: "older-booking",
    });

    await onCheckoutReturned({
      userId: "user-1",
      bookingId: "booking-1",
      completedAt: now,
      wasOnTime: true,
      sourceKey: "booking-1",
    });

    expect(mockTx.badgeStreak.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_streakType: {
            userId: "user-1",
            streakType: BadgeStreakType.ON_TIME_RETURN,
          },
        },
        update: expect.objectContaining({
          current: 5,
          longest: 5,
          lastSourceKey: "booking-1",
        }),
      }),
    );
    // The on-time badge and the streak badge, each written once.
    const written = mockTx.studentBadge.createManyAndReturn.mock.calls.flatMap(
      (call) => {
        const request = call[0] as { data?: Array<{ definitionId: string }> } | undefined;
        return request?.data?.map((row) => row.definitionId) ?? [];
      },
    );
    expect(written).toEqual(["on-time-1", "streak-5"]);
  });

  it("does not increment the on-time streak twice for the same source key", async () => {
    mockTx.badgeEventReceipt.createMany.mockResolvedValue({ count: 0 });
    mockTx.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date("2026-05-09T15:00:00.000Z"),
        endsAt: new Date("2026-05-09T18:00:00.000Z"),
        updatedAt: new Date("2026-05-09T18:01:00.000Z"),
        completedAt: new Date("2026-05-09T18:01:00.000Z"),
        checkinReports: [],
      },
    ]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
      where.ruleKey === "on_time_return" ? [{ id: "on-time-1" }] : []
    ));
    mockTx.booking.count.mockResolvedValue(0);
    mockTx.badgeStreak.findUnique.mockResolvedValue({
      current: 1,
      longest: 1,
      lastSourceKey: "booking-1",
    });

    await onCheckoutReturned({
      userId: "user-1",
      bookingId: "booking-1",
      completedAt: new Date("2026-05-09T18:01:00.000Z"),
      wasOnTime: true,
      sourceKey: "booking-1",
    });

    expect(mockTx.badgeStreak.upsert).not.toHaveBeenCalled();
    // No streak lane ran, so no streak badge was ever looked up.
    const ruleKeys = mockTx.badgeDefinition.findMany.mock.calls.map(
      (call) => {
        const request = call[0] as { where?: { ruleKey?: string } } | undefined;
        return request?.where?.ruleKey;
      },
    );
    expect(ruleKeys).not.toContain("on_time_return_streak");
  });

  it("ignores a delayed duplicate even after another source became the latest streak event", async () => {
    mockTx.badgeEventReceipt.createMany.mockResolvedValue({ count: 0 });
    mockTx.badgeStreak.findUnique.mockResolvedValue({
      current: 7,
      longest: 7,
      lastSourceKey: "newer-booking",
    });

    await onCheckoutReturned({
      userId: "user-1",
      bookingId: "older-booking",
      completedAt: new Date("2026-05-08T18:00:00.000Z"),
      wasOnTime: true,
      sourceKey: "older-booking",
    });

    expect(mockTx.badgeEventReceipt.createMany).toHaveBeenCalledWith({
      data: [{
        userId: "user-1",
        eventType: "checkout_returned",
        sourceKey: "older-booking",
      }],
      skipDuplicates: true,
    });
    expect(mockTx.booking.count).not.toHaveBeenCalled();
    expect(mockTx.badgeStreak.findUnique).not.toHaveBeenCalled();
    expect(mockTx.badgeStreak.upsert).not.toHaveBeenCalled();
  });

  it("counts on-time returns from completedAt even when later edits move updatedAt", async () => {
    mockTx.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date("2026-05-09T15:00:00.000Z"),
        endsAt: new Date("2026-05-09T18:00:00.000Z"),
        completedAt: new Date("2026-05-09T18:05:00.000Z"),
        updatedAt: new Date("2026-05-10T12:00:00.000Z"),
        checkinReports: [],
      },
      {
        startsAt: new Date("2026-05-08T15:00:00.000Z"),
        endsAt: new Date("2026-05-08T18:00:00.000Z"),
        completedAt: null,
        updatedAt: new Date("2026-05-08T18:05:00.000Z"),
        checkinReports: [],
      },
    ]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }) => {
      if (where.ruleKey === "on_time_return") {
        expect(where.threshold?.lte).toBe(2);
        return [{ id: "on-time-2" }];
      }
      return [];
    });
    mockTx.badgeStreak.findUnique.mockResolvedValue(null);

    await onCheckoutReturned({
      userId: "user-1",
      bookingId: "booking-1",
      completedAt: new Date("2026-05-09T18:05:00.000Z"),
      wasOnTime: true,
      sourceKey: "booking-1",
    });

    expect(mockTx.booking.findMany).toHaveBeenCalledWith({
      where: {
        requesterUserId: "user-1",
        kind: "CHECKOUT",
        status: "COMPLETED",
      },
      select: {
        startsAt: true,
        endsAt: true,
        updatedAt: true,
        completedAt: true,
        checkinReports: { select: { id: true, type: true } },
        dueDateChanges: { select: { id: true }, take: 1 },
      },
    });
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ userId: "user-1", definitionId: "on-time-2" }],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("resets the on-time streak on a late return", async () => {
    mockTx.booking.count.mockResolvedValue(0);
    mockTx.badgeDefinition.findMany.mockResolvedValue([]);
    mockTx.badgeStreak.findUnique.mockResolvedValue({
      current: 3,
      longest: 4,
      lastSourceKey: "older-booking",
    });

    await onCheckoutReturned({
      userId: "user-1",
      bookingId: "booking-1",
      completedAt: new Date("2026-05-09T19:00:00.000Z"),
      wasOnTime: false,
      sourceKey: "booking-1",
    });

    expect(mockTx.badgeStreak.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          current: 0,
          lastSourceKey: "booking-1",
        }),
      }),
    );
    expect(mockTx.studentBadge.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("awards damage-free badges for late clean returns", async () => {
    mockTx.booking.count.mockResolvedValue(10);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
      where.ruleKey === "damage_free_return" ? [{ id: "damage-free-10" }] : []
    ));

    await onCheckoutReturned({
      userId: "user-1",
      bookingId: "booking-1",
      completedAt: new Date("2026-05-09T19:00:00.000Z"),
      wasOnTime: false,
      sourceKey: "booking-1",
    });

    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ userId: "user-1", definitionId: "damage-free-10" }],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
    expect(mockTx.badgeStreak.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ current: 0 }),
      }),
    );
  });

  it("awards trade threshold badges from completed trade count", async () => {
    // The ladder reads the row count. Short-notice cover needs the rows
    // themselves, so the evaluator fetches once instead of counting.
    mockTx.shiftTrade.findMany.mockResolvedValue(Array.from({ length: 10 }, () => ({
      claimedByUserId: "user-2",
      claimedAt: new Date("2026-08-01T12:00:00.000Z"),
      shiftAssignment: { shift: { startsAt: new Date("2026-08-10T18:00:00.000Z") } },
    })));
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
      where.category === "TRADE" ? [{ id: "trade-10" }] : []
    ));

    await onTradeCompleted({
      userId: "user-1",
      tradeId: "trade-1",
      sourceKey: "trade-1",
    });

    expect(mockTx.shiftTrade.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: "COMPLETED",
        OR: [
          { postedByUserId: "user-1" },
          { claimedByUserId: "user-1" },
        ],
      },
    }));
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ userId: "user-1", definitionId: "trade-10" }],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("awards short-notice cover to the person who claimed the trade", async () => {
    mockTx.shiftTrade.findMany.mockResolvedValue([
      {
        claimedByUserId: "user-1",
        claimedAt: new Date("2026-08-10T12:00:00.000Z"),
        shiftAssignment: { shift: { startsAt: new Date("2026-08-10T18:00:00.000Z") } },
      },
      {
        claimedByUserId: "user-1",
        claimedAt: new Date("2026-08-11T12:00:00.000Z"),
        shiftAssignment: { shift: { startsAt: new Date("2026-08-11T18:00:00.000Z") } },
      },
      {
        claimedByUserId: "user-1",
        claimedAt: new Date("2026-08-12T12:00:00.000Z"),
        shiftAssignment: { shift: { startsAt: new Date("2026-08-12T18:00:00.000Z") } },
      },
    ]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
      where.category === "MILESTONE"
        ? [{ id: "short-notice", ruleKey: "trade_short_notice", threshold: 3 }]
        : []
    ));

    await onTradeCompleted({
      userId: "user-1",
      tradeId: "trade-1",
      sourceKey: "trade-1",
    });

    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ userId: "user-1", definitionId: "short-notice" }],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("awards the hidden 2 a.m. app-open rule from server time", async () => {
    process.env.APP_TIMEZONE = "America/Chicago";
    mockTx.badgeDefinition.findMany.mockResolvedValue([{ id: "go-to-bed" }]);

    await onAppOpened({
      userId: "user-1",
      occurredAt: new Date("2026-08-10T07:30:00.000Z"),
    });

    expect(mockTx.badgeEventReceipt.createMany).toHaveBeenCalledWith({
      data: [{
        userId: "user-1",
        eventType: "app_opened",
        sourceKey: "local-hour-2:2026-08-10",
      }],
      skipDuplicates: true,
    });
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ userId: "user-1", definitionId: "go-to-bed" }],
      skipDuplicates: true,
      select: { id: true, definitionId: true },
    });
  });

  it("evaluates midnight, weekend, and leap-day app-open rules independently", async () => {
    process.env.APP_TIMEZONE = "America/Chicago";

    await onAppOpened({
      userId: "user-1",
      // Sunday, February 27, 2028 at 12:30 a.m. Central.
      occurredAt: new Date("2028-02-27T06:30:00.000Z"),
    });
    await onAppOpened({
      userId: "user-1",
      // Tuesday, February 29, 2028 at 12:30 a.m. Central.
      occurredAt: new Date("2028-02-29T06:30:00.000Z"),
    });

    const receiptKeys = mockTx.badgeEventReceipt.createMany.mock.calls
      .map((call) => (call[0] as { data: Array<{ sourceKey: string }> }).data[0]?.sourceKey);
    expect(receiptKeys).toEqual([
      "local-hour-0:2028-02-27",
      "local-weekend:2028-02-27",
      "local-hour-0:2028-02-29",
      "local-leap-day:2028-02-29",
    ]);
  });
});

describe("badge evaluator serialization retry", () => {
  beforeEach(() => {
    mockTx.booking.count.mockResolvedValue(0);
    mockTx.badgeDefinition.findMany.mockResolvedValue([]);
  });

  // REGRESSION: the retry check matched only Prisma's P2034, so the raw 40001
  // driver code the Neon adapter can surface was never retried.
  it("retries a raw 40001 serialization conflict", async () => {
    dbMock.$transaction.mockRejectedValueOnce({ code: "40001" });

    await onCheckoutOpened({ userId: "user-1", bookingId: "booking-1", source: "kiosk_checkout", sourceKey: "checkout-1" });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it("still retries the Prisma P2034 shape", async () => {
    dbMock.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("write conflict", {
        code: "P2034",
        clientVersion: "test",
      }),
    );

    await onCheckoutOpened({ userId: "user-1", bookingId: "booking-1", source: "kiosk_checkout", sourceKey: "checkout-1" });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unrelated failure", async () => {
    dbMock.$transaction.mockRejectedValueOnce(new Error("boom"));

    await expect(onCheckoutOpened({ userId: "user-1", bookingId: "booking-1", source: "kiosk_checkout", sourceKey: "checkout-1" }))
      .rejects.toThrow("boom");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("badge earned notifications", () => {
  /**
   * Automatic awards used to be silent: only `awardBadgeManually` wrote a
   * `badge_awarded` row, so the badges that took the most work were the ones
   * that left no durable record. The nightly shift pass and any return
   * completed at a shared kiosk are exactly the moments nobody is holding
   * their phone to catch the popup.
   */
  it("tells the user about a badge they just earned automatically", async () => {
    mockTx.badgeEventReceipt.findMany.mockResolvedValue([
      { sourceKey: "booking-1" },
      { sourceKey: "booking-2" },
    ]);
    mockTx.booking.findMany.mockResolvedValue([]);
    mockTx.badgeDefinition.findMany.mockImplementation(async ({ where }) => (
      where.trigger === "checkout:opened" && where.threshold
        ? [{ id: "checkout-2", name: "Getting the Hang of It" }]
        : []
    ));
    mockTx.studentBadge.createManyAndReturn.mockResolvedValue([
      { id: "award-77", definitionId: "checkout-2" },
    ]);

    await onCheckoutOpened({ userId: "user-1", bookingId: "booking-2", source: "kiosk_checkout", sourceKey: "booking-2" });

    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "user-1",
          type: "badge_awarded",
          title: "Badge earned",
          body: "You earned Getting the Hang of It.",
          channel: "IN_APP",
          dedupeKey: "badge_awarded_award-77",
          payload: expect.objectContaining({
            studentBadgeId: "award-77",
            badgeDefinitionId: "checkout-2",
            href: "/users/user-1?tab=badges",
          }),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("stays quiet when the event awarded nothing new", async () => {
    mockTx.badgeEventReceipt.findMany.mockResolvedValue([{ sourceKey: "booking-1" }]);
    mockTx.booking.findMany.mockResolvedValue([]);
    mockTx.badgeDefinition.findMany.mockResolvedValue([{ id: "checkout-1", name: "First Checkout" }]);
    // The award row already existed, so `createManyAndReturn` inserts nothing.
    // A replayed event must not re-notify.
    mockTx.studentBadge.createManyAndReturn.mockResolvedValue([]);

    await onCheckoutOpened({ userId: "user-1", bookingId: "booking-1", source: "kiosk_checkout", sourceKey: "booking-1" });

    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
    expect(mockTx.user.findUnique).not.toHaveBeenCalled();
  });

  it("respects a user who turned badge notifications off", async () => {
    mockTx.badgeEventReceipt.findMany.mockResolvedValue([{ sourceKey: "booking-1" }]);
    mockTx.booking.findMany.mockResolvedValue([]);
    mockTx.badgeDefinition.findMany.mockResolvedValue([{ id: "checkout-1", name: "First Checkout" }]);
    mockTx.studentBadge.createManyAndReturn.mockResolvedValue([
      { id: "award-1", definitionId: "checkout-1" },
    ]);
    mockTx.user.findUnique.mockResolvedValue({ notificationPrefs: { badges: false } });

    await onCheckoutOpened({ userId: "user-1", bookingId: "booking-1", source: "kiosk_checkout", sourceKey: "booking-1" });

    // The award still lands; only the telling is suppressed.
    expect(mockTx.studentBadge.createManyAndReturn).toHaveBeenCalled();
    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
  });
});
