import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  checkRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = {
    wishItem: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    budget: { findUnique: vi.fn() },
    budgetLine: { create: vi.fn() },
  };
  return { db: { wishItem: { findMany: vi.fn() }, $transaction: vi.fn(), _mockTx: tx } };
});

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as listWishes, POST as createWish } from "@/app/api/wishlist/route";
import { DELETE as deleteWish, PATCH as patchWish } from "@/app/api/wishlist/[id]/route";
import { POST as promote } from "@/app/api/wishlist/[id]/promote/route";

type MockFn = ReturnType<typeof vi.fn>;
const tx = (db as unknown as { _mockTx: Record<string, Record<string, MockFn>> })._mockTx;
const ORIGIN = "https://app.example.com";
const staff = { id: "user-1", name: "Sam", email: "s@example.com", role: Role.STAFF, avatarUrl: null };
const admin = { ...staff, id: "admin-1", name: "Admin", role: Role.ADMIN };
const student = { ...staff, id: "student-1", role: Role.STUDENT };
const ctx = { params: Promise.resolve({ id: "wish-1" }) };

function json(method: string, path: string, body?: unknown) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "wish-1",
  title: "Atomos Ninja V+",
  linkUrl: "https://bhphotovideo.com/x",
  estimateCents: 79_900,
  quantity: 1,
  neededBy: null,
  reason: null,
  status: "OPEN",
  statusNote: null,
  requestedById: "user-1",
  budgetLineId: null,
  createdAt: new Date("2026-10-12T00:00:00Z"),
  requestedBy: { id: "user-1", name: "Sam" },
  budgetLine: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  (db.$transaction as unknown as MockFn).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
});

describe("wish list routes", () => {
  it("lets staff see every wish but keeps students out", async () => {
    (db.wishItem.findMany as unknown as MockFn).mockResolvedValue([row()]);
    (requireAuth as unknown as MockFn).mockResolvedValue(staff);
    const res = await listWishes(json("GET", "/api/wishlist"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    (requireAuth as unknown as MockFn).mockResolvedValue(student);
    expect((await listWishes(json("GET", "/api/wishlist"), { params: Promise.resolve({}) })).status).toBe(403);
  });

  it("records the requester when staff add a wish", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(staff);
    tx.wishItem!.create!.mockResolvedValue(row());
    const res = await createWish(json("POST", "/api/wishlist", { title: "Atomos Ninja V+" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(tx.wishItem!.create!.mock.calls[0]![0].data.requestedById).toBe("user-1");
  });

  it("stops staff from approving, or editing someone else's wish", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(staff);
    tx.wishItem!.findUnique!.mockResolvedValue(row());
    expect((await patchWish(json("PATCH", "/api/wishlist/wish-1", { status: "APPROVED" }), ctx)).status).toBe(403);
    tx.wishItem!.findUnique!.mockResolvedValue(row({ requestedById: "someone-else" }));
    expect((await patchWish(json("PATCH", "/api/wishlist/wish-1", { title: "New name" }), ctx)).status).toBe(403);
    expect((await deleteWish(json("DELETE", "/api/wishlist/wish-1"), ctx)).status).toBe(403);
  });

  it("lets an admin approve a wish", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    tx.wishItem!.findUnique!.mockResolvedValue(row());
    tx.wishItem!.update!.mockResolvedValue(row({ status: "APPROVED" }));
    expect((await patchWish(json("PATCH", "/api/wishlist/wish-1", { status: "APPROVED" }), ctx)).status).toBe(200);
  });

  it("moves a wish into the budget as a line and links it back, admin only", async () => {
    const body = { budgetId: "budget-1", category: "EQUIPMENT", unitCostCents: 79_900, quantity: 1, unplanned: true };
    (requireAuth as unknown as MockFn).mockResolvedValue(staff);
    expect((await promote(json("POST", "/api/wishlist/wish-1/promote", body), ctx)).status).toBe(403);

    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    tx.wishItem!.findUnique!.mockResolvedValue(row());
    tx.budget!.findUnique!.mockResolvedValue({ id: "budget-1" });
    tx.budgetLine!.create!.mockResolvedValue({ id: "line-9", budgetId: "budget-1" });
    tx.wishItem!.update!.mockResolvedValue(row({ status: "IN_BUDGET", budgetLineId: "line-9", budgetLine: { id: "line-9", budgetId: "budget-1" } }));
    const res = await promote(json("POST", "/api/wishlist/wish-1/promote", body), ctx);
    expect(res.status).toBe(201);
    const data = tx.budgetLine!.create!.mock.calls[0]![0].data;
    expect(data).toMatchObject({ description: "Atomos Ninja V+", supplier: "bhphotovideo.com", unplanned: true, requesterUserId: "user-1", status: "PLANNED" });
    expect(tx.wishItem!.update!.mock.calls[0]![0].data).toEqual({ status: "IN_BUDGET", budgetLineId: "line-9" });
  });

  it("refuses to move a declined or already-moved wish", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    const body = { budgetId: "budget-1", category: "EQUIPMENT", unitCostCents: 100, quantity: 1 };
    tx.wishItem!.findUnique!.mockResolvedValue(row({ status: "DECLINED" }));
    expect((await promote(json("POST", "/api/wishlist/wish-1/promote", body), ctx)).status).toBe(409);
    tx.wishItem!.findUnique!.mockResolvedValue(row({ status: "IN_BUDGET" }));
    expect((await promote(json("POST", "/api/wishlist/wish-1/promote", body), ctx)).status).toBe(409);
  });
});
