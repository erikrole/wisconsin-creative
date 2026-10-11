import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onAppOpened: vi.fn(),
  requireRole: vi.fn(),
  earnedBadgesSince: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (req: Request, context: unknown) => Promise<Response>) =>
    (req: Request) => handler(req, {
      user: { id: "user-1", role: "STUDENT" },
    }),
}));

vi.mock("@/lib/badges", () => ({
  badges: { onAppOpened: mocks.onAppOpened },
  earnedBadgesSince: mocks.earnedBadgesSince,
}));

vi.mock("@/lib/rbac", () => ({
  requireRole: mocks.requireRole,
}));

import { POST } from "@/app/api/badges/events/app-open/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onAppOpened.mockResolvedValue(undefined);
  mocks.earnedBadgesSince.mockResolvedValue([]);
});

describe("badge app-open event", () => {
  it("uses authenticated identity and server time", async () => {
    const before = Date.now();
    const response = await (POST as unknown as (req: Request) => Promise<Response>)(
      new Request("http://test/api/badges/events/app-open", {
        method: "POST",
        body: JSON.stringify({ userId: "someone-else", occurredAt: "1999-01-01T02:00:00Z" }),
      }),
    );
    const after = Date.now();

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith("STUDENT", ["ADMIN", "STAFF", "STUDENT"]);
    expect(mocks.onAppOpened).toHaveBeenCalledTimes(1);
    const event = mocks.onAppOpened.mock.calls[0]?.[0];
    expect(event.userId).toBe("user-1");
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("returns awards earned since the caller's cursor in the same request", async () => {
    mocks.earnedBadgesSince.mockResolvedValue([{ id: "award-1" }]);
    const after = new Date(Date.now() - 60_000).toISOString();
    const response = await (POST as unknown as (req: Request) => Promise<Response>)(
      new Request(`http://test/api/badges/events/app-open?after=${encodeURIComponent(after)}`, { method: "POST" }),
    );
    const body = await response.json();
    expect(mocks.earnedBadgesSince).toHaveBeenCalledWith("user-1", new Date(after));
    expect(body.data.awards).toEqual([{ id: "award-1" }]);
    expect(typeof body.data.nextCursor).toBe("string");
    expect(body.data.accepted).toBe(true);
  });

  it("never replays history without a usable cursor", async () => {
    for (const query of ["", "?after=nonsense", `?after=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`]) {
      const response = await (POST as unknown as (req: Request) => Promise<Response>)(
        new Request(`http://test/api/badges/events/app-open${query}`, { method: "POST" }),
      );
      const body = await response.json();
      expect(body.data).toEqual({ accepted: true });
    }
    expect(mocks.earnedBadgesSince).not.toHaveBeenCalled();
  });
});
