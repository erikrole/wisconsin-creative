import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http";
import {
  claimKioskOperationReceiptTx,
  finishKioskOperationReceiptTx,
  kioskOperationContext,
  readKioskOperationReceipt,
  readKioskOperationReplay,
  rejectKioskOperation,
  unreadableKioskOperation,
} from "@/lib/services/kiosk-operation-receipts";

type Row = { beforeJson: unknown; afterJson: unknown };

/** In-memory stand-in for the audit_log rows the receipts live in. */
function fakeDb() {
  const rows = new Map<string, Row>();
  const auditLog = {
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    create: async ({ data }: { data: { id: string; beforeJson: unknown } }) => {
      if (rows.has(data.id)) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows.set(data.id, { beforeJson: data.beforeJson, afterJson: null });
    },
    update: async ({ where, data }: { where: { id: string }; data: { afterJson: unknown } }) => {
      const row = rows.get(where.id)!;
      row.afterJson = data.afterJson;
    },
  };
  const tx = { auditLog };
  const db = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { rows, tx: tx as never, db: db as never };
}

const requestId = (issuedAt = Date.now()) => `${issuedAt}:0f8fad5b-d9cb-469f-a165-70867728950e`;
const context = (payload: unknown, id = requestId()) =>
  kioskOperationContext({ requestId: id, kioskId: "kiosk-1", actorId: "u-1", operation: "checkout", payload })!;

describe("kiosk operation receipts", () => {
  it("treats requests from clients without a reference as unguarded", async () => {
    expect(kioskOperationContext({ kioskId: "k", actorId: "u", operation: "checkout", payload: {} })).toBeUndefined();
    const { db } = fakeDb();
    expect(await readKioskOperationReceipt(db, undefined)).toBeNull();
  });

  it("rejects a malformed reference", () => {
    expect(() => kioskOperationContext({ requestId: "nope", kioskId: "k", actorId: "u", operation: "checkout", payload: {} }))
      .toThrow(HttpError);
  });

  it("replays the committed result for the same reference and details", async () => {
    const { tx, db } = fakeDb();
    const ctx = context({ items: ["a"] });
    await claimKioskOperationReceiptTx(tx, ctx);
    await finishKioskOperationReceiptTx(tx, ctx, { bookingId: "co-1", itemCount: 1 });
    expect(await readKioskOperationReceipt(db, ctx)).toEqual({ bookingId: "co-1", itemCount: 1 });
  });

  it("refuses to claim a reference twice", async () => {
    const { tx } = fakeDb();
    const ctx = context({ items: ["a"] });
    await claimKioskOperationReceiptTx(tx, ctx);
    await finishKioskOperationReceiptTx(tx, ctx, { bookingId: "co-1" });
    await expect(claimKioskOperationReceiptTx(tx, ctx)).rejects.toThrow();
  });

  it("asks for a retry while a claimed receipt has no result yet", async () => {
    const { tx, db } = fakeDb();
    const ctx = context({ items: ["a"] });
    await claimKioskOperationReceiptTx(tx, ctx);
    await expect(readKioskOperationReplay(db, ctx)).rejects.toMatchObject({ status: 409 });
  });

  it("answers a reference reused for different details with a clearable rejection", async () => {
    const { tx, db } = fakeDb();
    const id = requestId();
    await claimKioskOperationReceiptTx(tx, context({ items: ["a"] }, id));
    const replay = await readKioskOperationReplay(db, context({ items: ["b"] }, id));
    expect(replay).toMatchObject({ success: false, operationRejected: true });
  });

  it("answers an expired reference with no receipt with a clearable rejection", async () => {
    const { db } = fakeDb();
    const ctx = context({ items: ["a"] }, requestId(Date.now() - 8 * 24 * 60 * 60 * 1000));
    await expect(readKioskOperationReceipt(db, ctx)).rejects.toMatchObject({ status: 409 });
    expect(await readKioskOperationReplay(db, ctx)).toMatchObject({ operationRejected: true });
  });

  it("still replays a committed result past the retry window", async () => {
    const { tx, db } = fakeDb();
    const ctx = context({ items: ["a"] }, requestId(Date.now() - 8 * 24 * 60 * 60 * 1000));
    await claimKioskOperationReceiptTx(tx, { ...ctx, issuedAt: Date.now() });
    await finishKioskOperationReceiptTx(tx, ctx, { bookingId: "co-1" });
    expect(await readKioskOperationReplay(db, ctx)).toEqual({ bookingId: "co-1" });
  });

  it("seals a definitive 4xx rejection so later retries replay it", async () => {
    const { db } = fakeDb();
    const ctx = context({ items: ["a"] });
    const sealed = await rejectKioskOperation(db, ctx, new HttpError(409, "One or more items are no longer available"));
    expect(sealed).toEqual({ success: false, operationRejected: true, error: "One or more items are no longer available" });
    expect(await readKioskOperationReceipt(db, ctx)).toEqual(sealed);
  });

  it("does not seal server failures, which may still be retried", async () => {
    const { db } = fakeDb();
    const ctx = context({ items: ["a"] });
    expect(await rejectKioskOperation(db, ctx, new HttpError(500, "boom"))).toBeNull();
    expect(await rejectKioskOperation(db, ctx, new Error("network"))).toBeNull();
    expect(await readKioskOperationReceipt(db, ctx)).toBeNull();
  });

  it("rejects an unreadable saved body only when it carries a retry reference", () => {
    expect(unreadableKioskOperation({ requestId: requestId(), items: "bad" })).toMatchObject({ operationRejected: true });
    expect(unreadableKioskOperation({ items: "bad" })).toBeNull();
    expect(unreadableKioskOperation(null)).toBeNull();
  });
});
