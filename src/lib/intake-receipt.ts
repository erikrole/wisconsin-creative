import { createHash } from "node:crypto";
import { Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Seven-day requests expire well before the audit log's 90-day retention. */
export async function intakeTransaction<T>(req: Request, actor: { id: string; role: Role }, operation: string, body: unknown, mutate: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const key = req.headers.get("X-Intake-Request");
  if (!key) return db.$transaction(mutate, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const issuedAt = req.headers.get("X-Intake-Created-At") ?? "";
  const age = Date.now() - Date.parse(issuedAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) || !Number.isFinite(age) || age < -60_000 || age > MAX_AGE_MS) {
    throw new HttpError(409, "This receiving request has expired. Review the item before starting a new receipt.");
  }
  const id = `intake_${createHash("sha256").update(`${actor.id}:${key}`).digest("hex")}`;
  const fingerprint = createHash("sha256").update(canonical({ operation, body, issuedAt })).digest("hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const previous = await tx.auditLog.findUnique({ where: { id } });
        if (previous) {
          const receipt = previous.afterJson as { fingerprint?: string; result?: T } | null;
          if (receipt?.fingerprint !== fingerprint) throw new HttpError(409, "This receiving request was already used for different details. Review the original receipt.");
          return receipt.result as T;
        }
        const result = await mutate(tx);
        await tx.auditLog.create({ data: {
          id, actorUserId: actor.id, entityType: "item_intake_request", entityId: operation, action: "received",
          afterJson: JSON.parse(JSON.stringify({ fingerprint, body, result, issuedAt, _actorRole: actor.role })) as Prisma.InputJsonValue,
        } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) continue;
      throw error;
    }
  }
  throw new HttpError(409, "Receiving is busy. Retry this same request.");
}
