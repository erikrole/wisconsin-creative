import { BookingStatus, Role, ShiftAssignmentStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

/**
 * What is going on with this person right now: their next confirmed shift and the gear they
 * are holding. Students only see their own; staff and admins see anyone's.
 */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF, Role.STUDENT]);
  if (user.role === Role.STUDENT && user.id !== params.id)
    throw new HttpError(403, "Forbidden");

  const now = new Date();
  const [assignment, bookings] = await Promise.all([
    db.shiftAssignment.findFirst({
      where: {
        userId: params.id,
        status: {
          in: [
            ShiftAssignmentStatus.DIRECT_ASSIGNED,
            ShiftAssignmentStatus.APPROVED,
          ],
        },
        shift: {
          endsAt: { gte: now },
          shiftGroup: { publishedAt: { not: null }, archivedAt: null },
        },
      },
      orderBy: { shift: { startsAt: "asc" } },
      select: {
        shift: {
          select: {
            area: true,
            startsAt: true,
            endsAt: true,
            shiftGroup: {
              select: {
                event: {
                  select: {
                    summary: true,
                    location: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.booking.findMany({
      where: { requesterUserId: params.id, status: BookingStatus.OPEN },
      orderBy: { endsAt: "asc" },
      take: 3,
      select: { id: true, title: true, endsAt: true },
    }),
  ]);

  const shift = assignment?.shift ?? null;
  return ok({
    data: {
      nextShift: shift
        ? {
            summary: shift.shiftGroup.event.summary,
            location: shift.shiftGroup.event.location?.name ?? null,
            area: shift.area,
            startsAt: shift.startsAt.toISOString(),
            endsAt: shift.endsAt.toISOString(),
            live: shift.startsAt <= now,
          }
        : null,
      holding: bookings.map((b) => ({
        id: b.id,
        title: b.title,
        dueAt: b.endsAt.toISOString(),
        overdue: b.endsAt < now,
      })),
    },
  });
});
