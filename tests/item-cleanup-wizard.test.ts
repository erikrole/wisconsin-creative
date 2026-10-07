import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  $transaction: vi.fn(),
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    asset: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    assetAllocation: {
      findFirst: mocks.findFirst,
    },
    bulkSku: { findMany: vi.fn().mockResolvedValue([]) },
    systemConfig: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
    $transaction: mocks.$transaction,
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: mocks.createAuditEntry,
  createAuditEntryTx: mocks.createAuditEntryTx,
}));

import {
  LEGACY_QR_LABEL_PATTERN,
  applyCleanupWizardAttach,
  applyCleanupWizardQr,
  deferCleanupWizardItem,
  getCleanupWizardCounts,
  isAttachmentCandidateText,
  listCleanupWizardQueue,
  stripAccessoryParentTag,
} from "@/lib/services/item-cleanup-wizard";
import { HttpError } from "@/lib/http";

describe("item cleanup wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(null);
    mocks.findFirst.mockResolvedValue(null);
    mocks.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        asset: {
          findUnique: mocks.findUnique,
          update: mocks.update,
        },
        assetAllocation: {
          findFirst: mocks.findFirst,
        },
        systemConfig: {
          findUnique: mocks.findUnique,
          upsert: mocks.upsert,
        },
      }),
    );
  });

  it("recognizes Cheqroom-era shelf labels", () => {
    expect(LEGACY_QR_LABEL_PATTERN.test("E1-041")).toBe(true);
    expect(LEGACY_QR_LABEL_PATTERN.test("D1-0006")).toBe(true);
    expect(LEGACY_QR_LABEL_PATTERN.test("abc123xyz")).toBe(false);
  });

  it("detects attachment candidate terms and stripable parent tags", () => {
    expect(isAttachmentCandidateText("SmallRig Camera Cage Kit")).toBe(true);
    expect(isAttachmentCandidateText("Sony 67mm Front Lens Cap")).toBe(true);
    expect(isAttachmentCandidateText("FX3 1")).toBe(false);
    expect(stripAccessoryParentTag("a7 V 2 Grip")).toBe("a7 V 2");
    expect(stripAccessoryParentTag("SmallRig Top Plate")).toBe("SmallRig");
    expect(stripAccessoryParentTag("FX3 1")).toBeNull();
  });

  it("counts open legacy QR, missing serial, and attachment rows, excluding deferred assets", async () => {
    mocks.findUnique.mockResolvedValue({
      value: {
        "asset-deferred": {
          kinds: ["legacy_qr"],
          reason: "no_printed_qr",
          deferredAt: "2026-10-07T00:00:00.000Z",
          actorId: "admin-1",
        },
        "asset-standalone": {
          kinds: ["attachment_candidate"],
          reason: "keep_standalone",
          deferredAt: "2026-10-07T00:00:00.000Z",
          actorId: "admin-1",
        },
      },
    });
    mocks.findMany.mockResolvedValue([
      {
        id: "asset-1",
        assetTag: "FB Wireless Flash",
        name: null,
        brand: "Godox",
        model: "Flash",
        type: null,
        qrCodeValue: "E1-041",
        primaryScanCode: "E1-041",
        serialNumber: null,
        parentAssetId: null,
      },
      {
        id: "asset-deferred",
        assetTag: "Deferred Flash",
        name: null,
        brand: "Godox",
        model: "Flash",
        type: null,
        qrCodeValue: "E1-042",
        primaryScanCode: "E1-042",
        serialNumber: "SN",
        parentAssetId: null,
      },
      {
        id: "asset-2",
        assetTag: "GoPro Hero",
        name: null,
        brand: "GoPro",
        model: "Hero",
        type: null,
        qrCodeValue: "realqrcode",
        primaryScanCode: "realqrcode",
        serialNumber: null,
        parentAssetId: null,
      },
      {
        id: "asset-cage",
        assetTag: "SmallRig Camera Cage Kit",
        name: null,
        brand: "SmallRig",
        model: "4184",
        type: null,
        qrCodeValue: "cageqr",
        primaryScanCode: "cageqr",
        serialNumber: "C1",
        parentAssetId: null,
      },
      {
        id: "asset-standalone",
        assetTag: "Sony Vertical Grip (FB1)",
        name: null,
        brand: "Sony",
        model: "VG-C4EM",
        type: null,
        qrCodeValue: "gripqr",
        primaryScanCode: "gripqr",
        serialNumber: "G1",
        parentAssetId: null,
      },
    ]);

    await expect(getCleanupWizardCounts()).resolves.toEqual({
      legacy_qr: 1,
      missing_serial: 2,
      attachment_candidate: 1,
      deferred: { legacy_qr: 1, missing_serial: 0, attachment_candidate: 1 },
    });
  });

  it("lists legacy QR queue items with the printed-QR question", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([
      {
        id: "asset-1",
        assetTag: "FB Wireless Flash",
        name: null,
        brand: "Godox",
        model: "Flash",
        type: null,
        imageUrl: null,
        qrCodeValue: "E1-041",
        primaryScanCode: "E1-041",
        serialNumber: null,
        location: { name: "Cage" },
      },
    ]);

    const items = await listCleanupWizardQueue("legacy_qr", 8);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "asset-1",
      kind: "legacy_qr",
      question: "Is a QR code printed on this item?",
    });
  });

  it("lists attachment candidates with suggested parents", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany
      .mockResolvedValueOnce([
        {
          id: "child-1",
          assetTag: "a7 V 2 Grip",
          name: null,
          brand: "Sony",
          model: "Grip",
          type: null,
          imageUrl: null,
          qrCodeValue: "grip1",
          primaryScanCode: "grip1",
          serialNumber: null,
          location: { name: "Cage" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "parent-1",
          assetTag: "a7 V 2",
          brand: "Sony",
          model: "A7V",
          name: null,
          type: "Camera",
        },
        {
          id: "parent-2",
          assetTag: "FX3 1",
          brand: "Sony",
          model: "FX3",
          name: null,
          type: "Camera",
        },
      ]);

    const items = await listCleanupWizardQueue("attachment_candidate", 8);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "child-1",
      kind: "attachment_candidate",
      question: "Does this accessory stay married to a specific parent item?",
    });
    expect(items[0]?.suggestedParents?.[0]).toMatchObject({
      id: "parent-1",
      assetTag: "a7 V 2",
      reason: "Exact tag prefix match",
    });
  });

  it("writes qr and primary scan together when applying a printed code", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({
        id: "asset-1",
        status: "AVAILABLE",
        qrCodeValue: "E1-041",
        primaryScanCode: "E1-041",
      })
      .mockResolvedValueOnce(null);
    mocks.update.mockResolvedValue({
      id: "asset-1",
      assetTag: "FB Wireless Flash",
      name: null,
      brand: "Godox",
      model: "Flash",
      type: null,
      imageUrl: null,
      qrCodeValue: "newcode99",
      primaryScanCode: "newcode99",
      serialNumber: null,
      location: { name: "Cage" },
    });
    mocks.findMany.mockResolvedValue([]);

    const item = await applyCleanupWizardQr({
      assetId: "asset-1",
      code: "newcode99",
      actor: { id: "admin-1", role: "ADMIN" },
    });

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { qrCodeValue: "newcode99", primaryScanCode: "newcode99" },
    }));
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "cleanup_wizard_qr" }),
    );
    expect(item.qrCodeValue).toBe("newcode99");
  });

  it("rejects an empty QR code", async () => {
    await expect(
      applyCleanupWizardQr({
        assetId: "asset-1",
        code: "   ",
        actor: { id: "admin-1", role: "ADMIN" },
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("attaches a child to a parent and disables booking policy flags", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({
        id: "child-1",
        status: "AVAILABLE",
        parentAssetId: null,
        assetTag: "a7 V 2 Grip",
        availableForCheckout: true,
        availableForReservation: true,
        availableForCustody: true,
        name: null,
        brand: "Sony",
        model: "Grip",
        type: null,
        imageUrl: null,
        qrCodeValue: "grip1",
        primaryScanCode: "grip1",
        serialNumber: null,
        location: { name: "Cage" },
      })
      .mockResolvedValueOnce({
        id: "parent-1",
        status: "AVAILABLE",
        parentAssetId: null,
        assetTag: "a7 V 2",
      })
      .mockResolvedValueOnce(null);
    mocks.findFirst.mockResolvedValue(null);
    mocks.update.mockResolvedValue({
      id: "child-1",
      assetTag: "a7 V 2 Grip",
      name: null,
      brand: "Sony",
      model: "Grip",
      type: null,
      imageUrl: null,
      qrCodeValue: "grip1",
      primaryScanCode: "grip1",
      serialNumber: null,
      location: { name: "Cage" },
    });

    const item = await applyCleanupWizardAttach({
      assetId: "child-1",
      parentAssetId: "parent-1",
      actor: { id: "admin-1", role: "ADMIN" },
    });

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        parentAssetId: "parent-1",
        availableForCheckout: false,
        availableForReservation: false,
        availableForCustody: false,
      },
    }));
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "cleanup_wizard_attach" }),
    );
    expect(item.kind).toBe("attachment_candidate");
  });

  it("blocks attach when the child has active custody", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({
        id: "child-1",
        status: "CHECKED_OUT",
        parentAssetId: null,
        assetTag: "Cage",
        availableForCheckout: true,
        availableForReservation: true,
        availableForCustody: true,
      })
      .mockResolvedValueOnce({
        id: "parent-1",
        status: "AVAILABLE",
        parentAssetId: null,
        assetTag: "FX3 1",
      });
    mocks.findFirst.mockResolvedValue({ id: "alloc-1", bookingId: "booking-1" });

    await expect(
      applyCleanupWizardAttach({
        assetId: "child-1",
        parentAssetId: "parent-1",
        actor: { id: "admin-1", role: "ADMIN" },
      }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("active custody") });
  });

  it("defers a row with an audited reason", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ id: "asset-1", assetTag: "GoPro Hero 11 Black", status: "AVAILABLE" })
      .mockResolvedValueOnce(null);

    await expect(
      deferCleanupWizardItem({
        assetId: "asset-1",
        kind: "legacy_qr",
        reason: "no_printed_qr",
        actor: { id: "admin-1", role: "ADMIN" },
      }),
    ).resolves.toMatchObject({ success: true, reason: "no_printed_qr" });

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: "item_cleanup_wizard_deferred" },
    }));
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: "cleanup_wizard_deferred" }),
    );
  });

  it("defers attachment candidates as keep_standalone", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ id: "asset-cage", assetTag: "SmallRig Camera Cage Kit", status: "AVAILABLE" })
      .mockResolvedValueOnce(null);

    await expect(
      deferCleanupWizardItem({
        assetId: "asset-cage",
        kind: "attachment_candidate",
        reason: "keep_standalone",
        actor: { id: "admin-1", role: "ADMIN" },
      }),
    ).resolves.toMatchObject({ success: true, reason: "keep_standalone" });
  });
});
