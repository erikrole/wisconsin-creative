import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    checkinItemReport: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { POST as dismiss } from "@/app/api/checkin-reports/[id]/dismiss/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const studentUser = { ...staffUser, id: "student-1", role: Role.STUDENT };

function post() {
  return new Request(
    "https://app.example.com/api/checkin-reports/report-1/dismiss",
    {
      method: "POST",
      headers: {
        host: "app.example.com",
        origin: "https://app.example.com",
      },
    },
  );
}

const context = { params: Promise.resolve({ id: "report-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.$transaction).mockImplementation(async (fn) =>
    (fn as (tx: typeof db) => Promise<unknown>)(db),
  );
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
});

describe("POST /api/checkin-reports/[id]/dismiss", () => {
  it("dismisses every open damage report on the asset in one transaction", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      id: "report-1",
      assetId: "asset-1",
      bookingId: "booking-1",
      type: "DAMAGED",
    } as never);
    vi.mocked(db.checkinItemReport.findMany).mockResolvedValue([
      { id: "report-1" },
      { id: "report-old" },
    ] as never);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(200);
    expect(db.checkinItemReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assetId: "asset-1", type: "DAMAGED", dismissedAt: null },
    }));
    expect(db.checkinItemReport.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["report-1", "report-old"] }, dismissedAt: null },
      data: { dismissedAt: expect.any(Date), dismissedById: "staff-1" },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "dismissed_checkin_report",
        entityType: "asset",
        entityId: "asset-1",
        after: expect.objectContaining({ reportIds: ["report-1", "report-old"] }),
      }),
    );
  });

  it("is a no-op when the asset has no open damage reports", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      id: "report-1",
      assetId: "asset-1",
      bookingId: "booking-1",
      type: "DAMAGED",
    } as never);
    vi.mocked(db.checkinItemReport.findMany).mockResolvedValue([] as never);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(200);
    expect(db.checkinItemReport.updateMany).not.toHaveBeenCalled();
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("refuses to dismiss a lost report", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      id: "report-1",
      assetId: "asset-1",
      bookingId: "booking-1",
      type: "LOST",
      dismissedAt: null,
    } as never);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(409);
    expect(db.checkinItemReport.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown report", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue(null);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(404);
    expect(db.checkinItemReport.updateMany).not.toHaveBeenCalled();
  });

  it("rejects students", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(403);
    expect(db.checkinItemReport.findUnique).not.toHaveBeenCalled();
  });
});
