import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
  },
  productEvent: {
    groupBy: vi.fn(),
  },
  appDiagnostic: {
    groupBy: vi.fn(),
  },
  kioskDevice: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
}));
const presenceMock = vi.hoisted(() => ({ readCompanionPresence: vi.fn() }));
const storeMock = vi.hoisted(() => ({ loadAppStoreVersion: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/companion-store", () => presenceMock);
vi.mock("@/lib/apps-live-versions", () => storeMock);
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET as getAppActivity } from "@/app/api/settings/app-activity/route";
import { getAppActivityReport } from "@/lib/services/app-activity-report";

const owner = {
  id: "owner-1",
  name: "Owner",
  email: "owner@example.com",
  role: Role.ADMIN,
  forcePasswordChange: false,
  avatarUrl: null,
  affiliation: null,
  collaboratorProfile: null,
  staffingType: undefined,
  capabilities: [],
  collaboratorPolicy: null,
};

const openedAt = new Date("2026-08-20T15:00:00.000Z");
const staleSeenAt = new Date("2026-08-20T16:00:00.000Z");
const latestSeenAt = new Date("2026-08-21T15:00:00.000Z");

function request() {
  return new Request("https://app.example.com/api/settings/app-activity", {
    headers: { origin: "https://app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.USAGE_ANALYTICS_OWNER_EMAILS = "owner@example.com";
  process.env.USAGE_ANALYTICS_HASH_SECRET = "a-private-test-secret-with-more-than-32-characters";
  process.env.IOS_LATEST_APP_VERSION = "1.0";
  process.env.IOS_LATEST_APP_BUILD = "27";
  vi.mocked(requireAuth).mockResolvedValue(owner);
  dbMock.$queryRaw.mockResolvedValue([]);
  dbMock.productEvent.groupBy.mockResolvedValue([]);
  dbMock.appDiagnostic.groupBy.mockResolvedValue([]);
  dbMock.kioskDevice.findMany.mockResolvedValue([]);
  presenceMock.readCompanionPresence.mockResolvedValue(new Map());
  storeMock.loadAppStoreVersion.mockResolvedValue(undefined);
  dbMock.user.findMany.mockResolvedValue([
    {
      id: "user-erik",
      createdAt: new Date("2026-06-01T15:00:00.000Z"),
      deviceTokens: [],
      webPushSubscriptions: [],
      name: "Erik Role",
      email: "erik@example.com",
      role: Role.ADMIN,
      active: true,
      appInstallations: [
        {
          platform: "ios",
          appVersion: "1.0",
          appBuild: "26",
          osVersion: "26.0",
          deviceModel: "iPhone17,1",
          releaseChannel: "testflight",
          firstSeenAt: new Date("2026-08-01T15:00:00.000Z"),
          lastSeenAt: staleSeenAt,
          lastOpenedAt: openedAt,
        },
      ],
    },
    {
      id: "user-sam",
      createdAt: new Date("2026-06-01T15:00:00.000Z"),
      deviceTokens: [],
      webPushSubscriptions: [],
      name: "Sam Never Opened",
      email: "sam@example.com",
      role: Role.STUDENT,
      active: true,
      appInstallations: [],
    },
    {
      id: "user-taylor",
      createdAt: new Date("2026-06-01T15:00:00.000Z"),
      deviceTokens: [{ id: "token-1" }],
      webPushSubscriptions: [],
      name: "Taylor Store",
      email: "taylor@example.com",
      role: Role.STAFF,
      active: false,
      appInstallations: [
        {
          platform: "ios",
          appVersion: "1.0",
          appBuild: "27",
          osVersion: "18.6",
          deviceModel: "iPhone15,2",
          releaseChannel: "app_store",
          firstSeenAt: new Date("2026-07-20T15:00:00.000Z"),
          lastSeenAt: latestSeenAt,
          lastOpenedAt: latestSeenAt,
        },
      ],
    },
  ]);
});

describe("owner app activity report", () => {
  it("joins named roster users to client identity and build status", async () => {
    const report = await getAppActivityReport();

    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { hiddenFromRoster: false },
      select: expect.objectContaining({ appInstallations: expect.any(Object) }),
    }));
    expect(report.latestIosBuild).toEqual({ version: "1.0", build: "27", source: "configured" });
    expect(report.summary).toMatchObject({
      totalUsers: 3,
      usedUsers: 2,
      neverUsedUsers: 1,
      iosUsers: 2,
      iosInstallations: 2,
      staleIosInstallations: 1,
      latestIosInstallations: 1,
      testflightInstallations: 1,
      appStoreInstallations: 1,
    });

    const erik = report.users.find((user) => user.email === "erik@example.com");
    expect(erik).toMatchObject({ used: true, lastUsedAt: openedAt.toISOString() });
    expect(erik?.clients[0]).toMatchObject({
      deviceModel: "iPhone17,1",
      appBuild: "26",
      buildStatus: "stale",
      releaseChannel: "testflight",
    });
  });

  it("finds the current build from the App Store listing when none is configured", async () => {
    delete process.env.IOS_LATEST_APP_VERSION;
    delete process.env.IOS_LATEST_APP_BUILD;
    storeMock.loadAppStoreVersion.mockResolvedValue({ version: "1.0" });

    const report = await getAppActivityReport();

    expect(report.latestIosBuild).toEqual({ version: "1.0", build: "27", source: "app_store" });
    expect(report.summary.staleIosInstallations).toBe(1);
    expect(report.versions.map((row) => [row.build, row.installs, row.status])).toEqual([
      ["27", 1, "latest"],
      ["26", 1, "stale"],
    ]);
  });

  it("never counts a local Xcode build as behind", async () => {
    const [erik] = await dbMock.user.findMany();
    erik.appInstallations[0].releaseChannel = "development";
    dbMock.user.findMany.mockResolvedValue([erik]);

    const report = await getAppActivityReport();

    expect(report.users[0]?.clients[0]?.buildStatus).toBe("development");
    expect(report.summary).toMatchObject({ staleIosInstallations: 0, developmentIosInstallations: 1 });
  });

  it("merges menu bar presence into people and the daily trend", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const seen = new Date().toISOString();
    presenceMock.readCompanionPresence.mockResolvedValue(new Map([
      ["user-erik", { appVersion: "1.4", osVersion: "26.1", firstSeenAt: seen, lastSeenAt: seen, days: [today] }],
    ]));
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ day: today, platform: "web", people: 3 }])
      .mockResolvedValueOnce([{ platform: "web", people: 3, events: 40 }])
      .mockResolvedValueOnce([{ people: 3 }]);

    const report = await getAppActivityReport(7);

    const erik = report.users.find((user) => user.email === "erik@example.com");
    expect(erik?.clients.find((client) => client.platform === "macos")).toMatchObject({ appVersion: "1.4" });
    expect(report.summary.macosUsers).toBe(1);
    expect(report.activity?.daily).toHaveLength(7);
    expect(report.activity?.daily.at(-1)).toMatchObject({ date: today, web: 3, macos: 1 });
    expect(report.activity?.platforms.find((row) => row.platform === "macos")).toMatchObject({ people: 1, events: 1 });
  });

  it("still lists people when the activity trend fails", async () => {
    dbMock.$queryRaw.mockRejectedValue(new Error("timeout"));
    const report = await getAppActivityReport();
    expect(report.activity).toBeNull();
    expect(report.users).toHaveLength(3);
  });

  it("flags old TestFlight builds, unreachable iPhones, crashes by version, and kiosk builds", async () => {
    dbMock.appDiagnostic.groupBy.mockResolvedValue([
      { platform: "ios", appVersion: "1.0", kind: "crash", _count: { _all: 2 } },
    ]);
    dbMock.kioskDevice.findMany.mockResolvedValue([
      { name: "Video Office iPad", appVersion: "1.0", appBuild: "2", osVersion: "26.6", lastSeenAt: latestSeenAt },
    ]);

    const report = await getAppActivityReport();

    expect(report.summary).toMatchObject({ oldTestflightInstallations: 1, iosPushOffUsers: 1 });
    expect(report.users.find((user) => user.email === "erik@example.com")).toMatchObject({ iosPush: false });
    expect(report.crashes).toEqual([{ platform: "ios", appVersion: "1.0", appBuild: null, kind: "crash", count: 2 }]);
    expect(report.kiosks[0]).toMatchObject({ name: "Video Office iPad", appBuild: "2" });
    expect(report.firstOpens.weeks).toHaveLength(12);
  });

  it("allows the report only to the configured owner", async () => {
    const response = await getAppActivity(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);

    process.env.USAGE_ANALYTICS_OWNER_EMAILS = "someone-else@example.com";
    dbMock.user.findMany.mockClear();
    const denied = await getAppActivity(request(), { params: Promise.resolve({}) });
    expect(denied.status).toBe(403);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });
});
