import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    bookingSerializedItem: { count: vi.fn() },
    assetAllocation: { count: vi.fn() },
    asset: { delete: vi.fn() },
  };
  return {
    tx,
    db: {
      asset: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      bookingSerializedItem: { findMany: vi.fn() },
      assetAllocation: { findMany: vi.fn() },
      favoriteItem: { findUnique: vi.fn() },
      firmwareWatchTarget: { findFirst: vi.fn() },
      location: { findUnique: vi.fn() },
      category: { findUnique: vi.fn() },
      department: { findUnique: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    requireAuth: vi.fn(),
    audit: vi.fn(),
    status: vi.fn(),
    missing: vi.fn(),
    firmware: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/services/status", () => ({ deriveAssetStatus: mocks.status }));
vi.mock("@/lib/services/damage-cases", () => ({ missingAssetIds: mocks.missing }));
vi.mock("@/lib/firmware-watch-targets", () => ({ canonicalFirmwareIdentity: mocks.firmware }));

import { DELETE, GET, PATCH } from "@/app/api/assets/[id]/route";
import { buildItemAssetTagSortKey } from "@/lib/item-asset-tag-sort";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const admin = { ...staff, id: "admin-1", role: Role.ADMIN };
const params = { params: Promise.resolve({ id: "asset-1" }) };
const headers = { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" };
const startsAt = new Date("2026-10-20T15:00:00.000Z");
const endsAt = new Date("2026-10-30T15:00:00.000Z");

const stored = {
  id: "asset-1",
  assetTag: "ROAM2",
  type: "Camera",
  brand: "Sony",
  model: "FX6",
  status: "AVAILABLE",
  notes: "Keep the top handle on",
  serialNumber: "S-1",
  parent: null,
};

function allocation(kind: string, status: string, id = `${kind}-${status}`) {
  return {
    startsAt,
    booking: { id, kind, status, title: `${kind} ${status}`, startsAt, endsAt, requester: { name: "Ada", avatarUrl: null } },
  };
}

function upcoming(id: string) {
  return { booking: { id, title: `Shoot ${id}`, status: "BOOKED", startsAt, endsAt, requester: null } };
}

async function load() {
  const response = await GET(new Request("https://app.example.com/api/assets/asset-1"), params);
  return { response, body: await response.json() };
}

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("https://app.example.com/api/assets/asset-1", { method: "PATCH", headers, body: JSON.stringify(body) }), params);
}

function remove() {
  return DELETE(new Request("https://app.example.com/api/assets/asset-1", { method: "DELETE", headers }), params);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.status.mockResolvedValue("AVAILABLE");
  mocks.missing.mockResolvedValue(new Set());
  mocks.firmware.mockReturnValue(null);
  mocks.db.asset.findUnique.mockResolvedValue(stored);
  mocks.db.asset.findMany.mockResolvedValue([]);
  mocks.db.asset.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...stored, ...data }));
  mocks.db.bookingSerializedItem.findMany.mockResolvedValue([]);
  mocks.db.assetAllocation.findMany.mockResolvedValue([]);
  mocks.db.favoriteItem.findUnique.mockResolvedValue(null);
  mocks.db.firmwareWatchTarget.findFirst.mockResolvedValue(null);
  mocks.tx.bookingSerializedItem.count.mockResolvedValue(0);
  mocks.tx.assetAllocation.count.mockResolvedValue(0);
  mocks.audit.mockResolvedValue(undefined);
});

describe("GET /api/assets/[id]", () => {
  it("returns the item with its notes, favorite and no booking", async () => {
    mocks.db.favoriteItem.findUnique.mockResolvedValue({ id: "fav-1" });

    const { body } = await load();

    expect(body.data).toEqual(expect.objectContaining({
      assetTag: "ROAM2",
      notes: "Keep the top handle on",
      metadata: null,
      computedStatus: "AVAILABLE",
      missing: false,
      isFavorited: true,
      activeBooking: null,
      hasBookingHistory: false,
      parentAsset: null,
      firmwareWatch: null,
    }));
    expect(mocks.missing).not.toHaveBeenCalled();
  });

  it("hides import metadata from the notes and returns it separately", async () => {
    mocks.db.asset.findUnique.mockResolvedValue({ ...stored, notes: JSON.stringify({ source: "cheqroom", legacyId: 42 }) });

    const { body } = await load();

    expect(body.data.notes).toBeNull();
    expect(body.data.metadata).toEqual({ source: "cheqroom", legacyId: 42 });
  });

  it.each([["a number", "1234"], ["a list", "[1,2]"]])("keeps a note that is just %s", async (_label, notes) => {
    mocks.db.asset.findUnique.mockResolvedValue({ ...stored, notes });

    const { body } = await load();

    expect(body.data.notes).toBe(notes);
    expect(body.data.metadata).toBeNull();
  });

  it.each([
    ["CHECKED_OUT", "CHECKOUT", "OPEN"],
    ["PENDING_PICKUP", "CHECKOUT", "PENDING_PICKUP"],
    ["RESERVED", "RESERVATION", "BOOKED"],
  ])("names the booking that holds a %s item", async (status, kind, bookingStatus) => {
    mocks.status.mockResolvedValue(status);
    mocks.db.assetAllocation.findMany.mockResolvedValue([
      allocation("RESERVATION", "DRAFT"),
      allocation(kind, bookingStatus, "holder"),
    ]);

    const { body } = await load();

    expect(body.data.activeBooking).toEqual({
      id: "holder",
      kind,
      status: bookingStatus,
      title: `${kind} ${bookingStatus}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      requesterName: "Ada",
      requesterAvatarUrl: null,
    });
  });

  it("ignores a reservation that has not started yet", async () => {
    mocks.status.mockResolvedValue("RESERVED");
    mocks.db.assetAllocation.findMany.mockResolvedValue([
      { ...allocation("RESERVATION", "BOOKED"), startsAt: new Date(Date.now() + 86_400_000) },
    ]);

    expect((await load()).body.data.activeBooking).toBeNull();
  });

  it("lists upcoming reservations once each, without the current one", async () => {
    mocks.status.mockResolvedValue("RESERVED");
    mocks.db.assetAllocation.findMany.mockResolvedValue([allocation("RESERVATION", "BOOKED", "now")]);
    mocks.db.bookingSerializedItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([upcoming("now"), upcoming("next"), upcoming("next"), upcoming("later")]);

    const { body } = await load();

    expect(body.data.upcomingReservations.map((row: { bookingId: string }) => row.bookingId)).toEqual(["next", "later"]);
    expect(body.data.upcomingReservations[0].requesterName).toBe("Unknown");
  });

  it("falls back to the stored status and flags a missing item in maintenance", async () => {
    mocks.status.mockRejectedValue(new Error("status failed"));
    mocks.db.asset.findUnique.mockResolvedValue({ ...stored, status: "MAINTENANCE" });
    mocks.missing.mockResolvedValue(new Set(["asset-1"]));

    const { body } = await load();

    expect(body.data.computedStatus).toBe("MAINTENANCE");
    expect(body.data.missing).toBe(true);
  });

  it("shows the firmware watch for a known camera", async () => {
    mocks.firmware.mockReturnValue({ brand: "sony", model: "fx6" });
    mocks.db.firmwareWatchTarget.findFirst.mockResolvedValue({
      id: "fw-1",
      latestVersion: "4.0",
      latestReleaseDate: new Date("2026-09-01T00:00:00.000Z"),
      lastCheckedAt: null,
    });

    const { body } = await load();

    expect(mocks.db.firmwareWatchTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true, brand: "sony", model: "fx6" } }));
    expect(body.data.firmwareWatch).toEqual(expect.objectContaining({ latestReleaseDate: "2026-09-01T00:00:00.000Z", lastCheckedAt: null }));
  });

  it("marks an item with past bookings so it can only be retired", async () => {
    mocks.db.bookingSerializedItem.findMany.mockResolvedValueOnce([{
      id: "line-1",
      createdAt: startsAt,
      booking: { id: "b1", kind: "CHECKOUT", status: "COMPLETED", title: "Game", startsAt, endsAt, sportCode: "FB", requester: { name: "Ada" }, location: null, event: null },
    }]);

    const { body } = await load();

    expect(body.data.hasBookingHistory).toBe(true);
    expect(body.data.history).toEqual([expect.objectContaining({ id: "line-1", booking: expect.objectContaining({ id: "b1", event: null }) })]);
  });

  it("returns 404 for an unknown item", async () => {
    mocks.db.asset.findUnique.mockResolvedValue(null);

    expect((await load()).response.status).toBe(404);
  });
});

describe("PATCH /api/assets/[id]", () => {
  it("audits only the fields sent, with their old and new values", async () => {
    const response = await patch({ notes: "New note", status: "MAINTENANCE" });

    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "updated",
      before: { notes: "Keep the top handle on", status: "AVAILABLE" },
      after: { notes: "New note", status: "MAINTENANCE" },
    }));
  });

  it("stores dates as dates, clears empty ones and keeps the tag sort key in step", async () => {
    await patch({ assetTag: "ROAM10", purchaseDate: "2026-01-15", warrantyDate: "" });

    expect(mocks.db.asset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assetTag: "ROAM10",
        purchaseDate: new Date("2026-01-15"),
        assetTagSortKey: buildItemAssetTagSortKey("ROAM10"),
        warrantyDate: null,
      }),
    }));
  });

  it.each([
    [["qr_code_value"], "QR code already in use by another asset"],
    [["asset_tag"], "Asset tag already in use by another asset"],
    [["serial_number"], "Serial number already in use by another asset"],
    [["other"], "A unique constraint was violated"],
  ])("explains a duplicate %s", async (target, message) => {
    mocks.db.asset.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7", meta: { target } }));

    const response = await patch({ assetTag: "ROAM3" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(message);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown item and 403 for students", async () => {
    mocks.db.asset.findUnique.mockResolvedValueOnce(null);
    expect((await patch({ notes: "x" })).status).toBe(404);

    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });
    expect((await patch({ notes: "x" })).status).toBe(403);
  });
});

describe("DELETE /api/assets/[id]", () => {
  it("deletes an item with no history and audits it", async () => {
    mocks.requireAuth.mockResolvedValue(admin);

    const response = await remove();

    expect(await response.json()).toEqual({ success: true });
    expect(mocks.tx.asset.delete).toHaveBeenCalledWith({ where: { id: "asset-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted", before: { assetTag: "ROAM2", type: "Camera" } }));
  });

  it.each([
    ["booking history", () => mocks.tx.bookingSerializedItem.count.mockResolvedValue(1)],
    ["an active allocation", () => mocks.tx.assetAllocation.count.mockResolvedValue(1)],
  ])("refuses an item with %s", async (_label, arrange) => {
    mocks.requireAuth.mockResolvedValue(admin);
    arrange();

    const response = await remove();

    expect(response.status).toBe(409);
    expect(mocks.tx.asset.delete).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("is limited to admins", async () => {
    expect((await remove()).status).toBe(403);
    expect(mocks.db.asset.findUnique).not.toHaveBeenCalled();
  });
});
