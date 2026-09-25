import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  notificationCreateManyAndReturn: vi.fn(),
  notificationFindMany: vi.fn(),
  createAuditEntry: vi.fn(),
  createSystemAuditEntry: vi.fn(),
  sendPushToUser: vi.fn(),
  deferPush: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.bookingFindUnique },
    user: { findFirst: mocks.userFindFirst },
    notification: { createManyAndReturn: mocks.notificationCreateManyAndReturn, findMany: mocks.notificationFindMany },
  },
}));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (req: Request, ctx: unknown) => Promise<Response>) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1", locationId: "loc-1", locationName: "Camp Randall" } }),
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.createAuditEntry, createSystemAuditEntry: mocks.createSystemAuditEntry }));
vi.mock("@/lib/services/notifications", () => ({ sendPushToUser: mocks.sendPushToUser, deferPush: mocks.deferPush }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));

import { POST } from "@/app/api/kiosk/checkout/[id]/nudge/route";
import { kioskNudgeCopy, kioskNudgeDedupeKey, kioskNudgedTodaySet } from "@/lib/services/kiosk-nudge";

const run = POST as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const day = 24 * 60 * 60 * 1000;

function nudge(body?: unknown) {
  return run(
    new Request("http://test", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({ id: "co-1" }) },
  );
}

function checkout(extra: Record<string, unknown> = {}) {
  return {
    id: "co-1", kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON",
    endsAt: new Date(Date.now() - 2 * day - 60_000), title: "Sony FX3 kit", requesterUserId: "owner-1", ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.notificationCreateManyAndReturn.mockResolvedValue([{ id: "n-1" }]);
});

describe("POST /api/kiosk/checkout/[id]/nudge", () => {
  it("lets anyone at the kiosk nudge an overdue personal checkout, with no actor", async () => {
    mocks.bookingFindUnique.mockResolvedValue(checkout());
    const res = await nudge();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const data = mocks.notificationCreateManyAndReturn.mock.calls[0]![0].data[0];
    expect(data).toMatchObject({
      userId: "owner-1",
      bookingId: "co-1",
      title: "Someone's looking for your Sony FX3 kit",
      body: "It's 2 days overdue and someone at the kiosk needs it. Please bring it back.",
      dedupeKey: kioskNudgeDedupeKey("co-1"),
    });
    expect(mocks.notificationCreateManyAndReturn.mock.calls[0]![0].skipDuplicates).toBe(true);
    expect(mocks.deferPush).toHaveBeenCalledTimes(1);
    expect(mocks.createSystemAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "kiosk_overdue_nudge_sent", entityId: "co-1" }));
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith("kiosk:nudge:kiosk-1", expect.any(Object));
  });

  it("audits the identified actor when one is sent", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "actor-1", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue(checkout());
    expect((await nudge({ actorId: "actor-1" })).status).toBe(200);
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ actorId: "actor-1", action: "kiosk_overdue_nudge_sent" }));
  });

  it("answers alreadyNudged for a second nudge the same local day, without a push", async () => {
    mocks.bookingFindUnique.mockResolvedValue(checkout());
    mocks.notificationCreateManyAndReturn.mockResolvedValue([]);
    expect(await (await nudge({})).json()).toEqual({ success: true, alreadyNudged: true });
    expect(mocks.deferPush).not.toHaveBeenCalled();
    expect(mocks.createSystemAuditEntry).not.toHaveBeenCalled();
  });

  it("refuses shared, not-overdue, and closed checkouts", async () => {
    mocks.bookingFindUnique.mockResolvedValue(checkout({ custodyScope: "SHARED" }));
    await expect(nudge()).rejects.toMatchObject({ status: 409, data: { code: "shared_custody" } });
    mocks.bookingFindUnique.mockResolvedValue(checkout({ endsAt: new Date(Date.now() + day) }));
    await expect(nudge()).rejects.toMatchObject({ status: 409, data: { code: "not_overdue" } });
    mocks.bookingFindUnique.mockResolvedValue(checkout({ status: "COMPLETED" }));
    await expect(nudge()).rejects.toMatchObject({ status: 409, data: { code: "not_open" } });
    expect(mocks.notificationCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it("keys the dedupe on the app-timezone calendar day", () => {
    // 11:30 PM Central on the 25th is already the 26th in UTC.
    expect(kioskNudgeDedupeKey("b", new Date("2026-09-26T04:30:00.000Z"))).toBe("kiosk-nudge-b-2026-09-25");
    expect(kioskNudgeDedupeKey("b", new Date("2026-09-26T05:30:00.000Z"))).toBe("kiosk-nudge-b-2026-09-26");
  });

  it("uses hours under a day", () => {
    const now = new Date("2026-09-25T18:00:00.000Z");
    expect(kioskNudgeCopy("Kit", new Date(now.getTime() - 3 * 3_600_000), now).body).toBe(
      "It's 3 hours overdue and someone at the kiosk needs it. Please bring it back.",
    );
  });

  it("reports which bookings were nudged today in one query", async () => {
    const now = new Date("2026-09-25T18:00:00.000Z");
    mocks.notificationFindMany.mockResolvedValue([{ dedupeKey: kioskNudgeDedupeKey("a", now) }]);
    expect([...await kioskNudgedTodaySet(["a", "b"], now)]).toEqual(["a"]);
    expect(mocks.notificationFindMany).toHaveBeenCalledTimes(1);
    expect(await kioskNudgedTodaySet([], now)).toEqual(new Set());
    expect(mocks.notificationFindMany).toHaveBeenCalledTimes(1);
  });
});
