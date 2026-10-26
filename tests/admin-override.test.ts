import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, jsonRequest, routeCtx } from "./_helpers/route-request";

const { db, audit, requireAuth } = vi.hoisted(() => {
  const db = {
    booking: { findUnique: vi.fn() },
    scanSession: { findFirst: vi.fn() },
    checkinItemReport: { findMany: vi.fn() },
    overrideEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, audit: vi.fn(), requireAuth: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: audit }));
vi.mock("@/lib/auth", () => ({ requireAuth, requireKiosk: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { createAdminOverride } from "@/lib/services/scans";
import { POST } from "@/app/api/checkouts/[id]/admin-override/route";

const scan = (overrides: Record<string, unknown>) => ({ success: true, scanType: "SERIALIZED", assetId: null, bulkSkuId: null, quantity: null, ...overrides });

function bookingWithScans(scanEvents: unknown[]) {
  return {
    id: "b1",
    serializedItems: [{ assetId: "fx3" }, { assetId: "lens" }, { assetId: "mic" }],
    bulkItems: [
      { bulkSkuId: "aa", plannedQuantity: 4, bulkSku: { trackByNumber: false }, unitAllocations: [] },
      {
        bulkSkuId: "np",
        plannedQuantity: 2,
        bulkSku: { trackByNumber: true },
        unitAllocations: [
          { checkedOutAt: new Date(), checkedInAt: null, bulkSkuUnit: { unitNumber: 7 } },
          { checkedOutAt: new Date(), checkedInAt: new Date(), bulkSkuUnit: { unitNumber: 3 } },
          { checkedOutAt: new Date(), checkedInAt: null, bulkSkuUnit: { unitNumber: 2 } },
          { checkedOutAt: null, checkedInAt: null, bulkSkuUnit: { unitNumber: 9 } },
        ],
      },
    ],
    scanEvents,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.booking.findUnique.mockResolvedValue({ id: "b1" });
  db.scanSession.findFirst.mockResolvedValue(null);
  db.checkinItemReport.findMany.mockResolvedValue([]);
  db.overrideEvent.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "o1", ...data }));
});

const override = (details?: Record<string, unknown>) =>
  createAdminOverride({ bookingId: "b1", actorUserId: "admin-1", actorRole: Role.ADMIN, reason: "Gear handed over in person", details });

describe("createAdminOverride", () => {
  it("records what a check-in skipped: unscanned items, short bulk counts and numbered units still out", async () => {
    db.scanSession.findFirst.mockResolvedValue({ id: "s1", phase: "CHECKIN" });
    db.booking.findUnique
      .mockResolvedValueOnce({ id: "b1" })
      .mockResolvedValueOnce(bookingWithScans([
        scan({ assetId: "fx3" }),
        scan({ scanType: "BULK_BIN", bulkSkuId: "aa", quantity: 2 }),
        scan({ scanType: "BULK_BIN", bulkSkuId: "aa", quantity: 1 }),
        scan({ scanType: "BULK_BIN", bulkSkuId: "np", quantity: 2 }),
      ]));
    // A damaged or lost report counts the item as accounted for.
    db.checkinItemReport.findMany.mockResolvedValue([{ assetId: "mic" }]);

    await override({ note: "Front desk" });

    const details = db.overrideEvent.create.mock.calls[0]?.[0]?.data?.details;
    expect(details).toEqual({
      phase: "CHECKIN",
      missingSerialized: ["lens"],
      missingBulk: [{ bulkSkuId: "aa", required: 4, scanned: 3 }],
      missingUnits: [{ bulkSkuId: "np", unitNumbers: [2, 7] }],
      note: "Front desk",
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin_override", after: { reason: "Gear handed over in person", details } }));
  });

  it("ignores damage reports and unit lists while checking out", async () => {
    db.scanSession.findFirst.mockResolvedValue({ id: "s1", phase: "CHECKOUT" });
    db.booking.findUnique.mockResolvedValueOnce({ id: "b1" }).mockResolvedValueOnce(bookingWithScans([]));

    await override();

    expect(db.checkinItemReport.findMany).not.toHaveBeenCalled();
    expect(db.overrideEvent.create.mock.calls[0]?.[0]?.data?.details).toMatchObject({
      missingSerialized: ["fx3", "lens", "mic"],
      missingUnits: [],
    });
  });

  it("lets the caller's details win on the same key, and stores none without a session or details", async () => {
    db.scanSession.findFirst.mockResolvedValue({ id: "s1", phase: "CHECKOUT" });
    db.booking.findUnique.mockResolvedValueOnce({ id: "b1" }).mockResolvedValueOnce(bookingWithScans([]));
    await override({ phase: "manual" });
    expect(db.overrideEvent.create.mock.calls[0]?.[0]?.data?.details?.phase).toBe("manual");

    db.scanSession.findFirst.mockResolvedValue(null);
    await override();
    expect(db.overrideEvent.create.mock.calls[1]?.[0]?.data?.details).toBeUndefined();
    expect(audit.mock.calls[1]?.[0]?.after?.details).toBeNull();
  });

  it("still records the override when the skipped items cannot be worked out", async () => {
    db.scanSession.findFirst.mockResolvedValue({ id: "s1", phase: "CHECKIN" });
    db.$transaction.mockRejectedValue(new Error("serialization failure"));

    await override();

    expect(db.overrideEvent.create).toHaveBeenCalledTimes(1);
    expect(db.overrideEvent.create.mock.calls[0]?.[0]?.data?.details).toBeUndefined();
  });

  it("is for admins only, and needs the checkout to exist", async () => {
    await expect(createAdminOverride({ bookingId: "b1", actorUserId: "s", actorRole: Role.STAFF, reason: "because" })).rejects.toMatchObject({ status: 403 });
    db.booking.findUnique.mockResolvedValue(null);
    await expect(override()).rejects.toMatchObject({ status: 404 });
    expect(db.overrideEvent.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/checkouts/[id]/admin-override", () => {
  it("records the override once and answers 201", async () => {
    requireAuth.mockResolvedValue(authUser(Role.ADMIN));

    const res = await POST(jsonRequest("/api/checkouts/b1/admin-override", "POST", { reason: "Gear handed over in person" }), routeCtx({ id: "b1" }));

    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ id: "o1", bookingId: "b1" });
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("refuses a reason that is too short, and students", async () => {
    requireAuth.mockResolvedValue(authUser(Role.ADMIN));
    expect((await POST(jsonRequest("/api/checkouts/b1/admin-override", "POST", { reason: "ok" }), routeCtx({ id: "b1" }))).status).toBe(400);

    requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    expect((await POST(jsonRequest("/api/checkouts/b1/admin-override", "POST", { reason: "Gear handed over" }), routeCtx({ id: "b1" }))).status).toBe(403);
    expect(db.overrideEvent.create).not.toHaveBeenCalled();
  });
});
