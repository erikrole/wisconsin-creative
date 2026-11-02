import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  db: { kit: { findUnique: vi.fn() }, auditLog: { findFirst: vi.fn(), findMany: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { GET } from "@/app/api/kits/[id]/activity/route";

const logs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `log-${i}`, action: "kit_updated" }));
const get = (query = "") => GET(jsonRequest(`/api/kits/kit-1/activity${query}`, "GET"), routeCtx({ id: "kit-1" }));

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
  mocks.db.kit.findUnique.mockResolvedValue({ id: "kit-1" });
  mocks.db.auditLog.findFirst.mockResolvedValue({ id: "log-49" });
  mocks.db.auditLog.findMany.mockResolvedValue(logs(3));
});

describe("GET /api/kits/[id]/activity", () => {
  it("lists the kit's audit rows newest first with the actor, 50 per page by default", async () => {
    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
    expect(mocks.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: "kit", entityId: "kit-1" },
      orderBy: { createdAt: "desc" },
      take: 51,
      include: { actor: { select: { name: true, email: true, avatarUrl: true } } },
    }));
    expect(mocks.db.auditLog.findMany.mock.calls[0]![0]).not.toHaveProperty("cursor");
  });

  it("hands back a cursor when a page is full and continues after it", async () => {
    mocks.db.auditLog.findMany.mockResolvedValue(logs(51));
    const first = await (await get()).json();

    expect(first.data).toHaveLength(50);
    expect(first.nextCursor).toBe("log-49");

    mocks.db.auditLog.findMany.mockResolvedValue(logs(2));
    const res = await get("?cursor=log-49&limit=10");

    expect(res.status).toBe(200);
    expect(mocks.db.auditLog.findFirst).toHaveBeenCalledWith({ where: { id: "log-49", entityType: "kit", entityId: "kit-1" }, select: { id: true } });
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 11, cursor: { id: "log-49" }, skip: 1 }));
  });

  it("clamps limit to 1..100 and ignores garbage", async () => {
    await get("?limit=500");
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 101 }));
    await get("?limit=0");
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 51 }));
    await get("?limit=abc");
    expect(mocks.db.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 51 }));
  });

  it("rejects a cursor that belongs to another entity", async () => {
    mocks.db.auditLog.findFirst.mockResolvedValue(null);

    const res = await get("?cursor=log-from-an-asset");

    expect(res.status).toBe(400);
    expect(mocks.db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("404s an unknown kit and refuses students", async () => {
    mocks.db.kit.findUnique.mockResolvedValue(null);
    expect((await get()).status).toBe(404);

    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    expect((await get()).status).toBe(403);
  });
});
