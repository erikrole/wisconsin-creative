import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { deviceToken: { findMany: vi.fn(async () => []), updateMany: vi.fn() } },
}));
vi.mock("@/lib/push/apns", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/push/web", () => ({
  isWebPushConfigured: vi.fn(() => false),
  sendWebPushToUser: vi.fn(),
}));
vi.mock("@/lib/services/notification-prefs", () => ({
  loadUserPrefs: vi.fn(),
  shouldDeliverPush: vi.fn(() => true),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { POST as testApns } from "@/app/api/devices/test/route";
import { POST as testWebPush } from "@/app/api/push/web/test/route";

function post(path: string, body?: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("test push routes are throttled per user", () => {
  it("stops repeated app test pushes after a few per minute", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "apns-user", email: "a@example.com", name: "A", role: Role.STUDENT, avatarUrl: null });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await testApns(post("/api/devices/test", { token: "abc" }), ctx)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("stops repeated browser test pushes after a few per minute", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "web-user", email: "w@example.com", name: "W", role: Role.STUDENT, avatarUrl: null });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await testWebPush(post("/api/push/web/test"), ctx)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
