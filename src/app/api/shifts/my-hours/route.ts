import { ShiftAssignmentStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { endOfAppMonth, endOfAppWeek, startOfAppMonth, startOfAppWeek } from "@/lib/app-time";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireInternalActor } from "@/lib/rbac";

const ACTIVE_STATUSES: ShiftAssignmentStatus[] = ["DIRECT_ASSIGNED", "APPROVED"];

export const GET = withAuth(async (_req, { user }) => {
  requireInternalActor(user);
  const now = new Date();

  // Monday–Sunday and the calendar month, both in the institution timezone.
  // A week can cross the month boundary, so the read covers the union and the
  // totals are split afterward.
  const weekStart = startOfAppWeek(now);
  const weekEnd = endOfAppWeek(now);
  const monthStart = startOfAppMonth(now);
  const monthEnd = endOfAppMonth(now);
  const rangeStart = weekStart < monthStart ? weekStart : monthStart;
  const rangeEnd = weekEnd > monthEnd ? weekEnd : monthEnd;

  const assignments = await db.shiftAssignment.findMany({
    where: {
      userId: user.id,
      status: { in: ACTIVE_STATUSES },
      shift: {
        startsAt: { lt: rangeEnd },
        endsAt: { gte: rangeStart },
      },
    },
    select: {
      shift: {
        select: { startsAt: true, endsAt: true },
      },
    },
  });

  let weekMinutes = 0;
  let monthMinutes = 0;
  let shiftCountWeek = 0;
  let shiftCountMonth = 0;

  for (const a of assignments) {
    const start = a.shift.startsAt;
    const end = a.shift.endsAt;
    const mins = (end.getTime() - start.getTime()) / 60_000;
    const overlaps = (rangeStartAt: Date, rangeEndAt: Date) => start < rangeEndAt && end >= rangeStartAt;

    if (overlaps(monthStart, monthEnd)) {
      monthMinutes += mins;
      shiftCountMonth++;
    }
    if (overlaps(weekStart, weekEnd)) {
      weekMinutes += mins;
      shiftCountWeek++;
    }
  }

  return ok({
    data: {
      thisWeek: Math.round(weekMinutes / 60 * 10) / 10,
      thisMonth: Math.round(monthMinutes / 60 * 10) / 10,
      shiftCountWeek,
      shiftCountMonth,
    },
  });
});
