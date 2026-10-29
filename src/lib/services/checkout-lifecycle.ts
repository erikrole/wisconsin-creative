import {
  BookingCustodyScope,
  BookingKind,
  BookingStatus,
  BulkMovementKind,
  BulkUnitStatus,
  Prisma,
  ScanPhase,
  ScanSessionStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx, lookupActorRole } from "@/lib/audit";
import {
  checkAvailability,
  checkCheckoutDueTime,
} from "@/lib/services/availability";
import { kioskAvailabilityBlockMessage } from "@/lib/availability-copy";
import {
  bookingInclude,
  dedupeIds,
  upsertBulkBalancesAndMovements,
  type AuditJson,
} from "./bookings-helpers";
import {
  endCheckoutReturnLiveActivities,
  updateCheckoutReturnLiveActivities,
} from "./live-activities";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import {
  createShiftScheduleNotification,
  dispatchScheduleAssignmentNotifications,
} from "@/lib/services/notifications";
import {
  reconcileReservationScheduleTx,
  releaseReservationManagedAssignmentTx,
} from "@/lib/services/reservation-schedule";
import { assertBookingSnapshot } from "@/lib/booking-concurrency";
import { assertBookingDuration } from "@/lib/time";
import {
  OWNER_TRANSFER_STATUSES,
  isStaffOrAdmin,
  assertValidBookingWindow,
  handleBookingMutationRace,
  UpdateBookingInput,
  BookingUpdateOptions,
  TransferBookingOwnerInput,
} from "./bookings-lifecycle-shared";

export async function updateCheckout(
  bookingId: string,
  actorUserId: string,
  updates: UpdateBookingInput,
  expectedUpdatedAt?: Date,
  options: BookingUpdateOptions = {},
) {
  let updated;
  try {
    updated = await db.$transaction(
      async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          serializedItems: true,
          bulkItems: {
            include: {
              unitAllocations: {
                where: { checkedOutAt: { not: null }, checkedInAt: null },
                select: { id: true },
                take: 1,
              },
            },
          },
        }
      });

      if (!existing) {
        throw new HttpError(404, "Checkout not found");
      }

      assertBookingSnapshot(existing.updatedAt, expectedUpdatedAt);

      if (existing.kind !== BookingKind.CHECKOUT) {
        throw new HttpError(400, "Only checkouts can be updated with this endpoint");
      }

      if (existing.status === BookingStatus.CANCELLED || existing.status === BookingStatus.COMPLETED) {
        throw new HttpError(400, "Cannot edit a cancelled or completed checkout");
      }

      if (updates.serializedAssetIds !== undefined || updates.bulkItems !== undefined) {
        throw new HttpError(403, "Active checkout equipment can only be changed at a kiosk");
      }

      const nextEndsAt = updates.endsAt ?? existing.endsAt;
      const nextLocationId = updates.locationId ?? existing.locationId;
      const nextStartsAt = existing.startsAt; // start is fixed for OPEN checkouts
      assertValidBookingWindow(nextStartsAt, nextEndsAt);

      // Equipment is never edited here (refused above), so the availability
      // check covers the gear already on the checkout.
      const serializedAssetIds = dedupeIds(existing.serializedItems.map((item) => item.assetId));
      const bulkItems = existing.bulkItems.map((item) => ({
        bulkSkuId: item.bulkSkuId,
        quantity: item.plannedQuantity
      }));
      const updatesWindow = updates.endsAt !== undefined || updates.locationId !== undefined;

      if (updatesWindow) {
        const extendsOpenCheckout = existing.status === BookingStatus.OPEN
          && updates.endsAt !== undefined
          && nextEndsAt > existing.endsAt;
        const availability = existing.status === BookingStatus.OPEN
          ? await checkCheckoutDueTime(tx, existing, nextEndsAt)
          : await checkAvailability(tx, {
          locationId: nextLocationId,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          serializedAssetIds,
          bulkItems,
          excludeBookingId: bookingId,
          bookingKind: "CHECKOUT",
          enforceSerializedTurnaroundBuffer: !extendsOpenCheckout,
        });

        if (availability.conflicts.length > 0 || availability.shortages.length > 0 || availability.unavailableAssets.length > 0) {
          throw new HttpError(409, kioskAvailabilityBlockMessage(availability, "this item"), availability);
        }
      }

      const title = updates.title === undefined ? undefined : normalizeBookingTitle(updates.title);
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          title,
          endsAt: nextEndsAt,
          notes: updates.notes
        }
      });

      if (updatesWindow) {
        await tx.assetAllocation.updateMany({
          where: { bookingId },
          data: {
            startsAt: nextStartsAt,
            endsAt: nextEndsAt,
          },
        });
      }

      const fieldChanges: AuditJson = {};
      if (title && title !== existing.title) fieldChanges.title = title;
      if (updates.notes !== undefined && updates.notes !== existing.notes) fieldChanges.notes = updates.notes ?? null;
      if (updates.endsAt && updates.endsAt.toISOString() !== existing.endsAt.toISOString()) fieldChanges.endsAt = updates.endsAt.toISOString();

      const actorRole = await lookupActorRole(tx, actorUserId);
      await createAuditEntryTx(tx, {
        actorId: actorUserId,
        actorRole,
        entityType: "booking",
        entityId: bookingId,
        action: "updated",
        before: {
          title: existing.title,
          endsAt: existing.endsAt.toISOString(),
          notes: existing.notes,
        } as AuditJson as Record<string, unknown>,
        after: fieldChanges as Record<string, unknown>,
      });

      await options.afterUpdateTx?.(tx);

      return tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: bookingInclude
      });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    handleBookingMutationRace(error);
  }

  if (updated.kind === BookingKind.CHECKOUT && updated.status === BookingStatus.OPEN) {
    await updateCheckoutReturnLiveActivities({
      bookingId,
      endsAt: updated.endsAt,
    });
    await scheduleCheckoutReturnLiveActivity({ bookingId, endsAt: updated.endsAt });
  }

  return updated;
}

export async function transferBookingOwner(
  bookingId: string,
  actorUserId: string,
  input: TransferBookingOwnerInput,
  expectedUpdatedAt?: Date,
) {
  const scheduleNotificationAssignmentIds: string[] = [];
  try {
    const updated = await db.$transaction(
      async (tx) => {
        const existing = await tx.booking.findUnique({
          where: { id: bookingId },
          select: {
            id: true,
            kind: true,
            status: true,
            updatedAt: true,
            requesterUserId: true,
            custodyScope: true,
            eventId: true,
            shiftAssignmentId: true,
            createdBy: true,
            requester: { select: { id: true, name: true, email: true } },
          },
        });

        if (!existing) {
          throw new HttpError(404, "Booking not found");
        }

        assertBookingSnapshot(existing.updatedAt, expectedUpdatedAt);

        if (!OWNER_TRANSFER_STATUSES.has(existing.status)) {
          throw new HttpError(400, "Cannot transfer ownership for a completed or cancelled booking");
        }
        if (existing.custodyScope === BookingCustodyScope.SHARED) {
          throw new HttpError(400, "Shared travel-case bookings do not have a personal owner");
        }

        if (existing.kind === BookingKind.CHECKOUT && existing.status === BookingStatus.OPEN) {
          // Same guards as handing items over at the kiosk: a half-finished
          // return or an accountability hold must settle before custody moves.
          const [returnSession, exclusion] = await Promise.all([
            tx.scanSession.findFirst({
              where: { bookingId, phase: ScanPhase.CHECKIN, status: ScanSessionStatus.OPEN },
              select: { id: true },
            }),
            tx.bookingAccountabilityExclusion.findUnique({ where: { bookingId }, select: { restoredAt: true } }),
          ]);
          if (returnSession) throw new HttpError(409, "Finish the in-progress return before transferring this checkout");
          if (exclusion && !exclusion.restoredAt) {
            throw new HttpError(409, "Resolve the checkout accountability exclusion before transferring it");
          }
        }

        const actor = await tx.user.findUnique({
          where: { id: actorUserId },
          select: { role: true },
        });
        const isOwner = actorUserId === existing.requesterUserId || actorUserId === existing.createdBy;
        if (!actor || (!isStaffOrAdmin(actor.role) && !isOwner)) {
          throw new HttpError(403, "You do not have permission to transfer this booking");
        }

        if (existing.requesterUserId === input.targetUserId) {
          return tx.booking.findUniqueOrThrow({
            where: { id: bookingId },
            include: bookingInclude,
          });
        }

        const target = await tx.user.findUnique({
          where: { id: input.targetUserId },
          select: {
            id: true,
            name: true,
            email: true,
            active: true,
            hiddenFromRoster: true,
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
        });

        if (!target) throw new HttpError(400, "Target user not found");
        if (!target.active) throw new HttpError(400, "Cannot transfer ownership to an inactive user");
        if (target.hiddenFromRoster) throw new HttpError(400, "Cannot transfer ownership to a hidden test user");

        await tx.booking.update({
          where: { id: bookingId },
          data: { requesterUserId: target.id },
        });

        const after: Record<string, unknown> = {
          requesterUserId: target.id,
          requesterName: target.name,
          requesterEmail: target.email,
        };
        const reason = input.reason?.trim();
        if (reason) after.reason = reason;

        await createAuditEntryTx(tx, {
          actorId: actorUserId,
          actorRole: actor.role,
          entityType: "booking",
          entityId: bookingId,
          action: "owner_transferred",
          before: {
            requesterUserId: existing.requesterUserId,
            requesterName: existing.requester?.name ?? null,
            requesterEmail: existing.requester?.email ?? null,
          },
          after,
        });

        if (
          existing.kind === BookingKind.RESERVATION
          && (existing.eventId || existing.shiftAssignmentId)
        ) {
          const scheduleOutcome = await reconcileReservationScheduleTx(tx, {
            bookingId,
            requesterUserId: target.id,
            requester: target,
            primaryEventId: existing.eventId ?? null,
            currentAssignmentId: existing.shiftAssignmentId ?? null,
            createdBy: actorUserId,
          });
          if (scheduleOutcome.assignment?.created) {
            scheduleNotificationAssignmentIds.push(scheduleOutcome.assignment.shiftAssignmentId);
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
              after: { reason: "booking_owner_transferred" },
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

export async function extendBooking(
  bookingId: string,
  actorUserId: string,
  newEndsAt: Date,
  expectedUpdatedAt?: Date,
) {
  let updated;
  try {
    updated = await db.$transaction(
      async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { serializedItems: true, bulkItems: true }
      });

      if (!existing) {
        throw new HttpError(404, "Booking not found");
      }

      assertBookingSnapshot(existing.updatedAt, expectedUpdatedAt);

      if (existing.status !== BookingStatus.OPEN && existing.status !== BookingStatus.BOOKED) {
        throw new HttpError(400, "Can only extend active bookings");
      }

      if (newEndsAt <= existing.endsAt) {
        throw new HttpError(400, "New end date must be later than current end date");
      }

      if (newEndsAt.getTime() < Date.now()) {
        throw new HttpError(400, "New end date must be in the future");
      }
      assertBookingDuration(existing.startsAt, newEndsAt);

      const serializedAssetIds = existing.serializedItems.map((i) => i.assetId);
      const bulkItems = existing.bulkItems.map((i) => ({
        bulkSkuId: i.bulkSkuId,
        quantity: i.plannedQuantity
      }));

      const availability = existing.kind === BookingKind.CHECKOUT && existing.status === BookingStatus.OPEN
        ? await checkCheckoutDueTime(tx, existing, newEndsAt)
        : await checkAvailability(tx, {
        locationId: existing.locationId,
        startsAt: existing.startsAt,
        endsAt: newEndsAt,
        serializedAssetIds,
        bulkItems,
        excludeBookingId: bookingId,
        bookingKind: existing.kind,
        enforceSerializedTurnaroundBuffer: !(
          existing.kind === BookingKind.CHECKOUT
          && existing.status === BookingStatus.OPEN
        ),
      });

      // Shortages matter here too: extending bulk gear over a window where
      // future reservations depend on that quantity over-commits the stock.
      // unavailableAssets stays out deliberately — gear already in custody
      // should not be blocked from extension by a later retire flag.
      if (availability.conflicts.length > 0 || availability.shortages.length > 0) {
        throw new HttpError(409, kioskAvailabilityBlockMessage(availability, "this item"), availability);
      }

      await tx.booking.update({
        where: { id: bookingId },
        data: { endsAt: newEndsAt }
      });

      await tx.assetAllocation.updateMany({
        where: { bookingId, active: true },
        data: { endsAt: newEndsAt }
      });

      await tx.bookingDueDateChange.create({
        data: {
          bookingId,
          actorUserId,
          previousEndsAt: existing.endsAt,
          nextEndsAt: newEndsAt,
        },
      });

      const actorRole = await lookupActorRole(tx, actorUserId);
      await createAuditEntryTx(tx, {
        actorId: actorUserId,
        actorRole,
        entityType: "booking",
        entityId: bookingId,
        action: "extended",
        before: { endsAt: existing.endsAt },
        after: { endsAt: newEndsAt },
      });

      return tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: bookingInclude
      });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    handleBookingMutationRace(error);
  }

  if (updated.kind === BookingKind.CHECKOUT && updated.status === BookingStatus.OPEN) {
    await updateCheckoutReturnLiveActivities({
      bookingId,
      endsAt: updated.endsAt,
    });
    await scheduleCheckoutReturnLiveActivity({ bookingId, endsAt: updated.endsAt });
  }

  return updated;
}

export async function cancelBooking(
  bookingId: string,
  actorUserId: string,
  opts: { allowActiveCheckout?: boolean } = {},
) {
  let releasedAssignmentId: string | null = null;
  const result = await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        bulkItems: {
          select: {
            id: true,
            bulkSkuId: true,
            plannedQuantity: true,
            checkedInQuantity: true,
            unitAllocations: {
              where: { checkedOutAt: { not: null }, checkedInAt: null },
              select: { bulkSkuUnitId: true },
            },
          },
        },
      },
    });

    if (!booking) {
      throw new HttpError(404, "Booking not found");
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new HttpError(400, "Booking is already cancelled");
    }

    if (booking.status === BookingStatus.COMPLETED) {
      throw new HttpError(400, "Cannot cancel a completed booking");
    }

    if (booking.kind === BookingKind.CHECKOUT && booking.status === BookingStatus.OPEN && !opts.allowActiveCheckout) {
      throw new HttpError(
        409,
        "Active checkout custody must be returned at a kiosk or closed through the admin exception",
      );
    }

    if (booking.kind === BookingKind.RESERVATION && booking.shiftAssignmentId) {
      const scheduleRelease = await releaseReservationManagedAssignmentTx(tx, {
        bookingId,
        assignmentId: booking.shiftAssignmentId,
      });
      if (scheduleRelease.released) {
        releasedAssignmentId = scheduleRelease.assignmentId;
        const actorRole = await lookupActorRole(tx, actorUserId);
        await createAuditEntryTx(tx, {
          actorId: actorUserId,
          actorRole,
          entityType: "shift_assignment",
          entityId: scheduleRelease.assignmentId!,
          action: "shift_assignment_removed",
          before: {
            source: "event_gear_reservation",
            bookingId,
          },
          after: { reason: "booking_cancelled" },
        });
      } else if (scheduleRelease.blocked) {
        const actorRole = await lookupActorRole(tx, actorUserId);
        await createAuditEntryTx(tx, {
          actorId: actorUserId,
          actorRole,
          entityType: "booking",
          entityId: bookingId,
          action: "schedule_assignment_review_needed",
          after: {
            status: "blocked_working_copy",
            reason: "Booking cancelled while its event schedule working copy was open.",
          },
        });
      }
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED }
    });

    const bulkItems = booking.bulkItems ?? [];
    if (booking.kind === BookingKind.CHECKOUT && (booking.status === BookingStatus.PENDING_PICKUP || booking.status === BookingStatus.OPEN) && bulkItems.length > 0) {
      const outstandingBulk = bulkItems
        .map((item) => ({
          bulkSkuId: item.bulkSkuId,
          quantity: item.plannedQuantity - (item.checkedInQuantity ?? 0),
        }))
        .filter((item) => item.quantity > 0);

      await upsertBulkBalancesAndMovements(tx, {
        locationId: booking.locationId,
        bookingId,
        actorUserId,
        kind: BulkMovementKind.CHECKIN,
        items: outstandingBulk,
      });

      const activeUnitIds = bulkItems.flatMap((item) => (item.unitAllocations ?? []).map((allocation) => allocation.bulkSkuUnitId));
      if (activeUnitIds.length > 0) {
        await tx.bookingBulkUnitAllocation.updateMany({
          where: {
            bookingBulkItemId: { in: bulkItems.map((item) => item.id) },
            bulkSkuUnitId: { in: activeUnitIds },
            checkedOutAt: { not: null },
            checkedInAt: null,
          },
          data: { checkedInAt: new Date() },
        });
        await tx.bulkSkuUnit.updateMany({
          where: { id: { in: activeUnitIds } },
          data: { status: BulkUnitStatus.AVAILABLE },
        });
      }
    }

    await tx.assetAllocation.updateMany({
      where: { bookingId },
      data: { active: false }
    });

    await tx.scanSession.updateMany({
      where: { bookingId, status: ScanSessionStatus.OPEN },
      data: { status: ScanSessionStatus.CANCELLED }
    });

    const actorRole = await lookupActorRole(tx, actorUserId);
    await createAuditEntryTx(tx, {
      actorId: actorUserId,
      actorRole,
      entityType: "booking",
      entityId: bookingId,
      action: "cancelled",
    });

    return {
      success: true,
      scheduleAssignmentReleased: Boolean(releasedAssignmentId),
      shouldEndLiveActivity: booking.kind === BookingKind.CHECKOUT && booking.status === BookingStatus.OPEN,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (result.shouldEndLiveActivity) {
    await endCheckoutReturnLiveActivities(bookingId);
  }

  if (releasedAssignmentId) {
    await createShiftScheduleNotification(releasedAssignmentId, "removed");
  }

  return { success: true, scheduleAssignmentReleased: Boolean(releasedAssignmentId) };
}
