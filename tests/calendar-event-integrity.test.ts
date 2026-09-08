import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({ events: vi.fn(), count: vi.fn(), groups: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  calendarEvent: { findMany: mocks.events, count: mocks.count, create: mocks.create },
  shiftGroup: { findMany: mocks.groups },
} }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@/lib/services/shift-generation", () => ({ generateShiftsForEvent: vi.fn() }));
import { requireAuth } from "@/lib/auth";
import { GET, POST } from "@/app/api/calendar-events/route";

const context = { params: Promise.resolve({}) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ id: "staff", name: "Staff", email: "staff@example.com", role: Role.STAFF, avatarUrl: null });
  mocks.events.mockResolvedValue([{ id: "event-1" }, { id: "event-2" }, { id: "event-3" }]);
  mocks.count.mockResolvedValue(3);
});

describe("calendar event integrity", () => {
  it("counts staffed slots, excluding pending and terminal assignments in the database query", async () => {
    mocks.groups.mockImplementation(async (args) => {
      const statuses = args.select.shifts.select._count.select.assignments.where.status.in;
      expect(statuses).toEqual(["DIRECT_ASSIGNED", "APPROVED"]);
      const slots = [["REQUESTED"], ["DECLINED"], ["DIRECT_ASSIGNED", "APPROVED"], ["APPROVED"], []];
      return [
        { eventId: "event-1", shifts: slots.map((assignments) => ({ _count: { assignments: assignments.filter((status) => statuses.includes(status)).length } })) },
        { eventId: "event-2", shifts: [] },
      ];
    });
    const response = await GET(new Request("https://app.example.com/api/calendar-events"), context);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([
      { id: "event-1", coverage: { filled: 2, total: 5, percentage: 40 } },
      { id: "event-2", coverage: { filled: 0, total: 0, percentage: 0 } },
      { id: "event-3", coverage: null },
    ]);
    expect(mocks.groups).toHaveBeenCalledOnce();
    expect(mocks.groups.mock.calls[0]![0].where).toEqual({ eventId: { in: ["event-1", "event-2", "event-3"] }, archivedAt: null });
  });

  it("skips the crew query on an empty event page", async () => {
    mocks.events.mockResolvedValue([]);
    const response = await GET(new Request("https://app.example.com/api/calendar-events"), context);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
    expect(mocks.groups).not.toHaveBeenCalled();
  });

  it("rejects all-day timestamps that normalize to an empty date range before writing", async () => {
    const response = await POST(new Request("https://app.example.com/api/calendar-events", {
      method: "POST",
      headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
      body: JSON.stringify({ summary: "Media day", startsAt: "2026-09-07T14:00:00Z", endsAt: "2026-09-07T20:00:00Z", allDay: true, eventType: "non-game" }),
    }), context);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("End must be after start");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
