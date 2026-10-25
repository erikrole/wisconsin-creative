import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    checkinItemReport: { findFirst: vi.fn(), create: vi.fn() },
    asset: { update: vi.fn() },
  };
  return {
    tx,
    db: {
      checkinItemReport: { findMany: vi.fn(), count: vi.fn() },
      asset: { findUnique: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    put: vi.fn(),
    deleteImage: vi.fn(),
    validateImage: vi.fn(),
    notify: vi.fn(),
    deferPush: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/services/status", () => ({ deriveAssetStatus: vi.fn(async () => "AVAILABLE") }));
vi.mock("@/lib/services/notifications", () => ({ deferPush: mocks.deferPush, notifyItemReport: mocks.notify }));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("@/lib/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob")>()),
  validateImage: mocks.validateImage,
  deleteImage: mocks.deleteImage,
  isBlobUrl: (url: string) => url.includes("blob.vercel-storage.com"),
  publicBlobAuth: () => ({}),
}));

import { countOpenDamageCases, listDamageCases, missingAssetIds, reportAssetProblem } from "@/lib/services/damage-cases";

const reportedAt = new Date("2026-10-24T18:00:00.000Z");

function caseRow(extra: Record<string, unknown>) {
  return {
    id: "r1", type: "DAMAGED", description: "Cracked", imageUrl: null, quantity: null,
    lastReportedAt: reportedAt, resolution: null, resolvedAt: null, resolutionNote: null, resolvedBy: null,
    asset: null, bulkSkuUnit: null, bulkSku: null, booking: null,
    reportedBy: { id: "u1", name: "Sam" },
    ...extra,
  };
}

const camera = { id: "a1", assetTag: "FX6 3", name: null, brand: "Sony", model: "FX6", status: "AVAILABLE", imageUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.checkinItemReport.count.mockResolvedValue(0);
  mocks.db.asset.findUnique.mockResolvedValue({ id: "a1", assetTag: "FX6 3", brand: "Sony", model: "FX6", status: "AVAILABLE" });
  mocks.tx.checkinItemReport.findFirst.mockResolvedValue(null);
  mocks.tx.checkinItemReport.create.mockResolvedValue({ id: "r9" });
  mocks.notify.mockResolvedValue(undefined);
});

describe("listDamageCases", () => {
  it("describes items, units and counted stock, and drops reports with no target", async () => {
    mocks.db.checkinItemReport.findMany.mockResolvedValue([
      caseRow({ id: "r-asset", type: "LOST", asset: camera, booking: { id: "b1", title: "Football at Iowa", requester: { id: "ada", name: "Ada" } } }),
      caseRow({ id: "r-unit", bulkSkuUnit: { id: "u7", unitNumber: 7, status: "AVAILABLE", bulkSku: { id: "sku-1", name: "Sony Battery", imageUrl: null } } }),
      caseRow({ id: "r-counted", quantity: 3, bulkSku: { id: "sku-2", name: "AA batteries", imageUrl: null } }),
      caseRow({ id: "r-counted-one", bulkSku: { id: "sku-2", name: "AA batteries", imageUrl: null } }),
      caseRow({ id: "r-orphan" }),
    ]);

    const { cases } = await listDamageCases("open");

    expect(cases.map((row) => [row.id, row.item.kind, row.item.label, row.item.tag, row.item.href])).toEqual([
      ["r-asset", "asset", "Sony FX6", "FX6 3", "/items/a1"],
      ["r-unit", "unit", "Sony Battery", "#7", "/bulk-inventory/sku-1"],
      ["r-counted", "counted", "AA batteries", "× 3", "/bulk-inventory/sku-2"],
      ["r-counted-one", "counted", "AA batteries", "× 1", "/bulk-inventory/sku-2"],
    ]);
    expect(cases[0]).toEqual(expect.objectContaining({
      responsible: { id: "ada", name: "Ada" },
      stillBookable: true,
      allowedResolutions: ["FOUND", "REPLACED", "WRITTEN_OFF"],
      reportedAt: reportedAt.toISOString(),
    }));
    expect(cases[1]).toEqual(expect.objectContaining({ stillBookable: false, booking: null, responsible: null, allowedResolutions: ["REPAIRED", "REPLACED", "WRITTEN_OFF", "NO_ISSUE"] }));
  });

  it("reads closed cases newest-resolved first and counts every tab", async () => {
    mocks.db.checkinItemReport.findMany.mockResolvedValue([
      caseRow({ asset: camera, type: "LOST", resolution: "FOUND", resolvedAt: reportedAt, resolvedBy: { id: "s1", name: "Staff" } }),
    ]);
    mocks.db.checkinItemReport.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1).mockResolvedValueOnce(9);

    const result = await listDamageCases("closed");

    expect(result.counts).toEqual({ open: 4, missing: 1, closed: 9 });
    expect(result.cases[0]).toEqual(expect.objectContaining({ stillBookable: false, resolvedBy: "Staff", resolvedAt: reportedAt.toISOString() }));
    expect(mocks.db.checkinItemReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ resolution: { not: null } }),
      orderBy: { resolvedAt: "desc" },
    }));
  });
});

describe("missing items and the sidebar count", () => {
  it("skips the query with no items and returns only open missing reports", async () => {
    expect((await missingAssetIds([])).size).toBe(0);
    expect(mocks.db.checkinItemReport.findMany).not.toHaveBeenCalled();

    mocks.db.checkinItemReport.findMany.mockResolvedValue([{ assetId: "a1" }, { assetId: null }]);
    expect([...await missingAssetIds(["a1", "a2"])]).toEqual(["a1"]);
  });

  it("counts open cases", async () => {
    mocks.db.checkinItemReport.count.mockResolvedValue(5);

    expect(await countOpenDamageCases()).toBe(5);
    expect(mocks.db.checkinItemReport.count).toHaveBeenCalledWith({ where: expect.objectContaining({ resolution: null }) });
  });
});

describe("reportAssetProblem edges", () => {
  const reporter = { id: "u1", role: Role.STUDENT, name: "Sam" };

  it("refuses an unknown or retired item", async () => {
    mocks.db.asset.findUnique.mockResolvedValueOnce(null);
    await expect(reportAssetProblem({ assetId: "nope", type: "LOST", file: null, reporter })).rejects.toMatchObject({ status: 404 });

    mocks.db.asset.findUnique.mockResolvedValueOnce({ id: "a1", status: "RETIRED" });
    await expect(reportAssetProblem({ assetId: "a1", type: "LOST", file: null, reporter })).rejects.toMatchObject({ status: 409, message: "This item is retired." });
  });

  it("refuses a bad photo before uploading", async () => {
    mocks.validateImage.mockResolvedValue("That file isn't an image.");
    const file = new File(["x"], "note.txt", { type: "text/plain" });

    await expect(reportAssetProblem({ assetId: "a1", type: "DAMAGED", file, reporter })).rejects.toMatchObject({ status: 400, message: "That file isn't an image." });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("uploads a photo, and deletes it again when the report can't be saved", async () => {
    mocks.validateImage.mockResolvedValue(null);
    mocks.put.mockResolvedValue({ url: "https://x.public.blob.vercel-storage.com/checkin-reports/a.jpg" });
    mocks.deleteImage.mockResolvedValue(undefined);
    mocks.tx.checkinItemReport.findFirst.mockResolvedValue({ id: "r0" });
    const file = new File(["x"], "crack.jpg", { type: "image/jpeg" });

    await expect(reportAssetProblem({ assetId: "a1", type: "DAMAGED", file, reporter })).rejects.toMatchObject({ status: 409 });
    expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/^checkin-reports\/item\/a1\/\d+\.jpg$/), expect.anything(), expect.objectContaining({ contentType: "image/jpeg" }));
    expect(mocks.deleteImage).toHaveBeenCalledWith("https://x.public.blob.vercel-storage.com/checkin-reports/a.jpg");
  });

  it("logs a failed staff alert instead of failing the report", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.notify.mockRejectedValue(new Error("push down"));

    await reportAssetProblem({ assetId: "a1", type: "LOST", file: null, reporter });
    await mocks.deferPush.mock.calls[0]?.[0];

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ reportId: "r9", assetTag: "FX6 3", itemDescription: "Sony FX6", reporterName: "Sam" }));
    expect(error).toHaveBeenCalledWith("[REPORT] Failed to send supervisor notifications:", expect.any(Error));
  });
});
