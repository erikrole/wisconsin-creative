import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";
import { authUser, CUID_A, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  audit: vi.fn(),
  db: { asset: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { POST as duplicate } from "@/app/api/assets/[id]/duplicate/route";
import { POST as generateQr } from "@/app/api/assets/[id]/generate-qr/route";

const staff = authUser(Role.STAFF);
const ctx = routeCtx({ id: CUID_A });
const collision = (code = "P2002") => new Prisma.PrismaClientKnownRequestError("Constraint", { code, clientVersion: "7" });
const source = {
  id: CUID_A, assetTag: "FX6 3", serialNumber: "SN123", name: null, type: "Camera", brand: "Sony", model: "FX6",
  qrCodeValue: "AAAA0000", purchaseDate: null, purchasePrice: null, warrantyDate: null, residualValue: null,
  locationId: "loc-1", departmentId: null, categoryId: "cat-1", status: "CHECKED_OUT", consumable: false,
  imageUrl: null, notes: "Rig A", linkUrl: null, availableForReservation: true, availableForCheckout: true, availableForCustody: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.db.asset.findUnique.mockResolvedValue(source);
});

describe("POST /api/assets/[id]/duplicate", () => {
  it("copies the item as available with a fresh tag, serial and QR", async () => {
    mocks.db.asset.create.mockImplementation(async ({ data }) => ({ id: "copy-1", ...data }));

    const res = await duplicate(jsonRequest(`/api/assets/${CUID_A}/duplicate`, "POST"), ctx);

    expect(res.status).toBe(201);
    const { data } = mocks.db.asset.create.mock.calls[0]![0];
    expect(data.assetTag).toMatch(/^FX6 3-COPY-[0-9A-F]{8}$/);
    expect(data.serialNumber).toBe(`SN123-COPY-${data.assetTag.slice(-8)}`);
    expect(data.qrCodeValue).toMatch(/^[0-9A-F]{8}$/);
    expect(data).toEqual(expect.objectContaining({ status: "AVAILABLE", notes: "Rig A", locationId: "loc-1", availableForCustody: false, assetTagSortKey: expect.any(String) }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "copy-1", action: "duplicated", after: { sourceId: CUID_A, assetTag: data.assetTag } }));
  });

  it("leaves the serial empty when the source has none, and retries a collision", async () => {
    mocks.db.asset.findUnique.mockResolvedValue({ ...source, serialNumber: null });
    mocks.db.asset.create.mockRejectedValueOnce(collision()).mockImplementation(async ({ data }) => ({ id: "copy-2", ...data }));

    expect((await duplicate(jsonRequest(`/api/assets/${CUID_A}/duplicate`, "POST"), ctx)).status).toBe(201);
    expect(mocks.db.asset.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.asset.create.mock.calls[1]![0].data.serialNumber).toBeNull();
  });

  it("gives up after five collisions and passes other errors through", async () => {
    mocks.db.asset.create.mockRejectedValue(collision());
    const res = await duplicate(jsonRequest(`/api/assets/${CUID_A}/duplicate`, "POST"), ctx);
    expect(res.status).toBe(409);
    expect(mocks.db.asset.create).toHaveBeenCalledTimes(5);
    expect(mocks.audit).not.toHaveBeenCalled();

    mocks.db.asset.create.mockReset().mockRejectedValue(collision("P2010"));
    expect((await duplicate(jsonRequest(`/api/assets/${CUID_A}/duplicate`, "POST"), ctx)).status).toBe(500);
    expect(mocks.db.asset.create).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for an unknown item and keeps students out", async () => {
    mocks.db.asset.findUnique.mockResolvedValue(null);
    expect((await duplicate(jsonRequest(`/api/assets/${CUID_A}/duplicate`, "POST"), ctx)).status).toBe(404);

    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    expect((await duplicate(jsonRequest(`/api/assets/${CUID_A}/duplicate`, "POST"), ctx)).status).toBe(403);
    expect(mocks.db.asset.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/assets/[id]/generate-qr", () => {
  it("replaces the QR code and audits old and new values", async () => {
    mocks.db.asset.update.mockRejectedValueOnce(collision()).mockImplementation(async ({ data }) => ({ id: CUID_A, ...data }));

    const res = await generateQr(jsonRequest(`/api/assets/${CUID_A}/generate-qr`, "POST"), ctx);

    expect(res.status).toBe(200);
    expect(mocks.db.asset.update).toHaveBeenCalledTimes(2);
    const qr = mocks.db.asset.update.mock.calls[1]![0].data.qrCodeValue;
    expect((await res.json()).data.qrCodeValue).toBe(qr);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "qr_generated", before: { qrCodeValue: "AAAA0000" }, after: { qrCodeValue: qr } }));
  });

  it("gives up after five collisions", async () => {
    mocks.db.asset.update.mockRejectedValue(collision());

    expect((await generateQr(jsonRequest(`/api/assets/${CUID_A}/generate-qr`, "POST"), ctx)).status).toBe(500);
    expect(mocks.db.asset.update).toHaveBeenCalledTimes(5);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown item and passes other errors through", async () => {
    mocks.db.asset.findUnique.mockResolvedValueOnce(null);
    expect((await generateQr(jsonRequest(`/api/assets/${CUID_A}/generate-qr`, "POST"), ctx)).status).toBe(404);

    mocks.db.asset.update.mockRejectedValue(collision("P2010"));
    expect((await generateQr(jsonRequest(`/api/assets/${CUID_A}/generate-qr`, "POST"), ctx)).status).toBe(500);
    expect(mocks.db.asset.update).toHaveBeenCalledTimes(1);
  });
});
