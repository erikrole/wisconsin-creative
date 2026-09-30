import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    calendarEvent: {
      findUnique: vi.fn(),
    },
    eventTravelMember: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/calendar-events/[id]/travel/route";
import { DELETE } from "@/app/api/calendar-events/[id]/travel/[memberId]/route";

const staffUser = {
  id: "staff-1",
  email: "staff@test.com",
  name: "Staff",
  role: Role.STAFF,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@test.com",
  name: "Student",
  role: Role.STUDENT,
  avatarUrl: null,
};

function calendarEvent(row: unknown) {
  return row as Awaited<ReturnType<typeof db.calendarEvent.findUnique>>;
}

const awayGame = { id: "event-1", summary: "Wisconsin at Iowa", isHome: false, sportCode: "FB", status: "CONFIRMED", combinedIntoId: null };
const rosterTraveler = { id: "ckt1a2b3c4d5e6f7g8h9i0jkl", name: "Traveler", sportAssignments: [{ id: "assignment-1" }] };

function travelMembers(rows: unknown) {
  return rows as Awaited<ReturnType<typeof db.eventTravelMember.findMany>>;
}

function makeGetRequest() {
  return new Request("https://app.example.com/api/calendar-events/event-1/travel", {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

// The add-member schema requires a cuid, so this has to be a well-formed one
// or validation rejects the body before any route logic runs.
const TARGET_USER_ID = "ckt1a2b3c4d5e6f7g8h9i0jkl";

function makePostRequest() {
  return new Request("https://app.example.com/api/calendar-events/event-1/travel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ userId: TARGET_USER_ID }),
  });
}

function makeMalformedPostRequest() {
  return new Request("https://app.example.com/api/calendar-events/event-1/travel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: "{not-json",
  });
}

function makeDeleteRequest() {
  return new Request("https://app.example.com/api/calendar-events/event-1/travel/member-1", {
    method: "DELETE",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
    },
  });
}

describe("calendar event travel authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows STUDENT to read event travel rosters", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent({ id: "event-1" }));
    vi.mocked(db.eventTravelMember.findMany).mockResolvedValue(travelMembers([
      {
        id: "member-2",
        eventId: "event-1",
        userId: "student-2",
        notes: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: {
          id: "student-2",
          name: "Teammate",
          role: Role.STUDENT,
          primaryArea: null,
          avatarUrl: null,
        },
      },
    ]));

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
  });

  it("allows STAFF to read event travel rosters for an existing event", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent({ id: "event-1" }));
    vi.mocked(db.eventTravelMember.findMany).mockResolvedValue(travelMembers([
      {
        id: "member-1",
        eventId: "event-1",
        userId: "user-target",
        notes: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: {
          id: "user-target",
          name: "Traveler",
          role: Role.STUDENT,
          primaryArea: null,
          avatarUrl: null,
        },
      },
    ]));

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
  });

  it("returns 404 before listing members when the event does not exist", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(null);

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(404);
    expect(db.eventTravelMember.findMany).not.toHaveBeenCalled();
  });

  it("blocks STUDENT from adding event travel members", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(db.eventTravelMember.create).not.toHaveBeenCalled();
  });

  it("rejects malformed add-member JSON before creating travel members", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent(awayGame));

    const res = await POST(makeMalformedPostRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Request body must be valid JSON");
    expect(db.eventTravelMember.create).not.toHaveBeenCalled();
  });

  it("adds a traveler and records an audit entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent(awayGame));
    vi.mocked(db.user.findFirst).mockResolvedValue(rosterTraveler as never);
    vi.mocked(db.eventTravelMember.create).mockResolvedValue({
      id: "member-1",
      notes: null,
    } as never);

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(201);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "calendar_event",
          entityId: "event-1",
          action: "event_travel_member_added",
        }),
      }),
    );
  });

  // REGRESSION: an unknown or deactivated id used to reach Postgres as a
  // foreign-key violation, which has no central mapping and surfaced as a 500.
  it("returns 404 for an unknown or inactive traveler instead of a foreign-key 500", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent(awayGame));
    vi.mocked(db.user.findFirst).mockResolvedValue(null as never);

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("That person is not an active user");
    expect(db.eventTravelMember.create).not.toHaveBeenCalled();
  });

  it("turns a duplicate-roster constraint violation into a named 409", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent(awayGame));
    vi.mocked(db.user.findFirst).mockResolvedValue(rosterTraveler as never);
    vi.mocked(db.eventTravelMember.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("Traveler is already on the travel roster");
  });

  it("records an audit entry when a traveler is removed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.eventTravelMember.findUnique).mockResolvedValue({
      eventId: "event-1",
      userId: TARGET_USER_ID,
      notes: "driving",
      user: { name: "Traveler" },
    } as never);
    vi.mocked(db.eventTravelMember.deleteMany).mockResolvedValue({ count: 1 } as never);

    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "event-1", memberId: "member-1" }),
    });

    expect(res.status).toBe(200);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "calendar_event",
          entityId: "event-1",
          action: "event_travel_member_removed",
          beforeJson: expect.objectContaining({ userName: "Traveler", notes: "driving" }),
        }),
      }),
    );
  });

  it.each([
    ["a home game", { isHome: true }, "Travel rosters are only for away games"],
    ["an event with no recorded side", { isHome: null }, "Travel rosters are only for away games"],
    ["a non-sport event", { sportCode: null }, "Travel rosters are only for away games"],
    ["a cancelled game", { status: "CANCELLED" }, "This event is cancelled"],
    ["a combined event", { combinedIntoId: "event-2" }, "This event was combined into another event. Edit that event's travel roster."],
  ])("rejects adding travelers to %s", async (_label, override, message) => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent({ ...awayGame, ...override }));

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(message);
    expect(db.eventTravelMember.create).not.toHaveBeenCalled();
  });

  it("requires the traveler to be on the sport roster and excludes collaborators", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent(awayGame));
    vi.mocked(db.user.findFirst).mockResolvedValue({ ...rosterTraveler, sportAssignments: [] } as never);

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Add Traveler to the FB roster before adding them to travel");
    expect(db.eventTravelMember.create).not.toHaveBeenCalled();
    expect(vi.mocked(db.user.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { id: TARGET_USER_ID, role: { not: Role.COLLABORATOR }, active: true, hiddenFromRoster: false },
      select: { sportAssignments: { where: { sportCode: "FB" } } },
    });
  });

  it("returns 404 when the event is deleted before the traveler insert", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(calendarEvent(awayGame));
    vi.mocked(db.user.findFirst).mockResolvedValue(rosterTraveler as never);
    vi.mocked(db.eventTravelMember.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" }),
    );

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(404);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("treats a concurrent remove as done without a second audit entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.eventTravelMember.findUnique).mockResolvedValue({
      eventId: "event-1", userId: TARGET_USER_ID, notes: null, user: { name: "Traveler" },
    } as never);
    vi.mocked(db.eventTravelMember.deleteMany).mockResolvedValue({ count: 0 } as never);

    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "event-1", memberId: "member-1" }),
    });

    expect(res.status).toBe(200);
    expect(db.eventTravelMember.deleteMany).toHaveBeenCalledWith({ where: { id: "member-1", eventId: "event-1" } });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not remove a member through another event's URL", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.eventTravelMember.findUnique).mockResolvedValue({
      eventId: "event-other", userId: TARGET_USER_ID, notes: null, user: { name: "Traveler" },
    } as never);

    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "event-1", memberId: "member-1" }),
    });

    expect(res.status).toBe(404);
    expect(db.eventTravelMember.deleteMany).not.toHaveBeenCalled();
  });

  it("blocks STUDENT from deleting event travel members", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "event-1", memberId: "member-1" }),
    });

    expect(res.status).toBe(403);
    expect(db.eventTravelMember.deleteMany).not.toHaveBeenCalled();
  });
});
