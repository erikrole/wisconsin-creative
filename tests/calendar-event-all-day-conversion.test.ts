import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    calendarEvent: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  requireAuth: vi.fn(),
  audit: vi.fn(),
  shiftManualEventScheduleTx: vi.fn(),
  notifyWorkers: vi.fn(),
  notifyFollowers: vi.fn(),
  after: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/services/manual-event-time", () => ({
  shiftManualEventScheduleTx: mocks.shiftManualEventScheduleTx,
}));
vi.mock("@/lib/services/notifications", () => ({
  notifyPublishedShiftGroupWorkers: mocks.notifyWorkers,
  notifyPublishedScheduleFollowers: mocks.notifyFollowers,
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.rateLimit,
  SCHEDULE_MUTATION_LIMIT: { windowMs: 60_000, max: 10 },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

import { PATCH } from "@/app/api/calendar-events/[id]/route";

const staff = {
  id: "staff-1",
  role: Role.STAFF,
  email: "staff@example.com",
  name: "Staff One",
};

const allDayStart = new Date("2026-08-25T00:00:00.000Z");
const allDayEnd = new Date("2026-08-26T00:00:00.000Z");
const timedStart = new Date("2026-08-25T21:30:00.000Z");
const timedEnd = new Date("2026-08-25T22:30:00.000Z");

function request(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/calendar-events/event-1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    sourceId: null,
    summary: "Veterans Plaza Ceremony",
    subtitle: null,
    startsAt: allDayStart,
    endsAt: allDayEnd,
    allDay: true,
    sportCode: null,
    isHome: null,
    site: "NEUTRAL",
    locationId: null,
    rawSummary: null,
    rawLocationText: null,
    opponent: null,
    summaryLocked: false,
    isHomeLocked: false,
    locationLocked: false,
    location: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.db.$transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => Promise<unknown>) => callback(mocks.db));
  mocks.db.calendarEvent.findUnique.mockResolvedValue(event());
  mocks.db.calendarEvent.update.mockResolvedValue({
    id: "event-1",
    summary: "Veterans Plaza Ceremony",
    subtitle: null,
    startsAt: timedStart,
    endsAt: timedEnd,
    allDay: false,
    sportCode: null,
    isHome: null,
    site: "NEUTRAL",
    opponent: null,
    locationId: null,
    summaryLocked: false,
    isHomeLocked: false,
    locationLocked: false,
    location: null,
  });
  mocks.shiftManualEventScheduleTx.mockResolvedValue({
    shiftGroupId: "group-1",
    affectedUserIds: ["assignee-1", "assignee-2"],
    published: true,
  });
  mocks.after.mockImplementation((callback: () => Promise<unknown>) => {
    void callback();
  });
  mocks.notifyWorkers.mockResolvedValue(undefined);
  mocks.notifyFollowers.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.rateLimit.mockResolvedValue(undefined);
});

describe("PATCH /api/calendar-events/[id] all-day conversion", () => {
  it("converts a manual all-day event to a timed window and notifies published assignees", async () => {
    const response = await PATCH(
      request({
        startsAt: "2026-08-25T16:30:00-05:00",
        endsAt: "2026-08-25T17:30:00-05:00",
        allDay: false,
      }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.db.calendarEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        startsAt: timedStart,
        endsAt: timedEnd,
        allDay: false,
      }),
    }));
    expect(mocks.shiftManualEventScheduleTx).toHaveBeenCalledWith(mocks.db, {
      eventId: "event-1",
      previousStartsAt: allDayStart,
      previousEndsAt: allDayEnd,
      nextStartsAt: timedStart,
      nextEndsAt: timedEnd,
      actor: staff,
    });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.objectContaining({
      before: expect.objectContaining({ allDay: true }),
      after: expect.objectContaining({ allDay: false }),
    }));

    await vi.waitFor(() => {
      expect(mocks.notifyWorkers).toHaveBeenCalledWith("group-1", ["assignee-1", "assignee-2"]);
      expect(mocks.notifyFollowers).toHaveBeenCalledWith("group-1");
    });
  });

  it("canonicalizes a timed event when converting it to an all-day date span", async () => {
    const timedEventStart = new Date("2026-08-25T16:30:00.000Z");
    const timedEventEnd = new Date("2026-08-25T17:30:00.000Z");
    mocks.db.calendarEvent.findUnique.mockResolvedValueOnce(event({
      startsAt: timedEventStart,
      endsAt: timedEventEnd,
      allDay: false,
    }));
    mocks.db.calendarEvent.update.mockResolvedValueOnce({
      id: "event-1",
      summary: "Veterans Plaza Ceremony",
      subtitle: null,
      startsAt: allDayStart,
      endsAt: allDayEnd,
      allDay: true,
      sportCode: null,
      isHome: null,
      site: "NEUTRAL",
      opponent: null,
      locationId: null,
      summaryLocked: false,
      isHomeLocked: false,
      locationLocked: false,
      location: null,
    });
    mocks.shiftManualEventScheduleTx.mockResolvedValueOnce({
      shiftGroupId: "group-1",
      affectedUserIds: [],
      published: false,
    });

    const response = await PATCH(
      request({
        startsAt: "2026-08-25T00:00:00.000Z",
        endsAt: "2026-08-26T00:00:00.000Z",
        allDay: true,
      }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.db.calendarEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        startsAt: allDayStart,
        endsAt: allDayEnd,
        allDay: true,
      }),
    }));
  });

  it("requires a complete window when the timing mode is supplied", async () => {
    const response = await PATCH(
      request({ allDay: false }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.db.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("keeps imported event timing and all-day state source-owned", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValueOnce(event({ sourceId: "source-1" }));

    const response = await PATCH(
      request({
        startsAt: "2026-08-25T16:30:00-05:00",
        endsAt: "2026-08-25T17:30:00-05:00",
        allDay: false,
      }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("Imported event times are controlled by their calendar source");
    expect(mocks.db.calendarEvent.update).not.toHaveBeenCalled();
  });
});
