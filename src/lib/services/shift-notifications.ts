import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { buildNotificationEmail } from "@/lib/email";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { formatAppDateTime, formatAppTime } from "@/lib/app-time";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";
import {
  categoryForScheduleNotificationType,
  scheduleNotificationPayload,
  scheduleMyShiftsNotificationPayload,
  shouldNotifyGearPrep,
  shouldNotifyWorkerForScheduleEvent,
  type GearPrepNotificationSource,
} from "@/lib/services/schedule-notification-policy";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { unique } from "@/lib/utils";
import { deferPush, sendPushToUser, sendEmailToUser } from "./notification-delivery";

/**
 * Creates a "Gear Up" notification for a student when they are assigned/approved for a shift.
 * Skips if a notification for this assignment already exists (deduped).
 */
export async function createShiftGearUpNotification(
  assignmentId: string,
  opts: { source?: GearPrepNotificationSource } = {},
): Promise<void> {
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      user: { select: { id: true, email: true, active: true } },
      shift: {
        include: {
          shiftGroup: {
            include: {
              event: {
                select: {
                  id: true,
                  summary: true,
                  startsAt: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  locationId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!assignment?.user.active) return;

  const event = assignment.shift.shiftGroup.event;
  const source = opts.source ?? "manual_nudge";
  if (!shouldNotifyGearPrep({ source, publishedAt: assignment.shift.shiftGroup.publishedAt })) return;
  // "Reserve your gear now" is wrong for someone who already has it: the
  // assignment came from their own reservation, or they already reserved or
  // checked out gear for this event. A staff nudge is a deliberate choice and
  // still goes out.
  if (source === "assignment" && (
    assignment.source === "RESERVATION"
    || await hasGearForEvent(assignment.userId, event.id, assignment.id)
  )) return;

  const dedupeKey = `shift:${assignmentId}:gear_up`;

  const existing = await db.notification.findUnique({ where: { dedupeKey } });
  if (existing) return;

  const shiftTime = formatAppDateTime(assignment.shift.startsAt);

  const title = "Gear up for your shift";
  const body = `You're on ${assignment.shift.area} at ${event.summary}, ${shiftTime}. Reserve your gear now.`;
  const pushBody = `${assignment.shift.area}, ${shiftTime}. Reserve your gear now.`;
  const pushPayload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    eventId: event.id,
  });

  try {
    const row = await db.notification.create({
      data: {
        userId: assignment.userId,
        type: "shift_gear_up",
        title,
        body,
        payload: {
          ...pushPayload,
          eventSummary: event.summary,
          area: assignment.shift.area,
          startsAt: assignment.shift.startsAt.toISOString(),
          sportCode: event.sportCode,
          locationId: event.locationId,
        },
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey,
      },
    });

    deferPush(sendPushToUser(assignment.userId, {
      title,
      subtitle: event.summary,
      body: pushBody,
      payload: pushPayload,
      category: categoryForScheduleNotificationType("shift_gear_up") ?? undefined,
      notificationId: row.id,
    }));

    // Also send email notification
    if (assignment.user.email) {
      await sendEmailToUser(assignment.userId, {
        to: assignment.user.email,
        subject: title,
        ...buildNotificationEmail({
          kind: "schedule",
          title,
          body,
          bookingTitle: event.summary,
          dueAt: assignment.shift.startsAt.toISOString(),
          href: `/events/${event.id}`,
        }),
      }, categoryForScheduleNotificationType("shift_gear_up") ?? undefined);
    }
  } catch (err) {
    console.error(`[NOTIFY] Failed to create shift gear-up notification for assignment ${assignmentId}:`, err);
  }
}

const ACTIVE_BOOKING_STATUSES = ["BOOKED", "PENDING_PICKUP", "OPEN"] as const;

async function hasGearForEvent(userId: string, eventId: string, assignmentId: string): Promise<boolean> {
  const booking = await db.booking.findFirst({
    where: {
      requesterUserId: userId,
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      OR: [
        { shiftAssignmentId: assignmentId },
        { events: { some: { eventId } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(booking);
}

type ShiftScheduleEvent =
  | "assigned"
  | "requested"
  | "approved"
  | "declined"
  | "removed"
  | "shift_time_changed"
  | "personal_call_time_changed";

function formatShiftNotifyTime(dt: Date): string {
  return formatAppDateTime(dt);
}

function shiftScheduleNotificationCopy(args: {
  event: ShiftScheduleEvent;
  eventTitle: string;
  area: string;
  workerType: string;
  callStartsAt: Date | null;
  callEndsAt: Date | null;
  callNote: string | null;
}) {
  const hasCallWindow = args.workerType === "ST" && args.callStartsAt && args.callEndsAt;
  const callWindow = hasCallWindow
    ? args.callStartsAt!.getTime() === args.callEndsAt!.getTime()
      ? formatShiftNotifyTime(args.callStartsAt!)
      : `${formatShiftNotifyTime(args.callStartsAt!)} - ${formatShiftNotifyTime(args.callEndsAt!)}`
    : null;
  const note = hasCallWindow && args.callNote ? ` ${args.callNote}` : "";
  const timing = callWindow ? ` Call time: ${callWindow}.` : "";

  // The recipient's own role ("Student") adds nothing; name the area only.
  const shift = args.area;

  // `body` is the self-contained inbox sentence; `pushBody` sits under the
  // event-name subtitle, so it leaves the event out.
  switch (args.event) {
    case "requested":
      // A request holds no shift. Saying anything warmer than "waiting" is how
      // someone treats a pending claim as a shift they have.
      return {
        type: "shift_request_pending",
        title: "Shift request sent",
        body: `Your request for the ${shift} shift at ${args.eventTitle} is waiting for Admin approval. You're not on the schedule until it's approved.${timing}${note}`,
        pushBody: `You're not on the ${shift} shift until an Admin approves.`,
      };
    case "approved":
      return {
        type: "shift_request_approved",
        title: "Shift request approved",
        body: `You're on the schedule for the ${shift} shift at ${args.eventTitle}.${timing}${note}`,
        pushBody: `You're on the ${shift} shift.${timing}${note}`,
      };
    case "declined":
      return {
        type: "shift_request_declined",
        title: "Shift request declined",
        body: `Your request for the ${shift} shift at ${args.eventTitle} was declined.`,
        pushBody: `You won't be on the ${shift} shift.`,
      };
    case "removed":
      return {
        type: "shift_assignment_removed",
        title: "Removed from a shift",
        body: `You're no longer on the ${shift} shift at ${args.eventTitle}.`,
        pushBody: `You're no longer on the ${shift} shift.`,
      };
    case "shift_time_changed":
      return {
        type: "shift_time_changed",
        title: "Call time changed",
        body: callWindow
          ? `Your call time for the ${shift} shift at ${args.eventTitle} is now ${callWindow}.${note}`
          : `The event time changed for your ${shift} shift at ${args.eventTitle}.${note}`,
        pushBody: callWindow ? `${shift}: now ${callWindow}.${note}` : `The event time changed for your ${shift} shift.`,
      };
    case "personal_call_time_changed":
      return {
        type: "shift_personal_call_time_changed",
        title: "Your call time changed",
        body: callWindow
          ? `Your call time for the ${shift} shift at ${args.eventTitle} is now ${callWindow}.${note}`
          : `Your ${shift} shift at ${args.eventTitle} was updated.`,
        pushBody: callWindow ? `${shift}: now ${callWindow}.${note}` : `Your ${shift} shift was updated.`,
      };
    default:
      return {
        type: "shift_assigned",
        title: "Shift assigned",
        body: `You're on the ${shift} shift at ${args.eventTitle}.${timing}${note}`,
        pushBody: `You're on the ${shift} shift.${timing}${note}`,
      };
  }
}

/**
 * Everything a schedule notification needs, detached from the assignment row.
 *
 * A removal caused by deleting the shift cannot look the assignment up
 * afterwards -- it cascades away with the shift -- so the caller captures this
 * before the delete and sends it after the transaction commits.
 */
export type ShiftScheduleNotificationSnapshot = {
  assignmentId: string;
  shiftId: string;
  userId: string;
  userEmail: string | null;
  userActive: boolean;
  publishedAt: Date | null;
  area: string;
  workerType: string;
  shiftStartsAt: Date;
  callStartsAt: Date | null;
  callEndsAt: Date | null;
  callNote: string | null;
  calendarEvent: {
    id: string;
    summary: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    sportCode: string | null;
    opponent: string | null;
    isHome: boolean | null;
    site: "HOME" | "AWAY" | "NEUTRAL" | null;
    locationId: string | null;
  };
};

type ShiftScheduleNotificationOptions = {
  /**
   * Who caused the change. When it's the worker themselves (linking their own
   * reservation or checkout to an event puts them on its crew), the row is a
   * read receipt with no push or email.
   */
  actorUserId?: string | null;
};

export async function createShiftScheduleNotification(
  assignmentId: string,
  event: ShiftScheduleEvent,
  opts: ShiftScheduleNotificationOptions = {},
): Promise<void> {
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      user: { select: { id: true, email: true, active: true } },
      shift: {
        include: {
          shiftGroup: {
            include: {
              event: {
                select: {
                  id: true,
                  summary: true,
                  startsAt: true,
                  endsAt: true,
                  allDay: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  site: true,
                  locationId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!assignment) return;

  return createShiftScheduleNotificationFromSnapshot({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    userId: assignment.userId,
    userEmail: assignment.user.email,
    userActive: assignment.user.active,
    publishedAt: assignment.shift.shiftGroup.publishedAt,
    area: assignment.shift.area,
    workerType: assignment.shift.workerType,
    shiftStartsAt: assignment.shift.startsAt,
    callStartsAt: assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt,
    callEndsAt: assignment.callEndsAt ?? assignment.shift.callEndsAt ?? assignment.shift.endsAt,
    callNote: assignment.callNote,
    calendarEvent: assignment.shift.shiftGroup.event,
  }, event, opts);
}

export async function createShiftScheduleNotificationFromSnapshot(
  assignment: ShiftScheduleNotificationSnapshot,
  event: ShiftScheduleEvent,
  opts: ShiftScheduleNotificationOptions = {},
): Promise<void> {
  const assignmentId = assignment.assignmentId;
  const selfMade = Boolean(opts.actorUserId) && opts.actorUserId === assignment.userId;
  if (!assignment.userActive) return;
  if (!shouldNotifyWorkerForScheduleEvent({
    event,
    publishedAt: assignment.publishedAt,
  })) return;

  const calendarEvent = assignment.calendarEvent;
  if (event === "assigned" || event === "approved") {
    await enqueueShiftReminders([{
      assignmentId,
      callStartsAt: assignment.callStartsAt ?? assignment.shiftStartsAt,
    }]);
  }
  // The full event name, never a bare "vs Iowa" that loses the sport.
  const eventTitle = calendarEvent.summary;
  const hasStudentCallTime = assignment.workerType === "ST"
    && !calendarEvent.allDay
    && studentCallTimeAppliesToEvent(calendarEvent);
  const callStartsAt = hasStudentCallTime ? assignment.callStartsAt : null;
  const callEndsAt = hasStudentCallTime ? assignment.callEndsAt : null;
  const copy = shiftScheduleNotificationCopy({
    event,
    eventTitle,
    area: assignment.area,
    workerType: assignment.workerType,
    callStartsAt,
    callEndsAt,
    callNote: assignment.callNote,
  });
  const dedupeKey = `shift:${assignmentId}:${copy.type}:${callStartsAt?.toISOString() ?? ""}:${callEndsAt?.toISOString() ?? ""}:${hasStudentCallTime ? assignment.callNote ?? "" : ""}`;
  const pushPayload = scheduleNotificationPayload({
    assignmentId: assignment.assignmentId,
    shiftId: assignment.shiftId,
    eventId: calendarEvent.id,
  });
  const category = categoryForScheduleNotificationType(copy.type) ?? undefined;

  const existing = await db.notification.findUnique({ where: { dedupeKey } });
  if (existing) return;

  try {
    const now = new Date();
    const row = await db.notification.create({
      data: {
        userId: assignment.userId,
        type: copy.type,
        title: copy.title,
        body: copy.body,
        payload: {
          ...pushPayload,
          eventSummary: calendarEvent.summary,
          area: assignment.area,
          workerType: shiftWorkerLabel(assignment.workerType),
          startsAt: callStartsAt?.toISOString() ?? (assignment.workerType === "ST" ? calendarEvent.startsAt.toISOString() : assignment.shiftStartsAt.toISOString()),
          ...(callStartsAt && callEndsAt ? {
            callStartsAt: callStartsAt.toISOString(),
            callEndsAt: callEndsAt.toISOString(),
          } : {}),
          sportCode: calendarEvent.sportCode,
          locationId: calendarEvent.locationId,
        },
        channel: "IN_APP",
        sentAt: now,
        readAt: selfMade ? now : null,
        dedupeKey,
      },
    });
    if (selfMade) return;

    deferPush(sendPushToUser(assignment.userId, {
      title: copy.title,
      subtitle: calendarEvent.summary,
      body: copy.pushBody,
      payload: pushPayload,
      category,
      notificationId: row.id,
    }));

    if (assignment.userEmail) {
      await sendEmailToUser(assignment.userId, {
        to: assignment.userEmail,
        subject: copy.title,
        ...buildNotificationEmail({
          kind: "schedule",
          title: copy.title,
          body: copy.body,
          bookingTitle: calendarEvent.summary,
          dueAt: callStartsAt?.toISOString(),
          href: `/events/${calendarEvent.id}`,
        }),
      }, category);
    }
  } catch (err) {
    console.error(`[NOTIFY] Failed to create shift schedule notification for assignment ${assignmentId}:`, err);
  }
}

export async function dispatchScheduleAssignmentNotifications(
  assignmentId: string,
  event: ShiftScheduleEvent,
  opts: ShiftScheduleNotificationOptions = {},
): Promise<void> {
  await Promise.allSettled([
    // A pending request holds no slot, so telling the student to prep gear for
    // it would be telling them to prep for a shift they may not get. The nudge
    // waits for the approval, which dispatches "approved" and fires it then.
    ...(event === "requested" || event === "declined"
      ? []
      : [createShiftGearUpNotification(assignmentId, { source: "assignment" })]),
    createShiftScheduleNotification(assignmentId, event, opts),
  ]);
}

/**
 * Tell admins a student is waiting on a decision for an open slot. Runs after
 * the request commits; the per-reviewer dedupe key makes a retry idempotent.
 */
export async function notifyPickupRequestReviewers(assignmentId: string): Promise<void> {
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      shiftId: true,
      user: { select: { name: true } },
      shift: {
        select: {
          area: true,
          shiftGroup: {
            select: { publishedAt: true, event: { select: { id: true, summary: true } } },
          },
        },
      },
    },
  });
  if (!assignment?.shift.shiftGroup.publishedAt) return;

  const reviewers = await db.user.findMany({
    where: visibleActiveUserWhere({ role: "ADMIN" }),
    select: { id: true },
  });
  if (reviewers.length === 0) return;

  const eventSummary = assignment.shift.shiftGroup.event.summary;
  const title = "Shift request needs review";
  const body = `${assignment.user.name} requested the ${assignment.shift.area} shift at ${eventSummary}.`;
  const pushBody = `${assignment.user.name} wants the ${assignment.shift.area} shift.`;
  const payload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shiftId,
    eventId: assignment.shift.shiftGroup.event.id,
  });
  const category = categoryForScheduleNotificationType("shift_request_review") ?? undefined;
  const now = new Date();

  try {
    // Only reviewers whose row is new get a push, so a retry stays silent.
    const created = await db.notification.createManyAndReturn({
      data: reviewers.map((reviewer) => ({
        userId: reviewer.id,
        type: "shift_request_review",
        title,
        body,
        payload: JSON.parse(JSON.stringify(payload)),
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `shift_request_review_${assignment.id}_${reviewer.id}`,
      })),
      skipDuplicates: true,
      select: { id: true, userId: true },
    });

    for (const row of created) {
      deferPush(sendPushToUser(row.userId, {
        title,
        subtitle: eventSummary,
        body: pushBody,
        payload,
        category,
        notificationId: row.id,
      }));
    }
  } catch (err) {
    console.error(`[NOTIFY] Failed to notify reviewers for shift request ${assignmentId}:`, err);
  }
}

type PublishedShiftGroup = {
  event: Parameters<typeof studentCallTimeAppliesToEvent>[0] & { allDay: boolean };
  shifts: Array<{
    workerType: string;
    startsAt: Date;
    callStartsAt: Date | null;
    assignments: Array<{ id: string; userId: string; callStartsAt: Date | null }>;
  }>;
};

/** When an assignment's worker needs to be there: their call, the shift's call, else the start. */
function assignmentCallStart(
  shift: PublishedShiftGroup["shifts"][number],
  assignment: PublishedShiftGroup["shifts"][number]["assignments"][number],
): Date {
  return assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt;
}

function shiftReminderRows(shifts: PublishedShiftGroup["shifts"]) {
  return shifts.flatMap((shift) => shift.assignments.map((assignment) => ({
    assignmentId: assignment.id,
    callStartsAt: assignmentCallStart(shift, assignment),
  })));
}

/**
 * Each worker's shift count in a published group, plus their earliest call
 * time when it is a student shift at a non-all-day home or non-game event.
 */
function summarizeWorkerShifts(group: PublishedShiftGroup): Map<string, { count: number; studentCallStartsAt: Date | null }> {
  const showsStudentCall = !group.event.allDay && studentCallTimeAppliesToEvent(group.event);
  const byUser = new Map<string, { count: number; studentCallStartsAt: Date | null }>();
  for (const shift of group.shifts) for (const assignment of shift.assignments) {
    const current = byUser.get(assignment.userId);
    let studentCallStartsAt = current?.studentCallStartsAt ?? null;
    if (shift.workerType === "ST" && showsStudentCall) {
      const callStart = assignmentCallStart(shift, assignment);
      if (!studentCallStartsAt || callStart < studentCallStartsAt) studentCallStartsAt = callStart;
    }
    byUser.set(assignment.userId, { count: (current?.count ?? 0) + 1, studentCallStartsAt });
  }
  return byUser;
}

/** Creates an in-app row, or returns null when this dedupe key already has one. */
async function createNotificationOnce(
  data: Omit<Prisma.NotificationUncheckedCreateInput, "channel" | "sentAt">,
): Promise<string | null> {
  try {
    const row = await db.notification.create({
      data: { ...data, channel: "IN_APP", sentAt: new Date() },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) return null;
    throw error;
  }
}

export async function createPublishedShiftGroupNotifications(shiftGroupId: string): Promise<void> {
  const group = await db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: {
      publishedAt: true,
      publishedVersion: true,
      event: {
        select: {
          id: true,
          summary: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          sportCode: true,
          opponent: true,
          isHome: true,
          site: true,
        },
      },
      shifts: {
        select: {
          workerType: true,
          startsAt: true,
          callStartsAt: true,
          assignments: {
            where: {
              status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
              user: { active: true },
            },
            select: {
              id: true,
              userId: true,
              callStartsAt: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  });

  if (!group?.publishedAt) return;
  await enqueueShiftReminders(shiftReminderRows(group.shifts));
  const emailByUser = new Map(group.shifts.flatMap((shift) => shift.assignments.map((assignment) => [assignment.userId, assignment.user.email] as const)));
  const assignmentsByUser = summarizeWorkerShifts(group);

  const title = "Schedule ready";
  const payload = scheduleNotificationPayload({ eventId: group.event.id });

  await Promise.allSettled(
    [...assignmentsByUser.entries()].map(async ([userId, assignment]) => {
      const shiftLabel = assignment.count === 1 ? "shift" : "shifts";
      const callCopy = assignment.studentCallStartsAt
        ? ` Call time: ${formatShiftNotifyTime(assignment.studentCallStartsAt)}.`
        : "";
      const body = `You're on ${assignment.count} ${shiftLabel} at ${group.event.summary}.${callCopy}`;
      const pushBody = `You're on ${assignment.count} ${shiftLabel}.${callCopy}`;
      const dedupeKey = `shift_group_publish:${shiftGroupId}:v${group.publishedVersion}:${userId}`;
      const notificationId = await createNotificationOnce({
        userId,
        type: "shift_schedule_published",
        title,
        body,
        payload,
        dedupeKey,
      });
      if (!notificationId) return;

      deferPush(sendPushToUser(userId, {
        title,
        subtitle: group.event.summary,
        body: pushBody,
        payload,
        category: "schedule",
        notificationId,
      }));
      const email = emailByUser.get(userId);
      if (email) {
        await sendEmailToUser(userId, {
          to: email,
          subject: title,
          ...buildNotificationEmail({
            kind: "schedule",
            title,
            body,
            bookingTitle: group.event.summary,
            dueAt: assignment.studentCallStartsAt?.toISOString(),
            href: `/events/${group.event.id}`,
          }),
        }, "schedule");
      }
    }),
  );
}

type BulkAssignmentProposalRecord = { shiftId: string; userId: string };

function parseBulkAssignmentProposals(value: unknown): BulkAssignmentProposalRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const proposal = item as { shiftId?: unknown; userId?: unknown };
    return typeof proposal.shiftId === "string" && typeof proposal.userId === "string"
      ? [{ shiftId: proposal.shiftId, userId: proposal.userId }]
      : [];
  });
}

/**
 * A bulk release publishes many event schedules at once. Keep the worker
 * experience to one inbox row, one push, and one email for the whole batch.
 */
export async function createBulkScheduleAssignmentNotifications(batchId: string): Promise<void> {
  const batch = await db.scheduleBulkAssignment.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      sportCode: true,
      rangeStartsAt: true,
      rangeEndsAt: true,
      items: {
        where: { status: "RELEASED" },
        select: { shiftGroupId: true, proposalPayload: true },
      },
    },
  });
  if (!batch) return;

  const pairs = batch.items.flatMap((item) => parseBulkAssignmentProposals(item.proposalPayload).map((proposal) => ({
    ...proposal,
    shiftGroupId: item.shiftGroupId,
  })));
  const uniquePairs = [...new Map(pairs.map((pair) => [`${pair.shiftId}:${pair.userId}`, pair])).values()];
  if (uniquePairs.length === 0) return;

  const assignments = await db.shiftAssignment.findMany({
    where: {
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      OR: uniquePairs.map(({ shiftId, userId }) => ({ shiftId, userId })),
    },
    select: {
      shiftId: true,
      userId: true,
      user: { select: { email: true } },
      shift: { select: { shiftGroupId: true } },
    },
  });

  const byUser = new Map<string, { email: string | null; shiftIds: Set<string>; eventIds: Set<string> }>();
  for (const assignment of assignments) {
    const current = byUser.get(assignment.userId) ?? {
      email: assignment.user.email,
      shiftIds: new Set<string>(),
      eventIds: new Set<string>(),
    };
    current.shiftIds.add(assignment.shiftId);
    current.eventIds.add(assignment.shift.shiftGroupId);
    byUser.set(assignment.userId, current);
  }

  const body = "Tap to see them.";
  await Promise.allSettled([...byUser.entries()].map(async ([userId, assignment]) => {
    const count = assignment.shiftIds.size;
    const title = `You have ${count} new ${count === 1 ? "shift" : "shifts"}`;
    const payload = scheduleMyShiftsNotificationPayload({
      rangeStartsAt: batch.rangeStartsAt,
      rangeEndsAt: batch.rangeEndsAt,
      sportCode: batch.sportCode,
      extra: {
        bulkAssignmentId: batch.id,
        shiftCount: count,
        eventCount: assignment.eventIds.size,
      },
    });
    const dedupeKey = `schedule_bulk_assignment:${batch.id}:${userId}`;
    const notificationId = await createNotificationOnce({
      userId,
      type: "shift_schedule_bulk_assigned",
      title,
      body,
      payload,
      dedupeKey,
    });
    if (!notificationId) return;

    deferPush(sendPushToUser(userId, { title, body, payload, category: "schedule", notificationId }));
    if (assignment.email) {
      await sendEmailToUser(userId, {
        to: assignment.email,
        subject: title,
        ...buildNotificationEmail({
          kind: "schedule",
          title,
          body,
          bookingTitle: batch.sportCode ? `${batch.sportCode} schedule` : "Upcoming shifts",
          href: payload.href,
        }),
      }, "schedule");
    }
  }));
}

export async function notifyPublishedShiftGroupWorkers(
  shiftGroupId: string,
  userIds: string[],
): Promise<void> {
  const uniqueUserIds = unique(userIds);
  if (uniqueUserIds.length === 0) return;
  const [group, users] = await Promise.all([
    db.shiftGroup.findUnique({
      where: { id: shiftGroupId },
      select: {
        publishedAt: true,
        publishedVersion: true,
        event: {
          select: {
            id: true,
            summary: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            sportCode: true,
            opponent: true,
            isHome: true,
            site: true,
          },
        },
        shifts: {
          select: {
            workerType: true,
            startsAt: true,
            callStartsAt: true,
            assignments: {
              where: {
                userId: { in: uniqueUserIds },
                status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
              },
              select: { id: true, userId: true, callStartsAt: true },
            },
          },
        },
      },
    }),
    db.user.findMany({
      where: { id: { in: uniqueUserIds }, active: true },
      select: { id: true, email: true },
    }),
  ]);
  if (!group?.publishedAt) return;
  // A changed schedule re-keys each affected worker's reminder to the new
  // call time; the run for the old time finds itself superseded.
  await enqueueShiftReminders(shiftReminderRows(group.shifts));

  const assignmentsByUser = summarizeWorkerShifts(group);
  const title = "Schedule updated";
  const payload = scheduleNotificationPayload({ eventId: group.event.id });

  await Promise.allSettled(users.map(async (user) => {
    const assignment = assignmentsByUser.get(user.id);
    const count = assignment?.count ?? 0;
    const shiftCount = `${count} ${count === 1 ? "shift" : "shifts"}`;
    const callCopy = assignment?.studentCallStartsAt
      ? ` Call time: ${formatShiftNotifyTime(assignment.studentCallStartsAt)}.`
      : "";
    const body = count === 0
      ? `You're no longer on the schedule for ${group.event.summary}.`
      : `Your schedule for ${group.event.summary} changed. You now have ${shiftCount}.${callCopy}`;
    const pushBody = count === 0
      ? "You're no longer on the schedule."
      : `You now have ${shiftCount}.${callCopy}`;
    const dedupeKey = `shift_group_update:${shiftGroupId}:v${group.publishedVersion}:${user.id}`;
    const notificationId = await createNotificationOnce({
      userId: user.id,
      type: "shift_schedule_updated",
      title,
      body,
      payload,
      dedupeKey,
    });
    if (!notificationId) return;

    deferPush(sendPushToUser(user.id, {
      title,
      subtitle: group.event.summary,
      body: pushBody,
      payload,
      category: "schedule",
      notificationId,
    }));
    if (user.email) {
      await sendEmailToUser(user.id, {
        to: user.email,
        subject: title,
        ...buildNotificationEmail({
          kind: "schedule",
          title,
          body,
          bookingTitle: group.event.summary,
          dueAt: assignment?.studentCallStartsAt?.toISOString(),
          href: `/events/${group.event.id}`,
        }),
      }, "schedule");
    }
  }));
}

export async function notifyPublishedScheduleFollowers(shiftGroupId: string): Promise<void> {
  const group = await db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: {
      publishedAt: true,
      publishedVersion: true,
      event: {
        select: {
          id: true,
          summary: true,
          startsAt: true,
          follows: {
            where: {
              mutedAt: null,
              user: {
                active: true,
                role: "COLLABORATOR",
                collaboratorPolicy: {
                  is: {
                    status: "ACTIVE",
                    grants: { some: { capabilityKey: "PUBLISHED_SCHEDULE_VIEW" } },
                  },
                },
              },
            },
            select: {
              user: { select: { id: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!group?.publishedAt || group.event.follows.length === 0) return;

  const title = "Crew schedule updated";
  const body = `The crew schedule for ${group.event.summary} changed.`;
  const pushBody = "Tap to see who's working.";
  const payload = { eventId: group.event.id };

  await Promise.allSettled(group.event.follows.map(async ({ user }) => {
    const dedupeKey = `published_schedule:${group.event.id}:v${group.publishedVersion}:${user.id}`;
    const notificationId = await createNotificationOnce({
      userId: user.id,
      type: "published_schedule_updated",
      title,
      body,
      payload,
      dedupeKey,
    });
    if (!notificationId) return;

    deferPush(sendPushToUser(user.id, {
      title,
      subtitle: group.event.summary,
      body: pushBody,
      payload,
      category: "schedule",
      notificationId,
    }));
    if (user.email) {
      await sendEmailToUser(user.id, {
        to: user.email,
        subject: title,
        ...buildNotificationEmail({
          kind: "schedule",
          title,
          body,
          bookingTitle: group.event.summary,
          href: `/events/${group.event.id}`,
        }),
      }, "schedule");
    }
  }));
}

// ── Shift reminders ─────────────────────────────────────────────────────────

/** How long before the effective call time a worker is reminded. */
export const SHIFT_REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

type ShiftReminderAssignment = {
  id: string;
  userId: string;
  status: string;
  callStartsAt: Date | null;
  user: { active: boolean };
  shift: {
    id: string;
    area: string;
    workerType: string;
    startsAt: Date;
    callStartsAt: Date | null;
    shiftGroup: {
      publishedAt: Date | null;
      event: { id: string; summary: string; startsAt: Date; allDay: boolean; status: string };
    };
  };
};

async function loadShiftReminderAssignment(assignmentId: string): Promise<ShiftReminderAssignment | null> {
  return db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      callStartsAt: true,
      user: { select: { active: true } },
      shift: {
        select: {
          id: true,
          area: true,
          workerType: true,
          startsAt: true,
          callStartsAt: true,
          shiftGroup: {
            select: {
              publishedAt: true,
              event: { select: { id: true, summary: true, startsAt: true, allDay: true, status: true } },
            },
          },
        },
      },
    },
  }) as Promise<ShiftReminderAssignment | null>;
}

/** When the worker actually needs to be there: their call time, else the shift start. */
function effectiveShiftCallStart(assignment: {
  callStartsAt: Date | null;
  shift: { callStartsAt: Date | null; startsAt: Date };
}): Date {
  return assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt;
}

type ShiftReminderState =
  | { status: "scheduled"; remindAt: string }
  | { status: "superseded" | "inactive" | "passed" };

/**
 * Whether the reminder for this exact call time is still wanted, and when.
 * A run keyed to an older call time is superseded: a newer run owns it.
 */
export async function getShiftReminderTiming(args: {
  assignmentId: string;
  expectedCallStartsAt: Date;
  now?: Date;
}): Promise<ShiftReminderState> {
  const assignment = await loadShiftReminderAssignment(args.assignmentId);
  if (!assignment || !assignment.user.active) return { status: "inactive" };
  if (!(ACTIVE_ASSIGNMENT_STATUSES as string[]).includes(assignment.status)) {
    return { status: "inactive" };
  }
  const group = assignment.shift.shiftGroup;
  if (!group.publishedAt || group.event.allDay || group.event.status === "CANCELLED") return { status: "inactive" };
  const callStart = effectiveShiftCallStart(assignment);
  if (callStart.getTime() !== args.expectedCallStartsAt.getTime()) return { status: "superseded" };
  const now = args.now ?? new Date();
  if (callStart.getTime() <= now.getTime()) return { status: "passed" };
  return { status: "scheduled", remindAt: new Date(callStart.getTime() - SHIFT_REMINDER_LEAD_MS).toISOString() };
}

/** Sends the reminder if the shift still matches; idempotent per call time. */
export async function sendShiftReminder(args: {
  assignmentId: string;
  expectedCallStartsAt: Date;
  now?: Date;
}): Promise<"sent" | "duplicate" | ShiftReminderState["status"]> {
  const timing = await getShiftReminderTiming(args);
  if (timing.status !== "scheduled") return timing.status;
  const assignment = (await loadShiftReminderAssignment(args.assignmentId))!;
  const event = assignment.shift.shiftGroup.event;
  const callStart = effectiveShiftCallStart(assignment);
  const isStudent = assignment.shift.workerType === "ST";
  const time = formatAppTime(callStart);

  const title = "Shift in 2 hours";
  const pushBody = isStudent
    ? `You're on ${assignment.shift.area}. Call time ${time}.`
    : `You're on ${assignment.shift.area}. Starts ${time}.`;
  const body = isStudent
    ? `You're on the ${assignment.shift.area} shift at ${event.summary}. Call time ${time}.`
    : `You're on the ${assignment.shift.area} shift at ${event.summary}. Starts ${time}.`;
  const payload = scheduleNotificationPayload({
    assignmentId: assignment.id,
    shiftId: assignment.shift.id,
    eventId: event.id,
  });

  const [row] = await db.notification.createManyAndReturn({
    data: [{
      userId: assignment.userId,
      type: "shift_reminder",
      title,
      body,
      payload: JSON.parse(JSON.stringify(payload)),
      channel: "IN_APP",
      sentAt: args.now ?? new Date(),
      dedupeKey: `shift_reminder:${assignment.id}:${callStart.toISOString()}`,
    }],
    skipDuplicates: true,
    select: { id: true },
  });
  if (!row) return "duplicate";

  await sendPushToUser(assignment.userId, {
    title,
    subtitle: event.summary,
    body: pushBody,
    payload,
    category: "shiftReminder",
    notificationId: row.id,
  });
  return "sent";
}

/**
 * Starts reminder runs; loaded lazily because the workflow module imports this
 * one. Best-effort and never throws.
 */
async function enqueueShiftReminders(rows: Array<{ assignmentId: string; callStartsAt: Date }>): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { enqueueShiftReminder } = await import("@/lib/shift-reminder-workflow");
    await Promise.allSettled(rows.map((row) => enqueueShiftReminder(row)));
  } catch (error) {
    console.error("[Schedule] failed to enqueue shift reminders", error);
  }
}
