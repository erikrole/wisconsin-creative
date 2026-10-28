import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const NOW = new Date("2026-10-18T21:00:00Z");

function row(id: string, name: string, endsAt: string, extra: { allDay?: boolean; startsAt?: string; call?: [string, string]; event?: [string, string] } = {}) {
  return {
    callStartsAt: null,
    callEndsAt: null,
    user: { id, name, avatarUrl: null },
    shift: {
      area: "PHOTO",
      startsAt: new Date(extra.startsAt ?? "2026-10-18T20:00:00Z"),
      endsAt: new Date(endsAt),
      callStartsAt: extra.call ? new Date(extra.call[0]) : null,
      callEndsAt: extra.call ? new Date(extra.call[1]) : null,
      shiftGroup: { event: { summary: "Volleyball vs. Purdue", allDay: extra.allDay ?? false, startsAt: new Date(extra.event?.[0] ?? extra.startsAt ?? "2026-10-18T20:00:00Z"), endsAt: new Date(extra.event?.[1] ?? endsAt) } },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(requireAuth).mockResolvedValue(viewer);
});

afterEach(() => vi.useRealTimers());

describe("GET /api/users/on-shift", () => {
  it("only asks for confirmed assignments on published, current shifts", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([]);
    const res = await call();
    expect(res.status).toBe(200);
    const where = vi.mocked(db.shiftAssignment.findMany).mock.calls[0]?.[0]?.where as { status: unknown; user: unknown; shift: { shiftGroup: unknown; startsAt: { lte: unknown }; endsAt: { gte: unknown } } };
    expect(where.status).toEqual({ in: ["DIRECT_ASSIGNED", "APPROVED"] });
    expect(where.shift.shiftGroup).toEqual({ publishedAt: { not: null }, archivedAt: null });
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
      { id: "p1", name: "Maya Chen", avatarUrl: null, area: "PHOTO", event: "Volleyball vs. Purdue", endsAt: "2026-10-18T22:00:00.000Z", endsAtLabel: "5:00 PM" },
      { id: "p2", name: "Ben Ortiz", avatarUrl: null, area: "PHOTO", event: "Volleyball vs. Purdue", endsAt: "2026-10-18T23:30:00.000Z", endsAtLabel: "6:30 PM" },
    ]);
  });

  it("skips all-day events with no call time and shifts that have not started", async () => {
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([
      row("a", "All Day", "2026-10-19T00:00:00Z", { allDay: true, startsAt: "2026-10-18T00:00:00Z" }),
      row("b", "Later Tonight", "2026-10-19T03:00:00Z", { startsAt: "2026-10-19T00:00:00Z" }),
      row("c", "Called In", "2026-10-19T03:00:00Z", { allDay: true, startsAt: "2026-10-18T00:00:00Z", call: ["2026-10-18T20:00:00Z", "2026-10-18T23:00:00Z"] }),
    ] as never);
    const body = await (await call()).json();
    expect(body.data.map((p: { id: string }) => p.id)).toEqual(["c"]);
    expect(body.data[0].endsAtLabel).toBe("6:00 PM");
  });

  it("uses the game's own time when the crew still holds a stale full-day window", async () => {
    // Timed game later tonight; the shift kept the midnight-to-midnight window it was made with.
    const stale = { startsAt: "2026-10-18T00:00:00Z", event: ["2026-10-19T00:00:00Z", "2026-10-19T02:30:00Z"] as [string, string] };
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([row("a", "Early", "2026-10-19T00:00:00Z", stale)] as never);
    expect((await (await call()).json()).data).toEqual([]);

    vi.setSystemTime(new Date("2026-10-19T00:30:00Z"));
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([row("a", "Early", "2026-10-19T00:00:00Z", stale)] as never);
    expect((await (await call()).json()).data.map((p: { id: string }) => p.id)).toEqual(["a"]);
  });

  it("is closed to collaborators", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...viewer, role: "COLLABORATOR" as never });
    const res = await call();
    expect(res.status).toBe(403);
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });
});
