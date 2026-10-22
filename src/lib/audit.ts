import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";

export { AUDIT_RETENTION_DAYS } from "@/lib/audit-retention";

type AuditEntry = {
  actorId: string;
  actorRole: Role;
  entityType: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

type AuditEntryTx = {
  actorId: string | null;
  actorRole: Role | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

function buildAfterJson(
  after: Record<string, unknown> | undefined,
  actorRole: Role | null,
): Prisma.InputJsonValue {
  return {
    ...(after ?? {}),
    _actorRole: actorRole,
  } as Prisma.InputJsonValue;
}

/**
 * Create an audit log entry with actor role always included.
 * Per AREA_USERS.md § Authorization Guardrails #4:
 * "Audit logs must include actor role and actor id for all edits."
 */
export async function createAuditEntry(entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before
        ? (entry.before as Prisma.InputJsonValue)
        : undefined,
      afterJson: buildAfterJson(entry.after, entry.actorRole),
    },
  });
}

/**
 * System / pre-auth audit write — no human actor (e.g. kiosk activation).
 * Records `_actorRole: null` consistently so readers don't have to special-case
 * missing values.
 */
export async function createSystemAuditEntry(entry: {
  entityType: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}) {
  await db.auditLog.create({
    data: {
      actorUserId: null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before
        ? (entry.before as Prisma.InputJsonValue)
        : undefined,
      afterJson: buildAfterJson(entry.after, null),
    },
  });
}

/**
 * Batch create audit log entries in a single INSERT.
 * Use this instead of calling createAuditEntry in a loop.
 */
export async function createAuditEntries(entries: AuditEntry[]) {
  if (entries.length === 0) return;
  await db.auditLog.createMany({
    data: entries.map((entry) => ({
      actorUserId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before
        ? (entry.before as Prisma.InputJsonValue)
        : undefined,
      afterJson: buildAfterJson(entry.after, entry.actorRole),
    })),
  });
}

/**
 * Transaction-aware audit write. Use inside `db.$transaction((tx) => ...)`
 * blocks so the audit row is rolled back with the rest of the work.
 *
 * Accepts a nullable `actorRole` so kiosk-style actions (no human actor) can
 * still record `_actorRole: null` consistently.
 */
export async function createAuditEntryTx(
  tx: Prisma.TransactionClient,
  entry: AuditEntryTx,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actorId ?? undefined,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before
        ? (entry.before as Prisma.InputJsonValue)
        : undefined,
      afterJson: buildAfterJson(entry.after, entry.actorRole),
    },
  });
}

/** Batch variant of createAuditEntryTx — collapses N inserts into one. */
export async function createAuditEntriesTx(
  tx: Prisma.TransactionClient,
  entries: AuditEntryTx[],
) {
  if (entries.length === 0) return;
  await tx.auditLog.createMany({
    data: entries.map((entry) => ({
      actorUserId: entry.actorId ?? undefined,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before
        ? (entry.before as Prisma.InputJsonValue)
        : undefined,
      afterJson: buildAfterJson(entry.after, entry.actorRole),
    })),
  });
}

/**
 * Resolve an actor's role inside a transaction so callers don't have to
 * thread `Role` through every signature. Cached one lookup per transaction
 * by callers (call once at the top, reuse in every audit write below).
 */
export async function lookupActorRole(
  tx: Prisma.TransactionClient,
  actorUserId: string | null | undefined,
): Promise<Role | null> {
  if (!actorUserId) return null;
  const u = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { role: true },
  });
  return u?.role ?? null;
}
