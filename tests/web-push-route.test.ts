import { beforeEach, describe, expect, it, vi } from "vitest";

const txSubscription = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
}));
const txUser = vi.hoisted(() => ({ findUnique: vi.fn() }));
const topSubscription = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    webPushSubscription: topSubscription,
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 },
}));
vi.mock("@/lib/push/web", () => ({
  getWebPushPublicKey: vi.fn(() => "public-vapid-key"),
  isWebPushConfigured: vi.fn(() => true),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { DELETE, GET, POST } from "@/app/api/push/web/route";

const user = {
  id: "student-1",
  email: "student@example.com",
  name: "Student User",
  role: "STUDENT" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

const subscription = {
  endpoint: "https://push.example.test/subscription-1",
  keys: { p256dh: "public-key", auth: "auth-key" },
};

function request(method: string, body?: unknown) {
  return new Request("https://app.example.com/api/push/web", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function routeParams() {
  return { params: Promise.resolve({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  txUser.findUnique.mockResolvedValue({ active: true });
  txSubscription.findMany.mockResolvedValue([{ id: "subscription-1" }]);
  txSubscription.updateMany.mockResolvedValue({ count: 0 });
  txSubscription.upsert.mockResolvedValue({ id: "subscription-1" });
  topSubscription.findFirst.mockResolvedValue({ id: "subscription-1" });
  topSubscription.updateMany.mockResolvedValue({ count: 1 });
  vi.mocked(db.$transaction).mockImplementation((async (callback: unknown) => (
    callback as (tx: unknown) => Promise<unknown>
  )({ user: txUser, webPushSubscription: txSubscription })) as never);
});

describe("/api/push/web", () => {
  it("reports configuration and the caller's active browser subscription", async () => {
    const response = await GET(request("GET"), routeParams());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { configured: true, publicKey: "public-vapid-key", subscribed: true },
    });
    expect(topSubscription.findFirst).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      select: { id: true },
    });
  });

  it("registers a validated browser subscription transactionally and prunes old rows", async () => {
    const response = await POST(request("POST", subscription), routeParams());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { subscribed: true } });
    expect(txSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint },
      update: {
        userId: user.id,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        lastSeenAt: expect.any(Date),
        revokedAt: null,
      },
      create: {
        userId: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
    expect(txSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("rejects non-HTTPS endpoints without writing", async () => {
    const response = await POST(
      request("POST", { ...subscription, endpoint: "http://push.example.test/subscription-1" }),
      routeParams(),
    );
    expect(response.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("revokes only the browser subscription requested by the caller", async () => {
    const response = await DELETE(request("DELETE", { endpoint: subscription.endpoint }), routeParams());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { subscribed: false } });
    expect(topSubscription.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, endpoint: subscription.endpoint },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
