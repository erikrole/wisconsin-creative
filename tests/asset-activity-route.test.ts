import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    asset: { findUnique: vi.fn() },
    bookingSerializedItem: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
    scanEvent: { findMany: vi.fn() },
  },
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { GET } from "@/app/api/assets/[id]/activity/route";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };

function log(id: string, entityType = "asset", entityId = "asset-1", minute = 0) {
  return {
    id, entityType, entityId, action: "updated", actor: { name: "Staff" },
    createdAt: new Date(Date.UTC(2026, 9, 28, 15, 59 - minute)),
  };
}

const json = <T,>(value: T) => JSON.parse(JSON.stringify(value));

const namedInBookingEvent = [
  { entityType: "booking", afterJson: { path: ["assetId"], equals: "asset-1" } },
  { entityType: "booking", beforeJson: { path: ["assetId"], equals: "asset-1" } },
  { entityType: "booking", afterJson: { path: ["serializedAssetIds"], array_contains: ["asset-1"] } },
  { entityType: "booking", beforeJson: { path: ["serializedAssetIds"], array_contains: ["asset-1"] } },
];

async function load(query = "") {
  const response = await GET(new Request(`https://app.example.com/api/assets/asset-1/activity${query}`), {
    params: Promise.resolve({ id: "asset-1" }),
  });
  return { response, body: await response.json() };
}

function auditWhere() {
  return mocks.db.auditLog.findMany.mock.calls[0]?.[0].where.OR;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.db.asset.findUnique.mockResolvedValue({ id: "asset-1" });
  mocks.db.bookingSerializedItem.findMany.mockResolvedValue([{ bookingId: "b1" }, { bookingId: "b2" }]);
  mocks.db.auditLog.findMany.mockResolvedValue([]);
  mocks.db.booking.findMany.mockResolvedValue([]);
  mocks.db.scanEvent.findMany.mockResolvedValue([]);
  mocks.db.auditLog.findUnique.mockResolvedValue(null);
});

describe("GET /api/assets/[id]/activity", () => {
  it("combines the item's own history with its bookings' history", async () => {
    await load();

    expect(auditWhere()).toEqual([
      { entityType: "asset", entityId: "asset-1" },
      { entityType: "booking", entityId: { in: ["b1", "b2"] } },
      ...namedInBookingEvent,
    ]);
    expect(mocks.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51, orderBy: { createdAt: "desc" } }));
  });

  it("filters to item or booking history", async () => {
    await load("?scope=asset");
    expect(auditWhere()).toEqual([{ entityType: "asset", entityId: "asset-1" }]);

    mocks.db.auditLog.findMany.mockClear();
    await load("?scope=booking");
    expect(auditWhere()).toEqual([{ entityType: "booking", entityId: { in: ["b1", "b2"] } }, ...namedInBookingEvent]);
  });

  it("still finds swaps and removals that name an item no longer on any booking", async () => {
    mocks.db.bookingSerializedItem.findMany.mockResolvedValue([]);

    const { body } = await load("?scope=booking");

    expect(body).toEqual({ data: [], nextCursor: null });
    expect(auditWhere()).toEqual(namedInBookingEvent);
  });

  it("leaves bookings out of the default view for an item never booked", async () => {
    mocks.db.bookingSerializedItem.findMany.mockResolvedValue([]);

    await load();

    expect(auditWhere()).toEqual([{ entityType: "asset", entityId: "asset-1" }, ...namedInBookingEvent]);
  });

  it("pages with a cursor and names the bookings on the page", async () => {
    mocks.db.auditLog.findMany.mockResolvedValue([log("l1"), log("l2", "booking", "b1", 1), log("l3", "booking", "b9", 2)]);
    mocks.db.booking.findMany.mockResolvedValue([{ id: "b1", title: "Football vs Iowa", kind: "CHECKOUT" }]);

    const { body } = await load("?limit=2&cursor=l0");

    expect(mocks.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3, cursor: { id: "l0" }, skip: 1 }));
    expect(mocks.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["b1"] } } }));
    expect(body.nextCursor).toBe("l2");
    expect(body.data).toEqual(json([
      log("l1"),
      { ...log("l2", "booking", "b1", 1), entity: { label: "Football vs Iowa", kind: "CHECKOUT" } },
    ]));
  });

  it("places the item's scans among the page by time", async () => {
    const cursorAt = new Date(Date.UTC(2026, 9, 28, 16, 30));
    mocks.db.auditLog.findUnique.mockResolvedValue({ createdAt: cursorAt });
    mocks.db.auditLog.findMany.mockResolvedValue([log("l1"), log("l2", "asset", "asset-1", 5), log("l3", "asset", "asset-1", 6)]);
    mocks.db.scanEvent.findMany.mockResolvedValue([{
      id: "s1",
      phase: "CHECKIN",
      quantity: null,
      createdAt: new Date(Date.UTC(2026, 9, 28, 15, 57)),
      bookingId: "b1",
      booking: { title: "Football vs Iowa", kind: "CHECKOUT" },
      asset: { id: "asset-1", assetTag: "ROAM2", name: "Roaming cam" },
      bulkSku: null,
      actor: { id: "u1", name: "Avery", email: "a@example.com", avatarUrl: null },
    }]);

    const { body } = await load("?limit=2&cursor=l0");

    expect(mocks.db.scanEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assetId: "asset-1", success: true, createdAt: { lt: cursorAt, gte: log("l2", "asset", "asset-1", 5).createdAt } },
    }));
    expect(body.data.map((row: { id: string; action: string }) => [row.id, row.action])).toEqual([
      ["l1", "updated"],
      ["scan_s1", "scan_checkin"],
      ["l2", "updated"],
    ]);
    expect(body.data[1]).toMatchObject({
      entityType: "booking",
      entityId: "b1",
      afterJson: { itemName: "ROAM2", assetId: "asset-1" },
      entity: { label: "Football vs Iowa", kind: "CHECKOUT" },
    });
    expect(body.nextCursor).toBe("l2");
  });

  it("leaves scans out of item-only history", async () => {
    await load("?scope=asset");
    expect(mocks.db.scanEvent.findMany).not.toHaveBeenCalled();
  });

  it.each([["-5", 2], ["0", 51], ["500", 101], ["abc", 51]])("clamps a limit of %s", async (limit, take) => {
    await load(`?limit=${limit}`);

    expect(mocks.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take }));
  });

  it("skips the booking lookup when the page has only item rows", async () => {
    mocks.db.auditLog.findMany.mockResolvedValue([log("l1")]);

    const { body } = await load();

    expect(mocks.db.booking.findMany).not.toHaveBeenCalled();
    expect(body.nextCursor).toBeNull();
  });

  it("rejects an unknown scope, an unknown item, and students", async () => {
    expect((await load("?scope=everything")).response.status).toBe(400);

    mocks.db.asset.findUnique.mockResolvedValueOnce(null);
    expect((await load()).response.status).toBe(404);

    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });
    expect((await load()).response.status).toBe(403);
  });
});
