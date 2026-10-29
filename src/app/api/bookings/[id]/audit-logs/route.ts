import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { db } from "@/lib/db";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { mergeByTime, scanRowsForAuditPage } from "@/lib/services/activity-scans";

const PAGE_SIZE = 50;

/**
 * GET /api/bookings/[id]/audit-logs?cursor=<id>
 * Cursor-based pagination for audit log entries on a booking.
 */
export const GET = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = params;

  if (user.role === "COLLABORATOR") {
    throw new HttpError(403, "Booking audit history is not available to collaborators");
  }

  // Verify user has view access to this booking (students can only see own bookings)
  await requireBookingAction(id, user, "view");
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");

  const cursorLog = cursor
    ? await db.auditLog.findFirst({
        where: { id: cursor, entityType: "booking", entityId: id },
        select: { createdAt: true },
      })
    : null;
  if (cursor && !cursorLog) {
    throw new HttpError(400, "Invalid audit cursor");
  }

  const logs = await db.auditLog.findMany({
    where: { entityType: "booking", entityId: id },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
  });

  const hasMore = logs.length > PAGE_SIZE;
  const data = hasMore ? logs.slice(0, PAGE_SIZE) : logs;
  const nextCursor = hasMore ? data[data.length - 1]?.id : null;

  // Each item scanned out or back in, placed among this page's rows by time.
  const scans = await scanRowsForAuditPage(
    { bookingId: id },
    { before: cursorLog?.createdAt ?? null, atOrAfter: hasMore ? data[data.length - 1]!.createdAt : null },
  );

  return ok({ data: mergeByTime(data, scans), hasMore, nextCursor });
});
