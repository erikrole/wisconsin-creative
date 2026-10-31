import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { availabilityConflictNote } from "@/lib/student-availability";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

/**
 * GET /api/shifts/[id]/conflicts
 *
 * Returns a map of userId → conflictNote for all active students whose
 * StudentAvailabilityBlock overlaps with this shift's time window.
 * Used to show conflict indicators in the assignment picker UI.
 */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  // Feeds the staff assignment picker; the notes name other students' time off.
  requireRole(user.role, ["ADMIN", "STAFF"]);
  const { id } = params;

  const shift = await db.shift.findUnique({
    where: { id },
    select: { startsAt: true, endsAt: true, callStartsAt: true, callEndsAt: true },
  });
  if (!shift) throw new HttpError(404, "Shift not found");

  const effectiveStartsAt = shift.callStartsAt ?? shift.startsAt;
  const effectiveEndsAt = shift.callEndsAt ?? shift.endsAt;
  // Only check student availability; Staff users don't have class blocks.
  const students = await db.user.findMany({
    where: visibleActiveUserWhere({
      role: "STUDENT",
      availabilityBlocks: { some: {} },
    }),
    select: {
      id: true,
      availabilityBlocks: {
        select: {
          kind: true,
          intent: true,
          status: true,
          dayOfWeek: true,
          date: true,
          dateEndsOn: true,
          allDay: true,
          startsAt: true,
          endsAt: true,
          label: true,
          semesterLabel: true,
          semesterStartsOn: true,
          semesterEndsOn: true,
        },
      },
    },
  });

  const conflicts: Record<string, string> = {};
  for (const student of students) {
    const note = availabilityConflictNote(student.availabilityBlocks, {
      startsAt: effectiveStartsAt,
      endsAt: effectiveEndsAt,
    });
    if (note) conflicts[student.id] = note;
  }

  return ok({ data: conflicts });
});
