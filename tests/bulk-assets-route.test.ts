import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    asset: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    bookingSerializedItem: { count: vi.fn() },
    assetAllocation: { count: vi.fn() },
    scanEvent: { deleteMany: vi.fn() },
    checkinItemReport: { deleteMany: vi.fn() },
  };
  return {
    tx,
    db: {
      asset: { findMany: vi.fn(), updateMany: vi.fn() },
      location: { findUnique: vi.fn() },
      category: { findUnique: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    requireAuth: vi.fn(),
    audit: vi.fn(),
    auditTx: vi.fn(),
    addKitMembers: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntries: mocks.audit, createAuditEntriesTx: mocks.auditTx }));
vi.mock("@/lib/services/kits", () => ({ addKitMembers: mocks.addKitMembers }));
vi.mock("@/lib/services/companion-projection-publisher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/companion-projection-publisher")>()),
  deferCompanionProjectionRefresh: vi.fn(),
}));

import { POST } from "@/app/api/assets/bulk/route";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const admin = { ...staff, id: "admin-1", role: Role.ADMIN };
const ids = ["casset00001", "casset00002", "casset00003"];
const cage = "clocation001";
const lenses = "ccategory001";
const kit = "ckit0000001";

const assets = [
  { id: ids[0], status: "AVAILABLE", locationId: cage, categoryId: lenses },
  { id: ids[1], status: "RETIRED", locationId: "clocation002", categoryId: null },
  { id: ids[2], status: "MAINTENANCE", locationId: "clocation002", categoryId: lenses },
];

async function bulk(body: Record<string, unknown>) {
  const response = await POST(new Request("https://app.example.com/api/assets/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify({ ids, ...body }),
  }), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

function audited() {
  return (mocks.audit.mock.calls[0]?.[0] ?? []) as Array<{ entityId: string; action: string; before: unknown; after: unknown }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.db.asset.findMany.mockResolvedValue(assets);
  mocks.db.asset.updateMany.mockResolvedValue({ count: 3 });
  mocks.db.location.findUnique.mockResolvedValue({ id: cage });
  mocks.db.category.findUnique.mockResolvedValue({ id: lenses });
  mocks.tx.asset.findMany.mockResolvedValue(assets.map(({ id, status }) => ({ id, status })));
  mocks.tx.asset.updateMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length }));
  mocks.tx.asset.deleteMany.mockResolvedValue({ count: 3 });
  mocks.tx.bookingSerializedItem.count.mockResolvedValue(0);
  mocks.tx.assetAllocation.count.mockResolvedValue(0);
  mocks.addKitMembers.mockResolvedValue({ addedAssetIds: [ids[0], ids[2]] });
});

describe("POST /api/assets/bulk", () => {
  it("moves items and audits only the ones that changed place", async () => {
    const { body } = await bulk({ action: "move_location", locationId: cage });

    expect(body).toEqual({ updated: 3 });
    expect(mocks.db.asset.updateMany).toHaveBeenCalledWith({ where: { id: { in: ids } }, data: { locationId: cage } });
    expect(audited().map((entry) => [entry.entityId, entry.action, entry.before])).toEqual([
      [ids[1], "bulk_move_location", { locationId: "clocation002" }],
      [ids[2], "bulk_move_location", { locationId: "clocation002" }],
    ]);
  });

  it("clears a category and audits the items that had one", async () => {
    await bulk({ action: "change_category", categoryId: null });

    expect(mocks.db.category.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.asset.updateMany).toHaveBeenCalledWith({ where: { id: { in: ids } }, data: { categoryId: null } });
    expect(audited().map((entry) => entry.entityId)).toEqual([ids[0], ids[2]]);
  });

  it("retires and unretires only the items that need it", async () => {
    await bulk({ action: "retire" });
    expect(mocks.db.asset.updateMany).toHaveBeenLastCalledWith({ where: { id: { in: ids }, status: { not: "RETIRED" } }, data: { status: "RETIRED" } });
    expect(audited().map((entry) => [entry.entityId, entry.before])).toEqual([
      [ids[0], { status: "AVAILABLE" }],
      [ids[2], { status: "MAINTENANCE" }],
    ]);

    mocks.audit.mockClear();
    await bulk({ action: "unretire" });
    expect(mocks.db.asset.updateMany).toHaveBeenLastCalledWith({ where: { id: { in: ids }, status: "RETIRED" }, data: { status: "AVAILABLE" } });
    expect(audited()).toEqual([expect.objectContaining({ entityId: ids[1], action: "bulk_unretired", after: { status: "AVAILABLE" } })]);
  });

  it("toggles maintenance per item inside one transaction", async () => {
    const { body } = await bulk({ action: "maintenance" });

    expect(body).toEqual({ updated: 3 });
    expect(mocks.tx.asset.updateMany).toHaveBeenCalledWith({ where: { id: { in: [ids[0], ids[1]] } }, data: { status: "MAINTENANCE" } });
    expect(mocks.tx.asset.updateMany).toHaveBeenCalledWith({ where: { id: { in: [ids[2]] } }, data: { status: "AVAILABLE" } });
    const entries = mocks.auditTx.mock.calls[0]?.[1] as Array<{ entityId: string; action: string }>;
    expect(entries.map((entry) => [entry.entityId, entry.action])).toEqual([
      [ids[0], "bulk_marked_maintenance"],
      [ids[1], "bulk_marked_maintenance"],
      [ids[2], "bulk_cleared_maintenance"],
    ]);
  });

  it("skips the empty half of a maintenance toggle", async () => {
    mocks.tx.asset.findMany.mockResolvedValue([{ id: ids[0], status: "AVAILABLE" }]);

    const { body } = await bulk({ action: "maintenance" });

    expect(body).toEqual({ updated: 1 });
    expect(mocks.tx.asset.updateMany).toHaveBeenCalledTimes(1);
  });

  it("lets admins delete items with no history, clearing their scans first", async () => {
    mocks.requireAuth.mockResolvedValue(admin);

    const { body } = await bulk({ action: "delete" });

    expect(body).toEqual({ updated: 3 });
    expect(mocks.tx.scanEvent.deleteMany).toHaveBeenCalledWith({ where: { assetId: { in: ids } } });
    expect(mocks.tx.checkinItemReport.deleteMany).toHaveBeenCalledWith({ where: { assetId: { in: ids } } });
    expect(audited()).toHaveLength(3);
    expect(audited()[0]).toEqual(expect.objectContaining({ action: "bulk_deleted", after: { deleted: true } }));
  });

  it.each([
    ["booking history", () => mocks.tx.bookingSerializedItem.count.mockResolvedValue(2)],
    ["an active allocation", () => mocks.tx.assetAllocation.count.mockResolvedValue(1)],
  ])("refuses to delete items with %s", async (_label, arrange) => {
    mocks.requireAuth.mockResolvedValue(admin);
    arrange();

    const { response, body } = await bulk({ action: "delete" });

    expect(response.status).toBe(409);
    expect(body.error).toBe("Cannot delete: selected item(s) have booking history. Use Retire instead.");
    expect(mocks.tx.asset.deleteMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("adds items to a kit and counts the new members", async () => {
    const { body } = await bulk({ action: "add_to_kit", kitId: kit });

    expect(mocks.addKitMembers).toHaveBeenCalledWith(kit, ids, staff.id, staff.role, { allowAlreadyMembers: true });
    expect(body).toEqual({ updated: 2 });
  });

  it.each([
    ["a move without a location", { action: "move_location" }, 400, "locationId required for move_location"],
    ["a category change without a category", { action: "change_category" }, 400, "categoryId required for change_category"],
    ["a kit add without a kit", { action: "add_to_kit" }, 400, "kitId required for add_to_kit"],
  ])("rejects %s", async (_label, body, status, message) => {
    const result = await bulk(body);

    expect(result.response.status).toBe(status);
    expect(result.body.error).toBe(message);
    expect(mocks.db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("reports a missing location, category or item set", async () => {
    mocks.db.location.findUnique.mockResolvedValueOnce(null);
    expect((await bulk({ action: "move_location", locationId: cage })).body.error).toBe("Location not found");

    mocks.db.category.findUnique.mockResolvedValueOnce(null);
    expect((await bulk({ action: "change_category", categoryId: lenses })).body.error).toBe("Category not found");

    mocks.db.asset.findMany.mockResolvedValueOnce([]);
    const empty = await bulk({ action: "retire" });
    expect(empty.response.status).toBe(404);
    expect(mocks.db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("keeps students out and leaves deletes to admins", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });
    expect((await bulk({ action: "retire" })).response.status).toBe(403);

    mocks.requireAuth.mockResolvedValue(staff);
    expect((await bulk({ action: "delete" })).response.status).toBe(403);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
