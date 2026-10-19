import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { shiftAssignment: { findMany: vi.fn() } } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/users/on-shift/route";

const viewer = { id: "u1", email: "a@test.com", name: "A", role: "STAFF" as const, avatarUrl: null };

function call() {
  return GET(new Request("https://app.example.com/api/users/on-shift"), { params: Promise.resolve({}) });
}

function row(id: string, name: string, endsAt: string) {
  return {
    user: { id, name, avatarUrl: null },
    shift: { area: "PHOTO", endsAt: new Date(endsAt), shiftGroup: { event: { summary: "Volleyball vs. Purdue" } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(viewer);
});

describe("GET /api/users/on-shift", () => {
  it("only asks for confirmed assignments on published, current shifts", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([]);
    const res = await call();
    expect(res.status).toBe(200);
    const where = vi.mocked(db.shiftAssignment.findMany).mock.calls[0]?.[0]?.where as { status: unknown; user: unknown; shift: { shiftGroup: unknown; startsAt: { lte: unknown }; endsAt: { gte: unknown } } };
    expect(where.status).toEqual({ in: ["DIRECT_ASSIGNED", "APPROVED"] });
    expect(where.shift.shiftGroup).toEqual({ publishedAt: { not: null }, archivedAt: null });
    expect(where.shift.startsAt.lte).toBeInstanceOf(Date);
    expect(where.shift.endsAt.gte).toBeInstanceOf(Date);
    expect(where.user).toEqual({ active: true, hiddenFromRoster: false });
  });

  it("returns each person once with their area, event and end time", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([
      row("p1", "Maya Chen", "2026-10-18T22:00:00Z"),
      row("p1", "Maya Chen", "2026-10-18T23:00:00Z"),
      row("p2", "Ben Ortiz", "2026-10-18T23:30:00Z"),
    ] as never);
    const body = await (await call()).json();
    expect(body.data).toEqual([
      { id: "p1", name: "Maya Chen", avatarUrl: null, area: "PHOTO", event: "Volleyball vs. Purdue", endsAt: "2026-10-18T22:00:00.000Z" },
      { id: "p2", name: "Ben Ortiz", avatarUrl: null, area: "PHOTO", event: "Volleyball vs. Purdue", endsAt: "2026-10-18T23:30:00.000Z" },
    ]);
  });

  it("is closed to collaborators", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...viewer, role: "COLLABORATOR" as never });
    const res = await call();
    expect(res.status).toBe(403);
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });
});
