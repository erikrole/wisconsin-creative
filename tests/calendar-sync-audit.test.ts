import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    calendarEvent: {
      createManyAndReturn: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      createMany: vi.fn(),
    },
  };

  return {
    txMock: tx,
    dbMock: {
      $transaction: vi.fn(),
      calendarSource: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      locationMapping: {
        findMany: vi.fn(),
      },
      calendarEvent: {
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/security/ssrf", () => ({
  assertPublicHost: vi.fn().mockResolvedValue(undefined),
}));

import { syncCalendarSource } from "@/lib/services/calendar-sync";

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:event-1",
  "SUMMARY:MBB vs Iowa",
  "DTSTART:20260820T190000Z",
  "DTEND:20260820T220000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

function fetchedFeed() {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    text: async () => ics,
  };
}

function createdEvent() {
  return {
    id: "event-1",
    externalId: "event-1",
    summary: "MBB vs Iowa",
    description: null,
    startsAt: new Date("2026-08-20T19:00:00Z"),
    endsAt: new Date("2026-08-20T22:00:00Z"),
    allDay: false,
    status: "CONFIRMED",
    locationId: null,
    sportCode: "MBB",
    opponent: "Iowa",
    isHome: true,
    site: "HOME",
    result: null,
    rawStartsAt: new Date("2026-08-20T19:00:00Z"),
    rawEndsAt: new Date("2026-08-20T22:00:00Z"),
    rawAllDay: false,
    rawLocationText: null,
  };
}

function existingEvent() {
  return {
    ...createdEvent(),
    summary: "MBB vs Illinois",
    opponent: "Illinois",
    summaryLocked: false,
    isHomeLocked: false,
    locationLocked: false,
    timingLocked: false,
  };
}

describe("syncCalendarSource audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.calendarSource.findUnique.mockResolvedValue({
      id: "source-1",
      url: "https://example.com/feed.ics",
      enabled: true,
    });
    dbMock.calendarSource.update.mockResolvedValue({});
    dbMock.locationMapping.findMany.mockResolvedValue([]);
    dbMock.calendarEvent.findMany.mockResolvedValue([]);
    dbMock.$transaction.mockImplementation((callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));
    txMock.calendarEvent.createManyAndReturn.mockResolvedValue([createdEvent()]);
    txMock.calendarEvent.update.mockResolvedValue({});
    txMock.auditLog.createMany.mockResolvedValue({ count: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchedFeed()));
  });

  it("audits newly imported events as system-created calendar activity", async () => {
    const result = await syncCalendarSource("source-1");

    expect(result).toEqual(expect.objectContaining({ added: 1, updated: 0, errors: [] }));
    expect(txMock.auditLog.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        entityType: "calendar_event",
        entityId: "event-1",
        action: "calendar_event_created",
        actorUserId: undefined,
        afterJson: expect.objectContaining({
          summary: "MBB vs Iowa",
          opponent: "Iowa",
          rawStartsAt: "2026-08-20T19:00:00.000Z",
          _actorRole: null,
        }),
      })],
    });
  });

  it("audits changed imported events with before and after snapshots", async () => {
    dbMock.calendarEvent.findMany.mockResolvedValue([existingEvent()]);
    txMock.auditLog.createMany.mockResolvedValue({ count: 1 });

    const result = await syncCalendarSource("source-1");

    expect(result).toEqual(expect.objectContaining({ added: 0, updated: 1, errors: [] }));
    expect(txMock.calendarEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "event-1" },
    }));
    expect(txMock.auditLog.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        entityType: "calendar_event",
        entityId: "event-1",
        action: "calendar_event_updated",
        beforeJson: expect.objectContaining({ summary: "MBB vs Illinois", opponent: "Illinois" }),
        afterJson: expect.objectContaining({
          summary: "MBB vs Iowa",
          opponent: "Iowa",
          rawStartsAt: "2026-08-20T19:00:00.000Z",
          _actorRole: null,
        }),
      })],
    });
  });

  it("records a failed write chunk without losing the rest of the sync, and samples diagnostics", async () => {
    const eventBlock = (n: number) => [
      "BEGIN:VEVENT",
      `UID:event-${n}`,
      `SUMMARY:Event ${n}`,
      `DTSTART:202608${String(n).padStart(2, "0")}T190000Z`,
      `DTEND:202608${String(n).padStart(2, "0")}T220000Z`,
      "END:VEVENT",
    ];
    const bad = ["BEGIN:VEVENT", "UID:bad-1", "SUMMARY:Broken", "DTSTART:garbage", "DTEND:garbage", "END:VEVENT"];
    const feed = ["BEGIN:VCALENDAR", "VERSION:2.0", ...bad, ...Array.from({ length: 7 }, (_, i) => eventBlock(i + 1)).flat(), "END:VCALENDAR"].join("\r\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ...fetchedFeed(), text: async () => feed }));
    txMock.calendarEvent.createManyAndReturn.mockRejectedValue(new Error("x".repeat(400)));

    const result = await syncCalendarSource("source-1");

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(8);
    expect(result.errors.map((e) => e.operation)).toEqual(["validate", "create"]);
    expect(result.errors[0]).toMatchObject({ uid: "bad-1" });
    expect(result.errors[1]!.reason).toHaveLength(301);
    expect(result.errors[1]!.reason.endsWith("\u2026")).toBe(true);
    expect(result.diagnostics?.parsedEventCount).toBe(8);
    expect(result.diagnostics?.firstEvents).toHaveLength(5);
    expect(result.diagnostics?.firstEvents[0]?.uid).toBe("event-1");
  });
});
