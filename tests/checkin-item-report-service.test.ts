import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckinReportType, Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    asset: { findUnique: vi.fn(), update: vi.fn() },
    bookingSerializedItem: {
      findUnique: vi.fn(),
    },
    scanEvent: {
      findFirst: vi.fn(),
    },
    checkinItemReport: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/blob", () => ({
  publicBlobAuth: () => ({ token: "test-public-store" }),
  validateImage: vi.fn(() => null),
  deleteImage: vi.fn(async () => undefined),
  isBlobUrl: vi.fn(() => true),
  imageExtensionForType: vi.fn(() => "jpg"),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

vi.mock("@/lib/services/notifications", () => ({
  notifyItemReport: vi.fn(async () => undefined),
  deferPush: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { deleteImage } from "@/lib/blob";
import { put } from "@vercel/blob";
import { submitCheckinItemReport } from "@/lib/services/checkin-item-reports";

const reporter = { id: "staff-1", role: Role.STAFF, name: "Staff One" };

function report(overrides: { description?: string; file?: File | null } = {}) {
  return submitCheckinItemReport({
    bookingId: "booking-1",
    bookingTitle: "Checkout",
    assetId: "cm111111111111111111111111",
    type: "DAMAGED",
    description: "Scratched",
    file: null,
    reporter,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.$transaction).mockImplementation(async (fn) => (fn as (tx: typeof db) => Promise<unknown>)(db));
  vi.mocked(db.asset.findUnique).mockResolvedValue({ status: "AVAILABLE" } as never);
  vi.mocked(db.bookingSerializedItem.findUnique).mockResolvedValue({
    asset: { assetTag: "CAM-1", brand: "Sony", model: "FX3" },
  } as unknown as Awaited<ReturnType<typeof db.bookingSerializedItem.findUnique>>);
  vi.mocked(db.scanEvent.findFirst).mockResolvedValue(
    { id: "scan-1" } as unknown as Awaited<ReturnType<typeof db.scanEvent.findFirst>>,
  );
  vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue(null);
  vi.mocked(db.checkinItemReport.upsert).mockResolvedValue({
    id: "report-1",
    type: CheckinReportType.DAMAGED,
    description: "Scratched",
    imageUrl: null,
  } as unknown as Awaited<ReturnType<typeof db.checkinItemReport.upsert>>);
  vi.mocked(put).mockResolvedValue(
    { url: "https://blob.example.com/new.jpg" } as unknown as Awaited<ReturnType<typeof put>>,
  );
});

describe("check-in item reports (kiosk service)", () => {
  it("rejects duplicate check-in reports inside the five-second window", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      imageUrl: null,
      createdAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof db.checkinItemReport.findUnique>>);

    await expect(report()).rejects.toMatchObject({ status: 409 });
    expect(db.checkinItemReport.upsert).not.toHaveBeenCalled();
  });

  it("keeps replaced evidence available to the audit history", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      imageUrl: "https://blob.example.com/original.jpg", createdAt: new Date("2026-01-01"),
      type: CheckinReportType.DAMAGED, description: "Original evidence", reportedById: "staff-1",
    } as never);
    const result = await report({ description: "New evidence", file: new File(["image"], "damage.jpg", { type: "image/jpeg" }) });
    expect(result.report.id).toBe("report-1");
    // Updated evidence reopens a flag staff dismissed from the dashboard.
    expect(db.checkinItemReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ dismissedAt: null, dismissedById: null, lastReportedAt: expect.any(Date) }),
    }));
    expect(deleteImage).not.toHaveBeenCalled();
    expect(createAuditEntryTx).toHaveBeenCalledWith(db, expect.objectContaining({
      entityType: "booking",
      before: expect.objectContaining({ description: "Original evidence", imageUrl: "https://blob.example.com/original.jpg", createdAt: "2026-01-01T00:00:00.000Z" }),
    }));
  });

  it("deletes newly uploaded report images when report persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.checkinItemReport.upsert).mockRejectedValue(new Error("db down"));
    await expect(report({ file: new File(["image"], "damage.jpg", { type: "image/jpeg" }) })).rejects.toThrow("db down");
    expect(deleteImage).toHaveBeenCalledWith("https://blob.example.com/new.jpg");
    consoleError.mockRestore();
  });
});
