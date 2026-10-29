import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const GET = withAuth<{ id: string }>(async (req, { user, params }) => {
  requireRole(user.role, ["ADMIN", "STAFF"]);
  const { id } = params;

  const kit = await db.kit.findUnique({ where: { id }, select: { id: true } });
  if (!kit) throw new HttpError(404, "Kit not found");

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const limit = Math.min(
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const activityWhere = { entityType: "kit", entityId: id };

  if (cursor) {
    const cursorLog = await db.auditLog.findFirst({
      where: { id: cursor, ...activityWhere },
      select: { id: true },
    });
    if (!cursorLog) throw new HttpError(400, "Invalid activity cursor");
  }

  const logs = await db.auditLog.findMany({
    where: activityWhere,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      actor: { select: { name: true, email: true, avatarUrl: true } },
    },
  });

  const hasMore = logs.length > limit;
  const data = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? data[data.length - 1]!.id : null;

  return ok({ data, nextCursor });
});
