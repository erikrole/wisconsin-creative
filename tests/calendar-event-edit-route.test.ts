import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    calendarEvent: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
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

import { DELETE, GET, PATCH } from "@/app/api/calendar-events/[id]/route";

const staff = { id: "staff-1", role: Role.STAFF, email: "staff@example.com", name: "Staff One" };
const student = { id: "student-1", role: Role.STUDENT, email: "student@example.com", name: "Student One" };

const startsAt = new Date("2026-09-12T16:00:00.000Z");
const endsAt = new Date("2026-09-12T19:30:00.000Z");
const rawStartsAt = new Date("2026-09-12T17:00:00.000Z");
const rawEndsAt = new Date("2026-09-12T20:30:00.000Z");
const params = { params: Promise.resolve({ id: "event-1" }) };

function request(method: string, body?: unknown) {
  return new Request("https://app.example.com/api/calendar-events/event-1", {
    method,
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    sourceId: "source-1",
    summary: "Football vs Iowa",
    subtitle: null,
    startsAt,
    endsAt,
    allDay: false,
    sportCode: "FB",
    isHome: true,
    site: "HOME",
    locationId: "loc-1",
    rawSummary: "Football vs Iowa",
    rawLocationText: "Camp Randall Stadium",
    opponent: "Iowa",
    summaryLocked: true,
    isHomeLocked: true,
    locationLocked: true,
    timingLocked: true,
    rawStartsAt,
    rawEndsAt,
    rawAllDay: false,
    location: { isHomeVenue: true },
    combinedIntoId: null,
    _count: { combinedEvents: 0 },
    ...overrides,
  };
}

async function body(response: Response) {
  return response.json() as Promise<{ error?: string; data?: Record<string, unknown> }>;
}

function patchData() {
  return mocks.db.calendarEvent.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
}

function auditEntry() {
  return mocks.audit.mock.calls[0]?.[1] as { before: Record<string, unknown>; after: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.db.$transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => Promise<unknown>) => callback(mocks.db));
  mocks.db.calendarEvent.findUnique.mockResolvedValue(event());
  mocks.db.calendarEvent.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "event-1", ...data }));
  mocks.db.calendarEvent.delete.mockResolvedValue({ id: "event-1" });
  mocks.db.auditLog.findFirst.mockResolvedValue(null);
  mocks.shiftManualEventScheduleTx.mockResolvedValue({ shiftGroupId: "group-1", affectedUserIds: [], published: false });
  mocks.after.mockImplementation((callback: () => Promise<unknown>) => {
    void callback();
  });
  mocks.audit.mockResolvedValue(undefined);
  mocks.rateLimit.mockResolvedValue(undefined);
});

describe("PATCH /api/calendar-events/[id] request checks", () => {
  it("keeps students out before reading anything", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    const response = await PATCH(request("PATCH", { summary: "New title" }), params);

    expect(response.status).toBe(403);
    expect(mocks.db.calendarEvent.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const response = await PATCH(request("PATCH", "{not json"), params);

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Invalid JSON body");
  });

  it.each([
    [{ revertHomeAway: true, sportCode: "MBB" }, "Restore calendar value cannot be combined"],
    [{ revertTiming: true, startsAt: "2026-09-12T11:00:00-05:00", endsAt: "2026-09-12T14:00:00-05:00" }, "Restore calendar time cannot be combined"],
    [{ startsAt: "2026-09-12T11:00:00-05:00" }, "Start and end are required together"],
    [{ allDay: true }, "Start and end are required when changing event timing mode"],
    [{}, "At least one field is required"],
  ])("rejects the combination %j", async (payload, message) => {
    const response = await PATCH(request("PATCH", payload), params);

    expect(response.status).toBe(400);
    expect(JSON.stringify(await body(response))).toContain(message);
    expect(mocks.db.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("answers 404 for an event that is gone", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(null);

    const response = await PATCH(request("PATCH", { summary: "New title" }), params);

    expect(response.status).toBe(404);
  });

  it("rejects a window that ends before it starts", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ sourceId: null }));

    const response = await PATCH(request("PATCH", {
      startsAt: "2026-09-12T14:00:00-05:00",
      endsAt: "2026-09-12T11:00:00-05:00",
    }), params);

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("End must be after start");
    expect(mocks.shiftManualEventScheduleTx).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/calendar-events/[id] restoring calendar values", () => {
  it("restores the calendar's own time, unlocks timing and shifts the schedule with it", async () => {
    const response = await PATCH(request("PATCH", { revertTiming: true }), params);

    expect(response.status).toBe(200);
    expect(patchData()).toEqual({
      startsAt: rawStartsAt,
      endsAt: rawEndsAt,
      allDay: false,
      timingLocked: false,
    });
    expect(mocks.shiftManualEventScheduleTx).toHaveBeenCalledWith(mocks.db, expect.objectContaining({
      eventId: "event-1",
      previousStartsAt: startsAt,
      nextStartsAt: rawStartsAt,
      nextEndsAt: rawEndsAt,
    }));
    expect(auditEntry().before).toEqual(expect.objectContaining({
      startsAt: startsAt.toISOString(),
      timingLocked: true,
    }));
  });

  it("falls back to the event's all-day flag when the calendar never recorded one", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ allDay: true, rawAllDay: null }));

    await PATCH(request("PATCH", { revertTiming: true }), params);

    expect(patchData().allDay).toBe(true);
  });

  it("refuses to restore time on a manual event or before the calendar time is known", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValueOnce(event({ sourceId: null }));
    const manual = await PATCH(request("PATCH", { revertTiming: true }), params);
    expect((await body(manual)).error).toBe("Only imported events can restore calendar time");

    mocks.db.calendarEvent.findUnique.mockResolvedValueOnce(event({ rawStartsAt: null }));
    const unsynced = await PATCH(request("PATCH", { revertTiming: true }), params);
    expect((await body(unsynced)).error).toBe("Calendar time is not available until the next sync");

    expect(mocks.db.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("keeps the calendar's time on the first override of an imported event", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ rawStartsAt: null, rawEndsAt: null, rawAllDay: null, timingLocked: false }));

    await PATCH(request("PATCH", {
      startsAt: "2026-09-12T12:00:00-05:00",
      endsAt: "2026-09-12T15:00:00-05:00",
    }), params);

    expect(patchData()).toEqual(expect.objectContaining({
      timingLocked: true,
      rawStartsAt: startsAt,
      rawEndsAt: endsAt,
      rawAllDay: false,
    }));
  });

  it("restores the cleaned calendar title and unlocks it", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ summary: "Homecoming", rawSummary: "Football vs Iowa" }));

    await PATCH(request("PATCH", { revertTitle: true }), params);

    expect(patchData()).toEqual({ summary: "Football vs Iowa", summaryLocked: false });
    expect(auditEntry().before).toEqual({ summary: "Homecoming", summaryLocked: true });
  });

  it("keeps the current title when there is no calendar title to restore", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ sourceId: null, summary: "Media day", rawSummary: null }));

    await PATCH(request("PATCH", { revertTitle: true }), params);

    expect(patchData()).toEqual({ summary: "Media day", summaryLocked: false });
  });

  it("re-derives home, away, opponent and sport from the calendar listing", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({
      sportCode: "MBB",
      opponent: "Purdue",
      isHome: false,
      site: "AWAY",
      rawSummary: "Football vs Iowa",
    }));

    await PATCH(request("PATCH", { revertHomeAway: true }), params);

    expect(patchData()).toEqual({
      isHome: true,
      site: "HOME",
      opponent: "Iowa",
      sportCode: "FB",
      isHomeLocked: false,
    });
    expect(auditEntry().before).toEqual(expect.objectContaining({ opponent: "Purdue", sportCode: "MBB", site: "AWAY" }));
  });

  it("clears classification on a restore when there is no calendar listing", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ sourceId: null, rawSummary: null }));

    await PATCH(request("PATCH", { revertHomeAway: true }), params);

    expect(patchData()).toEqual({
      isHome: null,
      site: null,
      opponent: null,
      sportCode: null,
      isHomeLocked: false,
    });
  });

  it("unlocks the location without moving it, so the next sync can restore it", async () => {
    await PATCH(request("PATCH", { revertLocation: true }), params);

    expect(patchData()).toEqual({ locationLocked: false });
    expect(auditEntry().after).toEqual({ locationId: "loc-1", locationLocked: false });
  });
});

describe("PATCH /api/calendar-events/[id] field edits", () => {
  it("saves a subtitle and clears it with an empty string", async () => {
    await PATCH(request("PATCH", { subtitle: "Homecoming" }), params);
    expect(patchData()).toEqual({ subtitle: "Homecoming" });

    mocks.db.calendarEvent.update.mockClear();
    await PATCH(request("PATCH", { subtitle: "" }), params);
    expect(patchData()).toEqual({ subtitle: null });
  });

  it("locks a chosen location and unlocks a cleared one", async () => {
    await PATCH(request("PATCH", { locationId: "cm0000000000000000000loc2" }), params);
    expect(patchData()).toEqual({ locationId: "cm0000000000000000000loc2", locationLocked: true });

    mocks.db.calendarEvent.update.mockClear();
    await PATCH(request("PATCH", { locationId: null }), params);
    expect(patchData()).toEqual({ locationId: null, locationLocked: false });
  });

  it("requires an opponent for a game", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ opponent: null }));

    const response = await PATCH(request("PATCH", { eventType: "home" }), params);

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Opponent is required for a game event");
  });

  it("will not clear the sport from a game that has an opponent", async () => {
    const response = await PATCH(request("PATCH", { sportCode: null }), params);

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Sport is required for a game event");
    expect(mocks.db.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("notifies published workers and followers when a time change moves a published schedule", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(event({ sourceId: null }));
    mocks.shiftManualEventScheduleTx.mockResolvedValue({
      shiftGroupId: "group-1",
      affectedUserIds: ["worker-1"],
      published: true,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.notifyWorkers.mockRejectedValue(new Error("push down"));
    mocks.notifyFollowers.mockResolvedValue(undefined);

    const response = await PATCH(request("PATCH", {
      startsAt: "2026-09-12T12:00:00-05:00",
      endsAt: "2026-09-12T15:00:00-05:00",
    }), params);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(response.status).toBe(200);
    expect(mocks.notifyWorkers).toHaveBeenCalledWith("group-1", ["worker-1"]);
    expect(mocks.notifyFollowers).toHaveBeenCalledWith("group-1");
    expect(consoleError).toHaveBeenCalledWith("Manual event time-change notification failed", expect.any(Error));
    consoleError.mockRestore();
  });
});

describe("GET /api/calendar-events/[id]", () => {
  it("names who created a manual event", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue({ id: "event-1", sourceId: null, summary: "Media day" });
    mocks.db.auditLog.findFirst.mockResolvedValue({ actor: { name: "Sam Staff" } });

    const response = await GET(request("GET"), params);

    expect(response.status).toBe(200);
    expect((await body(response)).data).toEqual(expect.objectContaining({ id: "event-1", createdByName: "Sam Staff" }));
    expect(mocks.db.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: "calendar_event", entityId: "event-1", action: "calendar_event_created" },
    }));
  });

  it("skips the creator lookup for an imported event", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue({ id: "event-1", sourceId: "source-1", summary: "Football vs Iowa" });

    const response = await GET(request("GET"), params);

    expect((await body(response)).data?.createdByName).toBeNull();
    expect(mocks.db.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing event", async () => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(null);

    const response = await GET(request("GET"), params);

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/calendar-events/[id]", () => {
  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    const response = await DELETE(request("DELETE"), params);

    expect(response.status).toBe(403);
    expect(mocks.db.calendarEvent.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing event", null, 404, "Event not found"],
    ["an imported event", event(), 400, "Imported events stay on the calendar source"],
    ["an event combined into another", event({ sourceId: null, combinedIntoId: "event-2" }), 400, "Undo the combination"],
    ["an event others are combined into", event({ sourceId: null, _count: { combinedEvents: 2 } }), 400, "Undo the combination"],
  ])("refuses to remove %s", async (_label, existing, status, message) => {
    mocks.db.calendarEvent.findUnique.mockResolvedValue(existing);

    const response = await DELETE(request("DELETE"), params);

    expect(response.status).toBe(status);
    expect((await body(response)).error).toContain(message);
    expect(mocks.db.calendarEvent.delete).not.toHaveBeenCalled();
  });
});
