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
      update: vi.fn(),
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
  it("stamps the report and writes an audit entry for staff", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      id: "report-1",
      assetId: "asset-1",
      type: "DAMAGED",
      dismissedAt: null,
    } as never);
    vi.mocked(db.checkinItemReport.update).mockResolvedValue({
      id: "report-1",
      assetId: "asset-1",
      type: "DAMAGED",
      dismissedAt: new Date("2026-10-07T12:00:00Z"),
    } as never);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(200);
    expect(db.checkinItemReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "report-1" },
        data: expect.objectContaining({
          dismissedById: "staff-1",
          dismissedAt: expect.any(Date),
        }),
      }),
    );
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "dismissed_checkin_report",
        entityId: "asset-1",
      }),
    );
  });

  it("is a no-op for an already-dismissed report", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      id: "report-1",
      assetId: "asset-1",
      type: "DAMAGED",
      dismissedAt: new Date("2026-10-06T12:00:00Z"),
    } as never);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(200);
    expect(db.checkinItemReport.update).not.toHaveBeenCalled();
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
    expect(db.checkinItemReport.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown report", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue(null);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(404);
    expect(db.checkinItemReport.update).not.toHaveBeenCalled();
  });

  it("rejects students", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await dismiss(post(), context);

    expect(res.status).toBe(403);
    expect(db.checkinItemReport.findUnique).not.toHaveBeenCalled();
  });
});
