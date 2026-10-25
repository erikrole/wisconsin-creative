import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    shiftAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/services/checkout-policies", () => ({
  loadCheckoutPolicies: vi.fn(async () => ({ gracePeriodHours: 1 })),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/users/[id]/right-now/route";

const student = {
  id: "u1",
  email: "a@test.com",
  name: "A",
  role: "STUDENT" as const,
  avatarUrl: null,
};
const call = (id: string) =>
  GET(new Request(`https://app.example.com/api/users/${id}/right-now`), {
    params: Promise.resolve({ id }),
  });
const hour = 3_600_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(student);
  vi.mocked(db.shiftAssignment.findFirst).mockResolvedValue(null);
  vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([]);
  vi.mocked(db.booking.findMany).mockResolvedValue([]);
});

describe("GET /api/users/[id]/right-now", () => {
  it("lets a student read only their own", async () => {
    const res = await call("someone-else");
    expect(res.status).toBe(403);
    expect(db.shiftAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("lets staff read anyone, scoped to confirmed shifts on published groups and open checkouts", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...student, role: "STAFF" });
    await call("u9");
    const where = vi.mocked(db.shiftAssignment.findFirst).mock.calls[0]?.[0]
      ?.where as Record<string, unknown>;
    expect(where.userId).toBe("u9");
    expect(where.status).toEqual({ in: ["DIRECT_ASSIGNED", "APPROVED"] });
    const bookingWheres = vi
      .mocked(db.booking.findMany)
      .mock.calls.map((c) => c[0]?.where);
    expect(bookingWheres).toContainEqual(
      expect.objectContaining({ requesterUserId: "u9", status: "OPEN" }),
    );
    expect(bookingWheres).toContainEqual(
      expect.objectContaining({ requesterUserId: "u9", status: "COMPLETED" }),
    );
  });

  it("returns the next shift and what they are holding, flagging overdue gear", async () => {
    const now = Date.now();
    vi.mocked(db.shiftAssignment.findFirst).mockResolvedValue({
      shift: {
        area: "PHOTO",
        startsAt: new Date(now + 2 * hour),
        endsAt: new Date(now + 5 * hour),
        shiftGroup: {
          event: {
            summary: "Volleyball vs. Purdue",
            location: { name: "Field House" },
          },
        },
      },
    } as never);
    vi.mocked(db.booking.findMany).mockImplementation((async (args: {
      where: { status: string };
    }) =>
      args.where.status === "OPEN"
        ? [{ id: "b1", title: "Canon R5 kit", endsAt: new Date(now - hour) }]
        : []) as never);
    const res = await call("u1");
    const body = await res.json();
    expect(body.data.nextShift).toMatchObject({
      summary: "Volleyball vs. Purdue",
      location: "Field House",
      area: "PHOTO",
      live: false,
    });
    expect(body.data.holding).toEqual([
      expect.objectContaining({ title: "Canon R5 kit", overdue: true }),
    ]);
  });

  it("returns empty values when nothing is scheduled or out", async () => {
    const body = await (await call("u1")).json();
    expect(body.data).toEqual({
      nextShift: null,
      holding: [],
      week: [],
      performance: { checkouts: 0, onTimeRate: null },
    });
  });

  it("lists the next seven days of shifts and computes the on-time return rate", async () => {
    const now = Date.now();
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([
      {
        shift: {
          area: "VIDEO",
          startsAt: new Date(now + hour),
          endsAt: new Date(now + 3 * hour),
          shiftGroup: { event: { summary: "Soccer" } },
        },
      },
    ] as never);
    // Accountability's rule: on time unless returned after due plus the 1 hour grace; a
    // checkout still out past grace counts against the rate.
    vi.mocked(db.booking.findMany).mockImplementation((async (args: {
      where: { status: string };
    }) =>
      args.where.status === "OPEN"
        ? [{ endsAt: new Date(now - 5 * hour) }]
        : args.where.status === "COMPLETED"
        ? [
            {
              endsAt: new Date(now - 10 * hour),
              completedAt: new Date(now - 11 * hour),
            },
            {
              endsAt: new Date(now - 20 * hour),
              completedAt: new Date(now - 19 * hour),
            },
            {
              endsAt: new Date(now - 50 * hour),
              completedAt: new Date(now - 47 * hour),
            },
            { endsAt: new Date(now - 30 * hour), completedAt: null },
            {
              endsAt: new Date(now - 40 * hour),
              completedAt: new Date(now - 41 * hour),
            },
          ]
        : []) as never);
    const body = await (await call("u1")).json();
    expect(body.data.week).toEqual([
      expect.objectContaining({ summary: "Soccer", area: "VIDEO" }),
    ]);
    expect(body.data.performance).toEqual({ checkouts: 5, onTimeRate: 67 });
  });

  it("shows no on-time rate until there are 3 completed or overdue checkouts", async () => {
    vi.mocked(db.booking.findMany).mockImplementation((async (args: {
      where: { status: string };
    }) =>
      args.where.status === "COMPLETED"
        ? [
            { endsAt: new Date(Date.now() - 10 * hour), completedAt: new Date(Date.now() - 11 * hour) },
            { endsAt: new Date(Date.now() - 20 * hour), completedAt: new Date(Date.now() - 21 * hour) },
          ]
        : []) as never);
    const body = await (await call("u1")).json();
    expect(body.data.performance).toEqual({ checkouts: 2, onTimeRate: null });
  });
});
