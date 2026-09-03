import { Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { SchedulePublicationSnapshot } from "@/lib/schedule-publication-types";
import { createAuditEntryTx } from "@/lib/audit";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";

const publishedScheduleSelect = {
  id: true,
  lastPublishedSnapshot: true,
  event: {
    select: {
      id: true,
      summary: true,
      subtitle: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      sportCode: true,
      opponent: true,
      isHome: true,
      site: true,
      location: { select: { id: true, name: true } },
      follows: {
        select: { mutedAt: true },
      },
    },
  },
} satisfies Prisma.ShiftGroupSelect;

type PublishedGroup = Prisma.ShiftGroupGetPayload<{ select: typeof publishedScheduleSelect }>;

function readSnapshot(value: Prisma.JsonValue | null): SchedulePublicationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(404, "Published schedule not found");
  }
  const snapshot = value as { shifts?: unknown };
  if (!Array.isArray(snapshot.shifts)) {
    throw new HttpError(404, "Published schedule not found");
  }
  return value as SchedulePublicationSnapshot;
}

function publishedScheduleWhere(eventId?: string, upcomingOnly = false): Prisma.ShiftGroupWhereInput {
  return {
    publishedAt: { not: null },
    archivedAt: null,
    lastPublishedSnapshot: { not: Prisma.JsonNull },
    event: {
      id: eventId,
      endsAt: upcomingOnly ? { gte: new Date() } : undefined,
      isHidden: false,
      archivedAt: null,
    },
  };
}

async function hydratePublishedGroups(groups: PublishedGroup[]) {
  const snapshots = groups.map((group) => readSnapshot(group.lastPublishedSnapshot));
  const userIds = [...new Set(
    snapshots.flatMap((snapshot) =>
      snapshot.shifts.flatMap((shift) => shift.assignments.map((assignment) => assignment.userId)),
    ),
  )];
  const users = userIds.length > 0
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          title: true,
          role: true,
          affiliation: true,
        },
      })
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  return groups.map((group, index) => {
    const snapshot = snapshots[index]!;
    return {
      id: group.event.id,
      event: {
        id: group.event.id,
        summary: group.event.summary,
        subtitle: group.event.subtitle,
        startsAt: group.event.startsAt,
        endsAt: group.event.endsAt,
        allDay: group.event.allDay,
        sportCode: group.event.sportCode,
        opponent: group.event.opponent,
        isHome: group.event.isHome,
        site: group.event.site,
        venue: group.event.location,
      },
      crew: snapshot.shifts.flatMap((shift) =>
        shift.assignments.flatMap((assignment) => {
          const person = userById.get(assignment.userId);
          if (!person) return [];
          return [{
            assignmentId: assignment.id,
            shiftId: shift.shiftId,
            person,
            area: shift.area,
            role: shift.workerType,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            // An all-day event has no call time. Without this the fallback
            // reaches the event's own UTC-midnight boundary and published crew
            // reads "Call 7:00 PM - 7:00 PM" on both web and iOS.
            callStartsAt: shift.workerType === "ST"
              && !group.event.allDay
              && studentCallTimeAppliesToEvent(group.event)
              ? assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt
              : null,
            callEndsAt: shift.workerType === "ST"
              && !group.event.allDay
              && studentCallTimeAppliesToEvent(group.event)
              ? assignment.callEndsAt ?? shift.callEndsAt ?? shift.endsAt
              : null,
          }];
        }),
      ),
      isFollowing: group.event.follows.some((follow) => follow.mutedAt === null),
    };
  });
}

export async function listPublishedSchedule(args: { userId: string; limit: number; offset: number }) {
  const where = publishedScheduleWhere(undefined, true);
  const select = {
    ...publishedScheduleSelect,
    event: {
      ...publishedScheduleSelect.event,
      select: {
        ...publishedScheduleSelect.event.select,
        follows: {
          where: { userId: args.userId },
          select: { mutedAt: true },
        },
      },
    },
  } satisfies Prisma.ShiftGroupSelect;
  const [groups, total] = await Promise.all([
    db.shiftGroup.findMany({
      where,
      select,
      orderBy: { event: { startsAt: "asc" } },
      take: args.limit,
      skip: args.offset,
    }),
    db.shiftGroup.count({ where }),
  ]);
  return { data: await hydratePublishedGroups(groups), total, limit: args.limit, offset: args.offset };
}

export async function getPublishedScheduleEvent(eventId: string, userId: string) {
  const group = await db.shiftGroup.findFirst({
    where: publishedScheduleWhere(eventId),
    select: {
      ...publishedScheduleSelect,
      event: {
        ...publishedScheduleSelect.event,
        select: {
          ...publishedScheduleSelect.event.select,
          follows: {
            where: { userId },
            select: { mutedAt: true },
          },
        },
      },
    },
  });
  if (!group) throw new HttpError(404, "Published schedule not found");
  return (await hydratePublishedGroups([group]))[0];
}

export async function setPublishedScheduleFollow(args: {
  eventId: string;
  userId: string;
  actorRole: Role;
  following: boolean;
}) {
  return db.$transaction(async (tx) => {
    const visibleGroup = await tx.shiftGroup.findFirst({
      where: publishedScheduleWhere(args.eventId),
      select: { id: true },
    });
    if (!visibleGroup) throw new HttpError(404, "Published schedule not found");

    const existing = await tx.scheduleEventFollow.findUnique({
      where: { userId_eventId: { userId: args.userId, eventId: args.eventId } },
      select: { mutedAt: true },
    });
    const alreadyMatches = existing
      ? args.following ? existing.mutedAt === null : existing.mutedAt !== null
      : false;
    if (alreadyMatches) {
      return { eventId: args.eventId, isFollowing: args.following, changed: false };
    }

    const follow = await tx.scheduleEventFollow.upsert({
      where: { userId_eventId: { userId: args.userId, eventId: args.eventId } },
      create: {
        userId: args.userId,
        eventId: args.eventId,
        source: "MANUAL",
        mutedAt: args.following ? null : new Date(),
      },
      update: {
        source: "MANUAL",
        mutedAt: args.following ? null : new Date(),
      },
      select: { mutedAt: true },
    });
    await createAuditEntryTx(tx, {
      actorId: args.userId,
      actorRole: args.actorRole,
      entityType: "calendar_event",
      entityId: args.eventId,
      action: args.following ? "followed" : "unfollowed",
    });
    return { eventId: args.eventId, isFollowing: follow.mutedAt === null, changed: true };
  });
}
