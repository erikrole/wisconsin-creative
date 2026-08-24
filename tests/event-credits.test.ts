import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "admin-1", role: "ADMIN" as string },
  eventFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  creditFindUnique: vi.fn(),
  creditCreate: vi.fn(),
  creditDelete: vi.fn(),
  creditFindMany: vi.fn(),
  shiftGroupFindFirst: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
}));

const tx = {
  calendarEvent: { findUnique: mocks.eventFindUnique },
  user: { findUnique: mocks.userFindUnique },
  eventCredit: {
    findUnique: mocks.creditFindUnique,
    create: mocks.creditCreate,
    delete: mocks.creditDelete,
  },
};

vi.mock("@/lib/api", () => ({
  withAuth: (
    handler: (
      req: Request,
      ctx: { user: typeof mocks.currentUser; params: Record<string, string> },
    ) => Promise<Response>,
  ) => async (req: Request, context: { params: Promise<Record<string, string>> }) => {
    try {
      return await handler(req, { user: mocks.currentUser, params: await context.params });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : "Internal server error";
      return new Response(JSON.stringify({ error: message }), { status });
    }
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    calendarEvent: { findUnique: mocks.eventFindUnique },
    eventCredit: { findMany: mocks.creditFindMany },
    shiftGroup: { findFirst: mocks.shiftGroupFindFirst },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.rateLimit,
  SCHEDULE_MUTATION_LIMIT: { windowMs: 1, max: 1 },
}));

import { POST } from "@/app/api/calendar-events/[id]/credits/route";
import { DELETE } from "@/app/api/calendar-events/[id]/credits/[creditId]/route";
import { listEventCredits, participatedEventWhere } from "@/lib/services/event-credit";

const post = POST as unknown as (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;
const del = DELETE as unknown as (
  req: Request,
  context: { params: Promise<{ id: string; creditId: string }> },
) => Promise<Response>;

function request(body: unknown) {
  return new Request("https://example.test/api/calendar-events/event-1/credits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.role = "ADMIN";
  mocks.eventFindUnique.mockResolvedValue({
    id: "event-1",
    summary: "Wisconsin vs Ohio State",
    startsAt: new Date("2026-10-04T18:00:00.000Z"),
  });
  mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "Casey Cole", role: "COLLABORATOR" });
  mocks.creditFindUnique.mockResolvedValue(null);
  mocks.creditCreate.mockResolvedValue({ id: "credit-1" });
  mocks.creditFindMany.mockResolvedValue([]);
  mocks.shiftGroupFindFirst.mockResolvedValue(null);
});

describe("participatedEventWhere", () => {
  it("treats an admin credit and an active assignment as the same participation", () => {
    const where = participatedEventWhere("user-1");

    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toHaveProperty("shiftGroup");
    expect(where.OR?.[1]).toEqual({ credits: { some: { userId: "user-1" } } });
  });
});

describe("listEventCredits", () => {
  it("flags a credit for someone who is also on the crew", async () => {
    mocks.creditFindMany.mockResolvedValue([
      {
        id: "credit-1",
        note: null,
        createdAt: new Date("2026-10-05T12:00:00.000Z"),
        user: { id: "user-1", name: "Casey Cole", avatarUrl: null, role: "STUDENT", active: true },
        createdBy: { id: "admin-1", name: "Admin" },
      },
      {
        id: "credit-2",
        note: "Filled in on site",
        createdAt: new Date("2026-10-05T12:05:00.000Z"),
        user: { id: "user-2", name: "Dana Diaz", avatarUrl: null, role: "COLLABORATOR", active: true },
        createdBy: null,
      },
    ]);
    mocks.shiftGroupFindFirst.mockResolvedValue({
      shifts: [{ assignments: [{ userId: "user-1" }] }],
    });

    const credits = await listEventCredits("event-1");

    expect(credits.map((credit) => credit.alsoAssigned)).toEqual([true, false]);
    expect(credits[1]?.note).toBe("Filled in on site");
  });
});

describe("POST /api/calendar-events/[id]/credits", () => {
  it("records a silent credit and audits it", async () => {
    const response = await post(request({ userId: "user-1", note: "Shot warmups" }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.creditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventId: "event-1",
        userId: "user-1",
        note: "Shot warmups",
        createdById: "admin-1",
      }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "event_credit_added",
      entityId: "event-1",
    }));
  });

  it("rejects a duplicate credit instead of double-counting the person", async () => {
    mocks.creditFindUnique.mockResolvedValue({ id: "credit-1" });

    const response = await post(request({ userId: "user-1" }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.creditCreate).not.toHaveBeenCalled();
  });

  it("denies a staff actor", async () => {
    mocks.currentUser.role = "STAFF";

    const response = await post(request({ userId: "user-1" }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.creditCreate).not.toHaveBeenCalled();
  });

  it("404s when the event does not exist", async () => {
    mocks.eventFindUnique.mockResolvedValue(null);

    const response = await post(request({ userId: "user-1" }), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/calendar-events/[id]/credits/[creditId]", () => {
  it("refuses to delete a credit that belongs to another event", async () => {
    mocks.creditFindUnique.mockResolvedValue({
      id: "credit-1",
      eventId: "other-event",
      note: null,
      user: { id: "user-1", name: "Casey Cole", role: "STUDENT" },
      event: { summary: "Other", startsAt: new Date("2026-10-04T18:00:00.000Z") },
    });

    const response = await del(new Request("https://example.test", { method: "DELETE" }), {
      params: Promise.resolve({ id: "event-1", creditId: "credit-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.creditDelete).not.toHaveBeenCalled();
  });

  it("removes a credit and audits the removal", async () => {
    mocks.creditFindUnique.mockResolvedValue({
      id: "credit-1",
      eventId: "event-1",
      note: "Shot warmups",
      user: { id: "user-1", name: "Casey Cole", role: "COLLABORATOR" },
      event: { summary: "Wisconsin vs Ohio State", startsAt: new Date("2026-10-04T18:00:00.000Z") },
    });

    const response = await del(new Request("https://example.test", { method: "DELETE" }), {
      params: Promise.resolve({ id: "event-1", creditId: "credit-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.creditDelete).toHaveBeenCalledWith({ where: { id: "credit-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "event_credit_removed",
    }));
  });
});
