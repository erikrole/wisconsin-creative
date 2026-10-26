import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookings: vi.fn(),
  kiosks: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  nextRevision: vi.fn(),
  listDevices: vi.fn(),
  revoke: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { booking: { findMany: mocks.bookings }, kioskDevice: { findMany: mocks.kiosks } } }));
vi.mock("@/lib/kiosk-heartbeat-cache", () => ({ withLatestKioskBeats: async (devices: unknown) => devices }));
vi.mock("@/lib/companion-store", () => ({
  readCompanionProjection: mocks.read,
  writeCompanionProjection: mocks.write,
  nextCompanionProjectionRevision: mocks.nextRevision,
  listCompanionDevices: mocks.listDevices,
  revokeCompanionDeviceTokens: mocks.revoke,
}));
vi.mock("@/lib/push/apns", () => ({ sendCompanionInvalidation: mocks.invalidate }));

import { buildCompanionProjection, refreshCompanionProjection } from "@/lib/services/companion-projection";

const now = new Date("2026-10-25T14:00:00.000Z");

function booking(extra: Record<string, unknown> = {}) {
  return {
    id: "b1", title: "Football vs Iowa", kind: "CHECKOUT", status: "OPEN",
    startsAt: new Date("2026-10-25T12:00:00.000Z"), endsAt: new Date("2026-10-25T20:00:00.000Z"), updatedAt: now,
    refNumber: "C-1", requester: { id: "u1", name: "Ada", avatarUrl: null }, location: { id: "loc-1", name: "Camp Randall" },
    serializedItems: [], bulkItems: [],
    ...extra,
  };
}

const kiosk = (extra: Record<string, unknown> = {}) => ({
  id: "k1", name: "Front desk", locationId: "loc-1", location: { id: "loc-1", name: "Camp Randall" }, active: true, activatedAt: now,
  lastSeenAt: now, appVersion: "1.4.1", appBuild: "37", osVersion: "26.0", deviceModel: "iPad", ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bookings.mockResolvedValue([booking()]);
  mocks.kiosks.mockResolvedValue([kiosk()]);
  mocks.nextRevision.mockResolvedValue(7);
  mocks.write.mockResolvedValue(true);
  mocks.listDevices.mockResolvedValue([{ token: "mac-1" }]);
  mocks.invalidate.mockResolvedValue({ revoked: ["mac-gone"] });
});

describe("companion item lists", () => {
  it("names gear by name, then brand and model, then type, and skips blanks", async () => {
    mocks.bookings.mockResolvedValue([booking({
      serializedItems: [
        { id: "s1", asset: { assetTag: "CAM-1", name: "FX3", brand: "Sony", model: "FX3", type: "Camera" } },
        { id: "s2", asset: { assetTag: " ", name: null, brand: "Sony", model: "A7S III", type: "Camera" } },
        { id: "s3", asset: { assetTag: "TRI-1", name: null, brand: "", model: "", type: "Tripod" } },
        { id: "s4" },
      ],
      bulkItems: [
        { id: "k1", plannedQuantity: 4, checkedOutQuantity: 3, bulkSku: { name: "NP-FZ100" } },
        { id: "k2", plannedQuantity: 2, checkedOutQuantity: 0, bulkSku: { name: "  " } },
        { id: "k3", plannedQuantity: 0, checkedOutQuantity: 0 },
      ],
    })]);

    const [open] = (await buildCompanionProjection(now)).openBookings;

    expect(open!.serializedItems).toEqual([
      { id: "s1", name: "FX3", assetTag: "CAM-1" },
      { id: "s2", name: "Sony · A7S III" },
      { id: "s3", name: "Tripod", assetTag: "TRI-1" },
      { id: "s4" },
    ]);
    expect(open!.bulkItems).toEqual([
      { id: "k1", name: "NP-FZ100", quantity: 3 },
      { id: "k2", quantity: 2 },
      { id: "k3" },
    ]);
  });

  it("caps a booking at 48 lines, serialized gear first", async () => {
    mocks.bookings.mockResolvedValue([booking({
      serializedItems: Array.from({ length: 46 }, (_, i) => ({ id: `s${i}` })),
      bulkItems: Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, plannedQuantity: 1, checkedOutQuantity: 0 })),
    })]);

    const [open] = (await buildCompanionProjection(now)).openBookings;

    expect(open!.serializedItems).toHaveLength(46);
    expect(open!.bulkItems.map((item) => item.id)).toEqual(["k0", "k1"]);
  });

  it("counts pickups that are due, not future reservations, toward each kiosk", async () => {
    mocks.bookings.mockResolvedValue([
      booking(),
      booking({ id: "r1", kind: "RESERVATION", status: "BOOKED", startsAt: new Date("2026-10-25T13:00:00.000Z") }),
      booking({ id: "r2", kind: "RESERVATION", status: "BOOKED", startsAt: new Date("2026-10-26T13:00:00.000Z") }),
      booking({ id: "p1", kind: "RESERVATION", status: "PENDING_PICKUP", location: { id: "loc-2", name: "Kohl Center" } }),
    ]);
    mocks.kiosks.mockResolvedValue([kiosk(), kiosk({ id: "k2", locationId: "loc-3", activatedAt: null })]);

    const projection = await buildCompanionProjection(now);

    expect(projection.pendingPickupTotal).toBe(2);
    expect(projection.stats.reserved).toBe(1);
    expect(projection.kioskDevices).toEqual([
      expect.objectContaining({ id: "k1", pendingPickupCount: 1, openCheckoutCount: 1, activated: true }),
      expect.objectContaining({ id: "k2", pendingPickupCount: 0, openCheckoutCount: 0, activated: false }),
    ]);
  });
});

describe("refreshCompanionProjection", () => {
  it("writes without reading or notifying when asked not to notify", async () => {
    const projection = await refreshCompanionProjection({ notify: false });

    expect(projection.revision).toBe(7);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("returns the newer published projection when this build lost the race", async () => {
    mocks.write.mockResolvedValue(false);
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce({ revision: 9 });

    expect(await refreshCompanionProjection({ notify: true })).toEqual({ revision: 9 });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("falls back to its own build if nothing newer can be read", async () => {
    mocks.write.mockResolvedValue(false);
    mocks.read.mockResolvedValue(null);

    expect((await refreshCompanionProjection({ notify: false })).revision).toBe(7);
  });

  it("wakes the Macs on the first build and revokes dead tokens", async () => {
    mocks.read.mockResolvedValue(null);

    const projection = await refreshCompanionProjection({ notify: true });

    expect(mocks.invalidate).toHaveBeenCalledWith(["mac-1"], projection.generatedAt);
    expect(mocks.revoke).toHaveBeenCalledWith(["mac-gone"]);
  });

  it("stays quiet when neither bookings nor kiosk health changed, and wakes on either", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const previous = { ...await buildCompanionProjection(now), revision: 6 };
    // Round-trip through JSON, as the store does.
    mocks.read.mockResolvedValue(JSON.parse(JSON.stringify(previous)));

    await refreshCompanionProjection({ notify: true });
    expect(mocks.invalidate).not.toHaveBeenCalled();

    mocks.kiosks.mockResolvedValue([kiosk({ appBuild: "38" })]);
    await refreshCompanionProjection({ notify: true });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);

    mocks.kiosks.mockResolvedValue([kiosk()]);
    mocks.bookings.mockResolvedValue([booking({ status: "COMPLETED" })]);
    await refreshCompanionProjection({ notify: true });
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
