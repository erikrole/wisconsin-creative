import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const tx = {
  checkinItemReport: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  asset: { findUnique: vi.fn(), update: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  db: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));

import { createAuditEntryTx } from "@/lib/audit";
import { resolveDamageCase } from "@/lib/services/damage-cases";

const actor = { id: "staff-1", role: Role.STAFF };

function open(type: "DAMAGED" | "LOST", status: "MAINTENANCE" | "AVAILABLE" | "RETIRED" = "MAINTENANCE") {
  tx.checkinItemReport.findUnique.mockResolvedValue({ id: "r1", assetId: "a1", type, resolution: null, bookingId: "b1" });
  tx.checkinItemReport.findMany.mockResolvedValue([{ id: "r1" }, { id: "r0" }]);
  tx.asset.findUnique.mockResolvedValue({ status });
}

describe("resolveDamageCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("releases a repaired item and closes every open report on it", async () => {
    open("DAMAGED");
    await resolveDamageCase({ reportId: "r1", resolution: "REPAIRED", actor });
    expect(tx.checkinItemReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["r1", "r0"] } },
      data: expect.objectContaining({ resolution: "REPAIRED", resolvedById: "staff-1" }),
    }));
    expect(tx.asset.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "AVAILABLE" } });
    expect(createAuditEntryTx).toHaveBeenCalled();
  });

  it("retires a missing item that is written off", async () => {
    open("LOST");
    await resolveDamageCase({ reportId: "r1", resolution: "WRITTEN_OFF", note: " gone ", actor });
    expect(tx.asset.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "RETIRED" } });
    expect(tx.checkinItemReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resolutionNote: "gone" }),
    }));
  });

  it("does not un-retire an already retired item", async () => {
    open("DAMAGED", "RETIRED");
    await resolveDamageCase({ reportId: "r1", resolution: "REPAIRED", actor });
    expect(tx.asset.update).not.toHaveBeenCalled();
  });

  it("rejects an outcome that doesn't fit the report", async () => {
    open("LOST");
    await expect(resolveDamageCase({ reportId: "r1", resolution: "REPAIRED", actor })).rejects.toMatchObject({ status: 400 });
    expect(tx.checkinItemReport.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a case that was already closed", async () => {
    tx.checkinItemReport.findUnique.mockResolvedValue({ id: "r1", assetId: "a1", type: "DAMAGED", resolution: "REPAIRED", bookingId: "b1" });
    await expect(resolveDamageCase({ reportId: "r1", resolution: "NO_ISSUE", actor })).rejects.toMatchObject({ status: 409 });
  });
});
