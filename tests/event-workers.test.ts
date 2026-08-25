import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "admin-1", role: "ADMIN" as string },
  eventFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  workerFindUnique: vi.fn(),
  workerCreate: vi.fn(),
  workerDelete: vi.fn(),
  workerFindMany: vi.fn(),
  shiftGroupFindFirst: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
}));

const tx = {
  calendarEvent: { findUnique: mocks.eventFindUnique },
  user: { findUnique: mocks.userFindUnique },
  eventWorker: {
    findUnique: mocks.workerFindUnique,
    create: mocks.workerCreate,
    delete: mocks.workerDelete,
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
    eventWorker: { findMany: mocks.workerFindMany },
    shiftGroup: { findFirst: mocks.shiftGroupFindFirst },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.rateLimit,
  SCHEDULE_MUTATION_LIMIT: { windowMs: 1, max: 1 },
}));

import { POST } from "@/app/api/calendar-events/[id]/workers/route";
import { DELETE } from "@/app/api/calendar-events/[id]/workers/[workerId]/route";
import { listEventWorkers, participatedEventWhere } from "@/lib/services/event-worker";

const post = POST as unknown as (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;
const del = DELETE as unknown as (
  req: Request,
  context: { params: Promise<{ id: string; workerId: string }> },
) => Promise<Response>;

function request(body: unknown) {
  return new Request("https://example.test/api/calendar-events/event-1/workers", {
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
  mocks.workerFindUnique.mockResolvedValue(null);
  mocks.workerCreate.mockResolvedValue({ id: "worker-1" });
  mocks.workerFindMany.mockResolvedValue([]);
  mocks.shiftGroupFindFirst.mockResolvedValue(null);
});

describe("EventWorkersCard load failure", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(app)/events/[id]/_components/EventWorkersCard.tsx"),
    "utf8",
  );

  it("does not render a failed read as an empty roster", () => {
    // "No one has been added" is a claim about the event. Making it when the
    // request failed hides a broken deploy behind a reassuring empty state.
    expect(source).toContain("const [loadFailed, setLoadFailed] = useState(false);");
    expect(source).toContain("Could not load who has been added to this event.");
    expect(source).toContain("setLoadFailed(true);");
    // Success has to clear it, or one blip would leave the card stuck in error.
    expect(source).toContain("setLoadFailed(false);");
  });
});

describe("participatedEventWhere", () => {
  it("treats an added worker and an active assignment as the same participation", () => {
    const where = participatedEventWhere("user-1");

    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toHaveProperty("shiftGroup");
    expect(where.OR?.[1]).toEqual({ workers: { some: { userId: "user-1" } } });
  });
});

describe("listEventWorkers", () => {
  it("flags an added worker who is also on the crew", async () => {
    mocks.workerFindMany.mockResolvedValue([
      {
        id: "worker-1",
        note: null,
        createdAt: new Date("2026-10-05T12:00:00.000Z"),
        user: { id: "user-1", name: "Casey Cole", avatarUrl: null, role: "STUDENT", active: true },
        addedBy: { id: "admin-1", name: "Admin" },
      },
      {
        id: "worker-2",
        note: "Filled in on site",
        createdAt: new Date("2026-10-05T12:05:00.000Z"),
        user: { id: "user-2", name: "Dana Diaz", avatarUrl: null, role: "COLLABORATOR", active: true },
        addedBy: null,
      },
    ]);
    mocks.shiftGroupFindFirst.mockResolvedValue({
      shifts: [{ assignments: [{ userId: "user-1" }] }],
    });

    const workers = await listEventWorkers("event-1");

    expect(workers.map((worker) => worker.alsoAssigned)).toEqual([true, false]);
    expect(workers[1]?.note).toBe("Filled in on site");
  });
});

describe("POST /api/calendar-events/[id]/workers", () => {
  it("records a silent worker row and audits it", async () => {
    const response = await post(request({ userId: "user-1", note: "Shot warmups" }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.workerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventId: "event-1",
        userId: "user-1",
        note: "Shot warmups",
        addedById: "admin-1",
      }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "event_worker_added",
      entityId: "event-1",
    }));
  });

  it("lets the unique constraint reject a duplicate rather than racing a pre-read", async () => {
    // Two admins adding the same person at once both pass any pre-read, so
    // the constraint is what has to answer.
    mocks.workerCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6",
      }),
    );

    const response = await post(request({ userId: "user-1" }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Casey Cole is already on this event" });
  });

  it("denies a staff actor", async () => {
    mocks.currentUser.role = "STAFF";

    const response = await post(request({ userId: "user-1" }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.workerCreate).not.toHaveBeenCalled();
  });

  it("404s when the event does not exist", async () => {
    mocks.eventFindUnique.mockResolvedValue(null);

    const response = await post(request({ userId: "user-1" }), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/calendar-events/[id]/workers/[workerId]", () => {
  it("refuses to delete a worker row that belongs to another event", async () => {
    mocks.workerFindUnique.mockResolvedValue({
      id: "worker-1",
      eventId: "other-event",
      note: null,
      user: { id: "user-1", name: "Casey Cole", role: "STUDENT" },
      event: { summary: "Other", startsAt: new Date("2026-10-04T18:00:00.000Z") },
    });

    const response = await del(new Request("https://example.test", { method: "DELETE" }), {
      params: Promise.resolve({ id: "event-1", workerId: "worker-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.workerDelete).not.toHaveBeenCalled();
  });

  it("removes a worker and audits the removal", async () => {
    mocks.workerFindUnique.mockResolvedValue({
      id: "worker-1",
      eventId: "event-1",
      note: "Shot warmups",
      user: { id: "user-1", name: "Casey Cole", role: "COLLABORATOR" },
      event: { summary: "Wisconsin vs Ohio State", startsAt: new Date("2026-10-04T18:00:00.000Z") },
    });

    const response = await del(new Request("https://example.test", { method: "DELETE" }), {
      params: Promise.resolve({ id: "event-1", workerId: "worker-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.workerDelete).toHaveBeenCalledWith({ where: { id: "worker-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "event_worker_removed",
    }));
  });
});
