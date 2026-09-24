import { createHash } from "node:crypto";
import { hashIcsToken } from "@/lib/ics-token";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: vi.fn(),
    },
    shiftAssignment: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));

import { GET } from "@/app/api/shifts/ics/[token]/route";
import { db } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const validToken = "a".repeat(48);

function user(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.findFirst>>;
}

function shiftAssignments(rows: unknown) {
  return rows as Awaited<ReturnType<typeof db.shiftAssignment.findMany>>;
}

function request() {
  return new Request(`https://app.example.com/api/shifts/ics/${validToken}`, {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientIp).mockReturnValue("203.0.113.10");
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 10,
    resetAt: Date.now() + 60_000,
  });
  vi.mocked(db.user.findFirst).mockResolvedValue(user({
    id: "user-1",
    name: "Student One",
  }));
  vi.mocked(db.shiftAssignment.findMany).mockResolvedValue(shiftAssignments([
    {
      id: "assignment-1",
      callStartsAt: new Date("2026-05-10T14:30:00.000Z"),
      callEndsAt: null,
      updatedAt: new Date("2026-05-01T12:00:00.000Z"),
      shift: {
        workerType: "ST",
        startsAt: new Date("2026-05-10T15:00:00.000Z"),
        endsAt: new Date("2026-05-10T17:00:00.000Z"),
        callStartsAt: null,
        callEndsAt: null,
        area: "PHOTO",
        notes: "Bring camera, vest",
        updatedAt: new Date("2026-05-01T13:00:00.000Z"),
        shiftGroup: {
          event: {
            id: "event-1",
            summary: "Wisconsin Athletics Men's Basketball vs Iowa",
            startsAt: new Date("2026-05-10T15:00:00.000Z"),
            endsAt: new Date("2026-05-10T17:00:00.000Z"),
            allDay: false,
            sportCode: "MBB",
            opponent: "Iowa",
            isHome: true,
            locationId: "loc-1",
            updatedAt: new Date("2026-05-01T14:00:00.000Z"),
            location: { name: "Camp Randall" },
          },
        },
      },
      trades: [],
    },
  ]));
});

describe("shift ICS feed hardening", () => {
  it("returns 404 for malformed tokens without querying users", async () => {
    const res = await GET(request(), { params: Promise.resolve({ token: "bad-token" }) });

    expect(res.status).toBe(404);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("rate limits by client IP and token before querying the feed", async () => {
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, remaining: 0, resetAt: Date.now() + 30_000 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(checkRateLimit).toHaveBeenCalledWith("shifts:ics:ip:203.0.113.10", { max: 120, windowMs: 60_000 });
    // The token limiter keys on a digest, never the raw feed credential.
    const tokenKey = createHash("sha256").update(validToken).digest("hex").slice(0, 32);
    expect(checkRateLimit).toHaveBeenCalledWith(`shifts:ics:token:${tokenKey}`, { max: 30, windowMs: 60_000 });
    expect(checkRateLimit).not.toHaveBeenCalledWith(`shifts:ics:token:${validToken}`, expect.anything());
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("only serves active users and caps the shift assignment query", async () => {
    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });

    expect(res.status).toBe(200);
    // Hashed tokens match by digest; pre-hashing tokens still match raw.
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { icsToken: { in: [hashIcsToken(validToken), validToken] }, active: true },
    });
    expect(db.shiftAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
          shift: {
            startsAt: { gte: expect.any(Date), lte: expect.any(Date) },
            // Cancelled/archived events must drop out of the feed — that's
            // how subscribed calendar apps remove them. Unpublished crews
            // never reach it.
            shiftGroup: { publishedAt: { not: null }, event: { status: "CONFIRMED", archivedAt: null } },
          },
        }),
        include: expect.objectContaining({
          shift: expect.objectContaining({
            include: expect.objectContaining({
              shiftGroup: expect.objectContaining({
                include: expect.objectContaining({
                  event: expect.objectContaining({
                    select: expect.objectContaining({
                      id: true,
                      startsAt: true,
                      endsAt: true,
                      allDay: true,
                      sportCode: true,
                      opponent: true,
                      isHome: true,
                    }),
                  }),
                }),
              }),
            }),
          }),
          // Recent trades of any status, so a cancelled trade still moves the
          // revision forward instead of back.
          trades: expect.objectContaining({ take: 3 }),
        }),
        // Newest first before the cap: a heavy schedule drops old history,
        // not its furthest-out work.
        orderBy: { shift: { startsAt: "desc" } },
        take: 500,
      }),
    );
    expect(res.headers.get("X-Event-Limit")).toBe("500");
  });

  it("does not serve a collaborator's legacy private feed", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValueOnce(user({
      id: "collaborator-1",
      name: "Partner One",
      role: "COLLABORATOR",
    }));

    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });

    expect(res.status).toBe(404);
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });

  it("renders a bounded ICS calendar response", async () => {
    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });
    const body = await res.text();

    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:Photo: MBB vs Iowa");
    expect(body).toContain("DTSTART:20260510T143000Z");
    expect(body).toContain("DTEND:20260510T170000Z");
    expect(body).toContain("LOCATION:Camp Randall");
    // Canonical app origin (env.appUrl), never the request's Host header —
    // a spoofed Host must not seed links into a subscribed calendar.
    expect(body).toContain("URL:http://localhost:3000/events/event-1");
    expect(body).not.toContain("URL:https://app.example.com");
    expect(body).toContain("LAST-MODIFIED:20260501T140000Z");
    expect(body).toContain("SEQUENCE:");
    expect(body).toContain("TRANSP:OPAQUE");
    expect(body).not.toContain("DESCRIPTION:");
  });

  it("exports inherited all-day windows as date values", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValueOnce(shiftAssignments([
      {
        id: "assignment-all-day",
        callStartsAt: null,
        callEndsAt: null,
        updatedAt: new Date("2026-08-11T12:00:00.000Z"),
        shift: {
          workerType: "FT",
          startsAt: new Date("2026-10-03T00:00:00.000Z"),
          endsAt: new Date("2026-10-04T00:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "VIDEO",
          notes: null,
          updatedAt: new Date("2026-08-11T12:00:00.000Z"),
          shiftGroup: {
            event: {
              id: "event-all-day",
              summary: "Wisconsin Athletics Football vs Michigan State- Homecoming",
              startsAt: new Date("2026-10-03T00:00:00.000Z"),
              endsAt: new Date("2026-10-04T00:00:00.000Z"),
              allDay: true,
              sportCode: "FB",
              opponent: "Michigan State - Homecoming",
              isHome: true,
              locationId: "loc-1",
              updatedAt: new Date("2026-08-11T12:00:00.000Z"),
              location: { name: "Camp Randall" },
            },
          },
        },
        trades: [],
      },
    ]));

    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });
    const body = await res.text();

    expect(body).toContain("DTSTART;VALUE=DATE:20261003");
    expect(body).toContain("DTEND;VALUE=DATE:20261004");
    expect(body).toContain(`SEQUENCE:${Math.floor(new Date("2026-08-11T12:00:00.000Z").getTime() / 1000) + 1}`);
    expect(body).not.toContain("DTSTART:20261003T000000Z");
    expect(body).not.toContain("DTEND:20261004T000000Z");
  });

  it("keeps explicit Student call windows timed on all-day events", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValueOnce(shiftAssignments([
      {
        id: "assignment-timed-override",
        callStartsAt: new Date("2026-10-03T17:00:00.000Z"),
        callEndsAt: new Date("2026-10-03T21:00:00.000Z"),
        updatedAt: new Date("2026-08-11T12:00:00.000Z"),
        shift: {
          workerType: "ST",
          startsAt: new Date("2026-10-03T00:00:00.000Z"),
          endsAt: new Date("2026-10-04T00:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "VIDEO",
          notes: null,
          updatedAt: new Date("2026-08-11T12:00:00.000Z"),
          shiftGroup: {
            event: {
              id: "event-all-day",
              summary: "Wisconsin Athletics Football vs Michigan State- Homecoming",
              startsAt: new Date("2026-10-03T00:00:00.000Z"),
              endsAt: new Date("2026-10-04T00:00:00.000Z"),
              allDay: true,
              sportCode: "FB",
              opponent: "Michigan State - Homecoming",
              isHome: true,
              locationId: "loc-1",
              updatedAt: new Date("2026-08-11T12:00:00.000Z"),
              location: { name: "Camp Randall" },
            },
          },
        },
        trades: [],
      },
    ]));

    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });
    const body = await res.text();

    expect(body).toContain("DTSTART:20261003T170000Z");
    expect(body).toContain("DTEND:20261003T210000Z");
    expect(body).not.toContain("DTSTART;VALUE=DATE");
  });

  it("folds long content lines per RFC 5545 without splitting multi-byte characters", async () => {
    const longOpponent = "Extremely Long Opponent Name University of the Upper Midwest Conference Champions";
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValueOnce(shiftAssignments([
      {
        id: "assignment-1",
        callStartsAt: null,
        callEndsAt: null,
        updatedAt: new Date("2026-05-01T12:00:00.000Z"),
        shift: {
          workerType: "ST",
          startsAt: new Date("2026-05-10T15:00:00.000Z"),
          endsAt: new Date("2026-05-10T17:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "PHOTO",
          notes: null,
          updatedAt: new Date("2026-05-01T13:00:00.000Z"),
          shiftGroup: {
            event: {
              id: "event-1",
              summary: `Wisconsin Athletics Men's Basketball vs ${longOpponent}`,
              startsAt: new Date("2026-05-10T15:00:00.000Z"),
              endsAt: new Date("2026-05-10T17:00:00.000Z"),
              allDay: false,
              sportCode: "MBB",
              opponent: longOpponent,
              isHome: true,
              locationId: "loc-1",
              updatedAt: new Date("2026-05-01T14:00:00.000Z"),
              location: { name: "Camp Randall" },
            },
          },
        },
        trades: [{ id: "trade-1", status: "OPEN", updatedAt: new Date("2026-05-02T12:00:00.000Z") }],
      },
    ]));

    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });
    const body = await res.text();

    const encoder = new TextEncoder();
    for (const line of body.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Folded lines reassemble to the original content (unfold then check)
    const unfolded = body.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:🔁 Photo: MBB vs ${longOpponent}`);
  });

  it("marks active trade-board posts in the shift title", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValueOnce(shiftAssignments([
      {
        id: "assignment-1",
        callStartsAt: null,
        callEndsAt: null,
        updatedAt: new Date("2026-05-01T12:00:00.000Z"),
        shift: {
          workerType: "ST",
          startsAt: new Date("2026-05-10T15:00:00.000Z"),
          endsAt: new Date("2026-05-10T17:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          area: "PHOTO",
          notes: null,
          updatedAt: new Date("2026-05-01T13:00:00.000Z"),
          shiftGroup: {
            event: {
              id: "event-1",
              summary: "Wisconsin Athletics Men's Basketball vs Iowa",
              startsAt: new Date("2026-05-10T15:00:00.000Z"),
              endsAt: new Date("2026-05-10T17:00:00.000Z"),
              allDay: false,
              sportCode: "MBB",
              opponent: "Iowa",
              isHome: true,
              locationId: "loc-1",
              updatedAt: new Date("2026-05-01T14:00:00.000Z"),
              location: { name: "Camp Randall" },
            },
          },
        },
        trades: [{ id: "trade-1", status: "OPEN", updatedAt: new Date("2026-05-02T12:00:00.000Z") }],
      },
    ]));

    const res = await GET(request(), { params: Promise.resolve({ token: validToken }) });
    const body = await res.text();

    expect(body).toContain("SUMMARY:🔁 Photo: MBB vs Iowa");
    expect(body).toContain("LAST-MODIFIED:20260502T120000Z");
  });
});
