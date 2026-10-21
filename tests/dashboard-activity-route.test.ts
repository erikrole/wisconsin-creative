import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { findMany: vi.fn() }, booking: { findMany: vi.fn() } } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/dashboard/activity/route";

const viewer = (role: "STUDENT" | "STAFF" | "ADMIN" | "COLLABORATOR") =>
  ({ id: "u1", email: "a@test.com", name: "A", role, avatarUrl: null }) as never;

function call() {
  return GET(new Request("https://app.example.com/api/dashboard/activity"), { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
  vi.mocked(db.booking.findMany).mockResolvedValue([]);
});

describe("GET /api/dashboard/activity", () => {
  it("refuses students and collaborators", async () => {
    for (const role of ["STUDENT", "COLLABORATOR"] as const) {
      vi.mocked(requireAuth).mockResolvedValue(viewer(role));
      expect((await call()).status).toBe(403);
    }
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("reads only booking pickups, kiosk checkouts and completed returns from the last day", async () => {
    vi.mocked(requireAuth).mockResolvedValue(viewer("STAFF"));
    await call();
    const args = vi.mocked(db.auditLog.findMany).mock.calls[0]?.[0] as {
      where: { entityType: string; action: { in: string[] }; createdAt: { gte: Date } };
      take: number;
    };
    expect(args.where.entityType).toBe("booking");
    expect(args.where.action.in.sort()).toEqual(["checkin_completed", "kiosk_checkout", "kiosk_pickup"]);
    expect(Date.now() - args.where.createdAt.gte.getTime()).toBeLessThanOrEqual(24 * 3_600_000 + 1000);
    expect(args.take).toBeLessThanOrEqual(10);
  });

  it("maps rows to the borrower and drops bookings that no longer exist", async () => {
    vi.mocked(requireAuth).mockResolvedValue(viewer("ADMIN"));
    const at = new Date();
    vi.mocked(db.auditLog.findMany).mockResolvedValue([
      { id: "l1", action: "checkin_completed", entityId: "b1", createdAt: at },
      { id: "l2", action: "kiosk_pickup", entityId: "gone", createdAt: at },
    ] as never);
    vi.mocked(db.booking.findMany).mockResolvedValue([
      { id: "b1", title: "Soccer at Iowa", requester: { id: "p1", name: "Sam Okafor", avatarUrl: null } },
    ] as never);
    const body = await (await call()).json();
    expect(body.data).toEqual([
      { id: "l1", kind: "returned", bookingId: "b1", title: "Soccer at Iowa", person: { id: "p1", name: "Sam Okafor", avatarUrl: null }, at: at.toISOString() },
    ]);
  });
});
