import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    asset: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    assetAllocation: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  return {
    tx,
    db: {
      asset: { findMany: vi.fn() },
      bulkSku: { findMany: vi.fn() },
      systemConfig: tx.systemConfig,
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    audit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));

import {
  applyCleanupWizardAttach,
  applyCleanupWizardQr,
  applyCleanupWizardSerial,
  deferCleanupWizardItem,
  getCleanupWizardCounts,
  listCleanupWizardQueue,
  parseCleanupWizardKind,
} from "@/lib/services/item-cleanup-wizard";

const { tx, db } = mocks;
const actor = { id: "staff-1", role: Role.STAFF };

function asset(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, assetTag: id.toUpperCase(), name: null, brand: "Sony", model: "FX3", type: "Camera", imageUrl: null,
    qrCodeValue: `QR-${id}`, primaryScanCode: null, serialNumber: null, location: { name: "Camp Randall" },
    status: "AVAILABLE", parentAssetId: null, _count: { accessories: 0 },
    ...extra,
  };
}

function uniqueError() {
  return new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" });
}

function deferred(value: unknown) {
  tx.systemConfig.findUnique.mockResolvedValue({ value });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.systemConfig.findUnique.mockResolvedValue(null);
  tx.asset.findUnique.mockResolvedValue(asset("a1"));
  tx.asset.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...asset("a1"), ...data }));
  tx.asset.count.mockResolvedValue(0);
  tx.assetAllocation.findFirst.mockResolvedValue(null);
  db.asset.findMany.mockResolvedValue([]);
  db.bulkSku.findMany.mockResolvedValue([]);
});

describe("deferred items", () => {
  it("ignores malformed deferral rows and skips well-formed ones per queue", async () => {
    deferred({
      good: { kinds: ["missing_serial"], reason: "no_serial", deferredAt: "2026-10-01", actorId: "s1" },
      noKinds: { kinds: ["bogus"], reason: "x", deferredAt: "2026-10-01", actorId: "s1" },
      noReason: { kinds: ["missing_serial"], deferredAt: "2026-10-01", actorId: "s1" },
      notObject: "nope",
    });

    await listCleanupWizardQueue("missing_serial", 5, ["extra"]);

    expect(db.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { notIn: ["good", "extra"] } }),
      take: 5,
    }));
  });

  it("treats a non-object config as no deferrals", async () => {
    deferred(["not", "a", "map"]);

    await listCleanupWizardQueue("missing_serial");

    expect(db.asset.findMany.mock.calls[0]?.[0].where.id).toBeUndefined();
  });

  it("counts each queue and its deferrals", async () => {
    deferred({ a2: { kinds: ["legacy_qr", "missing_serial"], reason: "other", deferredAt: "2026-10-01", actorId: "s1" } });
    db.asset.findMany.mockResolvedValue([
      asset("a1", { qrCodeValue: "E1-041" }),
      asset("a2", { qrCodeValue: "E1-042" }),
      asset("a3", { name: "FX3 cage", serialNumber: "S3" }),
      asset("a4", { name: "FX3 handle", serialNumber: " ", parentAssetId: "a1" }),
    ]);

    expect(await getCleanupWizardCounts()).toEqual({
      legacy_qr: 1,
      missing_serial: 2,
      attachment_candidate: 1,
      deferred: { legacy_qr: 1, missing_serial: 1, attachment_candidate: 0 },
    });
  });
});

describe("attachment queue", () => {
  it("suggests the exact tag parent first, then matching lenses for a lens cap", async () => {
    db.asset.findMany
      .mockResolvedValueOnce([asset("cap", { assetTag: "24-70 lens cap", name: "77mm lens cap", type: "Accessory" })])
      .mockResolvedValueOnce([
        asset("p-exact", { assetTag: "24-70", name: "24-70 lens 82mm", type: "Lens" }),
        asset("p-77", { assetTag: "70-200", name: "70-200 lens 77mm", type: "Lens" }),
        asset("p-other", { assetTag: "16-35", name: "16-35 lens 82mm", type: "Lens" }),
        asset("p-cage", { assetTag: "FX3 cage", name: "FX3 cage", type: "Accessory" }),
      ]);

    const [item] = await listCleanupWizardQueue("attachment_candidate");

    expect(item?.suggestedParents?.map((parent) => [parent.id, parent.reason])).toEqual([
      ["p-exact", "Exact tag prefix match"],
      ["p-77", "Matching 77mm lens"],
    ]);
    expect(item?.question).toBe("Does this accessory stay married to a specific parent item?");
  });

  it("suggests camera bodies for a cage", async () => {
    db.asset.findMany
      .mockResolvedValueOnce([asset("cage", { assetTag: "C-9", name: "Small rig cage", type: "Accessory" })])
      .mockResolvedValueOnce([
        asset("plate", { assetTag: "FX3 baseplate", name: "FX3 camera baseplate", type: "Camera" }),
        asset("body", { assetTag: "FX3 1", name: null, model: "FX3", type: "Camera" }),
        asset("light", { assetTag: "LIGHT 1", name: "Aputure", model: "300d", type: "Lighting" }),
      ]);

    const [item] = await listCleanupWizardQueue("attachment_candidate");

    expect(item?.suggestedParents).toEqual([expect.objectContaining({ id: "body", reason: "Camera body candidate" })]);
  });
});

describe("applyCleanupWizardQr", () => {
  it("refuses a blank code and a code someone else uses", async () => {
    await expect(applyCleanupWizardQr({ assetId: "a1", code: "  ", actor })).rejects.toMatchObject({ status: 400 });

    db.asset.findMany.mockResolvedValueOnce([{ assetTag: "FX3 2" }]);
    db.bulkSku.findMany.mockResolvedValueOnce([{ name: "Sony Battery" }]);
    await expect(applyCleanupWizardQr({ assetId: "a1", code: "ABC", actor })).rejects.toMatchObject({ status: 409, message: "That scan code is already used by FX3 2, Sony Battery" });
  });

  it("refuses a retired item and a racing duplicate", async () => {
    tx.asset.findUnique.mockResolvedValueOnce(asset("a1", { status: "RETIRED" }));
    await expect(applyCleanupWizardQr({ assetId: "a1", code: "ABC", actor })).rejects.toMatchObject({ status: 404 });

    tx.asset.update.mockRejectedValueOnce(uniqueError());
    await expect(applyCleanupWizardQr({ assetId: "a1", code: "ABC", actor })).rejects.toMatchObject({ status: 409, message: "That scan code is already in use" });
  });

  it("saves the code to both scan fields and clears only that deferral", async () => {
    deferred({ a1: { kinds: ["legacy_qr", "missing_serial"], reason: "other", deferredAt: "2026-10-01", actorId: "s1" } });

    const item = await applyCleanupWizardQr({ assetId: "a1", code: " ABC ", actor });

    expect(item).toEqual(expect.objectContaining({ qrCodeValue: "ABC", primaryScanCode: "ABC", kind: "legacy_qr" }));
    expect(tx.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { value: { a1: expect.objectContaining({ kinds: ["missing_serial"] }) } },
    }));
  });
});

describe("applyCleanupWizardSerial", () => {
  it("refuses a blank serial, a retired item and a duplicate serial", async () => {
    await expect(applyCleanupWizardSerial({ assetId: "a1", serialNumber: " ", actor })).rejects.toMatchObject({ status: 400 });

    tx.asset.findUnique.mockResolvedValueOnce(null);
    await expect(applyCleanupWizardSerial({ assetId: "a1", serialNumber: "S1", actor })).rejects.toMatchObject({ status: 404 });

    tx.asset.update.mockRejectedValueOnce(uniqueError());
    await expect(applyCleanupWizardSerial({ assetId: "a1", serialNumber: "S1", actor })).rejects.toMatchObject({ status: 409, message: "Serial number already in use by another asset" });
  });

  it("passes other database errors through", async () => {
    tx.asset.update.mockRejectedValueOnce(new Error("boom"));

    await expect(applyCleanupWizardSerial({ assetId: "a1", serialNumber: "S1", actor })).rejects.toThrow("boom");
  });

  it("saves the serial and removes an item's last deferral", async () => {
    deferred({ a1: { kinds: ["missing_serial"], reason: "no_serial", deferredAt: "2026-10-01", actorId: "s1" } });

    const item = await applyCleanupWizardSerial({ assetId: "a1", serialNumber: " S1 ", actor });

    expect(item.serialNumber).toBe("S1");
    expect(tx.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: {} } }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "cleanup_wizard_serial", after: { serialNumber: "S1" } }));
  });
});

describe("applyCleanupWizardAttach", () => {
  function arrange(child: Record<string, unknown> | null, parent: Record<string, unknown> | null) {
    tx.asset.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "child" ? child : parent));
  }

  it.each([
    ["a retired child", { status: "RETIRED" }, {}, 404, "Item not found"],
    ["a missing parent", {}, null, 404, "Parent item not found"],
    ["a parent that is itself an accessory", {}, { parentAssetId: "x" }, 400, "Cannot attach accessories to a child item"],
    ["a child already attached", { parentAssetId: "x" }, {}, 409, "This item is already an accessory of another item. Detach it first."],
  ])("refuses %s", async (_label, childExtra, parentExtra, status, message) => {
    arrange(asset("child", childExtra), parentExtra === null ? null : asset("parent", parentExtra));

    await expect(applyCleanupWizardAttach({ assetId: "child", parentAssetId: "parent", actor })).rejects.toMatchObject({ status, message });
  });

  it("refuses a child with its own accessories or active custody", async () => {
    arrange(asset("child"), asset("parent"));
    tx.asset.count.mockResolvedValueOnce(2);
    await expect(applyCleanupWizardAttach({ assetId: "child", parentAssetId: "parent", actor })).rejects.toMatchObject({ status: 400 });

    tx.assetAllocation.findFirst.mockResolvedValueOnce({ id: "alloc" });
    await expect(applyCleanupWizardAttach({ assetId: "child", parentAssetId: "parent", actor })).rejects.toMatchObject({ status: 409, message: "This item has active custody. Return it before attaching." });
  });

  it("refuses attaching an item to itself before reading anything", async () => {
    await expect(applyCleanupWizardAttach({ assetId: "a1", parentAssetId: "a1", actor })).rejects.toMatchObject({ status: 400 });
    expect(tx.asset.findUnique).not.toHaveBeenCalled();
  });
});

describe("deferCleanupWizardItem", () => {
  it("needs a standalone reason for accessories", async () => {
    await expect(deferCleanupWizardItem({ assetId: "a1", kind: "attachment_candidate", reason: "no_serial", actor }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("refuses a retired item", async () => {
    tx.asset.findUnique.mockResolvedValueOnce({ id: "a1", assetTag: "A1", status: "RETIRED" });

    await expect(deferCleanupWizardItem({ assetId: "a1", kind: "missing_serial", reason: "no_serial", actor })).rejects.toMatchObject({ status: 404 });
  });

  it("adds the queue to the item's existing deferrals", async () => {
    deferred({ a1: { kinds: ["legacy_qr"], reason: "no_printed_qr", deferredAt: "2026-10-01", actorId: "s1" } });

    expect(await deferCleanupWizardItem({ assetId: "a1", kind: "missing_serial", reason: "no_serial", actor }))
      .toEqual({ success: true, assetId: "a1", kind: "missing_serial", reason: "no_serial" });
    expect(tx.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { value: { a1: expect.objectContaining({ kinds: ["legacy_qr", "missing_serial"], reason: "no_serial", actorId: "staff-1" }) } },
    }));
  });
});

describe("parseCleanupWizardKind", () => {
  it("accepts known queues only", () => {
    expect(parseCleanupWizardKind("legacy_qr")).toBe("legacy_qr");
    expect(() => parseCleanupWizardKind("other")).toThrow("Unknown cleanup queue");
    expect(() => parseCleanupWizardKind(3)).toThrow("Unknown cleanup queue");
  });
});
