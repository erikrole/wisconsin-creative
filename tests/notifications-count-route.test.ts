import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    notification: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/services/notification-resolution", () => ({
  resolveSettledNotificationsForUser: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resolveSettledNotificationsForUser } from "@/lib/services/notification-resolution";
import { GET } from "@/app/api/notifications/count/route";

const user = {
  id: "cm000000000000000000000001",
  email: "staff@example.com",
  name: "Staff User",
  role: "STAFF" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

describe("GET /api/notifications/count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(user);
    vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  });

  it("returns the caller's unread count without browser caching", async () => {
    vi.mocked(db.notification.count).mockResolvedValue(7 as never);

    const res = await GET(
      new Request("https://app.example.com/api/notifications/count"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual({ unreadCount: 7 });
    expect(enforceRateLimit).toHaveBeenCalledWith(
      "notifications:count:cm000000000000000000000001",
      { max: 180, windowMs: 60_000 },
    );
    expect(db.notification.count).toHaveBeenCalledWith({
      where: { userId: user.id, readAt: null },
    });
    // Settled rows are cleared before counting, so the badge counts open work.
    expect(resolveSettledNotificationsForUser).toHaveBeenCalledWith(user.id);
    expect(vi.mocked(resolveSettledNotificationsForUser).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(db.notification.count).mock.invocationCallOrder[0]!);
  });
});
