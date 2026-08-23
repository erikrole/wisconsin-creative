import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mockShiftTx = {
  shiftGroup: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shift: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockShiftTx) => Promise<unknown>) => fn(mockShiftTx)),
    calendarEvent: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    shiftGroup: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as getCalendarEvents } from "@/app/api/calendar-events/route";
import { GET as getShiftGroups } from "@/app/api/shift-groups/route";
import { POST as addShift } from "@/app/api/shift-groups/[id]/shifts/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function shiftGroup(row: unknown) {
  return row as Awaited<ReturnType<typeof mockShiftTx.shiftGroup.findUnique>>;
}

function shift(row: unknown) {
  return row as Awaited<ReturnType<typeof mockShiftTx.shift.create>>;
}

function shiftGroupUpdate(row: unknown) {
  return row as Awaited<ReturnType<typeof mockShiftTx.shiftGroup.update>>;
}

function get(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function post(path: string, body: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
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
  vi.mocked(db.shiftGroup.count).mockResolvedValue(0);
  mockShiftTx.shiftGroup.findUnique.mockResolvedValue(shiftGroup({
    id: "group-1",
    event: {
      startsAt: new Date("2026-06-01T10:00:00.000Z"),
      endsAt: new Date("2026-06-01T12:00:00.000Z"),
    },
  }));
  mockShiftTx.shift.create.mockResolvedValue(shift({ id: "shift-1", area: "VIDEO", workerType: "FT" }));
  mockShiftTx.shiftGroup.update.mockResolvedValue(shiftGroupUpdate({}));
});

describe("schedule date validation", () => {
  it("rejects invalid calendar-events startDate query params", async () => {
    const res = await getCalendarEvents(get("/api/calendar-events?startDate=bad-date"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(400);
    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it("rejects inverted calendar-events date ranges", async () => {
    const res = await getCalendarEvents(
      get("/api/calendar-events?startDate=2026-06-02T00:00:00.000Z&endDate=2026-06-01T00:00:00.000Z"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it("queries calendar events by overlap so multi-day events stay visible inside the window", async () => {
    await getCalendarEvents(
      get("/api/calendar-events?startDate=2026-07-08T00:00:00.000Z&endDate=2026-07-08T23:59:59.999Z"),
      { params: Promise.resolve({}) },
    );

    expect(db.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startsAt: { lte: new Date("2026-07-08T23:59:59.999Z") },
          endsAt: { gt: new Date("2026-07-08T00:00:00.000Z") },
        }),
      }),
    );
  });

  it("rejects invalid shift-groups startDate query params", async () => {
    const res = await getShiftGroups(get("/api/shift-groups?startDate=bad-date"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(400);
    expect(db.shiftGroup.findMany).not.toHaveBeenCalled();
  });

  it("queries shift groups by parent event overlap so crew coverage stays visible inside the window", async () => {
    await getShiftGroups(
      get("/api/shift-groups?startDate=2026-07-08T00:00:00.000Z&endDate=2026-07-08T23:59:59.999Z"),
      { params: Promise.resolve({}) },
    );

    expect(db.shiftGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event: expect.objectContaining({
            startsAt: { lte: new Date("2026-07-08T23:59:59.999Z") },
            endsAt: { gt: new Date("2026-07-08T00:00:00.000Z") },
          }),
        }),
      }),
    );
  });

  it("retires direct add-shift overrides before parsing mutation input", async () => {
    const res = await addShift(
      post("/api/shift-groups/group-1/shifts", {
        area: "VIDEO",
        workerType: "FT",
        startsAt: "bad-date",
      }),
      { params: Promise.resolve({ id: "group-1" }) },
    );

    expect(res.status).toBe(410);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(mockShiftTx.shift.create).not.toHaveBeenCalled();
  });
});
