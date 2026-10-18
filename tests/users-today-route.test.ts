import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { shiftAssignment: { findMany: vi.fn() } } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/users/today/route";

const viewer = { id: "u1", email: "a@test.com", name: "A", role: "STUDENT" as const, avatarUrl: null };

function call() {
  return GET(new Request("https://app.example.com/api/users/today"), { params: Promise.resolve({}) });
}

const hour = 3_600_000;
function row(userId: string, name: string, group: string, startOffset: number, endOffset: number) {
  const now = Date.now();
  return {
    user: { id: userId, name, avatarUrl: null },
    shift: {
      area: "PHOTO",
      startsAt: new Date(now + startOffset * hour),
      endsAt: new Date(now + endOffset * hour),
      shiftGroup: { id: group, event: { summary: `Event ${group}` } },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(viewer);
});

describe("GET /api/users/today", () => {
  it("only reads confirmed assignments on published, non-archived groups that have not ended", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([]);
    await call();
    const where = vi.mocked(db.shiftAssignment.findMany).mock.calls[0]?.[0]?.where as {
      status: unknown;
      shift: { shiftGroup: unknown; endsAt: { gte: unknown } };
    };
    expect(where.status).toEqual({ in: ["DIRECT_ASSIGNED", "APPROVED"] });
    expect(where.shift.shiftGroup).toEqual({ publishedAt: { not: null }, archivedAt: null });
    expect(where.shift.endsAt.gte).toBeInstanceOf(Date);
  });

  it("groups people by event, marks live events, and counts people on shift now", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([
      row("p1", "Maya Chen", "g1", -1, 2),
      row("p2", "Ben Ortiz", "g1", -1, 2),
      row("p1", "Maya Chen", "g1", -1, 3),
    ] as never);
    const body = await (await call()).json();
    expect(body.data.onNowCount).toBe(2);
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].when).toBe("now");
    expect(body.data.events[0].people.map((p: { id: string }) => p.id)).toEqual(["p1", "p2"]);
  });

  it("marks shifts that start after midnight as tomorrow", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([row("p3", "Zoe Alvarez", "g2", 30, 33)] as never);
    const body = await (await call()).json();
    expect(body.data.onNowCount).toBe(0);
    expect(body.data.events[0].when).toBe("tomorrow");
  });

  it("is closed to collaborators", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...viewer, role: "COLLABORATOR" as never });
    const res = await call();
    expect(res.status).toBe(403);
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });
});
