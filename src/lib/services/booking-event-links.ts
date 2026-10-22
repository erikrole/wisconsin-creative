import { BookingCustodyScope, BookingKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { bookingInclude } from "./bookings-helpers";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";
import { dispatchScheduleAssignmentNotifications } from "@/lib/services/notifications";
import {
  reconcileReservationScheduleTx,
  type ReservationScheduleAssignment,
} from "@/lib/services/reservation-schedule";
import { assertBookingSnapshot } from "@/lib/booking-concurrency";
import {
  EVENT_LINK_STATUSES,
  assertValidEventLinks,
  handleBookingMutationRace,
  eventLinkWhereForActor,
} from "./bookings-lifecycle-shared";

export async function updateBookingEvents(
  bookingId: string,
  actorUserId: string,
  eventIds: string[],
  expectedUpdatedAt?: Date,
) {
  assertValidEventLinks(eventIds);
  const scheduleNotificationAssignmentIds: string[] = [];

  try {
    const updated = await db.$transaction(
      async (tx) => {
        await updateBookingEventsTx(tx, {
          bookingId,
          actorUserId,
          eventIds,
          expectedUpdatedAt,
          scheduleNotificationAssignmentIds,
        });
        return tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: bookingInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    for (const assignmentId of scheduleNotificationAssignmentIds) {
      await dispatchScheduleAssignmentNotifications(assignmentId, "assigned", { actorUserId });
    }
    return updated;
  } catch (error) {
    handleBookingMutationRace(error);
  }
}

/**
 * The event-link write of `updateBookingEvents` inside a caller's SERIALIZABLE
 * transaction, so a title/time edit and the link commit together (kiosk
 * pickup details). Schedule assignments it creates are pushed onto
 * `scheduleNotificationAssignmentIds`; the caller notifies after commit.
 */
export async function updateBookingEventsTx(
  tx: Prisma.TransactionClient,
  args: {
    bookingId: string;
    actorUserId: string;
    eventIds: string[];
    expectedUpdatedAt?: Date;
    scheduleNotificationAssignmentIds: string[];
  },
) {
  const { bookingId, actorUserId, eventIds, expectedUpdatedAt, scheduleNotificationAssignmentIds } = args;
  assertValidEventLinks(eventIds);
        const actor = await tx.user.findUnique({
          where: { id: actorUserId },
          select: {
            role: true,
            collaboratorProfile: true,
            collaboratorPolicy: { select: collaboratorPolicyActorSelect },
          },
        });
        if (!actor) {
          throw new HttpError(403, "Forbidden");
        }

        const existing = await tx.booking.findUnique({
          where: { id: bookingId },
          select: {
            id: true,
            kind: true,
            status: true,
            updatedAt: true,
            eventId: true,
            requesterUserId: true,
            shiftAssignmentId: true,
            custodyScope: true,
            requester: {
              select: {
                role: true,
                staffingType: true,
                primaryArea: true,
                areaAssignments: {
                  select: {
                    area: true,
                    isPrimary: true,
                  },
                },
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
            },
            events: {
              select: { eventId: true },
              orderBy: { ordinal: "asc" },
            },
          },
        });

        if (!existing) {
          throw new HttpError(404, "Booking not found");
        }

        assertBookingSnapshot(existing.updatedAt, expectedUpdatedAt);

        if (!EVENT_LINK_STATUSES.has(existing.status)) {
          throw new HttpError(400, "Cannot update linked events for a completed or cancelled booking");
        }

        let sortedEventIds: string[] = [];
        if (eventIds.length > 0) {
          const events = await tx.calendarEvent.findMany({
            where: eventLinkWhereForActor(eventIds, actor),
            select: { id: true, startsAt: true },
          });
          if (events.length !== eventIds.length) {
            throw new HttpError(400, "One or more eventIds do not exist");
          }
          sortedEventIds = [...events]
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
            .map((event) => event.id);
        }

        const existingEventIds = existing.events.length > 0
          ? existing.events.map((event) => event.eventId)
          : existing.eventId ? [existing.eventId] : [];
        const primaryEventId = sortedEventIds[0] ?? null;
        const unchanged =
          existing.eventId === primaryEventId &&
          existingEventIds.length === sortedEventIds.length &&
          existingEventIds.every((eventId, index) => eventId === sortedEventIds[index]);

        if (!unchanged) {
          await tx.booking.update({
            where: { id: bookingId },
            data: { eventId: primaryEventId },
          });

          await tx.bookingEvent.deleteMany({ where: { bookingId } });

          if (sortedEventIds.length > 0) {
            await tx.bookingEvent.createMany({
              data: sortedEventIds.map((eventId, ordinal) => ({
                bookingId,
                eventId,
                ordinal,
              })),
            });
          }

          await createAuditEntryTx(tx, {
            actorId: actorUserId,
            actorRole: actor.role,
            entityType: "booking",
            entityId: bookingId,
            action: "events_updated",
            before: {
              eventId: existing.eventId,
              eventIds: existingEventIds,
            },
            after: {
              eventId: primaryEventId,
              eventIds: sortedEventIds,
            },
          });
        }

        let reservationScheduleAssignment: ReservationScheduleAssignment | null = null;
        if (
          existing.kind === BookingKind.RESERVATION
          && existing.custodyScope === BookingCustodyScope.PERSON
          && existing.requesterUserId
          && existing.requester
        ) {
          const scheduleOutcome = await reconcileReservationScheduleTx(tx, {
            bookingId,
            requesterUserId: existing.requesterUserId,
            requester: existing.requester,
            primaryEventId,
            currentAssignmentId: existing.shiftAssignmentId,
            createdBy: actorUserId,
          });
          reservationScheduleAssignment = scheduleOutcome.assignment;
          if (reservationScheduleAssignment?.created) {
            scheduleNotificationAssignmentIds.push(reservationScheduleAssignment.shiftAssignmentId);
          }
          if (scheduleOutcome.releasedAssignmentId) {
            await createAuditEntryTx(tx, {
              actorId: actorUserId,
              actorRole: actor.role,
              entityType: "shift_assignment",
              entityId: scheduleOutcome.releasedAssignmentId,
              action: "shift_assignment_removed",
              before: {
                source: "event_gear_reservation",
                bookingId,
              },
              after: {
                reason: "booking_events_updated",
              },
            });
          }
          if (scheduleOutcome.status === "needs_review" || scheduleOutcome.status === "blocked_working_copy") {
            await createAuditEntryTx(tx, {
              actorId: actorUserId,
              actorRole: actor.role,
              entityType: "booking",
              entityId: bookingId,
              action: "schedule_assignment_review_needed",
              after: {
                status: scheduleOutcome.status,
                reason: scheduleOutcome.reason ?? null,
              },
            });
          }
        }

        if (reservationScheduleAssignment?.created) {
          await createAuditEntryTx(tx, {
            actorId: actorUserId,
            actorRole: actor.role,
            entityType: "shift_assignment",
            entityId: reservationScheduleAssignment.shiftAssignmentId,
            action: "shift_assigned",
            after: {
              source: "event_gear_reservation",
              bookingId,
              eventId: reservationScheduleAssignment.eventId,
              shiftId: reservationScheduleAssignment.shiftId,
              userId: reservationScheduleAssignment.userId,
              area: reservationScheduleAssignment.area,
              workerType: reservationScheduleAssignment.workerType,
              hasConflict: reservationScheduleAssignment.hasConflict,
            },
          });
        }

}
