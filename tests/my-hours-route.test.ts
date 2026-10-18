import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  shiftAssignment: { findMany: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET } from "@/app/api/shifts/my-hours/route";

const student = {
  id: "student-1",
  email: "student@example.com",
  name: "Student",
  role: Role.STUDENT,
  avatarUrl: null,
};

function shift(startsAt: string, endsAt: string) {
  return { shift: { startsAt: new Date(startsAt), endsAt: new Date(endsAt) } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(student);
  dbMock.shiftAssignment.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/shifts/my-hours", () => {
  it("counts the Madison week, including days that fall in the next UTC month", async () => {
    // Thu Dec 31, 2026, 11:00pm CST. UTC has already rolled into January.
    vi.setSystemTime(new Date("2027-01-01T05:00:00.000Z"));
    dbMock.shiftAssignment.findMany.mockResolvedValue([
      shift("2027-01-03T00:00:00.000Z", "2027-01-03T04:00:00.000Z"),
      shift("2027-01-01T02:00:00.000Z", "2027-01-01T05:00:00.000Z"),
    ]);

    const res = await GET(new Request("https://app.example.com/api/shifts/my-hours", {
      headers: { host: "app.example.com" },
    }), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { thisWeek: 7, thisMonth: 3, shiftCountWeek: 2, shiftCountMonth: 1 },
    });

    const where = dbMock.shiftAssignment.findMany.mock.calls[0]![0].where.shift;
    expect(where.endsAt.gte.toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(where.startsAt.lt.toISOString()).toBe("2027-01-04T06:00:00.000Z");
  });

  it("keeps Monday through Saturday shifts in this week on Sunday evening", async () => {
    // Sun Oct 11, 2026, 8:00pm CDT = Mon Oct 12, 01:00 UTC.
    vi.setSystemTime(new Date("2026-10-12T01:00:00.000Z"));
    dbMock.shiftAssignment.findMany.mockResolvedValue([
      shift("2026-10-05T18:00:00.000Z", "2026-10-05T22:00:00.000Z"),
    ]);

    const res = await GET(new Request("https://app.example.com/api/shifts/my-hours", {
      headers: { host: "app.example.com" },
    }), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { thisWeek: 4, shiftCountWeek: 1, thisMonth: 4, shiftCountMonth: 1 },
    });
    const where = dbMock.shiftAssignment.findMany.mock.calls[0]![0].where.shift;
    expect(where.endsAt.gte.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(where.startsAt.lt.toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });
});
