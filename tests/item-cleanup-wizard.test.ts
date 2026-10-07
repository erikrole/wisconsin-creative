import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
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
  applyCleanupWizardQr,
  deferCleanupWizardItem,
  getCleanupWizardCounts,
  listCleanupWizardQueue,
} from "@/lib/services/item-cleanup-wizard";
import { HttpError } from "@/lib/http";

describe("item cleanup wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(null);
    mocks.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        asset: {
          findUnique: mocks.findUnique,
          update: mocks.update,
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

  it("counts open legacy QR and missing serial rows, excluding deferred assets", async () => {
    mocks.findUnique.mockResolvedValue({
      value: {
        "asset-deferred": {
          kinds: ["legacy_qr"],
          reason: "no_printed_qr",
          deferredAt: "2026-10-07T00:00:00.000Z",
          actorId: "admin-1",
        },
      },
    });
    mocks.findMany.mockResolvedValue([
      { id: "asset-1", qrCodeValue: "E1-041", primaryScanCode: "E1-041", serialNumber: null },
      { id: "asset-deferred", qrCodeValue: "E1-042", primaryScanCode: "E1-042", serialNumber: "SN" },
      { id: "asset-2", qrCodeValue: "realqrcode", primaryScanCode: "realqrcode", serialNumber: null },
    ]);

    await expect(getCleanupWizardCounts()).resolves.toEqual({
      legacy_qr: 1,
      missing_serial: 2,
      deferred: { legacy_qr: 1, missing_serial: 0 },
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
});
