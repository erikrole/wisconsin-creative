import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { getScheduleChangeHistory } from "@/lib/services/schedule-change-history";
import { requireInternalActor } from "@/lib/rbac";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireInternalActor(user);
  if (user.role === "STUDENT") {
    throw new HttpError(403, "Staff or admin access required");
  }
  await enforceRateLimit(`calendar-command:${user.id}`, { max: 60, windowMs: 60_000 });

  const eventId = params.id;

  const [shiftGroup, bookings, changeHistory] = await Promise.all([
    db.shiftGroup.findUnique({
      where: { eventId },
      include: {
        shifts: {
          orderBy: [{ area: "asc" }, { workerType: "asc" }],
          include: {
            assignments: {
              include: {
                user: { select: { id: true, name: true } },
                bookings: {
                  where: { status: { not: "CANCELLED" } },
                  select: { id: true, status: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    }),
    db.booking.findMany({
      where: {
        status: { not: "CANCELLED" },
        // Match bookings where this event is primary (FK) OR linked via the
        // BookingEvent junction (secondary/additional events).
        OR: [
          { eventId },
          { events: { some: { eventId } } },
        ],
      },
      select: {
        id: true,
        status: true,
        requesterUserId: true,
        shiftAssignmentId: true,
        requester: { select: { id: true, name: true } },
      },
      take: 500,
    }),
    getScheduleChangeHistory({ eventIds: [eventId], limitPerEvent: 8, includeWorkingCopy: true }),
  ]);

  if (!shiftGroup) {
    return ok({
      data: {
        shifts: [],
        gearSummary: { total: 0, byStatus: { draft: 0, reserved: 0, pendingPickup: 0, checkedOut: 0, completed: 0 } },
        missingGear: [],
        recentChanges: changeHistory.events[eventId]?.items ?? [],
      },
    });
  }

  const assignmentIds = shiftGroup.shifts.flatMap((shift) =>
    shift.assignments
      .filter((assignment) => assignment.status === "DIRECT_ASSIGNED" || assignment.status === "APPROVED")
      .map((assignment) => assignment.id),
  );
  const assignmentBookings = assignmentIds.length > 0
    ? await db.booking.findMany({
        where: {
          status: { not: "CANCELLED" },
          shiftAssignmentId: { in: assignmentIds },
        },
        select: {
          id: true,
          status: true,
          requesterUserId: true,
          shiftAssignmentId: true,
          requester: { select: { id: true, name: true } },
        },
        take: 500,
      })
    : [];
  const allBookings = [...bookings];
  const seenBookingIds = new Set(allBookings.map((booking) => booking.id));
  for (const booking of assignmentBookings) {
    if (seenBookingIds.has(booking.id)) continue;
    seenBookingIds.add(booking.id);
    allBookings.push(booking);
  }

  // Build gear summary
  const byStatus = { draft: 0, reserved: 0, pendingPickup: 0, checkedOut: 0, completed: 0 };
  for (const b of allBookings) {
    if (b.status === "DRAFT") byStatus.draft++;
    else if (b.status === "BOOKED") byStatus.reserved++;
    else if (b.status === "PENDING_PICKUP") byStatus.pendingPickup++;
    else if (b.status === "OPEN") byStatus.checkedOut++;
    else if (b.status === "COMPLETED") byStatus.completed++;
  }

  // Set of userIds who have any booking for this event
  const usersWithGear = new Set(allBookings.map((b) => b.requesterUserId));

  // Build shifts response and collect missing gear
  const missingGear: Array<{
    userId: string;
    userName: string;
    area: string;
    shiftId: string;
    assignmentId: string;
  }> = [];

  const shifts = shiftGroup.shifts.map((shift) => {
    const activeAssignment = shift.assignments.find(
      (a) => a.status === "DIRECT_ASSIGNED" || a.status === "APPROVED"
    );
    const pendingRequests = shift.assignments.filter(
      (a) => a.status === "REQUESTED"
    ).length;

    // Check for directly linked booking via FK
    const linkedBooking = activeAssignment?.bookings?.[0] ?? null;

    if (activeAssignment && !usersWithGear.has(activeAssignment.userId)) {
      missingGear.push({
        userId: activeAssignment.userId,
        userName: activeAssignment.user.name,
        area: shift.area,
        shiftId: shift.id,
        assignmentId: activeAssignment.id,
      });
    }

    return {
      id: shift.id,
      area: shift.area,
      workerType: shift.workerType,
      workerLabel: shiftWorkerLabel(shift.workerType),
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      callStartsAt: (shift.callStartsAt ?? shift.startsAt).toISOString(),
      callEndsAt: (shift.callEndsAt ?? shift.endsAt).toISOString(),
      assignment: activeAssignment
        ? {
            id: activeAssignment.id,
            userId: activeAssignment.userId,
            userName: activeAssignment.user.name,
            status: activeAssignment.status,
            callStartsAt: (activeAssignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt).toISOString(),
            callEndsAt: (activeAssignment.callEndsAt ?? shift.callEndsAt ?? shift.endsAt).toISOString(),
            callNote: activeAssignment.callNote,
            linkedBookingId: linkedBooking?.id ?? null,
            linkedBookingStatus: linkedBooking?.status ?? null,
          }
        : null,
      pendingRequests,
    };
  });

  return ok({
    data: {
      shifts,
      gearSummary: { total: allBookings.length, byStatus },
      missingGear,
      recentChanges: changeHistory.events[eventId]?.items ?? [],
    },
  });
});
