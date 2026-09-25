import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    calendarEvent: { findUnique: vi.fn() },
    studentSportAssignment: { findMany: vi.fn() },
    eventTravelMember: { createMany: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { POST } from "@/app/api/calendar-events/[id]/travel/defaults/route";

const staff = { id: "staff-1", email: "staff@test.com", name: "Staff", role: Role.STAFF, avatarUrl: null };
const student = { ...staff, id: "student-1", role: Role.STUDENT };
const awayGame = { id: "event-1", summary: "Wisconsin at Penn State", isHome: false, sportCode: "FB", status: "CONFIRMED", combinedIntoId: null };
const defaults = [
  { userId: "u-ben", user: { name: "Ben" } },
  { userId: "u-casey", user: { name: "Casey" } },
];
const members = [{ id: "m-1", eventId: "event-1", userId: "u-ben", user: { id: "u-ben", name: "Ben" } }];

function post() {
  return POST(new Request("https://app.example.com/api/calendar-events/event-1/travel/defaults", {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com" },
  }), { params: Promise.resolve({ id: "event-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staff);
  vi.mocked(db.calendarEvent.findUnique).mockResolvedValue(awayGame as never);
  vi.mocked(db.studentSportAssignment.findMany).mockResolvedValue(defaults as never);
  vi.mocked(db.eventTravelMember.createMany).mockResolvedValue({ count: 2 });
  vi.mocked(db.eventTravelMember.findMany).mockResolvedValue(members as never);
});

describe("POST /api/calendar-events/[id]/travel/defaults", () => {
  it("adds the sport's active default travelers, leaves existing members alone, and audits once", async () => {
    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ added: 2, defaultCount: 2, data: members });
    expect(vi.mocked(db.studentSportAssignment.findMany).mock.calls[0]?.[0]).toMatchObject({
      where: {
        sportCode: "FB",
        defaultTraveler: true,
        user: { role: { not: Role.COLLABORATOR }, active: true, hiddenFromRoster: false },
      },
    });
    expect(db.eventTravelMember.createMany).toHaveBeenCalledWith({
      data: [{ eventId: "event-1", userId: "u-ben" }, { eventId: "event-1", userId: "u-casey" }],
      skipDuplicates: true,
    });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityId: "event-1", action: "event_travel_defaults_added" }),
    }));
  });

  it("writes no audit entry when everyone is already on the trip", async () => {
    vi.mocked(db.eventTravelMember.createMany).mockResolvedValue({ count: 0 });

    const body = await (await post()).json();

    expect(body).toMatchObject({ added: 0, defaultCount: 2 });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("reports a sport with no default travelers without writing", async () => {
    vi.mocked(db.studentSportAssignment.findMany).mockResolvedValue([]);

    const body = await (await post()).json();

    expect(body).toMatchObject({ added: 0, defaultCount: 0 });
    expect(db.eventTravelMember.createMany).not.toHaveBeenCalled();
  });

  it("uses the same away-game gate as a single add", async () => {
    vi.mocked(db.calendarEvent.findUnique).mockResolvedValue({ ...awayGame, isHome: true } as never);

    const res = await post();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Travel rosters are only for away games");
    expect(db.eventTravelMember.createMany).not.toHaveBeenCalled();
  });

  it("blocks students", async () => {
    vi.mocked(requireAuth).mockResolvedValue(student);

    const res = await post();

    expect(res.status).toBe(403);
    expect(db.eventTravelMember.createMany).not.toHaveBeenCalled();
  });
});
