import { Role, ShiftAssignmentStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

/**
 * Who is on a published shift right now. Powers the "On shift now" strip on the roster.
 * Only published, non-archived shift groups and confirmed assignments count.
 */
export const GET = withAuth(async (_req, { user }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF, Role.STUDENT]);

  const now = new Date();
  const rows = await db.shiftAssignment.findMany({
    where: {
      status: { in: [ShiftAssignmentStatus.DIRECT_ASSIGNED, ShiftAssignmentStatus.APPROVED] },
      user: { active: true, hiddenFromRoster: false },
      shift: {
        startsAt: { lte: now },
        endsAt: { gte: now },
        shiftGroup: { publishedAt: { not: null }, archivedAt: null },
      },
    },
    select: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      shift: {
        select: {
          area: true,
          endsAt: true,
          shiftGroup: { select: { event: { select: { summary: true } } } },
        },
      },
    },
    orderBy: { shift: { endsAt: "asc" } },
    take: 60,
  });

  const seen = new Set<string>();
  const data = rows
    .filter((row) => (seen.has(row.user.id) ? false : (seen.add(row.user.id), true)))
    .map((row) => ({
      id: row.user.id,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl ?? null,
      area: row.shift.area,
      event: row.shift.shiftGroup.event.summary,
      endsAt: row.shift.endsAt.toISOString(),
    }));

  return ok({ data });
});
