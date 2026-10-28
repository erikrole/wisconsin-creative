import {
  claimKioskOperationReceiptTx,
  finishKioskOperationReceiptTx,
} from "@/lib/services/kiosk-operation-receipts";
import {
  AllocationKind,
  BookingCustodyScope,
  BookingKind,
  BookingStatus,
  BulkMovementKind,
  BulkUnitStatus,
  Prisma,
  Role,
  ScanSessionStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { withSerializationRetry } from "@/lib/serialization";
import { createAuditEntryTx, lookupActorRole } from "@/lib/audit";
import { checkAvailability, type AvailabilityResult } from "@/lib/services/availability";
import { kioskAvailabilityBlockMessage } from "@/lib/availability-copy";
import { loadKitEquipmentPlan } from "@/lib/services/kits";
import {
  ACTIVE_BULK_UNIT_ALLOCATION_WHERE,
  CLAIMABLE_BULK_UNIT_WHERE,
  effectiveBulkUnitStatus,
} from "@/lib/bulk-unit-status";
import { nextBookingRef } from "@/lib/services/booking-ref";
import { bookingInclude, dedupeIds, upsertBulkBalancesAndMovements } from "./bookings-helpers";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import { hasCollaboratorCapability } from "@/lib/collaborator-access";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";
import { assertCheckoutDistinctBulkSkuLimit } from "@/lib/services/kiosk-checkout-complete";
import { dispatchScheduleAssignmentNotifications } from "@/lib/services/notifications";
import {
  assignReservationRequesterToScheduleTx,
  validateReservationScheduleAssignmentTx,
  type ReservationScheduleAssignment,
} from "@/lib/services/reservation-schedule";
import {
  assertValidBookingWindow,
  assertValidCreateEventLinks,
  assertValidCreateEquipment,
  exactEventSetMatches,
  mergeReservationNotes,
  additiveBulkRequests,
  assertNumberedPickupPlanLimit,
  assertCheckoutCustodySource,
  assertValidMaxConcurrentReservations,
  handleBookingMutationRace,
  eventLinkWhereForActor,
  CreateBookingInput,
} from "./bookings-lifecycle-shared";

export async function createBooking(input: CreateBookingInput) {
  assertValidBookingWindow(input.startsAt, input.endsAt);
  assertValidCreateEventLinks(input);
  assertCheckoutCustodySource(input);
  assertValidMaxConcurrentReservations(input);
  if (input.kind === BookingKind.CHECKOUT && input.bulkItems.length > 0) {
    assertCheckoutDistinctBulkSkuLimit(input.bulkItems);
  }
  if (input.bulkUnitItems && input.bulkUnitItems.length > 0 && input.kind !== BookingKind.CHECKOUT) {
    throw new HttpError(400, "bulkUnitItems only apply to checkout custody");
  }
  if (input.sourceDraftId && input.kind !== BookingKind.RESERVATION) {
    throw new HttpError(400, "sourceDraftId only applies to reservations");
  }
  if (input.sourceReservationPickup && !input.sourceReservationId) {
    throw new HttpError(400, "sourceReservationPickup requires sourceReservationId");
  }
  if (input.sourceReservationPickup && input.kind !== BookingKind.CHECKOUT) {
    throw new HttpError(400, "sourceReservationPickup only applies to checkout custody");
  }

  try {
    const booking = await withSerializationRetry(() =>
      db.$transaction(
        async (tx) => {
          await claimKioskOperationReceiptTx(tx, input.kioskCompletionReceipt);
          let hasRemainingReservationItems = false;
          let resolvedCustodyScope = input.custodyScope ?? BookingCustodyScope.PERSON;
          // A missing requester would otherwise surface as an FK 500; an inactive
          // one would silently hold gear they can no longer account for.
          const requester = await tx.user.findUnique({
            where: { id: input.requesterUserId },
            select: {
              active: true,
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
              collaboratorProfile: true,
              collaboratorPolicy: { select: collaboratorPolicyActorSelect },
            },
          });
          if (!requester) throw new HttpError(400, "Requester not found");
          if (!requester.active) throw new HttpError(400, "Cannot create a booking for an inactive user");

          const sourceDraft = input.sourceDraftId
            ? await tx.booking.findFirst({
                where: {
                  id: input.sourceDraftId,
                  kind: BookingKind.RESERVATION,
                  status: BookingStatus.DRAFT,
                  createdBy: input.createdBy,
                },
                select: {
                  id: true,
                  kind: true,
                  custodyScope: true,
                  title: true,
                  requesterUserId: true,
                  locationId: true,
                  startsAt: true,
                  endsAt: true,
                },
              })
            : null;
          if (input.sourceDraftId && !sourceDraft) {
            throw new HttpError(404, "Source draft not found");
          }
          if (sourceDraft) {
            resolvedCustodyScope = sourceDraft.custodyScope;
          }

          // Resolve items from source reservation if provided. A normal source
          // conversion still falls back to the complete reservation for
          // backwards compatibility. Kiosk pickup passes an explicit
          // selection so a partial pickup cannot silently pull every item.
          let resolvedSerializedAssetIds = dedupeIds(input.serializedAssetIds);
          let resolvedBulkItems = input.bulkItems;
          let sourceReservationForPickup: {
            id: string;
            kind: BookingKind;
            status: BookingStatus;
            locationId: string;
            custodyScope: BookingCustodyScope;
            serializedItems: Array<{ assetId: string; allocationStatus: string }>;
            bulkItems: Array<{ bulkSkuId: string; plannedQuantity: number; checkedOutQuantity: number }>;
          } | null = null;

          if (input.sourceReservationId) {
            const sourceReservation = await tx.booking.findUnique({
              where: { id: input.sourceReservationId },
              include: { serializedItems: true, bulkItems: true }
            });

            if (!sourceReservation) {
              throw new HttpError(404, "Source reservation not found");
            }
            if (sourceReservation.kind !== BookingKind.RESERVATION) {
              throw new HttpError(400, "sourceReservationId does not refer to a reservation");
            }
            if (sourceReservation.status !== BookingStatus.BOOKED) {
              throw new HttpError(400, `Source reservation is not in BOOKED status (current: ${sourceReservation.status})`);
            }
            if (sourceReservation.locationId !== input.locationId) {
              throw new HttpError(400, "Source reservation belongs to a different location");
            }
            resolvedCustodyScope = sourceReservation.custodyScope;

            if (input.sourceReservationPickup) {
              sourceReservationForPickup = sourceReservation;
              const remainingSerializedAssetIds = new Set(
                sourceReservation.serializedItems
                  .filter((item) => item.allocationStatus === "active")
                  .map((item) => item.assetId),
              );
              const invalidSerializedAssetId = resolvedSerializedAssetIds.find(
                (assetId) => !remainingSerializedAssetIds.has(assetId),
              );
              if (invalidSerializedAssetId) {
                throw new HttpError(409, "One or more selected items were already picked up");
              }

              const sourceBulkBySku = new Map(
                sourceReservation.bulkItems.map((item) => [item.bulkSkuId, item]),
              );
              for (const item of resolvedBulkItems) {
                const sourceItem = sourceBulkBySku.get(item.bulkSkuId);
                if (!sourceItem) {
                  throw new HttpError(409, "One or more selected bulk items were not in this reservation");
                }
                const remainingQuantity = Math.max(
                  0,
                  sourceItem.plannedQuantity - (sourceItem.checkedOutQuantity ?? 0),
                );
                if (item.quantity > remainingQuantity) {
                  throw new HttpError(409, "One or more selected bulk items were already picked up");
                }
              }
            } else {
              if (resolvedSerializedAssetIds.length === 0) {
                resolvedSerializedAssetIds = sourceReservation.serializedItems.map((item) => item.assetId);
              }
              if (resolvedBulkItems.length === 0) {
                resolvedBulkItems = sourceReservation.bulkItems.map((item) => ({
                  bulkSkuId: item.bulkSkuId,
                  quantity: item.plannedQuantity
                }));
              }
            }
          }

          if (input.kitId && !input.sourceReservationPickup) {
            const kitPlan = await loadKitEquipmentPlan(tx, input.kitId, input.locationId);
            const hasClientEquipment =
              resolvedSerializedAssetIds.length > 0 || resolvedBulkItems.length > 0;
            if (!hasClientEquipment) {
              resolvedSerializedAssetIds = kitPlan.serializedAssetIds;
              resolvedBulkItems = kitPlan.bulkItems;
            }
            if (resolvedSerializedAssetIds.length === 0 && resolvedBulkItems.length === 0) {
              throw new HttpError(
                400,
                `${kitPlan.name} has no cameras, lenses, or batteries yet. Add gear to the kit first.`,
              );
            }
          }

          assertValidCreateEquipment(resolvedSerializedAssetIds, resolvedBulkItems);
          if (input.kind === BookingKind.CHECKOUT) {
            assertCheckoutDistinctBulkSkuLimit(
              resolvedBulkItems,
              input.sourceReservationId ? "reservation pickup" : "checkout",
            );
          }
          await assertNumberedPickupPlanLimit(tx, resolvedBulkItems);

          // Resolve event linking before availability so an exact event gear
          // plan can be found and excluded from its own availability check.
          // Sorting keeps legacy Booking.eventId and the junction rows stable.
          const requestedEventIds = input.eventIds && input.eventIds.length > 0
            ? input.eventIds
            : input.eventId ? [input.eventId] : [];
          let sortedEventIds: string[] = [];
          if (requestedEventIds.length > 0) {
            const events = await tx.calendarEvent.findMany({
              where: eventLinkWhereForActor(requestedEventIds, requester),
              select: { id: true, startsAt: true },
            });
            if (events.length !== requestedEventIds.length) {
              throw new HttpError(400, "One or more eventIds do not exist");
            }
            sortedEventIds = [...events]
              .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
              .map((e) => e.id);
          }
          const primaryEventId = sortedEventIds[0] ?? null;
          const title = normalizeBookingTitle(input.title);

          const consolidationCandidates = input.kind === BookingKind.RESERVATION
            && sortedEventIds.length > 0
            && !input.sourceReservationId
            ? await tx.booking.findMany({
                where: {
                  kind: BookingKind.RESERVATION,
                  status: BookingStatus.BOOKED,
                  requesterUserId: input.requesterUserId,
                  custodyScope: resolvedCustodyScope,
                  eventId: primaryEventId,
                  title: { equals: title, mode: "insensitive" },
                  ...(sourceDraft ? { id: { not: sourceDraft.id } } : {}),
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 10,
                include: {
                  events: { select: { eventId: true } },
                  serializedItems: {
                    select: { assetId: true, allocationStatus: true },
                  },
                  bulkItems: {
                    select: { bulkSkuId: true, plannedQuantity: true, checkedOutQuantity: true },
                  },
                },
              })
            : [];
          const consolidationTarget = consolidationCandidates.find((candidate) =>
            exactEventSetMatches(candidate, sortedEventIds),
          );

          if (
            consolidationTarget
            && (
              consolidationTarget.locationId !== input.locationId
              || consolidationTarget.startsAt.getTime() !== input.startsAt.getTime()
              || consolidationTarget.endsAt.getTime() !== input.endsAt.getTime()
            )
          ) {
            throw new HttpError(
              409,
              resolvedCustodyScope === BookingCustodyScope.SHARED
                ? "A shared travel-case plan already exists for the same event and title with different pickup details. Open that plan before adding gear."
                : "This person already has a gear plan for the same event and title with different pickup details. Open that plan before adding gear.",
              { existingReservationId: consolidationTarget.id },
            );
          }

          if (
            consolidationTarget
            && (
              consolidationTarget.serializedItems.some((item) => item.allocationStatus !== "active")
              || consolidationTarget.bulkItems.some((item) => item.checkedOutQuantity > 0)
            )
          ) {
            throw new HttpError(
              409,
              "Pickup already started for the existing event gear plan. Finish that pickup before changing its gear.",
              { existingReservationId: consolidationTarget.id },
            );
          }

          if (consolidationTarget) {
            const existingAssetIds = new Set(
              consolidationTarget.serializedItems.map((item) => item.assetId),
            );
            const addedAssetIds = resolvedSerializedAssetIds.filter(
              (assetId) => !existingAssetIds.has(assetId),
            );
            const combinedAssetIds = [...existingAssetIds, ...addedAssetIds];
            const combinedBulkItems = additiveBulkRequests(
              consolidationTarget.bulkItems,
              resolvedBulkItems,
            );

            const availability = await checkAvailability(tx, {
              locationId: input.locationId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              serializedAssetIds: combinedAssetIds,
              bulkItems: combinedBulkItems,
              excludeBookingId: consolidationTarget.id,
              bookingKind: input.kind,
              forCollaborator: requester.role === Role.COLLABORATOR,
            });
            if (
              availability.conflicts.length > 0
              || availability.shortages.length > 0
              || availability.unavailableAssets.length > 0
            ) {
              throw new HttpError(409, "Availability conflict", availability);
            }

            if (addedAssetIds.length > 0) {
              await tx.bookingSerializedItem.createMany({
                data: addedAssetIds.map((assetId) => ({
                  bookingId: consolidationTarget.id,
                  assetId,
                  allocationStatus: "active",
                })),
              });
              await tx.assetAllocation.createMany({
                data: addedAssetIds.map((assetId) => ({
                  bookingId: consolidationTarget.id,
                  assetId,
                  startsAt: input.startsAt,
                  endsAt: input.endsAt,
                  active: true,
                  kind: AllocationKind.RESERVATION,
                })),
              });
            }
            for (const item of resolvedBulkItems) {
              await tx.bookingBulkItem.upsert({
                where: {
                  bookingId_bulkSkuId: {
                    bookingId: consolidationTarget.id,
                    bulkSkuId: item.bulkSkuId,
                  },
                },
                create: {
                  bookingId: consolidationTarget.id,
                  bulkSkuId: item.bulkSkuId,
                  plannedQuantity: item.quantity,
                },
                update: { plannedQuantity: { increment: item.quantity } },
              });
            }

            await tx.booking.update({
              where: { id: consolidationTarget.id },
              data: { notes: mergeReservationNotes(consolidationTarget.notes, input.notes) },
            });
            const actorRole = await lookupActorRole(tx, input.createdBy);
            await createAuditEntryTx(tx, {
              actorId: input.createdBy,
              actorRole,
              entityType: "booking",
              entityId: consolidationTarget.id,
              action: "reservation_consolidated",
              before: {
                serializedAssetIds: [...existingAssetIds],
                bulkItems: consolidationTarget.bulkItems.map((item) => ({
                  bulkSkuId: item.bulkSkuId,
                  quantity: item.plannedQuantity,
                })),
              },
              after: {
                incomingTitle: title,
                addedSerializedAssetIds: addedAssetIds,
                addedBulkItems: resolvedBulkItems,
                eventIds: sortedEventIds,
                sourceDraftId: input.sourceDraftId ?? null,
              },
            });

            if (sourceDraft) {
              await tx.booking.delete({ where: { id: sourceDraft.id } });
              await createAuditEntryTx(tx, {
                actorId: input.createdBy,
                actorRole,
                entityType: "booking",
                entityId: sourceDraft.id,
                action: "draft_consumed",
                before: {
                  kind: sourceDraft.kind,
                  title: sourceDraft.title,
                  requesterUserId: sourceDraft.requesterUserId,
                  locationId: sourceDraft.locationId,
                  startsAt: sourceDraft.startsAt,
                  endsAt: sourceDraft.endsAt,
                },
                after: {
                  createdReservationId: consolidationTarget.id,
                  consolidated: true,
                },
              });
            }

            const consolidatedBooking = await tx.booking.findUniqueOrThrow({
              where: { id: consolidationTarget.id },
              include: bookingInclude,
            });
            return { booking: consolidatedBooking, creationDisposition: "consolidated" as const };
          }

          if (input.maxConcurrentReservations !== undefined && resolvedCustodyScope === BookingCustodyScope.PERSON) {
            const activeCount = await tx.booking.count({
              where: {
                requesterUserId: input.requesterUserId,
                kind: BookingKind.RESERVATION,
                status: BookingStatus.BOOKED,
              },
            });
            if (activeCount >= input.maxConcurrentReservations) {
              throw new HttpError(
                409,
                `This user already has ${activeCount} active reservation${activeCount === 1 ? "" : "s"} (limit: ${input.maxConcurrentReservations}).`,
              );
            }
          }

          const availability = await checkAvailability(tx, {
            locationId: input.locationId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            serializedAssetIds: resolvedSerializedAssetIds,
            bulkItems: resolvedBulkItems,
            excludeBookingId: input.sourceReservationId,
            bookingKind: input.kind,
            forCollaborator: requester.role === Role.COLLABORATOR,
          });

          if (availability.conflicts.length > 0 || availability.shortages.length > 0 || availability.unavailableAssets.length > 0) {
            // A kiosk pickup shows this text on the counter, so name the item
            // and who holds it instead of a bare "Availability conflict".
            const message = input.sourceReservationPickup
              ? await pickupAvailabilityMessage(tx, availability)
              : "Availability conflict";
            throw new HttpError(409, message, availability);
          }

          // Reservation intent stays BOOKED until custody is proven. Kiosk
          // pickup and the admin force-checkout exception both open custody
          // directly instead of creating the retired staged PENDING_PICKUP
          // checkout state.
          const status = input.kind === BookingKind.RESERVATION
            ? BookingStatus.BOOKED
            : BookingStatus.OPEN;

          let resolvedShiftAssignmentId = resolvedCustodyScope === BookingCustodyScope.PERSON
            ? input.shiftAssignmentId ?? null
            : null;
          if (resolvedShiftAssignmentId) {
            try {
              await validateReservationScheduleAssignmentTx(tx, {
                assignmentId: resolvedShiftAssignmentId,
                requesterUserId: input.requesterUserId,
                eventIds: sortedEventIds,
              });
            } catch (error) {
              // A pickup inherits the reservation's schedule link rather than
              // receiving it from a client. A stale link (owner transferred,
              // shift declined) must not block custody; drop it instead.
              if (!input.sourceReservationPickup || !(error instanceof HttpError)) throw error;
              resolvedShiftAssignmentId = null;
            }
          }

          const prefix = input.kind === BookingKind.CHECKOUT ? "CO" : "RV";
          let booking;
          let appendedToExistingCheckout = false;
          if (
            input.kind === BookingKind.CHECKOUT
            && input.sourceReservationPickup
            && input.sourceReservationId
          ) {
            const existingCheckout = await tx.booking.findFirst({
              where: {
                sourceReservationId: input.sourceReservationId,
                kind: BookingKind.CHECKOUT,
                status: BookingStatus.OPEN,
              },
              orderBy: { createdAt: "asc" },
            });
            if (existingCheckout) {
              booking = existingCheckout;
              appendedToExistingCheckout = true;
            }
          }
          if (!booking) {
            const refNumber = await nextBookingRef(tx, prefix);
            booking = await tx.booking.create({
              data: {
                kind: input.kind,
                custodyScope: resolvedCustodyScope,
                title,
                refNumber,
                requesterUserId: input.requesterUserId,
                locationId: input.locationId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                status,
                createdBy: input.createdBy,
                notes: input.notes,
                sourceReservationId: input.sourceReservationId ?? null,
                eventId: primaryEventId,
                sportCode: input.sportCode ?? null,
                shiftAssignmentId: resolvedShiftAssignmentId,
                kitId: input.kitId ?? null,
                pickupKioskDeviceId: input.pickupKioskDeviceId ?? null
              }
            });
          }
          const allocationStartsAt = appendedToExistingCheckout ? booking.startsAt : input.startsAt;
          const allocationEndsAt = appendedToExistingCheckout ? booking.endsAt : input.endsAt;

          let reservationScheduleAssignment: ReservationScheduleAssignment | null = null;
          if (sortedEventIds.length > 0 && !appendedToExistingCheckout) {
            await tx.bookingEvent.createMany({
              data: sortedEventIds.map((eventId, ordinal) => ({
                bookingId: booking.id,
                eventId,
                ordinal,
              })),
            });
            if (
              input.kind === BookingKind.RESERVATION &&
              resolvedCustodyScope === BookingCustodyScope.PERSON &&
              hasCollaboratorCapability(requester, "SCHEDULE_FOLLOW")
            ) {
              await tx.scheduleEventFollow.createMany({
                data: sortedEventIds.map((eventId) => ({
                  userId: input.requesterUserId,
                  eventId,
                  source: "BOOKING" as const,
                })),
                skipDuplicates: true,
              });
            }

            if (
              input.kind === BookingKind.RESERVATION
              && resolvedCustodyScope === BookingCustodyScope.PERSON
              && primaryEventId
              && !resolvedShiftAssignmentId
            ) {
              reservationScheduleAssignment = await assignReservationRequesterToScheduleTx(tx, {
                bookingId: booking.id,
                eventId: primaryEventId,
                requesterUserId: input.requesterUserId,
                requester,
                createdBy: input.createdBy,
              });
              if (reservationScheduleAssignment) {
                await tx.booking.update({
                  where: { id: booking.id },
                  data: { shiftAssignmentId: reservationScheduleAssignment.shiftAssignmentId },
                });
              }
            }
          }

          if (resolvedSerializedAssetIds.length > 0) {
            await tx.bookingSerializedItem.createMany({
              data: resolvedSerializedAssetIds.map((assetId) => ({
                bookingId: booking.id,
                assetId,
                allocationStatus: "active"
              }))
            });

            // A reservation pickup transfers the same physical assets into the
            // linked checkout. Release only this selected subset before creating
            // the replacement allocations so the active-allocation constraint
            // does not mistake the atomic handoff for competing custody.
            if (input.sourceReservationId) {
              await tx.assetAllocation.updateMany({
                where: {
                  bookingId: input.sourceReservationId,
                  assetId: { in: resolvedSerializedAssetIds },
                  active: true,
                },
                data: { active: false },
              });
            }

            await tx.assetAllocation.createMany({
              data: resolvedSerializedAssetIds.map((assetId) => ({
                bookingId: booking.id,
                assetId,
                startsAt: allocationStartsAt,
                endsAt: allocationEndsAt,
                active: true,
                kind: input.kind === BookingKind.RESERVATION ? AllocationKind.RESERVATION : AllocationKind.CHECKOUT
              }))
            });
          }

          if (resolvedBulkItems.length > 0) {
            const checkoutUnitCountBySku = new Map<string, number>();
            for (const unit of input.bulkUnitItems ?? []) {
              checkoutUnitCountBySku.set(
                unit.bulkSkuId,
                (checkoutUnitCountBySku.get(unit.bulkSkuId) ?? 0) + 1,
              );
            }
            if (appendedToExistingCheckout) {
              for (const item of resolvedBulkItems) {
                const checkedOutQuantity = checkoutUnitCountBySku.get(item.bulkSkuId) ?? item.quantity;
                await tx.bookingBulkItem.upsert({
                  where: { bookingId_bulkSkuId: { bookingId: booking.id, bulkSkuId: item.bulkSkuId } },
                  create: {
                    bookingId: booking.id,
                    bulkSkuId: item.bulkSkuId,
                    plannedQuantity: item.quantity,
                    ...(input.kind === BookingKind.CHECKOUT ? { checkedOutQuantity } : {}),
                  },
                  update: {
                    plannedQuantity: { increment: item.quantity },
                    ...(input.kind === BookingKind.CHECKOUT ? { checkedOutQuantity: { increment: checkedOutQuantity } } : {}),
                  },
                });
              }
            } else {
              await tx.bookingBulkItem.createMany({
                data: resolvedBulkItems.map((item) => {
                  const checkedOutQuantity = checkoutUnitCountBySku.get(item.bulkSkuId);
                  return {
                    bookingId: booking.id,
                    bulkSkuId: item.bulkSkuId,
                    plannedQuantity: item.quantity,
                    ...(input.kind === BookingKind.CHECKOUT ? { checkedOutQuantity: checkedOutQuantity ?? item.quantity } : {}),
                  };
                })
              });
            }

            if (input.kind === BookingKind.CHECKOUT) {
              await upsertBulkBalancesAndMovements(tx, {
                locationId: input.locationId,
                bookingId: booking.id,
                actorUserId: input.createdBy,
                kind: BulkMovementKind.CHECKOUT,
                items: resolvedBulkItems
              });
            }
          }

          // Bind exact numbered bulk units (kiosk reservation pickup). Runs in the
          // same transaction as booking creation and reservation fulfillment: if a
          // unit was grabbed between scan-staging and confirm, everything rolls
          // back and the reservation stays BOOKED so the student can retry.
          if (input.bulkUnitItems && input.bulkUnitItems.length > 0) {
            const checkoutBulkItems = await tx.bookingBulkItem.findMany({
              where: { bookingId: booking.id },
              select: {
                id: true,
                bulkSkuId: true,
                plannedQuantity: true,
                bulkSku: { select: { name: true, trackByNumber: true } },
              },
            });
            const bulkItemBySku = new Map(checkoutBulkItems.map((item) => [item.bulkSkuId, item.id]));

            const units = await tx.bulkSkuUnit.findMany({
              where: {
                OR: input.bulkUnitItems.map((item) => ({
                  bulkSkuId: item.bulkSkuId,
                  unitNumber: item.unitNumber,
                })),
              },
              select: {
                id: true,
                bulkSkuId: true,
                unitNumber: true,
                status: true,
                bulkSku: { select: { name: true } },
                allocations: {
                  where: ACTIVE_BULK_UNIT_ALLOCATION_WHERE,
                  take: 1,
                  select: { id: true },
                },
              },
            });
            if (units.length !== input.bulkUnitItems.length) {
              throw new HttpError(404, "One or more battery units were not found");
            }
            const unbindable = units.find((unit) => !bulkItemBySku.has(unit.bulkSkuId));
            if (unbindable) {
              throw new HttpError(409, `${unbindable.bulkSku.name} #${unbindable.unitNumber} no longer matches this checkout`);
            }
            // Effective status, not raw: orphaned CHECKED_OUT flags with no active
            // allocation are claimable and self-heal on claim.
            const unavailable = units.find(
              (unit) => effectiveBulkUnitStatus(unit, unit.allocations[0]) !== BulkUnitStatus.AVAILABLE,
            );
            if (unavailable) {
              throw new HttpError(409, `${unavailable.bulkSku.name} #${unavailable.unitNumber} is no longer available`);
            }

            // The ledger was decremented by this request's quantity — custody
            // must bind exactly that many units per numbered SKU, or the balance
            // and the physical checkout disagree from the first minute. (The
            // kiosk route blocks under-staging; this is the in-transaction
            // backstop and also catches over-staging.) Compare against this
            // request, not the checkout's accumulated plan: a leftover pickup
            // appended onto an existing checkout already holds the units bound
            // by the earlier pickup.
            const requestedQuantityBySku = new Map<string, number>();
            for (const item of resolvedBulkItems) {
              requestedQuantityBySku.set(
                item.bulkSkuId,
                (requestedQuantityBySku.get(item.bulkSkuId) ?? 0) + item.quantity,
              );
            }
            for (const item of checkoutBulkItems) {
              if (!item.bulkSku.trackByNumber) continue;
              const bound = units.filter((unit) => unit.bulkSkuId === item.bulkSkuId).length;
              const expected = requestedQuantityBySku.get(item.bulkSkuId) ?? 0;
              if (bound !== expected) {
                throw new HttpError(
                  409,
                  `${item.bulkSku.name}: ${bound} of ${expected} numbered units scanned — scan exactly the planned units before confirming`,
                );
              }
            }

            const updatedUnits = await tx.bulkSkuUnit.updateMany({
              where: { id: { in: units.map((unit) => unit.id) }, ...CLAIMABLE_BULK_UNIT_WHERE },
              data: { status: BulkUnitStatus.CHECKED_OUT },
            });
            if (updatedUnits.count !== units.length) {
              throw new HttpError(409, "One or more battery units are no longer available");
            }

            const checkedOutAt = new Date();
            await tx.bookingBulkUnitAllocation.createMany({
              data: units.map((unit) => ({
                bookingBulkItemId: bulkItemBySku.get(unit.bulkSkuId)!,
                bulkSkuUnitId: unit.id,
                checkedOutAt,
              })),
            });
          }

          const actorRole = await lookupActorRole(tx, input.createdBy);
          if (input.custodySource === "ADMIN_OVERRIDE" && actorRole !== Role.ADMIN) {
            throw new HttpError(403, "Only admins can force-checkout a reservation");
          }

          if (reservationScheduleAssignment?.created) {
            await createAuditEntryTx(tx, {
              actorId: input.createdBy,
              actorRole,
              entityType: "shift_assignment",
              entityId: reservationScheduleAssignment.shiftAssignmentId,
              action: "shift_assigned",
              after: {
                source: "event_gear_reservation",
                bookingId: booking.id,
                eventId: reservationScheduleAssignment.eventId,
                shiftId: reservationScheduleAssignment.shiftId,
                userId: reservationScheduleAssignment.userId,
                area: reservationScheduleAssignment.area,
                workerType: reservationScheduleAssignment.workerType,
                hasConflict: reservationScheduleAssignment.hasConflict,
              },
            });
          }

          await createAuditEntryTx(tx, {
            actorId: input.createdBy,
            actorRole,
            entityType: "booking",
            entityId: booking.id,
            action: appendedToExistingCheckout ? "kiosk_pickup_appended" : "created",
            after: {
              kind: input.kind,
              title,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              serializedAssetIds: resolvedSerializedAssetIds,
              bulkItems: resolvedBulkItems,
              sourceReservationId: input.sourceReservationId,
              sourceDraftId: input.sourceDraftId,
              eventIds: sortedEventIds,
              shiftAssignmentId: reservationScheduleAssignment?.shiftAssignmentId ?? resolvedShiftAssignmentId,
              kitId: input.kitId ?? null,
            },
          });

          if (sourceDraft) {
            await tx.booking.delete({ where: { id: sourceDraft.id } });
            await createAuditEntryTx(tx, {
              actorId: input.createdBy,
              actorRole,
              entityType: "booking",
              entityId: sourceDraft.id,
              action: "draft_consumed",
              before: {
                kind: sourceDraft.kind,
                title: sourceDraft.title,
                requesterUserId: sourceDraft.requesterUserId,
                locationId: sourceDraft.locationId,
                startsAt: sourceDraft.startsAt,
                endsAt: sourceDraft.endsAt,
              },
              after: { createdReservationId: booking.id },
            });
          }

          // Fulfill the source reservation atomically within the same
          // transaction. Partial kiosk pickups mark only the selected source
          // items as picked up and keep the reservation BOOKED for its next
          // pickup. The linked checkout remains the custody record for the
          // items already handed over.
          if (input.sourceReservationId) {
            if (input.sourceReservationPickup && sourceReservationForPickup) {
              const selectedSerializedAssetIds = new Set(resolvedSerializedAssetIds);
              const selectedBulkQuantityBySku = new Map(
                resolvedBulkItems.map((item) => [item.bulkSkuId, item.quantity]),
              );
              const remainingSerializedCount = sourceReservationForPickup.serializedItems.filter(
                (item) => item.allocationStatus === "active" && !selectedSerializedAssetIds.has(item.assetId),
              ).length;
              const hasRemainingBulk = sourceReservationForPickup.bulkItems.some((item) => {
                const pickedQuantity = (item.checkedOutQuantity ?? 0)
                  + (selectedBulkQuantityBySku.get(item.bulkSkuId) ?? 0);
                return pickedQuantity < item.plannedQuantity;
              });
              const sourceCompleted = remainingSerializedCount === 0 && !hasRemainingBulk;
              hasRemainingReservationItems = !sourceCompleted;

              if (selectedSerializedAssetIds.size > 0) {
                await tx.bookingSerializedItem.deleteMany({
                  where: {
                    bookingId: input.sourceReservationId,
                    assetId: { in: [...selectedSerializedAssetIds] },
                    allocationStatus: "active",
                  },
                });
                await tx.assetAllocation.updateMany({
                  where: {
                    bookingId: input.sourceReservationId,
                    assetId: { in: [...selectedSerializedAssetIds] },
                    active: true,
                  },
                  data: { active: false },
                });
              }

              for (const item of resolvedBulkItems) {
                const sourceItem = sourceReservationForPickup.bulkItems.find(
                  (candidate) => candidate.bulkSkuId === item.bulkSkuId,
                );
                const nextCheckedOut = (sourceItem?.checkedOutQuantity ?? 0) + item.quantity;
                if (sourceItem && nextCheckedOut >= sourceItem.plannedQuantity) {
                  await tx.bookingBulkItem.delete({
                    where: {
                      bookingId_bulkSkuId: {
                        bookingId: input.sourceReservationId,
                        bulkSkuId: item.bulkSkuId,
                      },
                    },
                  });
                } else {
                  await tx.bookingBulkItem.update({
                    where: {
                      bookingId_bulkSkuId: {
                        bookingId: input.sourceReservationId,
                        bulkSkuId: item.bulkSkuId,
                      },
                    },
                    data: { checkedOutQuantity: { increment: item.quantity } },
                  });
                }
              }

              if (sourceCompleted) {
                await tx.booking.update({
                  where: { id: input.sourceReservationId },
                  data: { status: BookingStatus.COMPLETED, completedAt: new Date() },
                });
                await tx.assetAllocation.updateMany({
                  where: { bookingId: input.sourceReservationId },
                  data: { active: false },
                });
                await tx.scanSession.updateMany({
                  where: { bookingId: input.sourceReservationId, status: ScanSessionStatus.OPEN },
                  data: { status: ScanSessionStatus.CANCELLED },
                });
              } else {
                // Touch the source reservation so clients immediately see that
                // its remaining pickup work is still open after this handoff.
                await tx.booking.update({
                  where: { id: input.sourceReservationId },
                  data: { status: BookingStatus.BOOKED },
                });
              }

              await createAuditEntryTx(tx, {
                actorId: input.createdBy,
                actorRole,
                entityType: "booking",
                entityId: input.sourceReservationId,
                action: input.custodySource === "ADMIN_OVERRIDE"
                  ? "admin_force_checkout"
                  : sourceCompleted
                    ? "fulfilled_by_kiosk_pickup"
                    : "partially_fulfilled_by_kiosk_pickup",
                after: {
                  convertedToCheckoutId: booking.id,
                  pickedSerializedAssetIds: [...selectedSerializedAssetIds],
                  pickedBulkItems: resolvedBulkItems,
                  ...(input.custodySource === "ADMIN_OVERRIDE"
                    ? { reason: input.adminOverrideReason!.trim() }
                    : {}),
                  remainingSerializedCount,
                  remainingBulk: sourceReservationForPickup.bulkItems
                    .filter((item) => {
                      const pickedQuantity = (item.checkedOutQuantity ?? 0)
                        + (selectedBulkQuantityBySku.get(item.bulkSkuId) ?? 0);
                      return pickedQuantity < item.plannedQuantity;
                    })
                    .map((item) => ({
                      bulkSkuId: item.bulkSkuId,
                      quantity: item.plannedQuantity
                        - (item.checkedOutQuantity ?? 0)
                        - (selectedBulkQuantityBySku.get(item.bulkSkuId) ?? 0),
                    })),
                },
              });
            } else {
              await tx.booking.update({
                where: { id: input.sourceReservationId },
                data: { status: BookingStatus.COMPLETED, completedAt: new Date() }
              });

              await tx.assetAllocation.updateMany({
                where: { bookingId: input.sourceReservationId },
                data: { active: false }
              });

              await tx.scanSession.updateMany({
                where: { bookingId: input.sourceReservationId, status: ScanSessionStatus.OPEN },
                data: { status: ScanSessionStatus.CANCELLED }
              });

              await createAuditEntryTx(tx, {
                actorId: input.createdBy,
                actorRole,
                entityType: "booking",
                entityId: input.sourceReservationId,
                action: input.custodySource === "ADMIN_OVERRIDE"
                  ? "admin_force_checkout"
                  : "fulfilled_by_kiosk_pickup",
                after: {
                  convertedToCheckoutId: booking.id,
                  ...(input.custodySource === "ADMIN_OVERRIDE"
                    ? { reason: input.adminOverrideReason!.trim() }
                    : {}),
                },
              });
            }
          }

          if (input.custodySource === "ADMIN_OVERRIDE") {
            const reason = input.adminOverrideReason!.trim();
            const numberedUnits = (input.bulkUnitItems ?? []).map((unit) => ({
              bulkSkuId: unit.bulkSkuId,
              unitNumber: unit.unitNumber,
            }));
            const bulkQuantity = resolvedBulkItems.reduce((sum, item) => sum + item.quantity, 0);

            await tx.overrideEvent.create({
              data: {
                bookingId: booking.id,
                actorUserId: input.createdBy,
                reason,
                details: {
                  type: "admin_force_checkout",
                  refNumber: booking.refNumber,
                  sourceReservationId: input.sourceReservationId,
                  serializedPickedUpCount: resolvedSerializedAssetIds.length,
                  bulkPickedUpQuantity: bulkQuantity,
                  numberedUnits,
                  createdAt: new Date().toISOString(),
                },
              },
            });

            await createAuditEntryTx(tx, {
              actorId: input.createdBy,
              actorRole,
              entityType: "booking",
              entityId: booking.id,
              action: "admin_force_checkout",
              after: {
                reason,
                sourceReservationId: input.sourceReservationId,
                status: BookingStatus.OPEN,
                serializedPickedUpCount: resolvedSerializedAssetIds.length,
                bulkPickedUpQuantity: bulkQuantity,
                numberedUnits,
              },
            });
          }

          const createdBooking = await tx.booking.findUniqueOrThrow({
            where: { id: booking.id },
            include: bookingInclude
          });
          await finishKioskOperationReceiptTx(tx, input.kioskCompletionReceipt, {
            success: true, bookingId: booking.id, partial: hasRemainingReservationItems,
            itemCount: resolvedSerializedAssetIds.length + resolvedBulkItems.reduce((sum, item) => sum + item.quantity, 0),
          });
          return { booking: createdBooking, creationDisposition: "created" as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    const result = booking.booking;
    if (result.kind === BookingKind.CHECKOUT && result.status === BookingStatus.OPEN) {
      await scheduleCheckoutReturnLiveActivity({ bookingId: result.id, endsAt: result.endsAt });
    }

    if (
      booking.creationDisposition === "created"
      && result.kind === BookingKind.RESERVATION
      && result.shiftAssignment?.source === "RESERVATION"
    ) {
      await dispatchScheduleAssignmentNotifications(result.shiftAssignment.id, "assigned", { actorUserId: input.createdBy });
    }

    return Object.defineProperty(result, "creationDisposition", {
      value: booking.creationDisposition,
      enumerable: false,
      configurable: false,
      writable: false,
    }) as typeof result & { creationDisposition: typeof booking.creationDisposition };
  } catch (error) {
    handleBookingMutationRace(error);
  }
}

async function pickupAvailabilityMessage(
  tx: Prisma.TransactionClient,
  availability: Pick<AvailabilityResult, "conflicts" | "shortages" | "unavailableAssets">,
) {
  const assetId = availability.unavailableAssets[0]?.assetId ?? availability.conflicts[0]?.assetId;
  const bulkSkuId = availability.shortages[0]?.bulkSkuId;
  const [asset, sku] = await Promise.all([
    assetId ? tx.asset.findUnique({ where: { id: assetId }, select: { name: true, assetTag: true } }) : null,
    !assetId && bulkSkuId ? tx.bulkSku.findUnique({ where: { id: bulkSkuId }, select: { name: true } }) : null,
  ]);
  const name = asset?.name || asset?.assetTag || sku?.name || "An item";
  return kioskAvailabilityBlockMessage(availability, name);
}
