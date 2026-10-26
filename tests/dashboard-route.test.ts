import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    booking: { findMany: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    checkinItemReport: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    bulkSkuUnit: { groupBy: vi.fn(), findMany: vi.fn() },
    bulkSku: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/services/dashboard-counts", () => ({
  readDashboardCounts: vi.fn(),
  zeroDashboardCounts: {
    teamCheckoutsTotal: 0,
    teamCheckoutsOverdue: 0,
    teamReservationsTotal: 0,
    myCheckoutsTotal: 0,
    myOverdue: 0,
    myDueToday: 0,
    totalCheckedOut: 0,
    totalOverdue: 0,
    totalReserved: 0,
    dueToday: 0,
    pendingPickupTotal: 0,
    staleReservationTotal: 0,
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { readDashboardCounts } from "@/lib/services/dashboard-counts";
import { GET } from "@/app/api/dashboard/route";

const now = new Date("2026-10-22T17:00:00.000Z"); // noon in Madison
const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);

const counts = {
  teamCheckoutsTotal: 11,
  teamCheckoutsOverdue: 2,
  teamReservationsTotal: 6,
  myCheckoutsTotal: 1,
  myOverdue: 1,
  myDueToday: 1,
  totalCheckedOut: 12,
  totalOverdue: 3,
  totalReserved: 7,
  dueToday: 4,
  pendingPickupTotal: 5,
  staleReservationTotal: 9,
};

type Role = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";

function signIn(role: Role, extra: Record<string, unknown> = {}) {
  vi.mocked(requireAuth).mockResolvedValue({
    id: "me",
    email: "me@wisc.edu",
    name: "Maddy",
    role,
    avatarUrl: null,
    ...extra,
  } as never);
}

function asset(id: string, category: string) {
  return { asset: { id, name: id.toUpperCase(), imageUrl: null, assetTag: id.toUpperCase(), category: { name: category } } };
}

function booking(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "CHECKOUT",
    title: `Booking ${id}`,
    refNumber: null,
    eventId: null,
    sportCode: null,
    events: [],
    shiftAssignment: null,
    requester: { name: "Rowan Reed", avatarUrl: null },
    requesterUserId: "user-2",
    location: { name: "Camp Randall" },
    startsAt: hours(-48),
    endsAt: hours(24),
    status: "OPEN",
    updatedAt: hours(-1),
    _count: { serializedItems: 4, bulkItems: 1 },
    serializedItems: [asset("tripod", "Support"), asset("a7", "Camera Body"), asset("mic", "Audio"), asset("lens", "Lens")],
    ...overrides,
  };
}

type Lanes = Partial<Record<
  "teamCheckouts" | "teamReservations" | "myCheckouts" | "myReservations" | "topOverdue" | "drafts" | "pendingPickups" | "shiftGear",
  unknown[] | Error
>>;

type BookingWhere = {
  kind?: string;
  status?: string | { in?: string[] };
  endsAt?: unknown;
  requesterUserId?: string | { not?: string };
  OR?: Array<Record<string, unknown>>;
  AND?: unknown;
};

const statusIn = (where: BookingWhere) => typeof where.status === "object" && Array.isArray(where.status.in);

/** Routes each booking lane query to its rows by what it asks for. */
function bookingLanes(lanes: Lanes) {
  db.booking.findMany.mockImplementation(async ({ where }: { where: BookingWhere }) => {
    const lane =
      where.status === "DRAFT" ? "drafts"
      : statusIn(where) ? "shiftGear"
      : where.OR?.some((clause) => clause.status === "PENDING_PICKUP") ? "pendingPickups"
      : where.kind === "CHECKOUT" && where.endsAt ? "topOverdue"
      : where.kind === "CHECKOUT" && where.OR ? "teamCheckouts"
      : where.kind === "CHECKOUT" ? "myCheckouts"
      : typeof where.requesterUserId === "object" ? "teamReservations"
      : "myReservations";
    const rows = lanes[lane] ?? [];
    if (rows instanceof Error) throw rows;
    return rows;
  });
}

function bookingQuery(predicate: (where: BookingWhere) => boolean) {
  return db.booking.findMany.mock.calls.map(([args]) => args.where as BookingWhere).find(predicate);
}

async function load(scope?: string) {
  const url = `https://app.example.com/api/dashboard${scope ? `?scope=${scope}` : ""}`;
  const res = await GET(new Request(url), { params: Promise.resolve({}) });
  return { status: res.status, data: (await res.json()).data };
}

function shiftAssignment(id: string, event: Record<string, unknown>, shift: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id,
    callStartsAt: null,
    callEndsAt: null,
    callNote: "Bring a battery",
    shift: {
      area: "VIDEO",
      workerType: "ST",
      startsAt: hours(28),
      endsAt: hours(32),
      callStartsAt: hours(27),
      callEndsAt: null,
      shiftGroup: {
        event: {
          id: "event-1",
          summary: "Football vs Iowa",
          startsAt: hours(29),
          endsAt: hours(33),
          allDay: false,
          sportCode: "FB",
          opponent: "Iowa",
          isHome: true,
          site: "HOME",
          locationId: "loc-1",
          location: { id: "loc-1", name: "Camp Randall" },
          ...event,
        },
      },
      ...shift,
    },
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.mocked(readDashboardCounts).mockResolvedValue(counts);
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockResolvedValue([]);
  bookingLanes({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/dashboard team view", () => {
  it("reports team-wide totals to staff on the web", async () => {
    signIn("STAFF");

    const { data } = await load();

    expect(data.stats).toEqual({ checkedOut: 12, overdue: 3, reserved: 7, dueToday: 4 });
    expect(data.teamCheckouts.total).toBe(11);
    expect(data.teamCheckouts.overdue).toBe(2);
    expect(data.teamReservations.total).toBe(6);
    expect(data.pendingPickups.total).toBe(5);
    expect(data.overdueCount).toBe(3);
    // The retired stale-reservation lane stays in the payload, empty.
    expect(data.staleReservations).toEqual({ total: 0, items: [] });
    expect(data.partialFailures).toEqual([]);
  });

  it("puts overdue team checkouts first, then the nearest due", async () => {
    signIn("STAFF");
    bookingLanes({
      teamCheckouts: [
        booking("later", { endsAt: hours(48) }),
        booking("sooner", { endsAt: hours(2) }),
        booking("overdue", { endsAt: hours(-3) }),
      ],
    });

    const { data } = await load();

    expect(data.teamCheckouts.items.map((row: { id: string }) => row.id)).toEqual(["overdue", "sooner", "later"]);
    expect(data.teamCheckouts.items[0].isOverdue).toBe(true);
    expect(bookingQuery((where) => where.kind === "CHECKOUT" && Boolean(where.OR))).toEqual({
      kind: "CHECKOUT",
      status: "OPEN",
      OR: [{ custodyScope: "SHARED" }, { requesterUserId: { not: "me" } }],
    });
  });

  it("summarizes a booking with its people, count and first three items, bodies and lenses first", async () => {
    signIn("STAFF");
    bookingLanes({
      teamCheckouts: [booking("b1", {
        eventId: "event-direct",
        events: [{ eventId: "event-direct" }, { eventId: "event-linked" }],
        requester: { name: "Rowan Reed", avatarUrl: "https://cdn/r.png" },
      })],
    });

    const { data } = await load();

    expect(data.teamCheckouts.items[0]).toMatchObject({
      id: "b1",
      kind: "CHECKOUT",
      eventId: "event-direct",
      eventIds: ["event-direct", "event-linked"],
      linkedEventId: "event-direct",
      requesterName: "Rowan Reed",
      requesterInitials: "RR",
      requesterAvatarUrl: "https://cdn/r.png",
      locationName: "Camp Randall",
      startsAt: hours(-48).toISOString(),
      endsAt: hours(24).toISOString(),
      itemCount: 5,
      isOverdue: false,
    });
    expect(data.teamCheckouts.items[0].items.map((item: { id: string }) => item.id)).toEqual(["a7", "lens", "tripod"]);
  });

  it("links a shift's gear to the shift's event before any other", async () => {
    signIn("STAFF");
    bookingLanes({
      teamCheckouts: [booking("b1", {
        events: [{ eventId: "event-linked" }],
        shiftAssignment: { shift: { shiftGroup: { eventId: "event-shift" } } },
      })],
    });

    const { data } = await load();

    expect(data.teamCheckouts.items[0].linkedEventId).toBe("event-shift");
    expect(data.teamCheckouts.items[0].eventIds).toEqual(["event-linked", "event-shift"]);
  });

  it("never marks a reservation or pickup overdue, and labels every pickup row Pending pickup", async () => {
    signIn("STAFF");
    bookingLanes({
      teamReservations: [booking("r1", { kind: "RESERVATION", status: "BOOKED", endsAt: hours(-1) })],
      pendingPickups: [booking("p1", { kind: "RESERVATION", status: "BOOKED", endsAt: hours(-1) })],
    });

    const { data } = await load();

    expect(data.teamReservations.items[0].isOverdue).toBe(false);
    expect(data.pendingPickups.items[0]).toMatchObject({ id: "p1", isOverdue: false, status: "PENDING_PICKUP" });
  });

  it("lists the overdue banner with tags and item counts", async () => {
    signIn("STAFF");
    bookingLanes({ topOverdue: [booking("late", { endsAt: hours(-5), serializedItems: [asset("a7", "Camera Body")] })] });

    const { data } = await load();

    expect(data.overdueItems).toEqual([{
      bookingId: "late",
      bookingTitle: "Booking late",
      requesterName: "Rowan Reed",
      requesterInitials: "RR",
      requesterAvatarUrl: null,
      assetTags: ["A7"],
      startsAt: hours(-48).toISOString(),
      endsAt: hours(-5).toISOString(),
      itemCount: 5,
      items: [{ id: "a7", name: "A7", imageUrl: null }],
    }]);
  });

  it("returns the caller's drafts", async () => {
    signIn("STAFF");
    bookingLanes({ drafts: [booking("d1", { status: "DRAFT", kind: "RESERVATION" })] });

    const { data } = await load();

    expect(data.drafts).toEqual([{ id: "d1", kind: "RESERVATION", title: "Booking d1", itemCount: 5, updatedAt: hours(-1).toISOString() }]);
    expect(bookingQuery((where) => where.status === "DRAFT")).toEqual({ status: "DRAFT", createdBy: "me" });
  });
});

describe("GET /api/dashboard upcoming events", () => {
  function event(overrides: Record<string, unknown> = {}) {
    return {
      id: "event-1",
      summary: "Football vs Iowa",
      sportCode: "FB",
      startsAt: hours(29),
      endsAt: hours(33),
      allDay: false,
      location: { id: "loc-1", name: "Camp Randall" },
      opponent: "Iowa",
      isHome: true,
      site: "HOME",
      shiftGroup: {
        shifts: [
          { area: "VIDEO", startsAt: hours(27), assignments: [{ user: { id: "u1", name: "Avery", avatarUrl: null } }] },
          { area: "PHOTO", startsAt: hours(26), assignments: [{ user: { id: "u1", name: "Avery", avatarUrl: null } }, { user: { id: "u2", name: "Blair", avatarUrl: "x" } }] },
          { area: "AUDIO", startsAt: hours(28), assignments: [] },
        ],
      },
      ...overrides,
    };
  }

  it("shows crew coverage, each person once, and the earliest call for a home game", async () => {
    signIn("STAFF");
    db.calendarEvent.findMany.mockResolvedValue([event()]);

    const { data } = await load();

    expect(data.upcomingEvents[0]).toMatchObject({
      id: "event-1",
      title: "Football vs Iowa",
      location: "Camp Randall",
      locationId: "loc-1",
      coverage: { total: 3, filled: 2, percentage: 67 },
      totalShiftSlots: 3,
      filledShiftSlots: 2,
      callTime: hours(26).toISOString(),
      assignedUsers: [
        { id: "u1", name: "Avery", avatarUrl: null, area: "VIDEO" },
        { id: "u2", name: "Blair", avatarUrl: "x", area: "PHOTO" },
      ],
    });
  });

  it("shows no call time for an away game or an all-day event, and no coverage without shifts", async () => {
    signIn("STAFF");
    db.calendarEvent.findMany.mockResolvedValue([
      event({ id: "away", isHome: false, site: "AWAY" }),
      event({ id: "all-day", allDay: true }),
      event({ id: "bare", shiftGroup: null }),
    ]);

    const { data } = await load();

    expect(data.upcomingEvents.map((row: { callTime: string | null }) => row.callTime)).toEqual([null, null, null]);
    expect(data.upcomingEvents[2].coverage).toBeNull();
  });

  it("keeps today's events until local midnight and leaves archived and hidden ones out", async () => {
    signIn("STAFF");

    await load();

    expect(db.calendarEvent.findMany.mock.calls[0]?.[0]?.where).toEqual({
      startsAt: { lte: hours(7 * 24) },
      endsAt: { gt: new Date("2026-10-22T05:00:00.000Z") },
      status: "CONFIRMED",
      isHidden: false,
      archivedAt: null,
    });
  });
});

describe("GET /api/dashboard personal scope", () => {
  it("keeps the iOS Home view to the caller's own work and totals", async () => {
    signIn("STAFF");
    bookingLanes({
      myReservations: [booking("r1", { kind: "RESERVATION", status: "BOOKED" }), booking("r2", { kind: "RESERVATION", status: "BOOKED" })],
      pendingPickups: [booking("p1", { kind: "RESERVATION", status: "BOOKED" })],
    });

    const { data } = await load("ios-home");

    expect(data.stats).toEqual({ checkedOut: 1, overdue: 1, reserved: 2, dueToday: 1 });
    expect(data.teamCheckouts).toEqual({ total: 0, overdue: 0, items: [] });
    expect(data.teamReservations.total).toBe(0);
    expect(data.pendingPickups.total).toBe(1);
    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
    expect(bookingQuery((where) => Boolean(where.OR?.some((clause) => clause.status === "PENDING_PICKUP")))?.AND).toEqual([
      { requesterUserId: "me" },
      { custodyScope: "PERSON" },
    ]);
  });

  it("does not look up drafts for a student on iOS", async () => {
    signIn("STUDENT");
    await load("ios-home");
    expect(bookingQuery((where) => where.status === "DRAFT")).toBeUndefined();
  });

  it("gives a collaborator with gear access only their own gear and no shifts", async () => {
    signIn("COLLABORATOR", { capabilities: ["MY_GEAR_VIEW"] });
    bookingLanes({ myCheckouts: [booking("mine", { requesterUserId: "me", endsAt: hours(-1) })] });

    const { data } = await load();

    expect(data.myCheckouts).toMatchObject({ total: 1, overdue: 1 });
    expect(data.myCheckouts.items[0].isOverdue).toBe(true);
    expect(data.stats.checkedOut).toBe(1);
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it("hands a Schedule-only collaborator no gear rows or gear totals", async () => {
    signIn("COLLABORATOR", { capabilities: ["PUBLISHED_SCHEDULE_VIEW"] });

    const { data } = await load();

    expect(db.booking.findMany).not.toHaveBeenCalled();
    expect(data.stats).toEqual({ checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 });
    expect(data.myCheckouts).toEqual({ total: 0, overdue: 0, items: [] });
  });
});

describe("GET /api/dashboard my shifts", () => {
  it("gives a student their call window on a home game and links the shift's gear", async () => {
    signIn("STUDENT");
    db.shiftAssignment.findMany.mockResolvedValue([shiftAssignment("a-1", {}, {}, { callStartsAt: hours(26) })]);
    bookingLanes({
      shiftGear: [
        booking("draft", { status: "DRAFT", eventId: "event-1", startsAt: hours(1) }),
        booking("ready", { status: "PENDING_PICKUP", events: [{ eventId: "event-1" }], startsAt: hours(2) }),
        booking("elsewhere", { status: "BOOKED", eventId: "event-9" }),
      ],
    });

    const { data } = await load();

    expect(data.myShifts).toEqual([expect.objectContaining({
      id: "a-1",
      area: "VIDEO",
      workerLabel: "Student",
      callStartsAt: hours(26).toISOString(),
      callEndsAt: hours(32).toISOString(),
      callNote: "Bring a battery",
      gearStatus: "pickup_ready",
      gearItemCount: 5,
      event: expect.objectContaining({ id: "event-1", summary: "Football vs Iowa", locationName: "Camp Randall" }),
    })]);
    expect(data.myEventWork[0].gearBookings.map((row: { id: string }) => row.id)).toEqual(["ready", "draft"]);
    expect(data.myEventWork[0].needsGear).toBe(false);
    expect(bookingQuery(statusIn)).toMatchObject({
      requesterUserId: "me",
      custodyScope: "PERSON",
      status: { in: ["DRAFT", "BOOKED", "PENDING_PICKUP", "OPEN"] },
    });
  });

  it("falls back to the shift's call, then its start", async () => {
    signIn("STUDENT");
    db.shiftAssignment.findMany.mockResolvedValue([
      shiftAssignment("shift-call", { id: "e-a" }),
      shiftAssignment("shift-start", { id: "e-b" }, { callStartsAt: null }),
    ]);

    const { data } = await load();

    expect(data.myShifts.map((row: { callStartsAt: string }) => row.callStartsAt)).toEqual([hours(27).toISOString(), hours(28).toISOString()]);
  });

  it("gives staff, away games and all-day events no call window", async () => {
    signIn("STAFF");
    db.shiftAssignment.findMany.mockResolvedValue([
      shiftAssignment("staff", { id: "e-a" }, { workerType: "FT" }),
      shiftAssignment("away", { id: "e-b", isHome: false, site: "AWAY" }),
      shiftAssignment("all-day", { id: "e-c", allDay: true }),
    ]);

    const { data } = await load();

    for (const row of [...data.myShifts, ...data.myEventWork.map((work: { shift: unknown }) => work.shift)]) {
      expect(row).toMatchObject({ callStartsAt: null, callEndsAt: null, callNote: null });
    }
    expect(data.myShifts[0].workerLabel).toBe("Staff");
    // The event's own all-day flag reaches both rows, never a hardcoded value.
    expect(data.myShifts.map((row: { event: { allDay: boolean } }) => row.event.allDay)).toEqual([false, false, true]);
    expect(data.myEventWork.map((work: { event: { allDay: boolean } }) => work.event.allDay)).toEqual([false, false, true]);
  });

  it("makes one work item per event from the earliest shift, flagged when no gear is held", async () => {
    signIn("STUDENT");
    db.shiftAssignment.findMany.mockResolvedValue([
      shiftAssignment("late", {}, { startsAt: hours(30), area: "PHOTO" }),
      shiftAssignment("early", {}, { startsAt: hours(27) }),
    ]);
    bookingLanes({ shiftGear: [booking("draft", { status: "DRAFT", eventId: "event-1" })] });

    const { data } = await load();

    expect(data.myShifts).toHaveLength(2);
    expect(data.myEventWork).toHaveLength(1);
    expect(data.myEventWork[0]).toMatchObject({ id: "event-1", shift: { id: "early" }, gearStatus: "draft", needsGear: true });
  });

  it("skips the gear lookup when the caller has no shifts", async () => {
    signIn("STUDENT");
    await load();
    expect(bookingQuery(statusIn)).toBeUndefined();
    expect(db.shiftAssignment.findMany.mock.calls[0]?.[0]?.where.shift.shiftGroup.event).toEqual({
      endsAt: { gt: new Date("2026-10-22T05:00:00.000Z") },
      status: "CONFIRMED",
      archivedAt: null,
    });
  });
});

describe("GET /api/dashboard flagged gear", () => {
  it("shows staff open damage and loss cases plus maintenance items", async () => {
    signIn("STAFF");
    db.checkinItemReport.findMany.mockResolvedValue([
      {
        id: "report-1",
        type: "DAMAGED",
        description: "Cracked screen",
        imageUrl: "https://cdn/crack.jpg",
        createdAt: hours(-30),
        lastReportedAt: hours(-6),
        asset: { id: "a7", assetTag: "A7", name: "Sony A7", status: "AVAILABLE" },
        booking: { title: "Volleyball vs Penn State" },
        reportedBy: { name: "Avery" },
      },
      { id: "report-2", type: "LOST", description: null, imageUrl: null, createdAt: hours(-1), lastReportedAt: hours(-1), asset: null, booking: null, reportedBy: { name: "Avery" } },
    ]);
    db.asset.findMany.mockResolvedValue([{ id: "roam2", assetTag: "ROAM2", name: "Roam", updatedAt: hours(-2) }]);

    const { data } = await load();

    expect(data.flaggedItems).toEqual([
      {
        id: "report-1",
        assetId: "a7",
        assetTag: "A7",
        assetName: "Sony A7",
        type: "DAMAGED",
        bookingTitle: "Volleyball vs Penn State",
        reportedBy: "Avery",
        description: "Cracked screen",
        imageUrl: "https://cdn/crack.jpg",
        assetStatus: "AVAILABLE",
        createdAt: hours(-6).toISOString(),
      },
      {
        id: "maint-roam2",
        assetId: "roam2",
        assetTag: "ROAM2",
        assetName: "Roam",
        type: "MAINTENANCE",
        bookingTitle: null,
        reportedBy: null,
        description: null,
        imageUrl: null,
        assetStatus: "MAINTENANCE",
        createdAt: hours(-2).toISOString(),
      },
    ]);
    expect(db.checkinItemReport.findMany.mock.calls[0]?.[0]?.include.asset).toEqual({
      select: { id: true, assetTag: true, name: true, status: true },
    });
    expect(db.bulkSkuUnit.groupBy).not.toHaveBeenCalled();
  });

  it("shows admins which bulk units are lost, by family", async () => {
    signIn("ADMIN");
    db.bulkSkuUnit.groupBy.mockResolvedValue([{ bulkSkuId: "sku-1", _count: { id: 2 } }, { bulkSkuId: "sku-gone", _count: { id: 1 } }]);
    db.bulkSku.findMany.mockResolvedValue([{ id: "sku-1", name: "NP-FZ100 battery" }]);
    db.bulkSkuUnit.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", unitNumber: 3 },
      { bulkSkuId: "sku-1", unitNumber: 7 },
      { bulkSkuId: "sku-gone", unitNumber: 1 },
    ]);

    const { data } = await load();

    expect(data.lostBulkUnits).toEqual([
      { skuName: "NP-FZ100 battery", count: 2, bulkSkuId: "sku-1", units: [3, 7] },
      { skuName: "Unknown", count: 1, bulkSkuId: "sku-gone", units: [1] },
    ]);
  });

  it("shows students no flagged gear", async () => {
    signIn("STUDENT");
    const { data } = await load();
    expect(data.flaggedItems).toEqual([]);
    expect(db.checkinItemReport.findMany).not.toHaveBeenCalled();
    expect(db.asset.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/dashboard resilience", () => {
  it("answers with the rest of Home when one lane fails, and names the lane", async () => {
    signIn("STAFF");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(readDashboardCounts).mockRejectedValue(new Error("timeout"));
    bookingLanes({ teamCheckouts: new Error("timeout"), myCheckouts: [booking("mine", { requesterUserId: "me" })] });

    const { status, data } = await load();

    expect(status).toBe(200);
    expect(data.partialFailures).toEqual(["counts", "teamCheckouts"]);
    expect(data.stats).toEqual({ checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 });
    expect(data.myCheckouts.items.map((row: { id: string }) => row.id)).toEqual(["mine"]);
  });

  it("rate limits per person", async () => {
    signIn("STAFF");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as never);

    const { status } = await load();

    expect(status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith("dashboard:full:me", { max: 30, windowMs: 60_000 });
  });
});
