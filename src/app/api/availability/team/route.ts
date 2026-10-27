import { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

const dateKey = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/**
 * Every active student worker with their availability blocks, for the Staff
 * Availability tab. Staff and admins only; a student's own blocks stay on their profile.
 */
export const GET = withAuth(async (_req, { user }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF]);

  const students = await db.user.findMany({
    where: { active: true, hiddenFromRoster: false, staffingType: "ST" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      availabilityBlocks: {
        where: { status: { not: "DENIED" } },
        select: {
          id: true, kind: true, intent: true, status: true, dayOfWeek: true,
          date: true, dateEndsOn: true, allDay: true, startsAt: true, endsAt: true,
          label: true, semesterStartsOn: true, semesterEndsOn: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return ok({
    data: students.map(({ availabilityBlocks, ...student }) => ({
      ...student,
      blocks: availabilityBlocks.map((b) => ({
        ...b,
        date: dateKey(b.date),
        dateEndsOn: dateKey(b.dateEndsOn),
        semesterStartsOn: dateKey(b.semesterStartsOn),
        semesterEndsOn: dateKey(b.semesterEndsOn),
      })),
    })),
  });
});
