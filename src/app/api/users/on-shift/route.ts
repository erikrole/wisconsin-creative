import { Role, ShiftAssignmentStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { formatAppTime } from "@/lib/app-time";
import { resolveEffectiveAssignmentWindow } from "@/lib/schedule-window";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

/**
 * Who is on a published shift right now. Powers the "On shift now" strip on the roster.
 * Only published, non-archived shift groups and confirmed assignments count. Everyone with a
 * confirmed assignment shows, students and staff alike.
 *
 * "Right now" uses the window the person is actually called for: their own call time, then the
 * slot's, then the shift's. An all-day event with no call time (game time not set yet) has no
 * clock to be on, so it never counts. Its stored window is the whole date span, which used to
 * make everyone look on shift from the evening before.
 */
export const GET = withAuth(async (_req, { user }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF, Role.STUDENT]);

  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const rows = await db.shiftAssignment.findMany({
    where: {
      status: { in: [ShiftAssignmentStatus.DIRECT_ASSIGNED, ShiftAssignmentStatus.APPROVED] },
      user: { active: true, hiddenFromRoster: false },
      // Broad prefilter; the real call window is rechecked below.
      shift: {
        startsAt: { lte: new Date(now.getTime() + day) },
        endsAt: { gte: new Date(now.getTime() - day) },
        shiftGroup: { publishedAt: { not: null }, archivedAt: null },
      },
    },
    select: {
      callStartsAt: true,
      callEndsAt: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
      shift: {
        select: {
          area: true,
          startsAt: true,
          endsAt: true,
          callStartsAt: true,
          callEndsAt: true,
          shiftGroup: { select: { event: { select: { summary: true, allDay: true, startsAt: true, endsAt: true } } } },
        },
      },
    },
    take: 200,
  });

  const live = rows
    .map((row) => {
      const hasCall =
        (row.callStartsAt && row.callEndsAt) || (row.shift.callStartsAt && row.shift.callEndsAt);
      if (row.shift.shiftGroup.event.allDay && !hasCall) return null;
      const window = resolveEffectiveAssignmentWindow(row);
      return window.startsAt <= now && window.endsAt >= now ? { row, endsAt: window.endsAt } : null;
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());

  const seen = new Set<string>();
  const data = live
    .filter(({ row }) => (seen.has(row.user.id) ? false : (seen.add(row.user.id), true)))
    .map(({ row, endsAt }) => ({
      id: row.user.id,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl ?? null,
      area: row.shift.area,
      event: row.shift.shiftGroup.event.summary,
      endsAt: endsAt.toISOString(),
      endsAtLabel: formatAppTime(endsAt),
    }));

  return ok({ data });
});
