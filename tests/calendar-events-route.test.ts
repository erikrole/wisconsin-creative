import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventStatus, Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(dbMock)),
  calendarEvent: {
    create: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shiftGroup: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: dbMock,
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/services/shift-generation", () => ({
  generateShiftsForEvent: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { generateShiftsForEvent } from "@/lib/services/shift-generation";
import { PATCH } from "@/app/api/calendar-events/[id]/route";
import { GET, POST } from "@/app/api/calendar-events/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@example.com",
  name: "Student One",
  role: Role.STUDENT,
  avatarUrl: null,
};

function get(path = "/api/calendar-events") {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: {
      host: "app.example.com",
    },
  });
}

function post(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/calendar-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ eventType: "non-game", ...body }),
  });
}

function malformedPost() {
  return new Request("https://app.example.com/api/calendar-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: "{not-json",
  });
}

function patch(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/calendar-events/cmevent000000000000000001", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(db.calendarEvent.findMany).mockResolvedValue([]);
  vi.mocked(db.calendarEvent.count).mockResolvedValue(0);
  vi.mocked(db.shiftGroup.findMany).mockResolvedValue([]);
  vi.mocked(db.shiftGroup.findUnique).mockResolvedValue(null);
  vi.mocked(db.calendarEvent.create).mockResolvedValue({
    id: "cmevent000000000000000001",
    sourceId: null,
    externalId: "manual-event-1",
    summary: "Manual smoke event",
    description: null,
    rawSummary: null,
    rawLocationText: null,
    rawDescription: null,
    startsAt: new Date("2026-05-12T14:00:00.000Z"),
    endsAt: new Date("2026-05-12T16:00:00.000Z"),
    allDay: false,
    status: CalendarEventStatus.CONFIRMED,
    result: null,
    site: null,
    locationId: null,
    sportCode: null,
    isHome: null,
    isHidden: false,
    summaryLocked: false,
    isHomeLocked: false,
    locationLocked: false,
    archivedAt: null,
    subtitle: null,
    opponent: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    location: null,
  } as Awaited<ReturnType<typeof db.calendarEvent.create>>);
  vi.mocked(createAuditEntry).mockResolvedValue(undefined);
  vi.mocked(createAuditEntryTx).mockResolvedValue(undefined);
  vi.mocked(generateShiftsForEvent).mockResolvedValue({
    created: true,
    shiftGroupId: "cmshiftgroup000000000001",
    shiftCount: 4,
  });
  vi.mocked(db.calendarEvent.findUnique).mockResolvedValue({
    id: "cmevent000000000000000001",
    sourceId: null,
    summary: "Football vs Notre Dame",
    subtitle: null,
    startsAt: new Date("2026-08-29T18:00:00.000Z"),
    endsAt: new Date("2026-08-29T20:00:00.000Z"),
    allDay: false,
    sportCode: "FB",
    isHome: true,
    locationId: null,
    rawSummary: "Football vs Notre Dame",
    rawLocationText: "Green Bay, Wis., Lambeau Field",
    opponent: "Notre Dame",
    summaryLocked: false,
    isHomeLocked: false,
    locationLocked: false,
  } as Awaited<ReturnType<typeof db.calendarEvent.findUnique>>);
  vi.mocked(db.calendarEvent.update).mockResolvedValue({
    id: "cmevent000000000000000001",
    summary: "Football vs Notre Dame",
    subtitle: null,
    sportCode: "FB",
    isHome: null,
    locationId: null,
    opponent: null,
    summaryLocked: false,
    isHomeLocked: true,
    locationLocked: false,
    location: null,
  } as unknown as Awaited<ReturnType<typeof db.calendarEvent.update>>);
});

describe("GET /api/calendar-events", () => {
  it("excludes hidden and archived events by default", async () => {
    const res = await GET(
      get("/api/calendar-events?startDate=2026-07-08T00:00:00.000Z&endDate=2026-07-08T23:59:59.999Z"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isHidden: false,
          archivedAt: null,
          startsAt: { lte: new Date("2026-07-08T23:59:59.999Z") },
          endsAt: { gt: new Date("2026-07-08T00:00:00.000Z") },
        }),
      }),
    );
  });

  it("lets staff include hidden and archived events explicitly", async () => {
    const res = await GET(
      get("/api/calendar-events?includeHidden=true&includeArchived=true&includePast=true"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    const findArgs = vi.mocked(db.calendarEvent.findMany).mock.calls[0]?.[0];
    expect(findArgs?.where).not.toHaveProperty("isHidden");
    expect(findArgs?.where).not.toHaveProperty("archivedAt");
  });

  it("denies students from including hidden events", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await GET(
      get("/api/calendar-events?includeHidden=true"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(403);
    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it("normalizes sportCode query filters before querying", async () => {
    const res = await GET(
      get("/api/calendar-events?sportCode=vb"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sportCode: "VB",
        }),
      }),
    );
  });

  it("rejects unknown sportCode query filters", async () => {
    const res = await GET(
      get("/api/calendar-events?sportCode=football"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/calendar-events", () => {
  it("creates manual events without a calendar source", async () => {
    const res = await POST(
      post({
        summary: "Manual smoke event",
        startsAt: "2026-05-12T14:00:00.000Z",
        endsAt: "2026-05-12T16:00:00.000Z",
        allDay: false,
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(db.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: null,
          summary: "Manual Smoke Event",
        }),
      }),
    );
    expect(createAuditEntry).toHaveBeenCalledOnce();
    expect(generateShiftsForEvent).toHaveBeenCalledWith("cmevent000000000000000001");
    await expect(res.json()).resolves.toMatchObject({
      scheduleGeneration: { created: true, shiftCount: 4 },
    });
  });

  it("persists a manual multi-day all-day event with canonical UTC-midnight date bounds", async () => {
    await POST(
      post({
        summary: "Football Media Day Shoot",
        startsAt: "2026-07-07T07:00:00.000Z",
        endsAt: "2026-07-09T07:00:00.000Z",
        allDay: true,
      }),
      { params: Promise.resolve({}) },
    );

    expect(db.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: null,
          summary: "Football Media Day Shoot",
          startsAt: new Date("2026-07-07T00:00:00.000Z"),
          endsAt: new Date("2026-07-09T00:00:00.000Z"),
          allDay: true,
        }),
      }),
    );
  });

  it("normalizes manual event sportCode before persistence", async () => {
    const res = await POST(
      post({
        summary: "Volleyball vs Kentucky",
        startsAt: "2026-08-21T20:00:00.000Z",
        endsAt: "2026-08-21T22:00:00.000Z",
        sportCode: "vb",
        eventType: "neutral",
        opponent: "Kentucky",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(db.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sportCode: "VB",
          isHome: null,
          opponent: "Kentucky",
        }),
      }),
    );
  });

  it("trims manual event fields before persistence", async () => {
    const res = await POST(
      post({
        summary: "  Volleyball vs Louisville  ",
        startsAt: "2026-08-22T20:00:00.000Z",
        endsAt: "2026-08-22T22:00:00.000Z",
        locationId: "cm000000000000000000000100",
        sportCode: " vb ",
        eventType: "neutral",
        opponent: "  Louisville  ",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(db.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: "Volleyball vs Louisville",
          locationId: "cm000000000000000000000100",
          sportCode: "VB",
          opponent: "Louisville",
        }),
      }),
    );
  });

  it("normalizes manual event opponent before persistence", async () => {
    const res = await POST(
      post({
        summary: "Volleyball vs Louisville",
        startsAt: "2026-08-22T20:00:00.000Z",
        endsAt: "2026-08-22T22:00:00.000Z",
        sportCode: "VB",
        eventType: "neutral",
        opponent: "  No. 7 University of Louisville  ",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(db.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opponent: "Louisville",
        }),
      }),
    );
  });

  it("persists a sport-tagged non-game without an opponent", async () => {
    const res = await POST(
      post({
        summary: "Volleyball Media Day",
        startsAt: "2026-08-22T20:00:00.000Z",
        endsAt: "2026-08-22T22:00:00.000Z",
        sportCode: "VB",
        eventType: "non-game",
        opponent: "Iowa",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(db.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sportCode: "VB",
          isHome: null,
          opponent: null,
        }),
      }),
    );
  });

  it.each([
    ["home", true, "HOME"],
    ["away", false, "AWAY"],
    ["neutral", null, "NEUTRAL"],
  ] as const)("derives %s game venue state from the explicit event type", async (eventType, isHome, site) => {
    const res = await POST(
      post({
        summary: "Volleyball vs Kentucky",
        startsAt: "2026-08-21T20:00:00.000Z",
        endsAt: "2026-08-21T22:00:00.000Z",
        sportCode: "VB",
        eventType,
        opponent: "Kentucky",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(db.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isHome,
          site,
          opponent: "Kentucky",
        }),
      }),
    );
  });

  it("rejects a game event without a sport", async () => {
    const res = await POST(
      post({
        summary: "Game",
        startsAt: "2026-08-21T20:00:00.000Z",
        endsAt: "2026-08-21T22:00:00.000Z",
        eventType: "home",
        opponent: "Kentucky",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a game event without an opponent", async () => {
    const res = await POST(
      post({
        summary: "Game",
        startsAt: "2026-08-21T20:00:00.000Z",
        endsAt: "2026-08-21T22:00:00.000Z",
        sportCode: "VB",
        eventType: "neutral",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects unknown manual event types", async () => {
    const res = await POST(
      post({
        summary: "Game",
        startsAt: "2026-08-21T20:00:00.000Z",
        endsAt: "2026-08-21T22:00:00.000Z",
        eventType: "scrimmage",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects unknown manual event sportCode values", async () => {
    const res = await POST(
      post({
        summary: "Football vs Notre Dame",
        startsAt: "2026-09-06T23:30:00.000Z",
        endsAt: "2026-09-07T02:30:00.000Z",
        sportCode: "football",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before creating a manual event", async () => {
    const res = await POST(malformedPost(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Request body must be valid JSON");
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects blank manual event titles before creating", async () => {
    const res = await POST(
      post({
        summary: "   ",
        startsAt: "2026-08-22T20:00:00.000Z",
        endsAt: "2026-08-22T22:00:00.000Z",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects invalid manual event dates before creating", async () => {
    const res = await POST(
      post({
        summary: "Bad date event",
        startsAt: "not-a-date",
        endsAt: "2026-08-22T22:00:00.000Z",
      }),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid date");
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects inverted manual event date ranges before creating", async () => {
    const res = await POST(
      post({
        summary: "Backwards event",
        startsAt: "2026-08-22T22:00:00.000Z",
        endsAt: "2026-08-22T20:00:00.000Z",
      }),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("End must be after start");
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects invalid manual event location ids before creating", async () => {
    const res = await POST(
      post({
        summary: "Bad location event",
        startsAt: "2026-08-22T20:00:00.000Z",
        endsAt: "2026-08-22T22:00:00.000Z",
        locationId: "loc-1",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/calendar-events/[id]", () => {
  it("captures the site when a sport-only edit turns the home/away lock on", async () => {
    // The lock shuts sync out of this row's classification. Locking a row that
    // has no stored site froze it as an unknown one, so the Scoreboard showed
    // "Unknown site" for a game Schedule rendered as Neutral.
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValueOnce({
      id: "cmevent000000000000000001",
      sourceId: "calendar-source-1",
      summary: "Men's Basketball vs Marquette",
      subtitle: null,
      startsAt: new Date("2026-08-29T18:00:00.000Z"),
      endsAt: new Date("2026-08-29T20:00:00.000Z"),
      allDay: false,
      sportCode: "MBB",
      isHome: null,
      site: null,
      locationId: null,
      rawSummary: "Men's Basketball vs Marquette",
      rawLocationText: "Milwaukee, WI, Fiserv Forum",
      opponent: "Marquette",
      summaryLocked: false,
      isHomeLocked: false,
      locationLocked: false,
      location: null,
    } as unknown as Awaited<ReturnType<typeof db.calendarEvent.findUnique>>);

    const res = await PATCH(
      patch({ sportCode: "WBB" }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sportCode: "WBB",
          isHomeLocked: true,
          site: "NEUTRAL",
        }),
      }),
    );
  });

  it("leaves a stored site alone on a sport-only edit", async () => {
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValueOnce({
      id: "cmevent000000000000000001",
      sourceId: "calendar-source-1",
      summary: "Football vs Notre Dame",
      subtitle: null,
      startsAt: new Date("2026-08-29T18:00:00.000Z"),
      endsAt: new Date("2026-08-29T20:00:00.000Z"),
      allDay: false,
      sportCode: "FB",
      isHome: true,
      site: "HOME",
      locationId: null,
      rawSummary: "Football vs Notre Dame",
      rawLocationText: "Madison, WI, Camp Randall Stadium",
      opponent: "Notre Dame",
      summaryLocked: false,
      isHomeLocked: false,
      locationLocked: false,
      location: null,
    } as unknown as Awaited<ReturnType<typeof db.calendarEvent.findUnique>>);

    await PATCH(
      patch({ sportCode: "VB" }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    const data = vi.mocked(db.calendarEvent.update).mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
    expect(data.sportCode).toBe("VB");
    expect(data).not.toHaveProperty("site");
  });


  it("moves a manual event to a new date and audits the previous window", async () => {
    const res = await PATCH(
      patch({
        startsAt: "2026-08-28T18:00:00.000Z",
        endsAt: "2026-08-28T20:00:00.000Z",
      }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startsAt: new Date("2026-08-28T18:00:00.000Z"),
          endsAt: new Date("2026-08-28T20:00:00.000Z"),
        }),
      }),
    );
    expect(db.shiftGroup.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "cmevent000000000000000001" } }),
    );
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        before: expect.objectContaining({
          startsAt: "2026-08-29T18:00:00.000Z",
          endsAt: "2026-08-29T20:00:00.000Z",
        }),
        after: expect.objectContaining({
          startsAt: "2026-08-28T18:00:00.000Z",
          endsAt: "2026-08-28T20:00:00.000Z",
        }),
      }),
    );
  });

  it("keeps imported event times owned by the calendar source", async () => {
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValueOnce({
      id: "cmevent000000000000000001",
      sourceId: "calendar-source-1",
      summary: "Football vs Notre Dame",
      subtitle: null,
      startsAt: new Date("2026-08-29T18:00:00.000Z"),
      endsAt: new Date("2026-08-29T20:00:00.000Z"),
      allDay: false,
      sportCode: "FB",
      isHome: true,
      site: "HOME",
      locationId: null,
      rawSummary: "Football vs Notre Dame",
      rawLocationText: null,
      opponent: "Notre Dame",
      summaryLocked: false,
      isHomeLocked: false,
      locationLocked: false,
      location: null,
    } as unknown as Awaited<ReturnType<typeof db.calendarEvent.findUnique>>);

    const res = await PATCH(
      patch({
        startsAt: "2026-08-28T18:00:00.000Z",
        endsAt: "2026-08-28T20:00:00.000Z",
      }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Imported event times are controlled by their calendar source");
    expect(db.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("normalizes manually edited event titles and locks the result", async () => {
    const res = await PATCH(
      patch({ summary: "mbb PRACTICE" }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: "MBB Practice",
          summaryLocked: true,
        }),
      }),
    );
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({ summary: "MBB Practice" }),
      }),
    );
  });

  it("preserves acronym casing when staff edits an imported event title", async () => {
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValueOnce({
      id: "cmevent000000000000000001",
      sourceId: "calendar-source-1",
      summary: "MBB vs USC",
      subtitle: null,
      sportCode: "MBB",
      isHome: true,
      locationId: null,
      rawSummary: "MBB vs USC",
      rawLocationText: null,
      opponent: "USC",
      summaryLocked: false,
      isHomeLocked: false,
      locationLocked: false,
      location: null,
    } as unknown as Awaited<ReturnType<typeof db.calendarEvent.findUnique>>);

    const res = await PATCH(
      patch({ summary: "MBB vs USC / UCLA / TCU" }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: "MBB vs USC / UCLA / TCU",
          summaryLocked: true,
        }),
      }),
    );
  });

  it("lets staff save a game as a locked non-game event by clearing opponent", async () => {
    const res = await PATCH(
      patch({
        eventType: "non-game",
        sportCode: "FB",
        opponent: null,
      }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isHome: null,
          site: null,
          opponent: null,
          sportCode: "FB",
          isHomeLocked: true,
        }),
      }),
    );
    expect(createAuditEntryTx).toHaveBeenCalledOnce();
  });

  it("normalizes saved opponent edits", async () => {
    const res = await PATCH(
      patch({
        eventType: "home",
        sportCode: "FB",
        opponent: "  #12 University of Illinois  ",
      }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opponent: "Illinois",
          isHome: true,
          site: "HOME",
          isHomeLocked: true,
        }),
      }),
    );
  });

  it("rejects converting an event to a game without a sport", async () => {
    const res = await PATCH(
      patch({
        eventType: "home",
        sportCode: null,
        opponent: "Illinois",
      }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("derives neutral venue state while updating sport and opponent together", async () => {
    const res = await PATCH(
      patch({
        eventType: "neutral",
        sportCode: "VB",
        opponent: "Kentucky",
      }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(200);
    expect(db.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sportCode: "VB",
          isHome: null,
          site: "NEUTRAL",
          opponent: "Kentucky",
          isHomeLocked: true,
        }),
      }),
    );
  });

  it("rejects opponent edits that omit the coupled event type", async () => {
    const res = await PATCH(
      patch({ opponent: "Illinois" }),
      { params: Promise.resolve({ id: "cmevent000000000000000001" }) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.update).not.toHaveBeenCalled();
  });
});
