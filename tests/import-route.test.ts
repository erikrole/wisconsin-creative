import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    location: { findMany: vi.fn(), upsert: vi.fn() },
    department: { findMany: vi.fn(), upsert: vi.fn() },
    asset: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    bulkSku: { upsert: vi.fn() },
    bulkStockBalance: { upsert: vi.fn() },
    kit: { upsert: vi.fn() },
    kitMembership: { createMany: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { POST as importAssets } from "@/app/api/assets/import/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function importRequest(path: string, formData: FormData) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: formData,
  });
}

function csvFile() {
  return new File(["Name,Location\nCAM-1,Main\n"], "items.csv", { type: "text/csv" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
});

describe("asset import route validation", () => {
  it("rejects malformed mapping JSON before touching the database", async () => {
    const formData = new FormData();
    formData.set("file", csvFile());
    formData.set("mapping", "{not-json");

    const res = await importAssets(
      importRequest("/api/assets/import?mode=preview", formData),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Mapping must be valid JSON");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unsupported import route modes before touching the database", async () => {
    const formData = new FormData();
    formData.set("file", csvFile());
    formData.set("mapping", "{}");

    const res = await importAssets(
      importRequest("/api/assets/import?mode=destroy", formData),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Import mode must be preview or import");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

function assetCsv(rowCount: number, start = 1) {
  const lines = ["Name,Location,Serial number"];
  for (let i = start; i < start + rowCount; i += 1) {
    lines.push(`CAM-${i},Main,SN-${i}`);
  }
  return new File([lines.join("\n") + "\n"], "items.csv", { type: "text/csv" });
}

function importFormData(file: File) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set(
    "mapping",
    JSON.stringify({ Name: "assetTag", Location: "locationName", "Serial number": "serialNumber" }),
  );
  return formData;
}

function mockImportTransaction() {
  vi.mocked(db.location.upsert).mockReturnValue({ id: "loc-1" } as never);
  vi.mocked(db.$transaction).mockImplementation(((arg: unknown) => {
    if (typeof arg === "function") return Promise.resolve((arg as (tx: typeof db) => unknown)(db));
    return Promise.resolve(arg);
  }) as never);
  vi.mocked(db.asset.findMany).mockResolvedValue([] as never);
  vi.mocked(db.asset.createMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.asset.updateMany).mockResolvedValue({ count: 0 } as never);
}

describe("asset import route batching", () => {
  it("writes one createMany for a whole batch instead of a statement per row", async () => {
    mockImportTransaction();

    const res = await importAssets(
      importRequest("/api/assets/import?mode=import", importFormData(assetCsv(5))),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.created).toBe(5);
    expect(body.errors).toEqual([]);
    expect(db.asset.createMany).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.asset.createMany).mock.calls[0]![0]!.data as unknown[]).toHaveLength(5);
    expect(db.asset.update).not.toHaveBeenCalled();
  });

  it("chunks a large file into bounded transactions of 200 rows", async () => {
    mockImportTransaction();

    const res = await importAssets(
      importRequest("/api/assets/import?mode=import", importFormData(assetCsv(450))),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(body.created).toBe(450);
    expect(db.asset.createMany).toHaveBeenCalledTimes(3);
    expect(vi.mocked(db.asset.createMany).mock.calls.map((call) => (call[0]!.data as unknown[]).length)).toEqual([200, 200, 50]);
  });

  it("reports every row of a failed batch as not applied and still runs the rest", async () => {
    mockImportTransaction();
    vi.mocked(db.asset.createMany)
      .mockResolvedValueOnce({ count: 200 } as never)
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockResolvedValueOnce({ count: 50 } as never);

    const res = await importAssets(
      importRequest("/api/assets/import?mode=import", importFormData(assetCsv(450))),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.created).toBe(250);
    expect(body.errors).toHaveLength(200);
    expect(body.errors[0]).toMatchObject({
      assetTag: "CAM-201",
      error: "Asset create batch failed, row not applied: deadlock detected",
    });
  });

  it("updates existing assets with grouped updateMany statements", async () => {
    mockImportTransaction();
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "asset-1", serialNumber: "SN-1", assetTag: "CAM-1", qrCodeValue: "bg://item/CAM-1", primaryScanCode: null },
      { id: "asset-2", serialNumber: "SN-2", assetTag: "CAM-2", qrCodeValue: "bg://item/CAM-2", primaryScanCode: null },
    ] as never);

    const res = await importAssets(
      importRequest("/api/assets/import?mode=import", importFormData(assetCsv(2))),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(body.updated).toBe(2);
    expect(db.asset.update).not.toHaveBeenCalled();
    expect(db.asset.updateMany).toHaveBeenCalledTimes(2);
    expect(vi.mocked(db.asset.updateMany).mock.calls[0]![0]!.where).toEqual({ id: { in: ["asset-1"] } });
  });
});
