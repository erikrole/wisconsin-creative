import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { createAuditEntry } from "@/lib/audit";

const patchNotificationSchema = z.object({
  action: z.enum(["mark_all_read", "mark_read", "mark_unread"]),
  id: z.string().cuid().optional(),
  ids: z.array(z.string().cuid()).max(500).optional(),
}).refine(
  (data) => data.action !== "mark_read" || !!data.id,
  { message: "id is required for mark_read action" }
).refine(
  (data) => data.action !== "mark_unread" || Boolean(data.id || data.ids?.length),
  { message: "id or ids is required for mark_unread action" }
);

export const GET = withAuth(async (req, { user }) => {
  const { searchParams } = new URL(req.url);
  const { limit, offset } = parsePagination(searchParams);
  const unreadOnly = searchParams.get("unread") === "true";

  const where = {
    userId: user.id,
    ...(unreadOnly ? { readAt: null } : {})
  };

  const [data, total, inboxTotal, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: user.id } }),
    db.notification.count({ where: { userId: user.id, readAt: null } })
  ]);

  return ok({ data, total, inboxTotal, limit, offset, unreadCount });
});

export const PATCH = withAuth(async (req, { user }) => {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  const body = patchNotificationSchema.parse(rawBody);

  if (body.action === "mark_all_read") {
    const unread = await db.notification.findMany({
      where: { userId: user.id, readAt: null },
      select: { id: true },
    });
    const result = await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() }
    });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "notification",
      entityId: user.id,
      action: "notifications_marked_all_read",
      after: { count: result.count },
    });
    return ok({ success: true, ids: unread.map(({ id }) => id) });
  }

  if (body.action === "mark_unread") {
    const ids = body.ids ?? (body.id ? [body.id] : []);
    const result = await db.notification.updateMany({
      where: { userId: user.id, id: { in: ids }, readAt: { not: null } },
      data: { readAt: null },
    });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "notification",
      entityId: user.id,
      action: "notifications_marked_unread",
      after: { requestedCount: ids.length, count: result.count },
    });
    return ok({ success: true, count: result.count });
  }

  const result = await db.notification.updateMany({
    where: { id: body.id!, userId: user.id },
    data: { readAt: new Date() }
  });
  if (result.count === 0) {
    throw new HttpError(404, "Notification not found");
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "notification",
    entityId: body.id!,
    action: "notification_marked_read",
  });
  return ok({ success: true });
});
