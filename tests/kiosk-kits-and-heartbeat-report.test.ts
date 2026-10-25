import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKiosk: vi.fn(),
  listKits: vi.fn(),
  suggestKit: vi.fn(),
  getKitDetail: vi.fn(),
  attachAvailability: vi.fn(),
  kioskFindUnique: vi.fn(),
  kioskUpdate: vi.fn(),
  enforceRateLimit: vi.fn(),
  refreshProjection: vi.fn(),
  remember: vi.fn(),
  recordBeat: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireKiosk: mocks.requireKiosk,
}));
vi.mock("@/lib/db", () => ({ db: { kioskDevice: { findUnique: mocks.kioskFindUnique, update: mocks.kioskUpdate } } }));
vi.mock("@/lib/services/kits", () => ({
  listKits: mocks.listKits,
  suggestFootballGamedayKit: mocks.suggestKit,
  getKitDetail: mocks.getKitDetail,
}));
vi.mock("@/lib/services/kit-member-availability", () => ({ attachKitMemberAvailability: mocks.attachAvailability }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/services/companion-projection", () => ({ refreshCompanionProjection: mocks.refreshProjection }));
vi.mock("@/lib/kiosk-heartbeat-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kiosk-heartbeat-cache")>()),
  readCachedKioskHeartbeat: vi.fn(async () => null),
  rememberKioskHeartbeat: mocks.remember,
  recordKioskBeat: mocks.recordBeat,
}));

import { HttpError } from "@/lib/http";
import { GET as listKioskKits } from "@/app/api/kiosk/kits/route";
import { GET as getKioskKit } from "@/app/api/kiosk/kits/[id]/route";
import { POST as heartbeat } from "@/app/api/kiosk/heartbeat/route";

const noParams = { params: Promise.resolve({}) };

function kitRow(id: string, name: string, gamedayRole: string | null, members: number, bulkMembers = 0) {
  return { id, name, sportCode: "FB", gamedayRole, _count: { members, bulkMembers } };
}

function kitDetail(over: Record<string, unknown> = {}) {
  return {
    id: "kit-1",
    name: "Roam 2 kit",
    active: true,
    sportCode: "FB",
    gamedayRole: "ROAM2",
    location: { name: "Camp Randall Stadium" },
    members: [{
      asset: {
        id: "fx3-1",
        assetTag: "FX3-1",
        name: "Sony FX3",
        imageUrl: undefined,
        computedStatus: "CHECKED_OUT",
        currentHolder: { holderName: "Maya" },
        serialNumber: "secret-serial",
      },
    }],
    bulkMembers: [{ quantity: 4, bulkSku: { id: "batt", name: "Sony Battery", imageUrl: null } }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKiosk.mockResolvedValue({ kioskId: "k1", name: "Video Office", locationId: "cr", locationName: "Camp Randall" });
  mocks.attachAvailability.mockImplementation(async (kit: unknown) => kit);
});

describe("GET /api/kiosk/kits", () => {
  beforeEach(() => {
    mocks.listKits.mockResolvedValue({
      data: [
        kitRow("k-b", "Basketball baseline", null, 3),
        kitRow("k-empty", "Empty kit", "ROAM3", 0, 0),
        kitRow("k-roam2", "Roam 2", "ROAM2", 2, 1),
        kitRow("k-slow1", "Slow 1", "SLOW1", 4),
      ],
    });
    mocks.suggestKit.mockResolvedValue("k-roam2");
  });

  it("lists this location's non-empty active kits in gameday call order", async () => {
    const res = await listKioskKits(new Request("http://test/api/kiosk/kits"), noParams);
    const body = await res.json();

    expect(mocks.listKits).toHaveBeenCalledWith(expect.objectContaining({ locationId: "cr", includeArchived: false }));
    expect(body.data.map((kit: { id: string }) => kit.id)).toEqual(["k-slow1", "k-roam2", "k-b"]);
    expect(body.data[1]).toEqual({ id: "k-roam2", name: "Roam 2", sportCode: "FB", gamedayRole: "ROAM2", contents: 3 });
    expect(body.suggestedKitId).toBeNull();
    expect(mocks.suggestKit).not.toHaveBeenCalled();
  });

  it.each(["requester_user_id", "userId"])("suggests a kit for the person named by %s", async (param) => {
    const res = await listKioskKits(new Request(`http://test/api/kiosk/kits?${param}=maya`), noParams);

    expect((await res.json()).suggestedKitId).toBe("k-roam2");
    expect(mocks.suggestKit).toHaveBeenCalledWith({ requesterUserId: "maya", locationId: "cr" });
  });
});

describe("GET /api/kiosk/kits/[id]", () => {
  const get = () => getKioskKit(new Request("http://test/api/kiosk/kits/kit-1"), { params: Promise.resolve({ id: "kit-1" }) });

  beforeEach(() => {
    mocks.getKitDetail.mockResolvedValue(kitDetail());
  });

  it("returns only the fields the kiosk shows, treating the stadium room as Camp Randall", async () => {
    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.members).toEqual([{
      id: "fx3-1",
      assetTag: "FX3-1",
      name: "Sony FX3",
      imageUrl: null,
      computedStatus: "CHECKED_OUT",
      holderName: "Maya",
    }]);
    expect(body.data.bulkMembers).toEqual([{ bulkSkuId: "batt", name: "Sony Battery", quantity: 4, imageUrl: null }]);
  });

  it("refuses an archived kit", async () => {
    mocks.getKitDetail.mockResolvedValue(kitDetail({ active: false }));

    const res = await get();

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Roam 2 kit is archived and cannot be added to a booking");
  });

  it("refuses a kit kept at another pickup counter", async () => {
    mocks.getKitDetail.mockResolvedValue(kitDetail({ location: { name: "Kohl Center" } }));

    const res = await get();

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Roam 2 kit belongs to Kohl Center, not this pickup location");
  });
});

describe("POST /api/kiosk/heartbeat build report", () => {
  const stored = { appVersion: "1.4.0", appBuild: "36", osVersion: "26.0", deviceModel: "iPad13,18" };
  const beat = (body?: unknown) =>
    heartbeat(new Request("https://app.example.com/api/kiosk/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "app.example.com",
        origin: "https://app.example.com",
        cookie: "kiosk_session=raw-token",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), noParams);

  beforeEach(() => {
    mocks.kioskFindUnique.mockImplementation(async ({ select }: { select: Record<string, boolean> }) =>
      select.sessionExpiresAt ? { ...stored, sessionExpiresAt: new Date(Date.now() + 86_400_000) } : stored);
  });

  it("stores a new build and refreshes the companion app's fleet view", async () => {
    const res = await beat({ ...stored, appVersion: "1.4.1", appBuild: "37" });

    expect(res.status).toBe(200);
    expect(mocks.kioskUpdate).toHaveBeenCalledWith({
      where: { id: "k1" },
      data: expect.objectContaining({ ...stored, appVersion: "1.4.1", appBuild: "37", appReportedAt: expect.any(Date) }),
    });
    expect(mocks.refreshProjection).toHaveBeenCalledWith({ notify: true });
  });

  it("writes nothing when the kiosk reports the build it already has", async () => {
    await beat(stored);

    expect(mocks.kioskUpdate).not.toHaveBeenCalled();
    expect(mocks.refreshProjection).not.toHaveBeenCalled();
    expect(mocks.remember).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kioskId: "k1", report: stored }));
  });

  it("ignores blank or non-text fields and trims long ones", async () => {
    await beat({ appVersion: "   ", appBuild: 38, osVersion: "26.1", deviceModel: `iPad${"x".repeat(100)}` });

    const data = mocks.kioskUpdate.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("appVersion");
    expect(data).not.toHaveProperty("appBuild");
    expect(data.osVersion).toBe("26.1");
    expect(data.deviceModel).toHaveLength(64);
  });

  it.each([["an empty body", undefined], ["an empty report", {}]])("accepts %s from older kiosk builds", async (_label, body) => {
    const res = await beat(body);

    expect(res.status).toBe(200);
    expect(mocks.kioskUpdate).not.toHaveBeenCalled();
  });

  it("is rate limited per kiosk", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new HttpError(429, "Too many requests"));

    const res = await beat({ ...stored, appBuild: "37" });

    expect(res.status).toBe(429);
    expect(mocks.kioskUpdate).not.toHaveBeenCalled();
  });
});
