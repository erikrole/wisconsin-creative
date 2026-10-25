import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    location: { findMany: vi.fn(), upsert: vi.fn() },
    department: { findMany: vi.fn(), upsert: vi.fn() },
    asset: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    bulkSku: { upsert: vi.fn() },
    bulkStockBalance: { upsert: vi.fn() },
    kit: { upsert: vi.fn() },
    kitMembership: { createMany: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { POST as importAssets } from "@/app/api/assets/import/route";

const staff = { id: "staff-1", email: "s@example.com", name: "Staff", role: Role.STAFF, avatarUrl: null };

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function post(csv: string, query = "mode=import", mapping?: Record<string, string>): Promise<{ status: number; body: Body }> {
  const form = new FormData();
  form.set("file", new File([csv], "items.csv", { type: "text/csv" }));
  if (mapping) form.set("mapping", JSON.stringify(mapping));
  const res = await importAssets(
    new Request(`https://app.example.com/api/assets/import?${query}`, {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com" },
      body: form,
    }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: await res.json() };
}

function createdRows() {
  return vi.mocked(db.asset.createMany).mock.calls.flatMap(([args]) => args!.data as Array<Record<string, unknown>>);
}

const ids: Record<string, string> = { Shop: "loc-shop", "Camp Randall": "loc-cr", Video: "dept-video" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staff);
  vi.mocked(db.$transaction).mockImplementation(((arg: unknown) =>
    typeof arg === "function" ? Promise.resolve((arg as (tx: typeof db) => unknown)(db)) : Promise.all(arg as unknown[])) as never);
  vi.mocked(db.location.upsert).mockImplementation((async ({ where }: { where: { name: string } }) => ({ id: ids[where.name] ?? `loc-${where.name}` })) as never);
  vi.mocked(db.department.upsert).mockImplementation((async ({ where }: { where: { name: string } }) => ({ id: ids[where.name] ?? `dept-${where.name}` })) as never);
  vi.mocked(db.location.findMany).mockResolvedValue([{ id: "loc-shop", name: "Shop" }] as never);
  vi.mocked(db.department.findMany).mockResolvedValue([] as never);
  vi.mocked(db.asset.findMany).mockResolvedValue([] as never);
  vi.mocked(db.asset.createMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.asset.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.bulkSku.upsert).mockImplementation((async ({ create }: { create: { binQrCodeValue: string } }) => ({ id: `sku:${create.binQrCodeValue}` })) as never);
  vi.mocked(db.kit.upsert).mockImplementation((async ({ create }: { create: { name: string } }) => ({ id: `kit:${create.name}` })) as never);
  vi.mocked(db.kitMembership.createMany).mockResolvedValue({ count: 0 } as never);
});

describe("asset import preview", () => {
  it("reads a Cheqroom export, renames duplicate names, and flags rows without a location", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([{ id: "a1", serialNumber: "SN-1", assetTag: "SLOW1" }] as never);
    const csv = [
      "Name,Location,Serial number,Kind,Retired,Department,Kit,Mystery",
      "SLOW1,Shop,SN-1,,no,Video,Kit A,",
      "ROAM2,Camp Randall,SN-2,,yes,,,keep me",
      "ROAM2,Camp Randall,SN-3,,,,,",
      "SD,Shop,,bulk,,,,",
      "LOST,,SN-9,,,,,",
    ].join("\r\n");

    const { status, body } = await post(csv, "mode=preview");

    expect(status).toBe(200);
    expect(body.mapping).toMatchObject({ Name: "assetTag", Location: "locationName", Kind: "kind", Kit: "kitName" });
    expect(body.rows.map((row: Body) => [row.assetTag, row.action])).toEqual([
      ["SLOW1", "update"],
      ["ROAM2", "create"],
      ["ROAM2-1", "create"],
      ["SD", "create"],
      ["LOST", "skip"],
    ]);
    expect(body.rows[2].warnings).toEqual(['Duplicate name "ROAM2" → renamed to "ROAM2-1"']);
    expect(body.rows[4].errors).toEqual(["Missing location"]);
    expect(body.rows[1].sourcePayload).toEqual({ Mystery: "keep me" });
    expect(body.rows[3].serialNumber).toBe("auto-SD");
    expect(body.summary).toMatchObject({
      totalItems: 5, willCreate: 3, willUpdate: 1, withErrors: 1, withWarnings: 1, duplicateNames: 1,
      consumableItems: 1, retiredItems: 1, locations: ["Shop", "Camp Randall"], newLocations: ["Camp Randall"],
      departments: ["Video"], newDepartments: ["Video"], kits: ["Kit A"],
    });
    expect(db.asset.createMany).not.toHaveBeenCalled();
  });

  it("handles semicolons and quoted cells with commas and quotes", async () => {
    const { body } = await post('Name;Location;Description\n"FX3, body";Shop;"The ""A"" camera"\n', "mode=preview");

    expect(body.rows[0]).toMatchObject({ assetTag: "FX3, body", description: 'The "A" camera' });
  });

  it("needs a header and a data row, and keeps imports to staff", async () => {
    expect((await post("Name,Location\n", "mode=preview")).body.error).toBe("CSV must include a header and at least one data row");
    expect((await post("Name,Location\nA,Shop\n", "mode=import&importMode=merge")).status).toBe(400);

    vi.mocked(requireAuth).mockResolvedValue({ ...staff, role: Role.STUDENT });
    expect((await post("Name,Location\nA,Shop\n")).status).toBe(403);
  });
});

describe("asset import writes", () => {
  it("stores dates as calendar days, prices as numbers, and source details in notes", async () => {
    const csv = [
      "Name,Location,Serial number,Purchase Date,Purchase Price,Warranty Date,Residual Value,Description,Owner,Link,Codes,Image Url",
      'FX3,Shop,SN-1,2026-05-14,"$3,998.00",2027-05-14 00:00:00,abc,Body only,Erik,https://bh.com/fx3,QR-77,https://img.example.com/fx3.jpg',
      "RS4,Shop,,not a date,,,,,,,,https://x.public.blob.vercel-storage.com/rs4.jpg",
    ].join("\n");

    const { body } = await post(csv);

    const [fx3, rs4] = createdRows();
    expect(fx3).toMatchObject({
      purchaseDate: new Date("2026-05-14T00:00:00.000Z"),
      warrantyDate: new Date("2027-05-14T00:00:00.000Z"),
      purchasePrice: 3998,
      residualValue: undefined,
      qrCodeValue: "QR-77",
      primaryScanCode: "QR-77",
      linkUrl: "https://bh.com/fx3",
      status: "AVAILABLE",
      locationId: "loc-shop",
      departmentId: null,
    });
    expect(JSON.parse(fx3!.notes as string)).toEqual({ cheqroomName: "FX3", description: "Body only", owner: "Erik", link: "https://bh.com/fx3" });
    expect(fx3!.sourcePayload).toEqual({ cheqroomCodes: "QR-77", cheqroomImageUrl: "https://img.example.com/fx3.jpg" });
    expect(rs4).toMatchObject({ purchaseDate: null, qrCodeValue: "bg://item/RS4", serialNumber: "auto-RS4", primaryScanCode: null });
    // Only images not yet on Blob wait for the rehost cron.
    expect(body.imagesQueued).toBe(1);
  });

  it("skips existing items in create-only mode and refuses tracking codes owned by another item", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "a1", serialNumber: "SN-1", assetTag: "SLOW1", qrCodeValue: "bg://item/SLOW1", primaryScanCode: null },
      { id: "a2", serialNumber: "SN-2", assetTag: "ROAM2", qrCodeValue: "QR-SHARED", primaryScanCode: null },
    ] as never);
    const csv = "Name,Location,Serial number,Codes\nSLOW1,Shop,SN-1,QR-SHARED\nNEW1,Shop,SN-5,\n";

    const upsert = await post(csv);
    expect(upsert.body.errors).toEqual([{ line: 2, assetTag: "SLOW1", error: "Tracking code already belongs to another asset" }]);
    expect(db.asset.updateMany).not.toHaveBeenCalled();

    vi.mocked(db.asset.createMany).mockClear();
    const createOnly = await post(csv, "mode=import&importMode=create_only");
    expect(createOnly.body).toMatchObject({ errors: [] });
    expect(createdRows().map((row) => row.serialNumber)).toEqual(["SN-5"]);
  });

  it("keeps a saved photo when the sheet has none, and refuses repeated tracking codes in one file", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "a1", serialNumber: "SN-1", assetTag: "SLOW1", qrCodeValue: "bg://item/SLOW1", primaryScanCode: null },
    ] as never);
    const csv = "Name,Location,Serial number,Codes\nSLOW1,Shop,SN-1,\nA,Shop,SN-7,QR-9\nB,Shop,SN-8,QR-9\n";

    const { body } = await post(csv);

    expect(vi.mocked(db.asset.updateMany).mock.calls[0]![0]!.data).not.toHaveProperty("imageUrl");
    expect(vi.mocked(db.asset.updateMany).mock.calls[0]![0]!.data).not.toHaveProperty("serialNumber");
    expect(body.errors).toEqual([{ line: 4, assetTag: "B", error: "Duplicate tracking code in import file: QR-9" }]);
    expect(body).toMatchObject({ created: 1, updated: 1 });
  });

  it("files bulk rows as bulk stock and adds to what is on hand", async () => {
    const { body } = await post("Name,Location,Kind,Quantity,Codes\nSD cards,Shop,bulk,12,BIN-SD\nAA,Shop,bulk,x,\n");

    expect(body.bulkCreated).toBe(2);
    expect(db.asset.createMany).not.toHaveBeenCalled();
    expect(vi.mocked(db.bulkSku.upsert).mock.calls[0]![0]).toMatchObject({
      where: { locationId_binQrCodeValue: { locationId: "loc-shop", binQrCodeValue: "BIN-SD" } },
      create: { name: "SD cards", unit: "each" },
    });
    expect(vi.mocked(db.bulkStockBalance.upsert).mock.calls.map(([args]) => args!.update)).toEqual([
      { onHandQuantity: { increment: 12 } },
      { onHandQuantity: { increment: 1 } },
    ]);
    expect(vi.mocked(db.bulkSku.upsert).mock.calls[1]![0]!.create).toMatchObject({ binQrCodeValue: "bg://bulk/AA" });
  });

  it("creates kits once and adds their members, then audits the totals", async () => {
    vi.mocked(db.asset.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "a1", serialNumber: "SN-1" }, { id: "a2", serialNumber: "SN-2" }] as never);

    const { body } = await post("Name,Location,Serial number,Kit,Department\nFX3,Shop,SN-1,Kit A,Video\nLENS,Shop,SN-2,Kit A,Video\nTRI,Shop,SN-3,,\n");

    expect(body.kitsCreated).toBe(1);
    expect(db.kit.upsert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.kitMembership.createMany).mock.calls[0]![0]).toEqual({
      data: [{ kitId: "kit:Kit A", assetId: "a1" }, { kitId: "kit:Kit A", assetId: "a2" }],
      skipDuplicates: true,
    });
    expect(createdRows()[0]).toMatchObject({ departmentId: "dept-video" });
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "csv_import",
      after: { created: 3, updated: 0, bulkCreated: 0, skipped: 0, kitsCreated: 1, imagesQueued: 0, errorCount: 0 },
    }));
  });

  it("reports rows without a location as skipped errors", async () => {
    const { body } = await post("Name,Location\nA,Shop\nB,\n");

    expect(body).toMatchObject({ created: 1, skipped: 1, errors: [{ line: 3, assetTag: "B", error: "Missing location" }] });
  });
});
