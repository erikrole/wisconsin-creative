import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    asset: { findFirst: vi.fn(), findMany: vi.fn() },
    bulkSku: { findFirst: vi.fn(), findMany: vi.fn() },
    auditLog: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  requireAuth: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: mocks.checkRateLimit,
}));

import { GET } from "@/app/api/items/changes/route";

const student = { id: "user-1", email: "s@example.com", name: "Student", role: Role.STUDENT };
const at = (minute: number) => new Date(`2026-10-25T15:${String(minute).padStart(2, "0")}:00.000Z`);

function cursorFor(date: Date) {
  return Buffer.from(JSON.stringify({ at: date.toISOString() })).toString("base64url");
}

function cursorDate(cursor: string) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).at as string;
}

async function poll(since?: string) {
  const url = new URL("https://app.example.com/api/items/changes");
  if (since !== undefined) url.searchParams.set("since", since);
  const response = await GET(new Request(url), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(student);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.db.asset.findFirst.mockResolvedValue({ updatedAt: at(10) });
  mocks.db.bulkSku.findFirst.mockResolvedValue({ updatedAt: at(30) });
  mocks.db.auditLog.findFirst.mockResolvedValue({ createdAt: at(20) });
  mocks.db.asset.findMany.mockResolvedValue([]);
  mocks.db.bulkSku.findMany.mockResolvedValue([]);
  mocks.db.auditLog.findMany.mockResolvedValue([]);
});

describe("GET /api/items/changes", () => {
  it("starts a client at the newest change without listing anything", async () => {
    const { body } = await poll();

    expect(body.data.changedAssetIds).toEqual([]);
    expect(body.data.changedBulkSkuIds).toEqual([]);
    expect(cursorDate(body.data.cursor)).toBe(at(30).toISOString());
    expect(mocks.db.asset.findMany).not.toHaveBeenCalled();
  });

  it("starts at the epoch for an empty catalog", async () => {
    mocks.db.asset.findFirst.mockResolvedValue(null);
    mocks.db.bulkSku.findFirst.mockResolvedValue(null);
    mocks.db.auditLog.findFirst.mockResolvedValue(null);

    const { body } = await poll();

    expect(cursorDate(body.data.cursor)).toBe(new Date(0).toISOString());
  });

  it("merges edited rows with audited ones and advances the cursor", async () => {
    mocks.db.asset.findMany.mockResolvedValue([{ id: "a1", updatedAt: at(11) }, { id: "a2", updatedAt: at(12) }]);
    mocks.db.bulkSku.findMany.mockResolvedValue([{ id: "f1", updatedAt: at(13) }]);
    mocks.db.auditLog.findMany.mockResolvedValue([
      { entityType: "asset", entityId: "a1", createdAt: at(14) },
      { entityType: "asset", entityId: "a3", createdAt: at(15) },
      { entityType: "bulk_sku", entityId: "f2", createdAt: at(16) },
    ]);

    const { body } = await poll(cursorFor(at(10)));

    expect(body.data.changedAssetIds).toEqual(["a1", "a2", "a3"]);
    expect(body.data.changedBulkSkuIds).toEqual(["f1", "f2"]);
    expect(cursorDate(body.data.cursor)).toBe(at(16).toISOString());
    expect(mocks.db.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { updatedAt: { gt: at(10) } }, take: 100 }));
    expect(mocks.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: { in: ["asset", "bulk_sku"] }, createdAt: { gt: at(10) } },
    }));
  });

  it("keeps the same cursor when nothing changed and accepts a plain timestamp", async () => {
    const { body } = await poll(at(10).toISOString());

    expect(body.data).toEqual({ cursor: cursorFor(at(10)), changedAssetIds: [], changedBulkSkuIds: [] });
  });

  it("rejects an unreadable cursor", async () => {
    const { response, body } = await poll("not-a-cursor");

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid item change cursor");
  });

  it("slows down a client polling too often", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });

    const { response } = await poll();

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("items:changes:user-1", { max: 180, windowMs: 60_000 });
    expect(mocks.db.asset.findFirst).not.toHaveBeenCalled();
  });
});
