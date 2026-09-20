import { LicenseCodeStatus, Prisma, type Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { sendPushToUser } from "@/lib/services/notifications";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
// Retry once on conflict — covers the rare two-students-tap-the-last-slot race.
import { withSerializationRetry } from "@/lib/serialization";
import { unique } from "@/lib/utils";

const MAX_SLOTS = 2;

const activeClaimsInclude = {
  where: { releasedAt: null as null },
  include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  orderBy: { claimedAt: "asc" as const },
};

// Display priority: most-claimable first, retired last.
const STATUS_PRIORITY: Record<LicenseCodeStatus, number> = {
  AVAILABLE: 0,
  PARTIAL: 1,
  CLAIMED: 2,
  RETIRED: 3,
};

function sortByStatusPriority<T extends { status: LicenseCodeStatus; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (sa !== 0) return sa;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export async function listCodes() {
  const rows = await db.licenseCode.findMany({
    where: { status: { not: LicenseCodeStatus.RETIRED } },
    include: { claims: activeClaimsInclude },
  });
  return sortByStatusPriority(rows);
}

export async function listAllCodes() {
  const rows = await db.licenseCode.findMany({
    include: { claims: activeClaimsInclude },
  });
  return sortByStatusPriority(rows);
}

export async function getActiveClaimForUser(userId: string) {
  const claim = await db.licenseCodeClaim.findFirst({
    where: { userId, releasedAt: null },
    include: { licenseCode: { select: { id: true, code: true, label: true, expiresAt: true } } },
  });
  if (!claim) return null;
  return {
    id: claim.licenseCode.id,
    code: claim.licenseCode.code,
    label: claim.licenseCode.label,
    expiresAt: claim.licenseCode.expiresAt,
    claimedAt: claim.claimedAt,
    claimId: claim.id,
  };
}

export async function claimCode(codeId: string, userId: string) {
  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.licenseCodeClaim.findFirst({
          where: { userId, releasedAt: null },
          select: { id: true },
        });
        if (existing) {
          throw new HttpError(409, "You already have an active Photo Mechanic license. Return it before claiming another.");
        }

        const code = await tx.licenseCode.findUnique({
          where: { id: codeId },
          include: { claims: { where: { releasedAt: null } } },
        });
        if (!code) throw new HttpError(404, "License code not found.");
        if (code.status === LicenseCodeStatus.RETIRED) throw new HttpError(409, "This license code is retired.");

        const activeCount = code.claims.length;
        if (activeCount >= MAX_SLOTS) throw new HttpError(409, "This license code is fully claimed.");

        const now = new Date();
        await tx.licenseCodeClaim.create({
          data: { licenseCodeId: codeId, userId, claimedAt: now },
        });

        const newStatus = activeCount + 1 >= MAX_SLOTS ? LicenseCodeStatus.CLAIMED : LicenseCodeStatus.PARTIAL;
        return tx.licenseCode.update({
          where: { id: codeId },
          data: {
            status: newStatus,
            ...(activeCount === 0 ? { claimedById: userId, claimedAt: now } : {}),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function releaseCode(
  codeId: string,
  requesterId: string,
  isAdmin: boolean,
  opts: { claimId?: string; releaseAll?: boolean } = {},
  actorRole: Role,
) {
  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        if (opts.releaseAll) {
          if (!isAdmin) throw new HttpError(403, "Only admins can release all slots.");
          const allActive = await tx.licenseCodeClaim.findMany({
            where: { licenseCodeId: codeId, releasedAt: null },
            select: { id: true },
          });
          if (allActive.length === 0) throw new HttpError(409, "No active claims to release.");
          const now = new Date();
          await tx.licenseCodeClaim.updateMany({
            where: { licenseCodeId: codeId, releasedAt: null },
            data: { releasedAt: now, releasedById: requesterId },
          });
          const code = await tx.licenseCode.update({
            where: { id: codeId },
            data: { status: LicenseCodeStatus.AVAILABLE, claimedById: null, claimedAt: null, nagSentAt: null },
          });
          await createAuditEntryTx(tx, {
            actorId: requesterId,
            actorRole,
            entityType: "license_code",
            entityId: codeId,
            action: "release",
            after: {
              status: code.status,
              claimId: opts.claimId ?? null,
              releaseAll: true,
              releasedById: isAdmin ? requesterId : null,
            },
          });
          return code;
        }

        let claim;
        if (opts.claimId) {
          if (!isAdmin) throw new HttpError(403, "Only admins can release by claim ID.");
          claim = await tx.licenseCodeClaim.findUnique({ where: { id: opts.claimId } });
          if (!claim || claim.licenseCodeId !== codeId || claim.releasedAt) {
            throw new HttpError(404, "Active claim not found.");
          }
        } else {
          claim = await tx.licenseCodeClaim.findFirst({
            where: { licenseCodeId: codeId, userId: requesterId, releasedAt: null },
          });
          if (!claim) throw new HttpError(404, "No active claim found for your account.");
        }

        const now = new Date();
        await tx.licenseCodeClaim.update({
          where: { id: claim.id },
          data: {
            releasedAt: now,
            releasedById: claim.userId !== requesterId ? requesterId : null,
          },
        });

        const remaining = await tx.licenseCodeClaim.findMany({
          where: { licenseCodeId: codeId, releasedAt: null },
          orderBy: { claimedAt: "asc" },
        });

        const newStatus =
          remaining.length === 0 ? LicenseCodeStatus.AVAILABLE
          : remaining.length < MAX_SLOTS ? LicenseCodeStatus.PARTIAL
          : LicenseCodeStatus.CLAIMED;

        const code = await tx.licenseCode.update({
          where: { id: codeId },
          data: {
            status: newStatus,
            claimedById: remaining[0]?.userId ?? null,
            claimedAt: remaining[0]?.claimedAt ?? null,
            nagSentAt: null,
          },
        });
        await createAuditEntryTx(tx, {
          actorId: requesterId,
          actorRole,
          entityType: "license_code",
          entityId: codeId,
          action: "release",
          after: {
            status: code.status,
            claimId: opts.claimId ?? claim.id,
            releaseAll: false,
            releasedById: isAdmin ? requesterId : null,
          },
        });
        return code;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function addUnknownOccupant(codeId: string, label: string) {
  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const code = await tx.licenseCode.findUnique({
          where: { id: codeId },
          include: { claims: { where: { releasedAt: null } } },
        });
        if (!code) throw new HttpError(404, "License code not found.");
        if (code.status === LicenseCodeStatus.RETIRED) throw new HttpError(409, "This license code is retired.");
        if (code.claims.length >= MAX_SLOTS) throw new HttpError(409, "This license code is fully claimed.");

        const now = new Date();
        await tx.licenseCodeClaim.create({
          data: { licenseCodeId: codeId, userId: null, occupantLabel: label.trim(), claimedAt: now },
        });

        const activeCount = code.claims.length + 1;
        const newStatus = activeCount >= MAX_SLOTS ? LicenseCodeStatus.CLAIMED : LicenseCodeStatus.PARTIAL;
        return tx.licenseCode.update({
          where: { id: codeId },
          data: { status: newStatus },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function assignCodeToUser(codeId: string, userId: string) {
  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const assignee = await tx.user.findFirst({
          where: visibleActiveUserWhere({
            id: userId,
            role: { in: ["ADMIN", "STAFF", "STUDENT"] },
          }),
          select: { id: true, name: true },
        });
        if (!assignee) throw new HttpError(404, "Active user not found.");

        const existing = await tx.licenseCodeClaim.findFirst({
          where: { userId, releasedAt: null },
          select: { id: true },
        });
        if (existing) {
          throw new HttpError(409, `${assignee.name} already has an active Photo Mechanic license.`);
        }

        const code = await tx.licenseCode.findUnique({
          where: { id: codeId },
          include: { claims: { where: { releasedAt: null } } },
        });
        if (!code) throw new HttpError(404, "License code not found.");
        if (code.status === LicenseCodeStatus.RETIRED) throw new HttpError(409, "This license code is retired.");
        if (code.claims.length >= MAX_SLOTS) throw new HttpError(409, "This license code is fully claimed.");

        const now = new Date();
        await tx.licenseCodeClaim.create({
          data: { licenseCodeId: codeId, userId, claimedAt: now },
        });

        const newStatus =
          code.claims.length + 1 >= MAX_SLOTS ? LicenseCodeStatus.CLAIMED : LicenseCodeStatus.PARTIAL;
        const updated = await tx.licenseCode.update({
          where: { id: codeId },
          data: {
            status: newStatus,
            ...(code.claims.length === 0 ? { claimedById: userId, claimedAt: now } : {}),
          },
        });

        return { code: updated, assignee };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function createCode(
  code: string,
  label: string | undefined,
  createdById: string,
  accountEmail?: string,
  expiresAt?: Date
) {
  return db.licenseCode.create({
    data: { code: code.trim(), label, createdById, accountEmail, expiresAt },
  });
}

export async function bulkCreateCodes(
  rawLines: string,
  createdById: string,
  shared: { accountEmail?: string; expiresAt?: Date } = {}
): Promise<{ created: number; skipped: number }> {
  const lines = rawLines
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Dedupe within the paste — repeated rows count as skipped, not a unique-constraint 500.
  const codes = unique(lines);

  if (codes.length === 0) throw new HttpError(400, "No codes provided.");
  if (codes.some((c) => c.length > 120)) {
    throw new HttpError(400, "One or more codes are longer than 120 characters.");
  }

  const existing = await db.licenseCode.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const existingSet = new Set(existing.map((e) => e.code));
  const newCodes = codes.filter((c) => !existingSet.has(c));

  if (newCodes.length === 0) return { created: 0, skipped: lines.length };

  const result = await db.licenseCode.createMany({
    data: newCodes.map((code) => ({
      code,
      createdById,
      accountEmail: shared.accountEmail,
      expiresAt: shared.expiresAt,
    })),
    skipDuplicates: true,
  });

  return { created: result.count, skipped: lines.length - result.count };
}

export async function retireCode(codeId: string) {
  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const code = await tx.licenseCode.findUnique({
          where: { id: codeId },
          include: { claims: { where: { releasedAt: null } } },
        });
        if (!code) throw new HttpError(404, "License code not found.");
        if (code.claims.length > 0) {
          throw new HttpError(409, "Cannot retire a license with active claims. Release all slots first.");
        }
        return tx.licenseCode.update({
          where: { id: codeId },
          data: { status: LicenseCodeStatus.RETIRED },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function deleteCode(codeId: string) {
  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const code = await tx.licenseCode.findUnique({
          where: { id: codeId },
          include: { claims: { where: { releasedAt: null } } },
        });
        if (!code) throw new HttpError(404, "License code not found.");
        if (code.claims.length > 0) {
          throw new HttpError(409, "Cannot delete a license with active claims. Release all slots first.");
        }
        return tx.licenseCode.delete({ where: { id: codeId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function updateCodeDetails(
  codeId: string,
  data: { label?: string; accountEmail?: string | null; expiresAt?: Date | null }
) {
  return db.licenseCode.update({ where: { id: codeId }, data });
}

export async function bulkRenewCodes(codeIds: string[], expiresAt: Date): Promise<{ updated: number }> {
  const result = await db.licenseCode.updateMany({
    where: {
      id: { in: codeIds },
      status: { not: LicenseCodeStatus.RETIRED },
    },
    data: { expiresAt },
  });

  return { updated: result.count };
}

export async function getClaimHistory(codeId: string, limit = 50) {
  return db.licenseCodeClaim.findMany({
    where: { licenseCodeId: codeId },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { claimedAt: "desc" },
    take: limit,
  });
}

export async function getClaimHistoryForUser(userId: string, limit = 25) {
  return db.licenseCodeClaim.findMany({
    where: { userId },
    include: {
      licenseCode: {
        select: {
          id: true,
          label: true,
          expiresAt: true,
        },
      },
    },
    orderBy: { claimedAt: "desc" },
    take: limit,
  });
}

export async function processExpiryWarnings() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const expiring = await db.licenseCode.findMany({
    where: {
      status: { not: LicenseCodeStatus.RETIRED },
      expiresAt: { not: null, lte: horizon },
    },
    select: { id: true, code: true, label: true, expiresAt: true },
  });

  if (expiring.length === 0) return { warned: 0 };

  const admins = await db.user.findMany({
    where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
    select: { id: true },
  });
  if (admins.length === 0) return { warned: 0 };

  // Dedupe on the CURRENT month so admins are re-warned monthly until the
  // license is renewed or retired (keying on the expiry month fires only once ever).
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // One row per (code, admin). Built up front so the whole fanout costs one
  // dedupe read and one insert instead of two queries per pair.
  const candidates = expiring.flatMap((code) => {
    if (!code.expiresAt) return [];
    const isExpired = code.expiresAt < now;
    const daysLeft = Math.ceil((code.expiresAt.getTime() - now.getTime()) / 86_400_000);

    const title = isExpired
      ? "Photo Mechanic license expired"
      : `Photo Mechanic license expiring in ${daysLeft}d`;
    const body = `${code.label ?? code.code}${code.label ? ` (${code.code})` : ""} · Renew soon to avoid disruption.`;

    return admins.map((admin) => ({
      codeId: code.id,
      userId: admin.id,
      title,
      body,
      type: isExpired ? "license_expired" : "license_expiring_soon",
      payload: { type: "license_expiry", licenseCodeId: code.id, href: "/licenses" },
      dedupeKey: `license-expiry-${code.id}-${yearMonth}-${admin.id}`,
    }));
  });
  if (candidates.length === 0) return { warned: 0 };

  let warned = 0;

  try {
    const existing = await db.notification.findMany({
      where: { dedupeKey: { in: candidates.map((candidate) => candidate.dedupeKey) } },
      select: { dedupeKey: true },
    });
    const existingKeys = new Set(existing.map((row) => row.dedupeKey));
    const pending = candidates.filter((candidate) => !existingKeys.has(candidate.dedupeKey));
    if (pending.length === 0) return { warned: 0 };

    const created = await db.notification.createMany({
      data: pending.map((candidate) => ({
        userId: candidate.userId,
        type: candidate.type,
        title: candidate.title,
        body: candidate.body,
        payload: candidate.payload,
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: candidate.dedupeKey,
      })),
      skipDuplicates: true,
    });
    warned = created.count;

    // Push is best-effort: one slow or failing device must not stall the rest.
    await Promise.allSettled(pending.map((candidate) =>
      sendPushToUser(candidate.userId, {
        title: candidate.title,
        body: candidate.body,
        payload: candidate.payload,
        category: "licenseExpiry",
      }).catch((err) => {
        console.error(`[LICENSE_EXPIRY] Failed for code ${candidate.codeId} admin ${candidate.userId}:`, err);
      }),
    ));
  } catch (err) {
    console.error(`[LICENSE_EXPIRY] Failed for ${candidates.length} pending warnings:`, err);
  }

  return { warned };
}

export async function processLicenseNags() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  // Staff and admins hold licenses with indefinite custody — only students get nagged to rotate.
  // Nag state is tracked per claim via the notification dedupe key (codeId + claimedAt), so
  // both holders of a 2-slot code each get their own nag.
  const overdueClaims = await db.licenseCodeClaim.findMany({
    where: {
      releasedAt: null,
      userId: { not: null },
      claimedAt: { lt: twoDaysAgo },
      user: { role: "STUDENT" },
    },
    select: { id: true, userId: true, claimedAt: true, licenseCodeId: true },
  });

  const title = "Still using Photo Mechanic?";
  const body = "You've had a license for 2+ days. Return it from the app if you're done so someone else can use it.";

  const candidates = overdueClaims.flatMap((claim) => claim.userId
    ? [{
      userId: claim.userId,
      licenseCodeId: claim.licenseCodeId,
      payload: { type: "license_nag", licenseCodeId: claim.licenseCodeId, href: "/licenses" },
      dedupeKey: `license-nag-${claim.licenseCodeId}-${claim.claimedAt.toISOString()}`,
    }]
    : []);
  if (candidates.length === 0) return { nagged: 0 };

  let nagged = 0;

  try {
    const existing = await db.notification.findMany({
      where: { dedupeKey: { in: candidates.map((candidate) => candidate.dedupeKey) } },
      select: { dedupeKey: true },
    });
    const existingKeys = new Set(existing.map((row) => row.dedupeKey));
    const pending = candidates.filter((candidate) => !existingKeys.has(candidate.dedupeKey));
    if (pending.length === 0) return { nagged: 0 };

    const created = await db.notification.createMany({
      data: pending.map((candidate) => ({
        userId: candidate.userId,
        type: "license_held_2d",
        title,
        body,
        payload: candidate.payload,
        channel: "IN_APP" as const,
        sentAt: new Date(),
        dedupeKey: candidate.dedupeKey,
      })),
      skipDuplicates: true,
    });
    nagged = created.count;

    // Push is best-effort: one slow or failing device must not stall the rest.
    await Promise.allSettled(pending.map((candidate) =>
      sendPushToUser(candidate.userId, {
        title,
        body,
        payload: candidate.payload,
        category: "licenseExpiry",
      }).catch((err) => {
        console.error(`[LICENSE_NAGS] Failed for code ${candidate.licenseCodeId}:`, err);
      }),
    ));
  } catch (err) {
    console.error(`[LICENSE_NAGS] Failed for ${candidates.length} pending nags:`, err);
  }

  return { nagged };
}
