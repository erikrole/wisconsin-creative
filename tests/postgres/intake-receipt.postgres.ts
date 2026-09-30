import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const value = process.env.WC_CUSTODY_TEST_DATABASE_URL;
  if (!value) throw new Error("Run scripts/test-custody-postgres.mjs; no external database is accepted");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== "localhost" || url.port !== "5432"
    || url.username !== "custody_test" || url.password || url.pathname !== "/custody_test"
    || [...url.searchParams.keys()].join() !== "host"
    || !/^\/(private\/)?tmp\/wc-custody-pg-[a-zA-Z0-9]+$/.test(url.searchParams.get("host") ?? "")) {
    throw new Error("Refusing a database outside the disposable custody-test cluster");
  }
  // Use Prisma's native PostgreSQL transport; no query/transaction is mocked.
  return { db: new PrismaClient({ datasources: { db: { url: `${value}&connection_limit=5` } } }) };
});
import { db } from "@/lib/db";
import { intakeTransaction } from "@/lib/intake-receipt";
const actor = { id: "receiver", role: "STAFF" as const };
function request() { return new Request("http://localhost/api/bulk-skus/stock/adjust", { headers: { "X-Intake-Request": crypto.randomUUID(), "X-Intake-Created-At": new Date().toISOString() } }); }
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "users", "locations" CASCADE');
  await db.user.create({ data: { id: actor.id, name: "Receiver", email: "receiver@example.test", passwordHash: "unused-fixture", role: "STAFF" } });
  await db.location.create({ data: { id: "studio", name: "Test studio" } });
  await db.bulkSku.create({ data: { id: "stock", name: "Tape", category: "Supplies", unit: "roll", locationId: "studio", binQrCodeValue: "TAPE", balances: { create: { locationId: "studio", onHandQuantity: 10 } } } });
});
afterAll(() => db.$disconnect());
const receive = (req: Request) => intakeTransaction(req, actor, "stock:adjust", { quantityDelta: 3 }, async tx => {
  const result = await tx.bulkStockBalance.update({ where: { bulkSkuId_locationId: { bulkSkuId: "stock", locationId: "studio" } }, data: { onHandQuantity: { increment: 3 } } });
  return { next: result.onHandQuantity };
});
it("concurrent identical receipts add stock once and replay the same committed result", async () => {
  const req = request();
  const results = await Promise.all([receive(req), receive(req)]);
  expect(results).toEqual([{ next: 13 }, { next: 13 }]);
  expect(await receive(req)).toEqual({ next: 13 });
  expect((await db.bulkStockBalance.findFirstOrThrow()).onHandQuantity).toBe(13);
  expect(await db.auditLog.count({ where: { entityType: "item_intake_request" } })).toBe(1);
});
it("rolls the stock change back when the durable receipt cannot commit", async () => {
  const req = request();
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reject_intake_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced receipt failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reject_intake_receipt BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.entity_type = 'item_intake_request') EXECUTE FUNCTION reject_intake_receipt()`);
  try {
    await expect(receive(req)).rejects.toThrow("forced receipt failure");
    expect((await db.bulkStockBalance.findFirstOrThrow()).onHandQuantity).toBe(10);
    expect(await db.auditLog.count()).toBe(0);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER reject_intake_receipt ON audit_logs'); }
  expect(await receive(req)).toEqual({ next: 13 });
});
