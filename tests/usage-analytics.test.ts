import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  productEvent: {
    create: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(async () => []),
  },
  notificationDelivery: {
    groupBy: vi.fn(async () => []),
  },
  jobRun: { groupBy: vi.fn(async () => []) },
  appDiagnostic: { groupBy: vi.fn(async () => []) },
  userAppInstallation: {
    upsert: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));

import { requireAuth } from "@/lib/auth";
import { POST as postProductEvent } from "@/app/api/product-events/route";
import { GET as getUsageReport } from "@/app/api/reports/usage/route";
import { GET as getAppActivityReport } from "@/app/api/settings/app-activity/route";
import { canViewUsageAnalytics, pseudonymousAnalyticsKey } from "@/lib/usage-analytics";

const owner = {
  id: "owner-1", name: "Owner", email: "owner@example.com", role: Role.ADMIN,
  forcePasswordChange: false, avatarUrl: null, affiliation: null, collaboratorProfile: null,
  staffingType: undefined, capabilities: [], collaboratorPolicy: null,
};

function request(path: string, method = "GET", body?: object) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: { origin: "https://app.example.com", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.USAGE_ANALYTICS_OWNER_EMAILS = "owner@example.com";
  process.env.USAGE_ANALYTICS_HASH_SECRET = "a-private-test-secret-with-more-than-32-characters";
  vi.mocked(requireAuth).mockResolvedValue(owner);
  dbMock.productEvent.create.mockResolvedValue({ id: "event-1" });
  dbMock.productEvent.groupBy.mockResolvedValue([]);
  dbMock.userAppInstallation.upsert.mockResolvedValue({ id: "installation-1" });
});

describe("private usage analytics", () => {
  it("uses the isolated session secret when an inherited analytics secret is explicitly blanked", () => {
    const previous = process.env.SESSION_SECRET;
    try {
      process.env.SESSION_SECRET = "preview-only-session-secret";
      process.env.USAGE_ANALYTICS_HASH_SECRET = "";
      expect(pseudonymousAnalyticsKey("synthetic-person")).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      if (previous === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
    }
  });
  it("does not grant access from ADMIN role alone", async () => {
    process.env.USAGE_ANALYTICS_OWNER_EMAILS = "someone-else@example.com";
    expect(canViewUsageAnalytics(owner)).toBe(false);
    const response = await getUsageReport(request("/api/reports/usage"), { params: Promise.resolve({}) });
    expect(response.status).toBe(403);
    expect(dbMock.productEvent.groupBy).not.toHaveBeenCalled();
  });

  it("allows only an explicitly configured owner", async () => {
    expect(canViewUsageAnalytics(owner)).toBe(true);
    const response = await getUsageReport(request("/api/reports/usage?days=7"), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      days: 7, totalEvents: 0, activeUsers: 0, platforms: [], surfaces: [], events: [], versions: [],
      notifications: { deliveries: [], pushReadiness: [], preferenceChanges: [], responses: [], timeToAct: [] },
      health: { jobs: [], diagnostics: [] },
    });
  });

  it("returns populated aggregates with five reads and one consistent period", async () => {
    dbMock.productEvent.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      switch (by.join(",")) {
        case "actorHash": return [{ actorHash: "hash-a" }, { actorHash: "hash-b" }];
        case "platform": return [{ platform: "web", _count: { _all: 4 } }, { platform: "ios", _count: { _all: 6 } }];
        case "surface": return [{ surface: "schedule", _count: { _all: 10 } }];
        case "eventName": return [{ eventName: "surface_viewed", _count: { _all: 10 } }];
        case "platform,appVersion": return [{ platform: "ios", appVersion: "1.0", _count: { _all: 6 } }];
        default: throw new Error(`Unexpected aggregate: ${by}`);
      }
    });
    const earliestBoundary = Date.now() - 90 * 86_400_000;
    const response = await getUsageReport(request("/api/reports/usage?days=90"), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      days: 90, totalEvents: 10, activeUsers: 2,
      platforms: [{ name: "web", count: 4 }, { name: "ios", count: 6 }],
      surfaces: [{ name: "schedule", count: 10 }],
      events: [{ name: "surface_viewed", count: 10 }],
      versions: [{ platform: "ios", version: "1.0", count: 6 }],
      notifications: { deliveries: [], pushReadiness: [], preferenceChanges: [], responses: [], timeToAct: [] },
      health: { jobs: [], diagnostics: [] },
    });
    expect(dbMock.productEvent.groupBy).toHaveBeenCalledTimes(5);
    const boundaries = dbMock.productEvent.groupBy.mock.calls.map(([args]) => args.where.occurredAt.gte.getTime());
    expect(new Set(boundaries).size).toBe(1);
    expect(boundaries[0]).toBeGreaterThanOrEqual(earliestBoundary);
    expect(boundaries[0]).toBeLessThanOrEqual(Date.now() - 90 * 86_400_000);
  });

  it("stores only allowlisted, pseudonymous event fields", async () => {
    const response = await postProductEvent(request("/api/product-events", "POST", {
      eventName: "surface_viewed",
      platform: "ios",
      surface: "schedule",
      appVersion: "26.8.12",
      sessionKey: "1234567890abcdef",
    }), { params: Promise.resolve({}) });
    expect(response.status).toBe(202);
    expect(dbMock.productEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      eventName: "surface_viewed",
      platform: "ios",
      surface: "schedule",
    }) });
    expect(JSON.stringify(dbMock.productEvent.create.mock.calls[0])).not.toContain(owner.id);
    expect(pseudonymousAnalyticsKey(owner.id)).not.toBe(owner.id);
  });

  it("records coarse app client identity separately from event analytics", async () => {
    const response = await postProductEvent(request("/api/product-events", "POST", {
      eventName: "app_opened",
      platform: "ios",
      surface: "home",
      appVersion: "1.0",
      appBuild: "27",
      osVersion: "26.0",
      deviceModel: "iPhone17,1",
      releaseChannel: "testflight",
      installationKey: "1234567890abcdef-installation",
    }), { params: Promise.resolve({}) });

    expect(response.status).toBe(202);
    expect(dbMock.userAppInstallation.upsert).toHaveBeenCalledWith({
      where: {
        userId_installationHash_platform: {
          userId: owner.id,
          installationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          platform: "ios",
        },
      },
      create: expect.objectContaining({
        userId: owner.id,
        platform: "ios",
        appVersion: "1.0",
        appBuild: "27",
        osVersion: "26.0",
        deviceModel: "iPhone17,1",
        releaseChannel: "testflight",
        lastOpenedAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        appBuild: "27",
        releaseChannel: "testflight",
        lastOpenedAt: expect.any(Date),
      }),
    });
  });

  it("keeps the named app activity report owner-only", async () => {
    process.env.USAGE_ANALYTICS_OWNER_EMAILS = "someone-else@example.com";
    const response = await getAppActivityReport(request("/api/settings/app-activity"), { params: Promise.resolve({}) });
    expect(response.status).toBe(403);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it("rejects free-form properties and record identifiers", async () => {
    const response = await postProductEvent(request("/api/product-events", "POST", {
      eventName: "surface_viewed",
      platform: "web",
      surface: "items",
      properties: { bookingId: "booking-1" },
    }), { params: Promise.resolve({}) });
    expect(response.status).toBe(400);
    expect(dbMock.productEvent.create).not.toHaveBeenCalled();
  });
});
