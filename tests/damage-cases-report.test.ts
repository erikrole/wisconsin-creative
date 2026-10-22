import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const { tx, dbMock } = vi.hoisted(() => {
  const tx = {
    checkinItemReport: { findFirst: vi.fn(), create: vi.fn() },
    asset: { update: vi.fn() },
  };
  const dbMock = {
    asset: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { tx, dbMock };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/services/status", () => ({ deriveAssetStatus: vi.fn() }));
vi.mock("@/lib/services/notifications", () => ({
  deferPush: vi.fn(),
  notifyItemReport: vi.fn(async () => {}),
}));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

import { deriveAssetStatus } from "@/lib/services/status";
import { reportAssetProblem } from "@/lib/services/damage-cases";

const reporter = { id: "u1", role: Role.STUDENT, name: "Sam" };

describe("reportAssetProblem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.asset.findUnique.mockResolvedValue({ id: "a1", assetTag: "FX6 #3", brand: "Sony", model: "FX6", status: "AVAILABLE" });
    tx.checkinItemReport.findFirst.mockResolvedValue(null);
    tx.checkinItemReport.create.mockResolvedValue({ id: "r1", type: "DAMAGED" });
  });

  it("opens a case without a booking and holds an idle item", async () => {
    vi.mocked(deriveAssetStatus).mockResolvedValue("AVAILABLE");
    await reportAssetProblem({ assetId: "a1", type: "DAMAGED", description: " cracked ", file: null, reporter });
    expect(tx.checkinItemReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ assetId: "a1", description: "cracked", reportedById: "u1" }),
    });
    expect(tx.asset.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "MAINTENANCE" } });
  });

  it("leaves a checked-out item in service", async () => {
    vi.mocked(deriveAssetStatus).mockResolvedValue("CHECKED_OUT");
    await reportAssetProblem({ assetId: "a1", type: "LOST", file: null, reporter });
    expect(tx.checkinItemReport.create).toHaveBeenCalled();
    expect(tx.asset.update).not.toHaveBeenCalled();
  });

  it("asks for detail on a damage report", async () => {
    await expect(reportAssetProblem({ assetId: "a1", type: "DAMAGED", file: null, reporter })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a repeat open report from the same person", async () => {
    vi.mocked(deriveAssetStatus).mockResolvedValue("AVAILABLE");
    tx.checkinItemReport.findFirst.mockResolvedValue({ id: "r0" });
    await expect(reportAssetProblem({ assetId: "a1", type: "DAMAGED", description: "x", file: null, reporter })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a retired item", async () => {
    dbMock.asset.findUnique.mockResolvedValue({ id: "a1", assetTag: "T", brand: "b", model: "m", status: "RETIRED" });
    await expect(reportAssetProblem({ assetId: "a1", type: "LOST", file: null, reporter })).rejects.toMatchObject({ status: 409 });
  });
});
