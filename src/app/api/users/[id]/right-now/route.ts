import { BookingStatus, Role, ShiftAssignmentStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { accountableCheckoutWhere, isPastGrace, onTimeRate } from "@/lib/on-time-rate";
import { requireRole } from "@/lib/rbac";
import { liveAssignmentWindow } from "@/lib/schedule-window";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";

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
  const [assignment, bookings, weekShifts, completed, overdue, policies] = await Promise.all([
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
        callStartsAt: true,
        callEndsAt: true,
        shift: {
          select: {
            area: true,
            startsAt: true,
            endsAt: true,
            callStartsAt: true,
            callEndsAt: true,
            shiftGroup: {
              select: {
                event: {
                  select: {
                    summary: true,
                    allDay: true,
                    startsAt: true,
                    endsAt: true,
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
      where: { ...accountableCheckoutWhere, requesterUserId: params.id, status: BookingStatus.COMPLETED },
      select: { endsAt: true, completedAt: true },
    }),
    db.booking.findMany({
      where: { ...accountableCheckoutWhere, requesterUserId: params.id, status: BookingStatus.OPEN },
      select: { endsAt: true },
    }),
    loadCheckoutPolicies(),
  ]);

  // The app-wide on-time rule (see on-time-rate.ts): late means returned after due plus grace,
  // and checkouts still out past that point count against the rate.
  const lateCompleted = completed.filter(
    (b) => b.completedAt && isPastGrace(b.endsAt, b.completedAt, policies.gracePeriodHours),
  ).length;
  const activeLate = overdue.filter((b) => isPastGrace(b.endsAt, now, policies.gracePeriodHours)).length;

  const shift = assignment?.shift ?? null;
  // Live means inside the person's real window (see liveAssignmentWindow).
  const callWindow = assignment ? liveAssignmentWindow(assignment) : null;
  const live =
    !!callWindow &&
    callWindow.startsAt <= now &&
    callWindow.endsAt >= now;
  return ok({
    data: {
      nextShift: shift
        ? {
            summary: shift.shiftGroup.event.summary,
            location: shift.shiftGroup.event.location?.name ?? null,
            area: shift.area,
            startsAt: shift.startsAt.toISOString(),
            endsAt: shift.endsAt.toISOString(),
            live,
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
        onTimeRate: onTimeRate({ completed: completed.length, lateCompleted, activeLate }),
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
