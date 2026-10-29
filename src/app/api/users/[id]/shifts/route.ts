import { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

/** Every shift a person is on, newest first, for the Schedule's person sheet. Staff and admins only. */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF]);

  const assignments = await db.shiftAssignment.findMany({
    where: {
      userId: params.id,
      status: { in: ["DIRECT_ASSIGNED", "APPROVED", "REQUESTED"] },
      shift: { shiftGroup: { event: { status: { not: "CANCELLED" }, archivedAt: null } } },
    },
    orderBy: [{ shift: { startsAt: "desc" } }, { id: "asc" }],
    take: 500,
    select: {
      id: true,
      status: true,
      crewLabel: true,
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
                select: { id: true, summary: true, allDay: true, sportCode: true, opponent: true, isHome: true, site: true },
              },
            },
          },
        },
      },
    },
  });

  return ok({
    data: assignments.map((a) => ({
      id: a.id,
      status: a.status,
      crewLabel: a.crewLabel,
      area: a.shift.area,
      startsAt: (a.callStartsAt ?? a.shift.callStartsAt ?? a.shift.startsAt).toISOString(),
      endsAt: (a.callEndsAt ?? a.shift.callEndsAt ?? a.shift.endsAt).toISOString(),
      event: a.shift.shiftGroup.event,
    })),
  });
});
