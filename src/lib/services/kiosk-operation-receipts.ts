import { createHash } from "node:crypto";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "@/lib/http";

export type KioskOperationContext = {
  id: string;
  actorId: string;
  fingerprint: string;
  issuedAt: number;
};
const retryLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function kioskOperationContext(args: {
  requestId?: string; kioskId: string; actorId: string; operation: string;
  sourceId?: string; payload: unknown;
}): KioskOperationContext | undefined {
  if (!args.requestId) return undefined; // Older installed clients.
  const issuedAt = Number(args.requestId.split(":")[0]);
  if (!/^\d{13}:[0-9a-f-]{36}$/i.test(args.requestId) || !Number.isSafeInteger(issuedAt)) {
    throw new HttpError(400, "Invalid operation reference");
  }
  return {
    id: `kiosk-operation:${createHash("sha256").update(`${args.kioskId}:${args.requestId}`).digest("hex")}`,
    actorId: args.actorId, issuedAt,
    fingerprint: createHash("sha256").update(canonical({ ...args, requestId: undefined })).digest("hex"),
  };
}

export async function readKioskOperationReceipt(tx: Prisma.TransactionClient | PrismaClient, context?: KioskOperationContext) {
  if (!context) return null;
  const row = await tx.auditLog.findUnique({ where: { id: context.id }, select: { beforeJson: true, afterJson: true } });
  if (row) {
    const before = row.beforeJson as { fingerprint?: string } | null;
    if (before?.fingerprint !== context.fingerprint) throw new HttpError(409, "This operation reference belongs to different details. Resolve the original operation before making changes.");
    if (row.afterJson && typeof row.afterJson === "object" && !Array.isArray(row.afterJson)) return row.afterJson;
    throw new HttpError(409, "This handoff is still being recorded. Retry with the same details.");
  }
  // Audit retention is 90 days. An expired missing receipt must never create a
  // second handoff after archival. A retained committed result can still replay.
  const age = Date.now() - context.issuedAt;
  if (age > retryLifetimeMs || age < -5 * 60 * 1000) throw new HttpError(409, "This handoff reference has expired. Check the checkout list before starting again.");
  return null;
}

class KioskOperationReplay extends Error {}

export async function claimKioskOperationReceiptTx(tx: Prisma.TransactionClient, context?: KioskOperationContext) {
  if (!context) return;
  if (await readKioskOperationReceipt(tx, context)) throw new KioskOperationReplay();
  // The unique row is claimed in the same transaction as custody. Concurrent
  // callers lose this insert or serialization and replay after rollback.
  await tx.auditLog.create({ data: {
    id: context.id, actorUserId: context.actorId, entityType: "kiosk_operation",
    entityId: context.id, action: "kiosk_operation_receipt",
    beforeJson: { fingerprint: context.fingerprint },
  } });
}

export async function finishKioskOperationReceiptTx(tx: Prisma.TransactionClient, context: KioskOperationContext | undefined, response: Record<string, unknown>) {
  if (!context) return;
  await tx.auditLog.update({ where: { id: context.id }, data: {
    afterJson: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonObject,
  } });
}

/** Seal a definitive rejection in a fresh transaction. This contends on the
 * same unique key as an in-flight submit, so the client can safely clear its
 * pending payload without a late original creating custody afterward. */
export async function rejectKioskOperation(db: PrismaClient, context: KioskOperationContext | undefined, error: unknown) {
  if (!context || !(error instanceof HttpError) || error.status >= 500) return null;
  try {
    return await db.$transaction(async (tx) => {
      const replay = await readKioskOperationReceipt(tx, context);
      if (replay) return replay;
      await claimKioskOperationReceiptTx(tx, context);
      const response = { success: false, operationRejected: true, error: error.message };
      await finishKioskOperationReceiptTx(tx, context, response);
      return response;
    }, { isolationLevel: "Serializable" });
  } catch {
    return readKioskOperationReceipt(db, context);
  }
}
