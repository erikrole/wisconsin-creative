import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  withKiosk:
    (handler: (req: Request, ctx: { kiosk: { locationId: string } }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { kiosk: { locationId: "loc-1" } }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    calendarEvent: { count: vi.fn(), findMany: vi.fn() },
    booking: { count: vi.fn(), findMany: vi.fn() },
    bookingSerializedItem: { findMany: vi.fn() },
    bookingBulkUnitAllocation: { findMany: vi.fn() },
    notification: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { db } from "@/lib/db";
import { GET } from "@/app/api/kiosk/dashboard/route";

const mockDb = db as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  calendarEvent: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  booking: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  bookingSerializedItem: { findMany: ReturnType<typeof vi.fn> };
  bookingBulkUnitAllocation: { findMany: ReturnType<typeof vi.fn> };
};

/**
 * The OPEN-checkout list query gets `rows`; the upcoming query (startsAt.gte)
 * gets `upcoming`; the pickups query gets `pickups`.
 */
function mockOpenCheckouts(rows: unknown[], pickups: unknown[] = [], upcoming: unknown[] = []) {
  mockDb.booking.findMany.mockImplementation(
    async (args: { where?: { status?: unknown; startsAt?: { gte?: unknown } } }) =>
      args?.where?.status === "OPEN" ? rows : args?.where?.startsAt?.gte ? upcoming : pickups,
  );
}

function request() {
  return new Request("https://app.example.com/api/kiosk/dashboard");
}

describe("kiosk dashboard route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb.calendarEvent.count.mockResolvedValue(0);
    mockDb.booking.count.mockResolvedValue(0);
    mockDb.bookingSerializedItem.findMany.mockResolvedValue([]);
    mockDb.bookingBulkUnitAllocation.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns kiosk dashboard data when every section succeeds", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 4n, checkouts: 2n, overdue: 1n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        summary: "Lambeau Field Visit",
        sportCode: "FB",
        startsAt: new Date("2026-06-17T05:00:00.000Z"),
        endsAt: new Date("2026-06-18T05:00:00.000Z"),
        allDay: false,
        shiftGroup: {
          _count: { shifts: 3 },
          shifts: [{
            area: "Video",
            startsAt: new Date("2026-06-17T13:00:00.000Z"),
            endsAt: new Date("2026-06-18T00:00:00.000Z"),
            callStartsAt: new Date("2026-06-17T13:00:00.000Z"),
            callEndsAt: new Date("2026-06-18T00:00:00.000Z"),
            assignments: [{
              user: { id: "user-1", name: "Erik Role", avatarUrl: null },
            }],
          }],
        },
      },
    ]);
    mockDb.bookingSerializedItem.findMany.mockResolvedValue([
      {
        asset: { id: "asset-1", assetTag: "CAM-1", name: "FX3", imageUrl: null },
        booking: {
          id: "booking-1",
          title: "Camera Kit",
          endsAt: new Date("2026-05-13T12:00:00.000Z"),
          requester: { name: "Bucky Badger" },
        },
      },
    ]);
    mockOpenCheckouts([
      {
        id: "booking-1",
        title: "Camera Kit",
        endsAt: new Date("2026-05-13T12:00:00.000Z"),
        requester: { id: "user-1", name: "Bucky Badger", avatarUrl: null },
        serializedItems: [{ asset: { assetTag: "CAM-1", name: "FX3" } }],
        bulkItems: [],
        _count: { serializedItems: 1 },
      },
    ]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stats).toEqual({ itemsOut: 4, checkouts: 2, overdue: 1 });
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toEqual(expect.objectContaining({
      title: "Lambeau Field Visit",
      allDay: true,
      callStartsAt: null,
      callEndsAt: null,
    }));
    expect(body.events[0].assignedUsers[0]).toEqual(expect.objectContaining({
      name: "Erik Role",
      callStartsAt: null,
      callEndsAt: null,
    }));
    expect(body.activeItems).toEqual([
      expect.objectContaining({
        id: "asset-1",
        name: "FX3",
        tagName: "CAM-1",
      }),
    ]);
    expect(body.checkouts).toHaveLength(1);
    expect(body.partialFailures).toEqual([]);
    expect(mockDb.bookingSerializedItem.findMany.mock.calls[0]?.[0]?.where.booking)
      .not.toHaveProperty("locationId");
    expect(mockDb.bookingBulkUnitAllocation.findMany.mock.calls[0]?.[0]?.where.bookingBulkItem.booking)
      .not.toHaveProperty("locationId");
    expect(mockDb.booking.findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty("locationId");
    expect(mockDb.bookingSerializedItem.findMany.mock.calls[0]?.[0]).not.toHaveProperty("take");
    expect(mockDb.bookingBulkUnitAllocation.findMany.mock.calls[0]?.[0]).not.toHaveProperty("take");
    expect(mockDb.booking.findMany.mock.calls[0]?.[0]).not.toHaveProperty("take");
  });

  it("counts and displays active numbered bulk units on the kiosk dashboard", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 1n, checkouts: 1n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockDb.bookingBulkUnitAllocation.findMany.mockResolvedValue([
      {
        bulkSkuUnit: {
          id: "unit-31",
          unitNumber: 31,
          bulkSku: { name: "Sony Battery", imageUrl: null },
        },
        bookingBulkItem: {
          booking: {
            id: "booking-1",
            title: "Kiosk Checkout",
            endsAt: new Date("2026-05-13T12:00:00.000Z"),
            requester: { name: "Bucky Badger" },
          },
        },
      },
    ]);
    mockOpenCheckouts([
      {
        id: "booking-1",
        title: "Kiosk Checkout",
        endsAt: new Date("2026-05-13T12:00:00.000Z"),
        requester: { id: "user-1", name: "Bucky Badger", avatarUrl: null },
        serializedItems: [],
        bulkItems: [{
          checkedOutQuantity: 1,
          checkedInQuantity: 0,
          bulkSku: { name: "Sony Battery", imageUrl: "https://example.com/battery.png" },
          unitAllocations: [{ bulkSkuUnit: { unitNumber: 31 } }],
        }],
        _count: { serializedItems: 0 },
      },
    ]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stats).toEqual({ itemsOut: 1, checkouts: 1, overdue: 0 });
    expect(body.activeItems).toEqual([
      expect.objectContaining({
        id: "unit-31",
        name: "Sony Battery #31",
        tagName: "#31",
        checkoutId: "booking-1",
      }),
    ]);
    expect(body.checkouts).toEqual([
      expect.objectContaining({
        id: "booking-1",
        itemCount: 1,
        items: [{ name: "Sony Battery #31", tagName: "Sony Battery", imageUrl: "https://example.com/battery.png" }],
      }),
    ]);
    expect(body.partialFailures).toEqual([]);
  });

  it("counts crew with a reservation for a later event as having gear, in one batched read", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 0n, checkouts: 0n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([{
      id: "event-tomorrow",
      summary: "Volleyball vs Minnesota",
      sportCode: "WVB",
      startsAt: new Date(Date.now() + 30 * 3_600_000),
      endsAt: new Date(Date.now() + 33 * 3_600_000),
      allDay: false,
      shiftGroup: {
        _count: { shifts: 1 },
        shifts: [{
          area: "Video",
          startsAt: new Date(Date.now() + 30 * 3_600_000),
          endsAt: new Date(Date.now() + 33 * 3_600_000),
          callStartsAt: null,
          callEndsAt: null,
          assignments: [
            { id: "asg-2", user: { id: "user-2", name: "Reserved Person", avatarUrl: null } },
            { id: "asg-3", user: { id: "user-3", name: "No Gear", avatarUrl: null } },
          ],
        }],
      },
    }]);
    const reservationQueries: unknown[] = [];
    mockDb.booking.findMany.mockImplementation(async (args: { where?: { status?: unknown; AND?: unknown } }) => {
      if (args?.where?.status === "OPEN") return [];
      if (args?.where?.AND) {
        reservationQueries.push(args.where);
        return [{ requesterUserId: "user-2", eventId: null, shiftAssignmentId: null, events: [{ eventId: "event-tomorrow" }] }];
      }
      return [];
    });

    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();

    expect(reservationQueries).toHaveLength(1);
    expect(body.events[0].crewWithoutGear.map((user: { id: string }) => user.id)).toEqual(["user-3"]);
  });

  it("leaves reported-missing bulk out of what a checkout still has out", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 1n, checkouts: 1n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockDb.bookingBulkUnitAllocation.findMany.mockResolvedValue([]);
    mockOpenCheckouts([
      {
        id: "booking-1",
        title: "Kiosk Checkout",
        endsAt: new Date("2026-05-13T12:00:00.000Z"),
        requester: { id: "user-1", name: "Bucky Badger", avatarUrl: null },
        serializedItems: [],
        bulkItems: [
          {
            // #31 still out; #32 reported missing closed its allocation
            // without counting as checked in.
            id: "bi-bat",
            checkedOutQuantity: 2,
            checkedInQuantity: 0,
            bulkSku: { id: "sku-bat", name: "Sony Battery", imageUrl: null },
            unitAllocations: [{ bulkSkuUnit: { unitNumber: 31 } }],
            _count: { unitAllocations: 1 },
          },
          {
            // 5 out, 1 back, 2 reported missing: 2 still out.
            id: "bi-cable",
            checkedOutQuantity: 5,
            checkedInQuantity: 1,
            bulkSku: { id: "sku-cable", name: "XLR Cable", imageUrl: null },
            unitAllocations: [],
            _count: { unitAllocations: 0 },
          },
        ],
        checkinReports: [
          { bulkSkuId: null, quantity: null, bulkSkuUnit: { bulkSkuId: "sku-bat" } },
          { bulkSkuId: "sku-cable", quantity: 2, bulkSkuUnit: null },
        ],
        _count: { serializedItems: 0 },
      },
    ]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(body.checkouts[0]).toMatchObject({
      itemCount: 3,
      items: [
        { name: "Sony Battery #31", tagName: "Sony Battery", imageUrl: null },
        { name: "XLR Cable x2", tagName: "XLR Cable", imageUrl: null },
      ],
    });
    expect(body.activeItems.map((item: { name: string }) => item.name)).toEqual(["XLR Cable x2"]);
  });

  it("corrects legacy team abbreviation casing in kiosk display projections", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 1n, checkouts: 1n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([{
      id: "event-1",
      summary: "Women's Soccer vs Tcu",
      sportCode: "WSOC",
      startsAt: new Date("2026-06-17T05:00:00.000Z"),
      endsAt: new Date("2026-06-17T08:00:00.000Z"),
      allDay: false,
      shiftGroup: null,
    }]);
    mockDb.bookingSerializedItem.findMany.mockResolvedValue([{
      asset: { id: "asset-1", assetTag: "CAM-1", name: "FX3", imageUrl: null },
      booking: {
        id: "booking-1",
        title: "Women's Soccer vs Usc",
        endsAt: new Date("2026-06-17T12:00:00.000Z"),
        requester: { name: "Bucky Badger" },
      },
    }]);
    mockOpenCheckouts([{
      id: "booking-1",
      title: "Women's Soccer vs Ucla",
      endsAt: new Date("2026-06-17T12:00:00.000Z"),
      requester: { id: "user-1", name: "Bucky Badger", avatarUrl: null },
      serializedItems: [],
      bulkItems: [],
      _count: { serializedItems: 0 },
    }]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(body.events[0].title).toBe("Women's Soccer vs TCU");
    expect(body.activeItems[0].checkoutTitle).toBe("Women's Soccer vs USC");
    expect(body.checkouts[0].title).toBe("Women's Soccer vs UCLA");
  });

  it("labels crew with their assignment-level call time before the shift call", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 0n, checkouts: 0n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([{
      id: "event-1",
      summary: "Volleyball",
      sportCode: "VB",
      startsAt: new Date("2026-06-17T18:00:00.000Z"),
      endsAt: new Date("2026-06-17T21:00:00.000Z"),
      allDay: false,
      shiftGroup: {
        _count: { shifts: 1 },
        shifts: [{
          area: "Video",
          startsAt: new Date("2026-06-17T17:00:00.000Z"),
          endsAt: new Date("2026-06-17T21:00:00.000Z"),
          callStartsAt: new Date("2026-06-17T16:00:00.000Z"),
          callEndsAt: null,
          assignments: [
            { id: "as-1", callStartsAt: new Date("2026-06-17T15:00:00.000Z"), user: { id: "user-1", name: "Erik Role", avatarUrl: null } },
            { id: "as-2", callStartsAt: null, user: { id: "user-2", name: "Bucky Badger", avatarUrl: null } },
          ],
        }],
      },
    }]);
    mockOpenCheckouts([]);

    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    const [override, inherited] = body.events[0].assignedUsers;
    expect(override.callStartsAt).toBe("2026-06-17T15:00:00.000Z");
    expect(inherited.callStartsAt).toBe("2026-06-17T16:00:00.000Z");
  });

  it("shows active bulk checkout quantity even when exact unit allocations are missing", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 8n, checkouts: 1n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockDb.bookingBulkUnitAllocation.findMany.mockResolvedValue([]);
    mockOpenCheckouts([
      {
        id: "booking-1",
        title: "Chris Hall checkout",
        endsAt: new Date("2026-06-29T23:00:00.000Z"),
        requester: { id: "user-chris", name: "Chris Hall", avatarUrl: null },
        serializedItems: [],
        bulkItems: [{
          id: "bulk-item-1",
          checkedOutQuantity: 8,
          checkedInQuantity: 0,
          bulkSku: { id: "sku-sony", name: "Sony Battery", imageUrl: null },
          unitAllocations: [],
        }],
        _count: { serializedItems: 0 },
      },
    ]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activeItems).toEqual([
      expect.objectContaining({
        id: "booking-1:bulk-item-1:bulk-quantity",
        name: "Sony Battery x8",
        tagName: "x8",
        bulkSkuId: "sku-sony",
        unitNumber: null,
        checkoutId: "booking-1",
        requesterName: "Chris Hall",
      }),
    ]);
    expect(body.checkouts).toEqual([
      expect.objectContaining({
        id: "booking-1",
        itemCount: 8,
        items: [{ name: "Sony Battery x8", tagName: "Sony Battery", imageUrl: null }],
      }),
    ]);
  });

  it("returns safe fallback sections when one dashboard query fails", async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error("stats failed"));
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockOpenCheckouts([]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stats).toEqual({ itemsOut: 0, checkouts: 0, overdue: 0 });
    expect(body.events).toEqual([]);
    expect(body.checkouts).toEqual([]);
    expect(body.partialFailures).toEqual(["stats"]);
  });

  it("uses the app timezone for night-hours standby", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T23:38:00.000Z")); // 6:38 PM Central during CDT
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 0n, checkouts: 0n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockOpenCheckouts([]);

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.standby).toEqual(expect.objectContaining({
      nightHours: false,
      reason: "idle_window",
    }));
  });

  it("adds home fields: pickups, event links, due today, people tiles, and next up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T18:00:00.000Z")); // 1:00 PM Central
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 1n, checkouts: 1n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockOpenCheckouts(
      [{
        id: "co-1",
        title: "Soccer",
        endsAt: new Date("2026-09-25T23:00:00.000Z"),
        custodyScope: "PERSON",
        eventId: null,
        shiftAssignmentId: null,
        events: [{ eventId: "event-9" }],
        requester: { id: "user-1", name: "Bucky Badger", avatarUrl: null },
        serializedItems: [],
        bulkItems: [],
        _count: { serializedItems: 1 },
      }],
      [{
        id: "rv-1",
        kind: "RESERVATION",
        title: "Volleyball",
        startsAt: new Date("2026-09-25T20:00:00.000Z"),
        custodyScope: "PERSON",
        eventId: null,
        events: [],
        requester: { id: "user-2", name: "Erik Role", avatarUrl: null },
        _count: { serializedItems: 2 },
        bulkItems: [],
      }],
    );

    const res = await GET(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(body.partialFailures).toEqual([]);
    expect(body.checkouts[0]).toMatchObject({ eventId: "event-9", isDueToday: true, isOverdue: false });
    expect(body.pickups).toEqual([expect.objectContaining({
      bookingId: "rv-1", itemCount: 2, readyAt: "2026-09-25T20:00:00.000Z",
      requester: expect.objectContaining({ id: "user-2", name: "Erik Role" }),
    })]);
    expect(body.today.map((t: { userId: string; reasons: string[] }) => [t.userId, t.reasons])).toEqual([
      ["user-2", ["pickup"]],
      ["user-1", ["return_due"]],
    ]);
    expect(body.nextUp).toEqual({ title: "Volleyball", at: "2026-09-25T20:00:00.000Z", kind: "pickup" });
    const pickupQuery = mockDb.booking.findMany.mock.calls
      .map((call) => call[0])
      .find((args) => Array.isArray(args.where?.OR));
    expect(pickupQuery.where.startsAt).toEqual({ lt: new Date("2026-09-26T05:00:00.000Z") });
  });

  it("reports a failed pickups read as a partial failure", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 0n, checkouts: 0n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockDb.booking.findMany.mockImplementation(async (args: { where?: { status?: unknown; startsAt?: { gte?: unknown } } }) => {
      if (args.where?.status === "OPEN" || args.where?.startsAt?.gte) return [];
      throw new Error("pickups failed");
    });

    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.pickups).toEqual([]);
    expect(body.partialFailures).toEqual(["pickups"]);
  });

  it("returns upcoming reservations from every location after today, in one batched query", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T15:00:00.000Z"));
    mockDb.$queryRaw.mockResolvedValue([{ items_out: 0n, checkouts: 0n, overdue: 0n }]);
    mockDb.calendarEvent.findMany.mockResolvedValue([]);
    mockOpenCheckouts([], [], [
      {
        id: "res-1",
        kind: "RESERVATION",
        title: "Hockey road trip",
        startsAt: new Date("2026-09-26T14:00:00.000Z"),
        endsAt: new Date("2026-09-28T02:00:00.000Z"),
        custodyScope: "PERSON",
        eventId: null,
        events: [],
        requester: { id: "u-1", name: "Ava Johnson", avatarUrl: "https://example.com/ava.png" },
        _count: { serializedItems: 3 },
        bulkItems: [{ plannedQuantity: 2, checkedOutQuantity: 0 }],
      },
      {
        id: "res-2",
        kind: "RESERVATION",
        title: "Shared studio kit",
        startsAt: new Date("2026-09-29T19:00:00.000Z"),
        endsAt: new Date("2026-09-29T23:00:00.000Z"),
        custodyScope: "SHARED",
        eventId: null,
        events: [],
        requester: { id: "u-2", name: "Ben Lee", avatarUrl: null },
        _count: { serializedItems: 1 },
        bulkItems: [],
      },
    ]);

    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.upcoming).toEqual([
      {
        id: "res-1",
        title: "Hockey road trip",
        startsAt: "2026-09-26T14:00:00.000Z",
        endsAt: "2026-09-28T02:00:00.000Z",
        itemCount: 5,
        custodyScope: "PERSON",
        requester: { id: "u-1", name: "Ava Johnson", avatarUrl: "https://example.com/ava.png", initials: "AJ" },
      },
      {
        id: "res-2",
        title: "Shared studio kit",
        startsAt: "2026-09-29T19:00:00.000Z",
        endsAt: "2026-09-29T23:00:00.000Z",
        itemCount: 1,
        custodyScope: "SHARED",
        requester: null,
      },
    ]);

    const upcomingQueries = mockDb.booking.findMany.mock.calls
      .map((call) => call[0])
      .filter((args) => args.where?.startsAt?.gte);
    expect(upcomingQueries).toHaveLength(1);
    const query = upcomingQueries[0];
    expect(query.where).toEqual({
      kind: "RESERVATION",
      status: "BOOKED",
      // D-032: no kiosk location filter. Chicago: today ends 2026-09-26 00:00 CDT;
      // the window ends 7 x 24h from now, matching the operator hub.
      startsAt: { gte: new Date("2026-09-26T05:00:00.000Z"), lte: new Date("2026-10-02T15:00:00.000Z") },
    });
    expect(query.orderBy).toEqual({ startsAt: "asc" });
    expect(query.take).toBe(8);
    expect(query.select.requester).toEqual({ select: { id: true, name: true, avatarUrl: true } });
  });
});
