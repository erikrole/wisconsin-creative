import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  db: {
    asset: { findMany: vi.fn() },
    favoriteItem: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntries: mocks.audit }));
vi.mock("@/lib/services/companion-projection-publisher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/companion-projection-publisher")>()),
  deferCompanionProjectionRefresh: vi.fn(),
}));

import { POST } from "@/app/api/assets/favorites/bulk/route";

const student = { id: "ada", email: "ada@example.com", name: "Ada", role: Role.STUDENT };
const [a, b, c] = ["cmasset000000000000000001", "cmasset000000000000000002", "cmasset000000000000000003"];

function send(body: unknown) {
  return POST(new Request("https://app.example.com/api/assets/favorites/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(student);
  mocks.db.asset.findMany.mockResolvedValue([{ id: a }, { id: b }]);
  mocks.db.favoriteItem.findMany.mockResolvedValue([{ assetId: b }]);
});

describe("POST /api/assets/favorites/bulk", () => {
  it("stars only items that exist and aren't starred yet, and audits each one", async () => {
    const response = await send({ assetIds: [a, b, c], action: "add" });

    expect(await response.json()).toEqual({ data: { count: 1, action: "add" } });
    expect(mocks.db.favoriteItem.createMany).toHaveBeenCalledWith({ data: [{ userId: "ada", assetId: a }], skipDuplicates: true });
    expect(mocks.audit).toHaveBeenCalledWith([expect.objectContaining({ entityId: a, action: "favorite_added", actorId: "ada" })]);
  });

  it("writes nothing when every item is already starred", async () => {
    mocks.db.favoriteItem.findMany.mockResolvedValue([{ assetId: a }, { assetId: b }]);

    expect(await (await send({ assetIds: [a, b], action: "add" })).json()).toEqual({ data: { count: 0, action: "add" } });
    expect(mocks.db.favoriteItem.createMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("unstars only items that were starred, and audits each one", async () => {
    const response = await send({ assetIds: [a, b], action: "remove" });

    expect(await response.json()).toEqual({ data: { count: 1, action: "remove" } });
    expect(mocks.db.favoriteItem.deleteMany).toHaveBeenCalledWith({ where: { userId: "ada", assetId: { in: [b] } } });
    expect(mocks.audit).toHaveBeenCalledWith([expect.objectContaining({ entityId: b, action: "favorite_removed" })]);
  });

  it("writes nothing when none of the items were starred", async () => {
    mocks.db.favoriteItem.findMany.mockResolvedValue([]);

    expect(await (await send({ assetIds: [a], action: "remove" })).json()).toEqual({ data: { count: 0, action: "remove" } });
    expect(mocks.db.favoriteItem.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ["no items", { assetIds: [], action: "add" }],
    ["a bad id", { assetIds: ["nope"], action: "add" }],
    ["an unknown action", { assetIds: [a], action: "toggle" }],
  ])("rejects %s", async (_label, body) => {
    expect((await send(body)).status).toBe(400);
    expect(mocks.db.asset.findMany).not.toHaveBeenCalled();
  });
});
