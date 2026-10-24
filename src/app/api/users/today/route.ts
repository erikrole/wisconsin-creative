import { Role, ShiftAssignmentStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { startOfDayInAppTz } from "@/lib/app-time";
import { db } from "@/lib/db";
import { isFullDayBoundaryWindow, studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

/**
 * Who is working which event now, later today, and tomorrow. Powers the Staff Today tab.
 * Only published, non-archived shift groups and confirmed assignments count.
 */
export const GET = withAuth(async (_req, { user }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF, Role.STUDENT]);

  const now = new Date();
  // Day boundaries are Central midnights; server runtimes run in UTC, where
  // setHours would file tonight's events under "tomorrow".
  const startOfTomorrow = startOfDayInAppTz(now, 1);
  const endOfTomorrow = startOfDayInAppTz(now, 2);

  const rows = await db.shiftAssignment.findMany({
    where: {
      status: { in: [ShiftAssignmentStatus.DIRECT_ASSIGNED, ShiftAssignmentStatus.APPROVED] },
      user: { active: true, hiddenFromRoster: false },
      shift: {
        endsAt: { gte: now },
        startsAt: { lt: endOfTomorrow },
        shiftGroup: { publishedAt: { not: null }, archivedAt: null },
      },
    },
    select: {
      callStartsAt: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
      shift: {
        select: {
          area: true,
          workerType: true,
          startsAt: true,
          endsAt: true,
          callStartsAt: true,
          shiftGroup: {
            select: {
              id: true,
              event: {
                select: {
                  summary: true, rawSummary: true, startsAt: true, endsAt: true,
                  allDay: true, isHome: true, site: true, opponent: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { shift: { startsAt: "asc" } },
    take: 400,
  });

  type EventCard = {
    id: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    when: "now" | "later" | "tomorrow";
    people: { id: string; name: string; avatarUrl: string | null; area: string }[];
  };
  const events = new Map<string, EventCard>();
  const onNowIds = new Set<string>();

  for (const row of rows) {
    const { shift } = row;
    const event = shift.shiftGroup.event;
    // A shift row's own window is not the person's working window: a full-day
    // default spans the whole day, and an early staff slot is not a call time.
    // Staff work the event's own hours; a Student's call time moves their start.
    // Without event times (older rows), the shift window stands in.
    const defaultWindow = isFullDayBoundaryWindow({ startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString() });
    const usesCall = shift.workerType === "ST" && !event.allDay && studentCallTimeAppliesToEvent(event);
    const callStart = usesCall ? (row.callStartsAt ?? shift.callStartsAt ?? (defaultWindow ? null : shift.startsAt)) : null;
    const ownHours = defaultWindow || !usesCall;
    const start = callStart ?? (ownHours ? (event.startsAt ?? shift.startsAt) : shift.startsAt);
    const end = event.endsAt ?? shift.endsAt;
    const live = start <= now && end >= now;
    if (end < now) continue;
    if (live) onNowIds.add(row.user.id);
    const key = shift.shiftGroup.id;
    let card = events.get(key);
    if (!card) {
      card = {
        id: key,
        summary: event.summary,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay: Boolean(event.allDay),
        when: "later",
        people: [],
      };
      events.set(key, card);
    }
    if (start.toISOString() < card.startsAt) card.startsAt = start.toISOString();
    if (end.toISOString() > card.endsAt) card.endsAt = end.toISOString();
    if (live) card.when = "now";
    else if (card.when !== "now" && start >= startOfTomorrow) card.when = "tomorrow";
    if (!card.people.some((p) => p.id === row.user.id)) {
      card.people.push({ id: row.user.id, name: row.user.name, avatarUrl: row.user.avatarUrl ?? null, area: shift.area });
    }
  }

  const data = [...events.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return ok({
    data: {
      onNowCount: onNowIds.size,
      events: data,
    },
  });
});
