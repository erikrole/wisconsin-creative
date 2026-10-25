import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    shiftAssignment: { count: vi.fn(), findMany: vi.fn() },
    booking: { findMany: vi.fn() },
  },
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { GET } from "@/app/api/my-shifts/route";
import { startOfTodayInAppTz } from "@/lib/app-time";

const student = { id: "ada", email: "ada@wisc.edu", name: "Ada", role: Role.STUDENT };
const startsAt = new Date("2026-10-31T17:00:00.000Z");
const endsAt = new Date("2026-10-31T21:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "game",
    summary: "Football vs Iowa",
    startsAt,
    endsAt,
    allDay: false,
    sportCode: "FB",
    isHome: true,
    opponent: "Iowa",
    site: null,
    locationId: "camp",
    location: { id: "camp", name: "Camp Randall" },
    ...overrides,
  };
}

function assignment(id: string, overrides: Record<string, unknown> = {}, shiftOverrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "APPROVED",
    callStartsAt: null,
    callEndsAt: null,
    callNote: "Meet at the tunnel",
    acknowledgedAt: null,
    acknowledgedById: null,
    ...overrides,
    shift: {
      id: `shift-${id}`,
      area: "VIDEO",
      workerType: "ST",
      startsAt,
      endsAt,
      callStartsAt: null,
      callEndsAt: null,
      ...shiftOverrides,
      shiftGroup: { publishedAt: null, event: event(eventOverrides) },
    },
  };
}

function booking(id: string, status: string, links: Record<string, unknown> = {}) {
  return {
    id,
    status,
    kind: "RESERVATION",
    eventId: null,
    events: [],
    shiftAssignment: null,
    _count: { serializedItems: 2, bulkItems: 1 },
    ...links,
  };
}

async function load(query = "") {
  const response = await GET(new Request(`https://app.example.com/api/my-shifts${query}`), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

function where() {
  return mocks.db.shiftAssignment.findMany.mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(student);
  mocks.db.shiftAssignment.count.mockResolvedValue(1);
  mocks.db.shiftAssignment.findMany.mockResolvedValue([assignment("a1")]);
  mocks.db.booking.findMany.mockResolvedValue([]);
});

describe("GET /api/my-shifts", () => {
  it("lists upcoming confirmed shifts from the start of today in Chicago", async () => {
    const before = Date.now();
    const { body } = await load();

    const query = where();
    expect(query.where.userId).toBe("ada");
    expect(query.where.status).toEqual({ in: ["DIRECT_ASSIGNED", "APPROVED"] });
    const eventWhere = query.where.shift.shiftGroup.event;
    expect(eventWhere.status).toBe("CONFIRMED");
    expect(eventWhere.archivedAt).toBeNull();
    expect(eventWhere.endsAt.gt).toEqual(startOfTodayInAppTz(new Date(before)));
    expect(query).toEqual(expect.objectContaining({ skip: 0, take: 5, orderBy: [{ shift: { startsAt: "asc" } }, { id: "asc" }] }));
    expect(body).toEqual(expect.objectContaining({ userId: "ada", total: 1, limit: 5, offset: 0 }));
  });

  it("filters to one event or to a scrolled window", async () => {
    await load("?eventId=game");
    expect(where().where.shift.shiftGroup.event).toEqual({ id: "game" });

    mocks.db.shiftAssignment.findMany.mockClear();
    await load("?startDate=2026-09-01T05:00:00.000Z&endDate=2026-09-08T05:00:00.000Z");
    expect(where().where.shift.shiftGroup.event).toEqual({
      endsAt: { gt: new Date("2026-09-01T05:00:00.000Z") },
      startsAt: { lte: new Date("2026-09-08T05:00:00.000Z") },
      status: { not: "CANCELLED" },
      archivedAt: null,
    });
  });

  it("rejects a window that ends before it starts", async () => {
    const { response } = await load("?startDate=2026-09-08T05:00:00.000Z&endDate=2026-09-01T05:00:00.000Z");

    expect(response.status).toBe(400);
  });

  it.each([
    ["?limit=50&offset=-3", 20, 0],
    ["?limit=0&offset=12.7", 1, 12],
    ["?limit=abc&offset=abc", 5, 0],
    ["?offset=99999", 5, 10_000],
  ])("clamps paging %s", async (query, take, skip) => {
    const { body } = await load(query);

    expect(where()).toEqual(expect.objectContaining({ take, skip }));
    expect(body).toEqual(expect.objectContaining({ limit: take, offset: skip }));
  });

  it("shows a student call window on a home game, falling back to the shift window", async () => {
    mocks.db.shiftAssignment.findMany.mockResolvedValue([
      assignment("a1", { callStartsAt: new Date("2026-10-31T15:30:00.000Z") }),
    ]);

    const [row] = (await load()).body.data;

    expect(row).toEqual(expect.objectContaining({
      workerLabel: "Student",
      callStartsAt: "2026-10-31T15:30:00.000Z",
      callEndsAt: endsAt.toISOString(),
      callNote: "Meet at the tunnel",
    }));
    expect(row.event).toEqual(expect.objectContaining({ id: "game", locationName: "Camp Randall" }));
  });

  it.each([
    ["staff shifts", {}, { workerType: "FT" }, {}],
    ["all-day events", {}, {}, { allDay: true }],
    ["away games", {}, {}, { isHome: false, site: "AWAY" }],
  ])("hides call times on %s", async (_label, overrides, shiftOverrides, eventOverrides) => {
    mocks.db.shiftAssignment.findMany.mockResolvedValue([assignment("a1", overrides, shiftOverrides, eventOverrides)]);

    const [row] = (await load()).body.data;

    expect(row).toEqual(expect.objectContaining({ callStartsAt: null, callEndsAt: null, callNote: null }));
  });

  it("shows the most advanced gear first across every way a booking links to the event", async () => {
    mocks.db.booking.findMany.mockResolvedValue([
      booking("b-draft", "DRAFT", { eventId: "game" }),
      booking("b-ready", "PENDING_PICKUP", { events: [{ eventId: "game" }] }),
      booking("b-reserved", "BOOKED", { shiftAssignment: { shift: { shiftGroup: { eventId: "game" } } } }),
      booking("b-elsewhere", "OPEN", { eventId: "practice" }),
    ]);

    const [row] = (await load()).body.data;

    expect(row.gear.status).toBe("pickup_ready");
    expect(row.gear.bookings.map((entry: { id: string }) => entry.id)).toEqual(["b-ready", "b-reserved", "b-draft"]);
    expect(row.gear.bookings[0].itemCount).toBe(3);
  });

  it("reads a teammate's gear, not the viewer's, when asked for their shifts", async () => {
    const { body } = await load("?userId=grace");

    expect(where().where.userId).toBe("grace");
    expect(mocks.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requesterUserId: "grace" }),
    }));
    expect(body.userId).toBe("grace");
  });

  it("skips the gear lookup with no shifts and marks a shift without gear", async () => {
    mocks.db.shiftAssignment.findMany.mockResolvedValue([]);
    await load();
    expect(mocks.db.booking.findMany).not.toHaveBeenCalled();

    mocks.db.shiftAssignment.findMany.mockResolvedValue([assignment("a1")]);
    expect((await load()).body.data[0].gear).toEqual({ status: "none", bookings: [] });
  });

  it("counts a shift acknowledged only after its schedule is published", async () => {
    const acknowledgedAt = new Date("2026-10-26T15:00:00.000Z");
    mocks.db.shiftAssignment.findMany.mockResolvedValue([
      { ...assignment("a1", { acknowledgedAt }), shift: { ...assignment("a1").shift, shiftGroup: { publishedAt: new Date("2026-10-25T15:00:00.000Z"), event: event() } } },
      assignment("a2", { acknowledgedAt }),
    ]);

    const rows = (await load()).body.data;

    expect(rows.map((row: { scheduleAcknowledged: boolean }) => row.scheduleAcknowledged)).toEqual([true, false]);
  });

  it("stays internal", async () => {
    mocks.requireAuth.mockResolvedValue({ ...student, role: Role.COLLABORATOR });

    expect((await load()).response.status).toBe(403);
    expect(mocks.db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });
});
