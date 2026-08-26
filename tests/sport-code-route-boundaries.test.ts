import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  booking: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  shiftGroup: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  user: {
    count: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/services/schedule-health", () => ({ getScheduleHealth: vi.fn() }));
vi.mock("@/lib/services/schedule-automation", () => ({ getScheduleAutomationDigest: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { getScheduleHealth } from "@/lib/services/schedule-health";
import { getScheduleAutomationDigest } from "@/lib/services/schedule-automation";
import { db } from "@/lib/db";
import { GET as getScheduleHealthRoute } from "@/app/api/schedule/health/route";
import { GET as getScheduleAutomationRoute } from "@/app/api/schedule/automation/route";
import { GET as getShiftGroupsRoute } from "@/app/api/shift-groups/route";
import { GET as getBookingsRoute } from "@/app/api/bookings/route";
import { GET as getUsersRoute } from "@/app/api/users/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const studentUser = {
  ...staffUser,
  id: "student-1",
  role: Role.STUDENT,
};

function req(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(getScheduleHealth).mockResolvedValue({ ok: true } as never);
  vi.mocked(getScheduleAutomationDigest).mockResolvedValue({ ok: true } as never);
  vi.mocked(db.shiftGroup.count).mockResolvedValue(0);
  vi.mocked(db.shiftGroup.findMany).mockResolvedValue([]);
  vi.mocked(db.booking.count).mockResolvedValue(0);
  vi.mocked(db.booking.findMany).mockResolvedValue([]);
  vi.mocked(db.user.count).mockResolvedValue(0);
  vi.mocked(db.user.findMany).mockResolvedValue([]);
  vi.mocked(db.user.groupBy).mockResolvedValue([]);
});

describe("sport-code route boundaries", () => {
  it("normalizes Schedule health sport filters", async () => {
    const res = await getScheduleHealthRoute(req("/api/schedule/health?sportCode=vb"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(getScheduleHealth).toHaveBeenCalledWith(expect.objectContaining({ sportCode: "VB" }));
  });

  it("rejects unknown Schedule health sport filters", async () => {
    const res = await getScheduleHealthRoute(req("/api/schedule/health?sportCode=football"), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(getScheduleHealth).not.toHaveBeenCalled();
  });

  it("normalizes Schedule automation sport filters", async () => {
    const res = await getScheduleAutomationRoute(req("/api/schedule/automation?sportCode=msoc"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(getScheduleAutomationDigest).toHaveBeenCalledWith(expect.objectContaining({ sportCode: "MSOC" }));
  });

  it("rejects unknown Schedule automation sport filters", async () => {
    const res = await getScheduleAutomationRoute(req("/api/schedule/automation?sportCode=soccer"), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(getScheduleAutomationDigest).not.toHaveBeenCalled();
  });

  it("normalizes shift-group sport filters before querying", async () => {
    const res = await getShiftGroupsRoute(req("/api/shift-groups?sportCode=vb"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(db.shiftGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event: { sportCode: "VB" } },
      }),
    );
  });

  it("rejects unknown shift-group sport filters before querying", async () => {
    const res = await getShiftGroupsRoute(req("/api/shift-groups?sportCode=football"), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(db.shiftGroup.findMany).not.toHaveBeenCalled();
  });

  it("normalizes combined booking sport filters before querying", async () => {
    const res = await getBookingsRoute(req("/api/bookings?sport_code=sb"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sportCode: "SB" }),
      }),
    );
  });

  it("returns canonical allowed actions with combined booking rows", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([{
      id: "booking-1",
      kind: "RESERVATION",
      status: "BOOKED",
      title: "Equipment reservation",
      requesterUserId: "student-1",
      createdBy: "student-1",
    }] as never);
    vi.mocked(db.booking.count).mockResolvedValue(1);

    const res = await getBookingsRoute(req("/api/bookings"), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].allowedActions).toEqual(expect.arrayContaining([
      "edit",
      "extend",
      "cancel",
      "transfer-owner",
    ]));
  });

  it("leaves the combined booking list team-visible for students", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await getBookingsRoute(req("/api/bookings"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    const query = vi.mocked(db.booking.findMany).mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(query.where).not.toHaveProperty("requesterUserId");
  });

  it("rejects unknown combined booking sport filters before querying", async () => {
    const res = await getBookingsRoute(req("/api/bookings?sport_code=softball"), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it("normalizes user sport filters before querying", async () => {
    const res = await getUsersRoute(req("/api/users?sport=whky"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { sportAssignments: { some: { sportCode: "WHKY" } } },
          ]),
        }),
      }),
    );
  });

  it("rejects unknown user sport filters before querying", async () => {
    const res = await getUsersRoute(req("/api/users?sport=hockey"), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
