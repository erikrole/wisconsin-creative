import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AUDIT_RETENTION_DAYS } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const MAX_PAGE_SIZE = 100;

type AuditCursor = { createdAt: string; id: string };

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString("base64url");
}

function decodeCursor(raw: string): AuditCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed && typeof parsed.createdAt === "string" &&
      Number.isFinite(new Date(parsed.createdAt).getTime()) &&
      typeof parsed.id === "string" && parsed.id.trim().length > 0
    ) return parsed as AuditCursor;
    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/audit — paginated audit log feed for admins.
 * Keyset pagination ordered by (createdAt DESC, id DESC).
 *
 * Query params:
 *   cursor     — opaque pagination token (base64url JSON)
 *   after      — cursor for live-tail polling (returns rows newer than this)
 *   entityType — filter by exact entity type
 *   actor      — filter by actor user ID
 *   action     — substring filter on action string
 *   from       — ISO datetime lower bound (createdAt >=)
 *   to         — ISO datetime upper bound (createdAt <=)
 *   limit      — page size (default 50, max 100)
 */
export const GET = withAuth(async (req, { user }) => {
  if (user.role !== "ADMIN") throw new HttpError(403, "Admin only");
  await enforceRateLimit(`audit:browse:${user.id}`, { max: 60, windowMs: 60_000 });

  const { searchParams } = new URL(req.url);
  const cursorParam = searchParams.get("cursor");
  const afterParam = searchParams.get("after");
  const entityType = searchParams.get("entityType") || null;
  const actorId = searchParams.get("actor") || null;
  const action = searchParams.get("action") || null;
  const from = searchParams.get("from") || null;
  const to = searchParams.get("to") || null;
  const limitParam = Math.min(parsePagination(new URLSearchParams({
    ...(searchParams.has("limit") ? { limit: searchParams.get("limit")! } : {}),
  })).limit, MAX_PAGE_SIZE);
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if ((fromDate && !Number.isFinite(fromDate.getTime())) ||
      (toDate && !Number.isFinite(toDate.getTime()))) {
    throw new HttpError(400, "Invalid audit date filter");
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw new HttpError(400, "from must be before or equal to to");
  }
  if (cursorParam && afterParam) {
    throw new HttpError(400, "Use either cursor or after, not both");
  }

  const where: Prisma.AuditLogWhereInput = {};

  if (entityType) where.entityType = entityType;
  if (actorId) where.actorUserId = actorId;
  if (action) where.action = { contains: action, mode: "insensitive" };
  if (from || to) {
    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  // Keyset pagination — "before" cursor (older pages)
  if (cursorParam) {
    const cursor = decodeCursor(cursorParam);
    if (!cursor) throw new HttpError(400, "Invalid audit cursor");
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      where.OR = [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: cursor.id } },
      ];
    }
  }

  // "After" cursor — live-tail polling for rows newer than the newest seen
  if (afterParam) {
    const cursor = decodeCursor(afterParam);
    if (!cursor) throw new HttpError(400, "Invalid audit after cursor");
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      where.OR = [
        { createdAt: { gt: createdAt } },
        { createdAt, id: { gt: cursor.id } },
      ];
    }
  }

  const rows = await db.auditLog.findMany({
    where,
    select: {
      id: true,
      entityType: true,
      entityId: true,
      action: true,
      createdAt: true,
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: afterParam
      ? [{ createdAt: "asc" }, { id: "asc" }]
      : [{ createdAt: "desc" }, { id: "desc" }],
    take: afterParam ? limitParam : limitParam + 1,
  });

  const hasMore = !afterParam && rows.length > limitParam;
  const data = afterParam ? rows : rows.slice(0, limitParam);
  const lastRow = data.at(-1);
  const nextCursor = hasMore && lastRow ? encodeCursor(lastRow) : null;

  return ok({
    data: data.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      actor: r.actor ? { id: r.actor.id, name: r.actor.name, email: r.actor.email } : null,
    })),
    nextCursor,
    hasMore,
    retentionDays: AUDIT_RETENTION_DAYS,
  });
});
