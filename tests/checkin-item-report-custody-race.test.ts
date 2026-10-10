import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
  const tx = {
    bookingSerializedItem: { findUnique: vi.fn() },
    scanEvent: { findFirst: vi.fn() },
    checkinItemReport: { findUnique: vi.fn(), upsert: vi.fn() },
    asset: { findUnique: vi.fn(), update: vi.fn() },
  };
  const db = {
    bookingSerializedItem: { findUnique: vi.fn() },
    scanEvent: { findFirst: vi.fn() },
    checkinItemReport: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/services/notifications", () => ({ deferPush: vi.fn(), notifyItemReport: vi.fn(async () => undefined) }));
vi.mock("@/lib/services/bookings-checkin", () => ({ maybeAutoComplete: vi.fn(async () => null) }));

import { submitCheckinItemReport } from "@/lib/services/checkin-item-reports";
import { createAuditEntryTx } from "@/lib/audit";

const args = {
  bookingId: "b1",
  bookingTitle: "Game day",
  assetId: "a1",
  file: null,
  description: "Cracked screen",
  reporter: { id: "u1", role: "STUDENT" as const, name: "Pat" },
  kiosk: {
    kioskId: "k1",
    locationId: "loc1",
    booking: { requesterUserId: "u1", custodyScope: "INDIVIDUAL" as never, locationId: "loc1" },
  },
};

describe("item report custody and evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.bookingSerializedItem.findUnique.mockResolvedValue({ allocationStatus: "active", asset: { assetTag: "CAM-1" } });
    db.checkinItemReport.findUnique.mockResolvedValue(null);
    tx.checkinItemReport.findUnique.mockResolvedValue(null);
  });

  it("refuses a LOST report when the item was scanned back after the pre-check", async () => {
    tx.bookingSerializedItem.findUnique.mockResolvedValue({ allocationStatus: "returned" });

    await expect(submitCheckinItemReport({ ...args, type: "LOST" })).rejects.toMatchObject({ status: 409 });
    expect(tx.checkinItemReport.upsert).not.toHaveBeenCalled();
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("refuses a DAMAGED report when the check-in scan is gone inside the transaction", async () => {
    db.scanEvent.findFirst.mockResolvedValue({ id: "s1" });
    tx.scanEvent.findFirst.mockResolvedValue(null);

    await expect(submitCheckinItemReport({ ...args, type: "DAMAGED" })).rejects.toMatchObject({ status: 400 });
    expect(tx.checkinItemReport.upsert).not.toHaveBeenCalled();
  });

  it("records a LOST report when the item is still out", async () => {
    tx.bookingSerializedItem.findUnique.mockResolvedValue({ allocationStatus: "active" });
    tx.checkinItemReport.upsert.mockResolvedValue({ id: "r1", imageUrl: null });

    await submitCheckinItemReport({ ...args, type: "LOST" });
    expect(tx.checkinItemReport.upsert).toHaveBeenCalledTimes(1);
  });
});


describe("web damage report safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.bookingSerializedItem.findUnique.mockResolvedValue({ asset: { assetTag: "CAM-1" } });
    db.checkinItemReport.findUnique.mockResolvedValue(null);
    tx.checkinItemReport.findUnique.mockResolvedValue(null);
    db.scanEvent.findFirst.mockResolvedValue({ id: "s1" });
    tx.scanEvent.findFirst.mockResolvedValue({ id: "s1" });
    tx.checkinItemReport.upsert.mockResolvedValue({ id: "r1", type: "DAMAGED", imageUrl: null });
    db.checkinItemReport.upsert.mockResolvedValue({ id: "r1", type: "DAMAGED", imageUrl: null });
    tx.asset.findUnique.mockResolvedValue({ status: "AVAILABLE" });
  });

  it("holds damaged gear for staff and audits the hold in the report transaction", async () => {
    const result = await submitCheckinItemReport({ ...args, kiosk: undefined, type: "DAMAGED" });
    expect(result.heldForStaff).toBe(true);
    expect(tx.asset.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "MAINTENANCE" } });
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      entityType: "asset", before: { status: "AVAILABLE" },
      after: expect.objectContaining({ status: "MAINTENANCE", reportId: "r1", source: "WEB" }),
    }));
    expect(db.checkinItemReport.upsert).not.toHaveBeenCalled();
  });

  it("does not overwrite evidence changed while the submission was in flight", async () => {
    tx.checkinItemReport.findUnique.mockResolvedValue({ createdAt: new Date(), type: "DAMAGED", description: "New evidence" });
    await expect(submitCheckinItemReport({ ...args, kiosk: undefined, type: "DAMAGED" })).rejects.toMatchObject({ status: 409 });
    expect(tx.checkinItemReport.upsert).not.toHaveBeenCalled();
    expect(tx.asset.update).not.toHaveBeenCalled();
  });

  it("rejects damage without a description, a photo, or existing evidence", async () => {
    await expect(submitCheckinItemReport({ ...args, kiosk: undefined, type: "DAMAGED", description: "   " })).rejects.toMatchObject({ status: 400 });
    expect(tx.checkinItemReport.upsert).not.toHaveBeenCalled();
  });

  it("updates the item version for fresh damage evidence even when it is already held", async () => {
    tx.asset.findUnique.mockResolvedValue({ status: "MAINTENANCE" });
    await submitCheckinItemReport({ ...args, kiosk: undefined, type: "DAMAGED" });
    expect(tx.asset.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "MAINTENANCE" } });
  });

  it("does not unretire damaged gear", async () => {
    tx.asset.findUnique.mockResolvedValue({ status: "RETIRED" });
    const result = await submitCheckinItemReport({ ...args, kiosk: undefined, type: "DAMAGED" });
    expect(result.heldForStaff).toBe(false);
    expect(tx.asset.update).not.toHaveBeenCalled();
  });
});
