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
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const confirmed = [
    ShiftAssignmentStatus.DIRECT_ASSIGNED,
    ShiftAssignmentStatus.APPROVED,
  ];
  const [assignment, bookings, weekShifts, completed] = await Promise.all([
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
    db.shiftAssignment.findMany({
      where: {
        userId: params.id,
        status: { in: confirmed },
        shift: {
          endsAt: { gte: now },
          startsAt: { lte: weekEnd },
          shiftGroup: { publishedAt: { not: null }, archivedAt: null },
        },
      },
      orderBy: { shift: { startsAt: "asc" } },
      take: 10,
      select: {
        shift: {
          select: {
            area: true,
            startsAt: true,
            endsAt: true,
            shiftGroup: { select: { event: { select: { summary: true } } } },
          },
        },
      },
    }),
    db.booking.findMany({
      where: { requesterUserId: params.id, status: BookingStatus.COMPLETED },
      select: { endsAt: true, completedAt: true },
    }),
  ]);

  // On time = returned at or before the due time. Bookings with no recorded return time are
  // counted as checkouts but left out of the rate.
  const returned = completed.filter((b) => b.completedAt);
  const onTime = returned.filter((b) => b.completedAt! <= b.endsAt).length;

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
      week: weekShifts.map((a) => ({
        summary: a.shift.shiftGroup.event.summary,
        area: a.shift.area,
        startsAt: a.shift.startsAt.toISOString(),
        endsAt: a.shift.endsAt.toISOString(),
      })),
      performance: {
        checkouts: completed.length,
        onTimeRate: returned.length
          ? Math.round((onTime / returned.length) * 100)
          : null,
      },
      holding: bookings.map((b) => ({
        id: b.id,
        title: b.title,
        dueAt: b.endsAt.toISOString(),
        overdue: b.endsAt < now,
      })),
    },
  });
});
