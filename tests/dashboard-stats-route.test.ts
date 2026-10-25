import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  checkRateLimit: vi.fn(),
  readCounts: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/db", () => ({ db: { shiftAssignment: { count: mocks.count } } }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@/lib/services/dashboard-counts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/dashboard-counts")>()),
  readDashboardCounts: mocks.readCounts,
}));

import { GET } from "@/app/api/dashboard/stats/route";

const counts = {
  teamCheckoutsTotal: 2, teamCheckoutsOverdue: 1, teamReservationsTotal: 3,
  myCheckoutsTotal: 4, myOverdue: 1, myDueToday: 2,
  totalCheckedOut: 40, totalOverdue: 5, totalReserved: 12, dueToday: 6,
  pendingPickupTotal: 7, staleReservationTotal: 8,
};
// 9 AM Chicago on Oct 25 (CDT, UTC-5).
const now = new Date("2026-10-25T14:00:00.000Z");
const stats = async (query = "") => (await (await GET(new Request(`https://app.example.com/api/dashboard/stats${query}`), routeCtx({}))).json()).data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.readCounts.mockResolvedValue(counts);
  mocks.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
});
afterEach(() => { vi.useRealTimers(); });

describe("GET /api/dashboard/stats", () => {
  it("bounds today by the Chicago day, not the server's UTC day", async () => {
    await stats();

    expect(mocks.readCounts).toHaveBeenCalledWith(expect.objectContaining({
      userId: "staff-1",
      startOfToday: new Date("2026-10-25T05:00:00.000Z"),
      startOfTomorrow: new Date("2026-10-26T05:00:00.000Z"),
      sevenDaysFromNow: new Date("2026-11-01T14:00:00.000Z"),
    }));
  });

  it("shows staff the team numbers", async () => {
    const data = await stats();

    expect(data.stats).toEqual({ checkedOut: 40, overdue: 5, reserved: 12, dueToday: 6 });
    expect(data).toEqual(expect.objectContaining({
      role: Role.STAFF, overdueCount: 5, myCheckoutsTotal: 4, teamCheckoutsTotal: 2, teamReservationsTotal: 3,
      pendingPickupTotal: 7, staleReservationTotal: 8, myShiftsCount: 3, myShiftsTodayCount: 1,
    }));
  });

  it("shows only personal numbers for the iPhone Home scope", async () => {
    const data = await stats("?scope=ios-home");

    expect(data.stats).toEqual({ checkedOut: 4, overdue: 1, reserved: 9, dueToday: 2 });
    expect(data).toEqual(expect.objectContaining({ overdueCount: 1, teamCheckoutsTotal: 0, teamCheckoutsOverdue: 0, teamReservationsTotal: 0, pendingPickupTotal: 0, staleReservationTotal: 0 }));
  });

  it("never reports a negative personal reservation count", async () => {
    mocks.readCounts.mockResolvedValue({ ...counts, totalReserved: 1, teamReservationsTotal: 3 });

    expect((await stats("?scope=ios-home")).stats.reserved).toBe(0);
  });

  it("gives collaborators personal gear only when they may see it, and no shifts", async () => {
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.COLLABORATOR), capabilities: ["MY_GEAR_VIEW"] });
    let data = await stats();
    expect(data.stats).toEqual({ checkedOut: 4, overdue: 1, reserved: 9, dueToday: 2 });
    expect(data.myShiftsCount).toBe(0);
    expect(mocks.count).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.COLLABORATOR), capabilities: [] });
    data = await stats();
    expect(data.stats).toEqual({ checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 });
    expect(data).toEqual(expect.objectContaining({ overdueCount: 0, myCheckoutsTotal: 0, myOverdueCount: 0, myDueTodayCount: 0 }));
  });

  it("reports a failed count instead of failing the whole response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readCounts.mockRejectedValue(new Error("db down"));

    const res = await GET(new Request("https://app.example.com/api/dashboard/stats"), routeCtx({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.partialFailures).toEqual(["counts"]);
    expect(body.data.stats).toEqual({ checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 });
    expect(body.data.myShiftsCount).toBe(3);
  });

  it("stops at the rate limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });

    const res = await GET(new Request("https://app.example.com/api/dashboard/stats"), routeCtx({}));

    expect(res.status).toBe(429);
    expect(mocks.readCounts).not.toHaveBeenCalled();
  });
});
