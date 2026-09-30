import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const state = vi.hoisted(() => ({ receipts: new Map<string, unknown>(), stock: 10 }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
  const original = state.stock; const originalReceipts = new Map(state.receipts);
  try { return await run({ auditLog: {
    findUnique: async ({ where }: { where: { id: string } }) => state.receipts.get(where.id) ?? null,
    create: async ({ data }: { data: { id: string } }) => { state.receipts.set(data.id, data); return data; },
  } }); } catch (error) { state.stock = original; state.receipts = originalReceipts; throw error; }
} ) } }));
import { intakeTransaction } from "@/lib/intake-receipt";
const actor = { id: "staff-a", role: Role.STAFF };
const key = "f7a5f070-3d68-4595-a46b-adcbe1f8a7f1";
function request(issuedAt = new Date().toISOString()) { return new Request("https://app.test/api/bulk-skus/family/adjust", { headers: { "X-Intake-Request": key, "X-Intake-Created-At": issuedAt } }); }
beforeEach(() => { state.receipts = new Map(); state.stock = 10; });
describe("durable receiving receipts", () => {
  it("recovers a lost successful response without adding stock twice", async () => {
    const req = request(); const receive = vi.fn(async () => ({ next: state.stock += 3 }));
    await intakeTransaction(req, actor, "family:adjust", { quantityDelta: 3 }, receive);
    const replay = await intakeTransaction(req, actor, "family:adjust", { quantityDelta: 3 }, receive);
    expect(replay).toEqual({ next: 13 }); expect(state.stock).toBe(13); expect(receive).toHaveBeenCalledOnce();
  });
  it("rejects reuse for another quantity or operation and isolates different actors", async () => {
    const req = request();const receive = async () => ({ next: state.stock += 3 });
    await intakeTransaction(req, actor, "family:adjust", { quantityDelta: 3 }, receive);
    await expect(intakeTransaction(req, actor, "family:adjust", { quantityDelta: 4 }, receive)).rejects.toMatchObject({ status: 409 });
    await expect(intakeTransaction(req, actor, "other:adjust", { quantityDelta: 3 }, receive)).rejects.toMatchObject({ status: 409 });
    await intakeTransaction(req, { ...actor, id: "staff-b" }, "family:adjust", { quantityDelta: 3 }, receive);
    expect(state.stock).toBe(16);
  });
  it("leaves a failed transaction retryable, and rejects requests older than retention safety", async () => {
    const req = request();await expect(intakeTransaction(req, actor, "family:units", { count: 2 }, async () => { state.stock += 2; throw Error("rollback"); })).rejects.toThrow("rollback");
    expect(state.stock).toBe(10);expect(state.receipts.size).toBe(0);
    await intakeTransaction(req, actor, "family:units", { count: 2 }, async () => ({ next: state.stock += 2 }));expect(state.stock).toBe(12);
    await expect(intakeTransaction(request(new Date(Date.now() - 8 * 86400_000).toISOString()), actor, "family:units", { count: 2 }, async () => { throw Error("must not run"); })).rejects.toMatchObject({ status: 409 });
  });
});
