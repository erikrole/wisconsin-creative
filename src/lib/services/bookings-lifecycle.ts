import {
  AllocationKind,
  BookingKind,
  BookingStatus,
  BulkMovementKind,
  BulkUnitStatus,
  Prisma,
  Role,
  ScanSessionStatus
} from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { isSerializationConflict, withSerializationRetry } from "@/lib/serialization";
import {
  createAuditEntriesTx,
  createAuditEntryTx,
  lookupActorRole,
} from "@/lib/audit";
import { checkAvailability, type BulkRequest } from "@/lib/services/availability";
import { ACTIVE_BULK_UNIT_ALLOCATION_WHERE, CLAIMABLE_BULK_UNIT_WHERE, effectiveBulkUnitStatus } from "@/lib/bulk-unit-status";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { nextBookingRef } from "@/lib/services/booking-ref";
import {
  bookingInclude,
  dedupeIds,
  diffEquipment,
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
  hasCollaboratorCapability,
  type CollaboratorActor,
} from "@/lib/collaborator-access";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";
import {
  MAX_CHECKOUT_BULK_LINE_CHANGES_PER_REQUEST,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
  MAX_LINKED_EVENTS_PER_BOOKING,
} from "@/lib/request-limits";
import { assertCheckoutDistinctBulkSkuLimit } from "@/lib/services/kiosk-checkout-complete";
import {
  createShiftScheduleNotification,
  dispatchScheduleAssignmentNotifications,
} from "@/lib/services/notifications";
import {
  assignReservationRequesterToScheduleTx,
  reconcileReservationScheduleTx,
  releaseReservationManagedAssignmentTx,
  validateReservationScheduleAssignmentTx,
  type ReservationScheduleAssignment,
  type ReservationScheduleRequester,
} from "@/lib/services/reservation-schedule";
import { assertBookingSnapshot } from "@/lib/booking-concurrency";

type CreateBookingInput = {
  kind: BookingKind;
  /** Reservation-only concurrency cap. When present, the active BOOKED count
   * is checked in the same SERIALIZABLE transaction as the insert. */
  maxConcurrentReservations?: number;
  custodySource?: "KIOSK" | "ADMIN_OVERRIDE";
  /** Required when an admin creates checkout custody without a kiosk scan. */
  adminOverrideReason?: string;
  title: string;
  requesterUserId: string;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  serializedAssetIds: string[];
  bulkItems: BulkRequest[];
  notes?: string;
  createdBy: string;
  sourceReservationId?: string;
  /** Owned DRAFT row consumed atomically when a reservation is created. */
  sourceDraftId?: string;
  eventId?: string;
  /** Optional multi-event linking. If provided, events are sorted chronologically
   * and the first one becomes the primary (`Booking.eventId`). Mutually exclusive
   * with `eventId` — callers pick one. Cap five events. */
  eventIds?: string[];
  sportCode?: string;
  shiftAssignmentId?: string;
  kitId?: string;
  /** KioskDevice that handled pickup — captured at kiosk custody transitions. */
  pickupKioskDeviceId?: string;
  /** Kiosk reservation pickup: exact numbered bulk units to bind inside the
   * same transaction that opens the checkout and completes the reservation,
   * so a failed unit bind rolls the whole pickup back. CHECKOUT kind only. */
  bulkUnitItems?: Array<{ bulkSkuId: string; unitNumber: number }>;
  /** When set with sourceReservationId, serializedAssetIds and bulkItems are
   * the exact reservation items being picked up now. The source reservation
   * remains BOOKED until every remaining item is picked up. */
  sourceReservationPickup?: boolean;
};

type UpdateBookingInput = {
  title?: string;
  requesterUserId?: string;
  locationId?: string;
  startsAt?: Date;
  endsAt?: Date;
  serializedAssetIds?: string[];
  bulkItems?: BulkRequest[];
  notes?: string;
};

type TransferBookingOwnerInput = {
  targetUserId: string;
  reason?: string;
};

const OWNER_TRANSFER_STATUSES = new Set<BookingStatus>([
  BookingStatus.DRAFT,
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
]);

const EVENT_LINK_STATUSES = new Set<BookingStatus>([
  BookingStatus.DRAFT,
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
]);

function hasDuplicateIds(ids: string[]) {
  return new Set(ids).size !== ids.length;
}

function isStaffOrAdmin(role: Role | null | undefined) {
  return role === Role.ADMIN || role === Role.STAFF;
}

function assertValidBookingWindow(startsAt: Date, endsAt: Date) {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new HttpError(400, "Invalid startsAt or endsAt");
  }
  if (endsAt <= startsAt) {
    throw new HttpError(400, "endsAt must be later than startsAt");
  }
}

function assertValidCreateEventLinks(input: CreateBookingInput) {
  if (input.eventId && input.eventIds && input.eventIds.length > 0) {
    throw new HttpError(400, "Provide either eventId or eventIds, not both");
  }
  if (input.eventIds && input.eventIds.length > MAX_LINKED_EVENTS_PER_BOOKING) {
    throw new HttpError(400, `A booking may link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events`);
  }
  if (input.eventIds && hasDuplicateIds(input.eventIds)) {
    throw new HttpError(400, "eventIds must be unique");
  }
}

function assertValidEventLinks(eventIds: string[]) {
  if (eventIds.length > MAX_LINKED_EVENTS_PER_BOOKING) {
    throw new HttpError(400, `A booking may link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events`);
  }
  if (hasDuplicateIds(eventIds)) {
    throw new HttpError(400, "eventIds must be unique");
  }
}

function assertValidCreateEquipment(serializedAssetIds: string[], bulkItems: BulkRequest[]) {
  if (serializedAssetIds.length === 0 && bulkItems.length === 0) {
    throw new HttpError(400, "Add at least one piece of equipment");
  }

  const seenBulkSkuIds = new Set<string>();
  for (const item of bulkItems) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new HttpError(400, "Bulk item quantities must be positive whole numbers");
    }
    if (seenBulkSkuIds.has(item.bulkSkuId)) {
      throw new HttpError(400, "Duplicate bulk item");
    }
    seenBulkSkuIds.add(item.bulkSkuId);
  }
}

async function assertNumberedPickupPlanLimit(
  tx: Prisma.TransactionClient,
  bulkItems: BulkRequest[],
): Promise<void> {
  if (bulkItems.length === 0) return;

  const numberedSkus = await tx.bulkSku.findMany({
    where: {
      id: { in: [...new Set(bulkItems.map((item) => item.bulkSkuId))] },
      trackByNumber: true,
    },
    select: { id: true },
  });
  const numberedSkuIds = new Set(numberedSkus.map((sku) => sku.id));
  const numberedPickupTotal = bulkItems.reduce(
    (total, item) => total + (numberedSkuIds.has(item.bulkSkuId) ? item.quantity : 0),
    0,
  );

  if (numberedPickupTotal > MAX_EQUIPMENT_SELECTIONS_PER_REQUEST) {
    throw new HttpError(
      400,
      `Numbered pickup plans support at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} units total`,
    );
  }
}

function assertCheckoutBulkLineChangeLimit(
  existingItems: Array<{ bulkSkuId: string; plannedQuantity: number }>,
  nextItems: BulkRequest[],
) {
  const nextBySku = new Map(nextItems.map((item) => [item.bulkSkuId, item.quantity]));
  const existingSkuIds = new Set(existingItems.map((item) => item.bulkSkuId));
  const changedExistingCount = existingItems.filter(
    (item) => nextBySku.get(item.bulkSkuId) !== item.plannedQuantity,
  ).length;
  const addedCount = nextItems.filter((item) => !existingSkuIds.has(item.bulkSkuId)).length;
  const changeCount = changedExistingCount + addedCount;

  if (changeCount > MAX_CHECKOUT_BULK_LINE_CHANGES_PER_REQUEST) {
    throw new HttpError(
      400,
      `Change at most ${MAX_CHECKOUT_BULK_LINE_CHANGES_PER_REQUEST} bulk lines per checkout update`,
    );
  }
}

function assertCheckoutCustodySource(input: CreateBookingInput) {
  if (
    input.kind === BookingKind.CHECKOUT
    && input.custodySource !== "KIOSK"
    && input.custodySource !== "ADMIN_OVERRIDE"
  ) {
    throw new HttpError(403, "Direct checkout custody can only be created at a kiosk");
  }

  if (input.adminOverrideReason !== undefined && input.custodySource !== "ADMIN_OVERRIDE") {
    throw new HttpError(400, "Admin override details require admin checkout custody");
  }

  if (input.custodySource === "ADMIN_OVERRIDE") {
    if (input.kind !== BookingKind.CHECKOUT || !input.sourceReservationId || !input.sourceReservationPickup) {
      throw new HttpError(400, "Admin checkout override requires a reservation pickup");
    }
    const reason = input.adminOverrideReason?.trim() ?? "";
    if (reason.length < 10) {
      throw new HttpError(400, "Reason must be at least 10 characters");
    }
  }
}

function assertValidMaxConcurrentReservations(input: CreateBookingInput) {
  const cap = input.maxConcurrentReservations;
  if (cap === undefined) return;
  if (input.kind !== BookingKind.RESERVATION) {
    throw new HttpError(400, "maxConcurrentReservations only applies to reservations");
  }
  if (!Number.isFinite(cap) || !Number.isInteger(cap) || cap < 1 || cap > 50) {
    throw new HttpError(400, "maxConcurrentReservations must be a whole number between 1 and 50");
  }
}

function prismaErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const meta = typeof error === "object" && error && "meta" in error
    ? JSON.stringify((error as { meta?: unknown }).meta ?? {})
    : "";
  return `${message} ${meta}`;
}

function isBookingAllocationConstraintError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const text = prismaErrorText(error);

  if (code === "23P01" || text.includes("asset_allocations_no_overlap")) {
    return true;
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code === "P2002") {
    const target = (error.meta?.target as string[] | string | undefined) ?? "";
    const targetStr = Array.isArray(target) ? target.join(",") : String(target);
    return (
      targetStr.includes("asset_allocations_asset_id_active_unique") ||
      targetStr.includes("asset_id")
    );
  }

  return error.code === "P2004" && text.includes("asset_allocations");
}

function handleBookingMutationRace(error: unknown): never {
  if (isSerializationConflict(error)) {
    throw new HttpError(409, "Someone else submitted at the same time; please try again.");
  }
  if (isBookingAllocationConstraintError(error)) {
    throw new HttpError(409, "One or more items are no longer available");
  }
  throw error;
}

function eventLinkWhereForActor(
  eventIds: string[],
  actor: CollaboratorActor,
): Prisma.CalendarEventWhereInput {
  const where: Prisma.CalendarEventWhereInput = { id: { in: eventIds } };
  if (actor.role !== Role.COLLABORATOR) return where;
  if (!hasCollaboratorCapability(actor, "PUBLISHED_SCHEDULE_VIEW")) {
    throw new HttpError(403, "Forbidden");
  }
  return {
    ...where,
    isHidden: false,
    archivedAt: null,
    shiftGroup: {
      is: {
        publishedAt: { not: null },
        archivedAt: null,
        lastPublishedSnapshot: { not: Prisma.JsonNull },
      },
    },
  };
}

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

          if (input.maxConcurrentReservations !== undefined) {
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

          assertValidCreateEquipment(resolvedSerializedAssetIds, resolvedBulkItems);
          if (input.kind === BookingKind.CHECKOUT) {
            assertCheckoutDistinctBulkSkuLimit(
              resolvedBulkItems,
              input.sourceReservationId ? "reservation pickup" : "checkout",
            );
          }
          await assertNumberedPickupPlanLimit(tx, resolvedBulkItems);

          const availability = await checkAvailability(tx, {
            locationId: input.locationId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            serializedAssetIds: resolvedSerializedAssetIds,
            bulkItems: resolvedBulkItems,
            excludeBookingId: input.sourceReservationId,
            bookingKind: input.kind,
          });

          if (availability.conflicts.length > 0 || availability.shortages.length > 0 || availability.unavailableAssets.length > 0) {
            throw new HttpError(409, "Availability conflict", availability);
          }

          // Reservation intent stays BOOKED until custody is proven. Kiosk
          // pickup and the admin force-checkout exception both open custody
          // directly instead of creating the retired staged PENDING_PICKUP
          // checkout state.
          const status = input.kind === BookingKind.RESERVATION
            ? BookingStatus.BOOKED
            : BookingStatus.OPEN;

          // Resolve event linking: multi-event (eventIds) or legacy single (eventId).
          // Sort chronologically so primary = first.
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

          if (input.shiftAssignmentId) {
            await validateReservationScheduleAssignmentTx(tx, {
              assignmentId: input.shiftAssignmentId,
              requesterUserId: input.requesterUserId,
              eventIds: sortedEventIds,
            });
          }

          const prefix = input.kind === BookingKind.CHECKOUT ? "CO" : "RV";
          const refNumber = await nextBookingRef(tx, prefix);

          const title = normalizeBookingTitle(input.title);
          const booking = await tx.booking.create({
            data: {
              kind: input.kind,
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
              shiftAssignmentId: input.shiftAssignmentId ?? null,
              kitId: input.kitId ?? null,
              pickupKioskDeviceId: input.pickupKioskDeviceId ?? null
            }
          });

          let reservationScheduleAssignment: ReservationScheduleAssignment | null = null;
          if (sortedEventIds.length > 0) {
            await tx.bookingEvent.createMany({
              data: sortedEventIds.map((eventId, ordinal) => ({
                bookingId: booking.id,
                eventId,
                ordinal,
              })),
            });
            if (
              input.kind === BookingKind.RESERVATION &&
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
              && primaryEventId
              && !input.shiftAssignmentId
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

            await tx.assetAllocation.createMany({
              data: resolvedSerializedAssetIds.map((assetId) => ({
                bookingId: booking.id,
                assetId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
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
            await tx.bookingBulkItem.createMany({
              data: resolvedBulkItems.map((item) => {
                const checkedOutQuantity = checkoutUnitCountBySku.get(item.bulkSkuId);
                return {
                  bookingId: booking.id,
                  bulkSkuId: item.bulkSkuId,
                  plannedQuantity: item.quantity,
                  ...(checkedOutQuantity === undefined ? {} : { checkedOutQuantity }),
                };
              })
            });

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

            // The ledger was decremented by plannedQuantity — custody must bind
            // exactly that many units per numbered SKU, or the balance and the
            // physical checkout disagree from the first minute. (The kiosk route
            // blocks under-staging; this is the in-transaction backstop and also
            // catches over-staging.)
            for (const item of checkoutBulkItems) {
              if (!item.bulkSku.trackByNumber) continue;
              const bound = units.filter((unit) => unit.bulkSkuId === item.bulkSkuId).length;
              if (bound !== item.plannedQuantity) {
                throw new HttpError(
                  409,
                  `${item.bulkSku.name}: ${bound} of ${item.plannedQuantity} numbered units scanned — scan exactly the planned units before confirming`,
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
            action: "created",
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
              shiftAssignmentId: reservationScheduleAssignment?.shiftAssignmentId ?? input.shiftAssignmentId ?? null,
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

              if (selectedSerializedAssetIds.size > 0) {
                await tx.bookingSerializedItem.updateMany({
                  where: {
                    bookingId: input.sourceReservationId,
                    assetId: { in: [...selectedSerializedAssetIds] },
                    allocationStatus: "active",
                  },
                  data: { allocationStatus: "picked_up" },
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

          return tx.booking.findUniqueOrThrow({
            where: { id: booking.id },
            include: bookingInclude
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    if (booking.kind === BookingKind.CHECKOUT && booking.status === BookingStatus.OPEN) {
      await scheduleCheckoutReturnLiveActivity({ bookingId: booking.id, endsAt: booking.endsAt });
    }

    if (booking.kind === BookingKind.RESERVATION && booking.shiftAssignment?.source === "RESERVATION") {
      await dispatchScheduleAssignmentNotifications(booking.shiftAssignment.id, "assigned");
    }

    return booking;
  } catch (error) {
    handleBookingMutationRace(error);
  }
}

/**
 * Create checkout custody for the remaining equipment on a reservation when an
 * admin has verified the physical handoff but kiosk scanning is unavailable.
 *
 * Unit selection is deliberately server-side and deterministic. Durable staged
 * unit scans are preferred when those units are still claimable; any remainder
 * is filled from the lowest-numbered available units. `createBooking()` then
 * rechecks the source reservation, availability, and unit claims in its own
 * SERIALIZABLE transaction before committing the custody record.
 */
export async function forceCheckoutReservation(args: {
  reservationId: string;
  actorUserId: string;
  reason: string;
}) {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    throw new HttpError(400, "Reason must be at least 10 characters");
  }
  if (reason.length > 1000) {
    throw new HttpError(400, "Reason must be at most 1000 characters");
  }

  const source = await db.booking.findUnique({
    where: { id: args.reservationId },
    select: {
      id: true,
      kind: true,
      status: true,
      title: true,
      requesterUserId: true,
      locationId: true,
      startsAt: true,
      endsAt: true,
      notes: true,
      eventId: true,
      sportCode: true,
      shiftAssignmentId: true,
      kitId: true,
      serializedItems: {
        select: { assetId: true, allocationStatus: true },
      },
      bulkItems: {
        select: {
          bulkSkuId: true,
          plannedQuantity: true,
          checkedOutQuantity: true,
          bulkSku: {
            select: {
              id: true,
              name: true,
              trackByNumber: true,
              binQrCodeValue: true,
            },
          },
        },
      },
      scanEvents: {
        where: {
          phase: "CHECKOUT",
          scanType: "BULK_BIN",
          success: true,
        },
        orderBy: { createdAt: "asc" },
        select: { bulkSkuId: true, scanValue: true },
      },
      events: {
        orderBy: { ordinal: "asc" },
        select: { eventId: true },
      },
    },
  });

  if (!source || source.kind !== BookingKind.RESERVATION) {
    throw new HttpError(404, "Reservation not found");
  }
  if (source.status !== BookingStatus.BOOKED) {
    throw new HttpError(400, `Reservation is not in BOOKED status (current: ${source.status})`);
  }

  const startsAt = new Date();
  if (source.endsAt <= startsAt) {
    throw new HttpError(400, "Reservation end time has passed; extend it before force checkout");
  }

  const serializedAssetIds = source.serializedItems
    .filter((item) => item.allocationStatus === "active")
    .map((item) => item.assetId);
  const remainingBulkItems = source.bulkItems
    .map((item) => ({
      bulkSkuId: item.bulkSkuId,
      quantity: Math.max(0, item.plannedQuantity - (item.checkedOutQuantity ?? 0)),
    }))
    .filter((item) => item.quantity > 0);

  const numberedSourceSkus = source.bulkItems
    .filter((item) => item.bulkSku.trackByNumber && remainingBulkItems.some((remaining) => remaining.bulkSkuId === item.bulkSkuId))
    .map((item) => item.bulkSku);
  const stagedUnitNumbersBySku = new Map<string, number[]>();
  const sourceSkuCandidates = source.bulkItems.map((item) => item.bulkSku);
  for (const event of source.scanEvents) {
    if (!event.bulkSkuId) continue;
    const match = parseDerivedBulkUnitQr(event.scanValue, sourceSkuCandidates);
    if (!match || match.bulkSkuId !== event.bulkSkuId) continue;
    const numbers = stagedUnitNumbersBySku.get(match.bulkSkuId) ?? [];
    if (!numbers.includes(match.unitNumber)) numbers.push(match.unitNumber);
    stagedUnitNumbersBySku.set(match.bulkSkuId, numbers);
  }

  const availableUnits = numberedSourceSkus.length > 0
    ? await db.bulkSkuUnit.findMany({
        where: {
          bulkSkuId: { in: numberedSourceSkus.map((sku) => sku.id) },
          ...CLAIMABLE_BULK_UNIT_WHERE,
        },
        orderBy: [{ bulkSkuId: "asc" }, { unitNumber: "asc" }],
        select: { bulkSkuId: true, unitNumber: true },
      })
    : [];
  const availableNumbersBySku = new Map<string, number[]>();
  for (const unit of availableUnits) {
    const numbers = availableNumbersBySku.get(unit.bulkSkuId) ?? [];
    numbers.push(unit.unitNumber);
    availableNumbersBySku.set(unit.bulkSkuId, numbers);
  }

  const bulkUnitItems: Array<{ bulkSkuId: string; unitNumber: number }> = [];
  for (const item of remainingBulkItems) {
    const sourceItem = source.bulkItems.find((candidate) => candidate.bulkSkuId === item.bulkSkuId);
    if (!sourceItem?.bulkSku.trackByNumber) continue;

    const availableNumbers = availableNumbersBySku.get(item.bulkSkuId) ?? [];
    const availableSet = new Set(availableNumbers);
    const preferredNumbers = (stagedUnitNumbersBySku.get(item.bulkSkuId) ?? [])
      .filter((unitNumber) => availableSet.has(unitNumber));
    const selectedNumbers = [...new Set([
      ...preferredNumbers,
      ...availableNumbers.filter((unitNumber) => !preferredNumbers.includes(unitNumber)),
    ])].slice(0, item.quantity);

    if (selectedNumbers.length !== item.quantity) {
      throw new HttpError(
        409,
        `${sourceItem.bulkSku.name}: ${item.quantity} numbered units are required, but only ${selectedNumbers.length} are available for force checkout`,
      );
    }

    bulkUnitItems.push(...selectedNumbers.map((unitNumber) => ({
      bulkSkuId: item.bulkSkuId,
      unitNumber,
    })));
  }

  if (serializedAssetIds.length === 0 && remainingBulkItems.length === 0) {
    throw new HttpError(409, "This reservation has no remaining items to force checkout");
  }

  const eventIds = source.events.map((event) => event.eventId);
  return createBooking({
    kind: BookingKind.CHECKOUT,
    custodySource: "ADMIN_OVERRIDE",
    adminOverrideReason: reason,
    title: source.title,
    requesterUserId: source.requesterUserId,
    locationId: source.locationId,
    startsAt,
    endsAt: source.endsAt,
    notes: source.notes ?? undefined,
    createdBy: args.actorUserId,
    sourceReservationId: source.id,
    sourceReservationPickup: true,
    eventIds: eventIds.length > 0 ? eventIds : undefined,
    eventId: eventIds.length === 0 ? source.eventId ?? undefined : undefined,
    sportCode: source.sportCode ?? undefined,
    shiftAssignmentId: source.shiftAssignmentId ?? undefined,
    kitId: source.kitId ?? undefined,
    serializedAssetIds,
    bulkItems: remainingBulkItems,
    bulkUnitItems,
  });
}

export async function updateReservation(
  bookingId: string,
  actorUserId: string,
  updates: UpdateBookingInput,
  expectedUpdatedAt?: Date,
) {
  const scheduleNotificationAssignmentIds: string[] = [];
  let updated;
  try {
    updated = await db.$transaction(
      async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          serializedItems: true,
          bulkItems: true,
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
        }
      });

      if (!existing) {
        throw new HttpError(404, "Reservation not found");
      }

      assertBookingSnapshot(existing.updatedAt, expectedUpdatedAt);

      if (existing.kind !== BookingKind.RESERVATION) {
        throw new HttpError(400, "Only reservations can be updated with this endpoint");
      }

      if (existing.status === BookingStatus.CANCELLED || existing.status === BookingStatus.COMPLETED) {
        throw new HttpError(400, "Cannot edit a cancelled or completed reservation");
      }

      let nextRequester: ReservationScheduleRequester | null = existing.requester ?? null;
      if (updates.requesterUserId && updates.requesterUserId !== existing.requesterUserId) {
        const requester = await tx.user.findUnique({
          where: { id: updates.requesterUserId },
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
          },
        });
        if (!requester) throw new HttpError(400, "Requester not found");
        if (!requester.active) throw new HttpError(400, "Cannot set an inactive user as requester");
        nextRequester = requester;
      }

      const nextStartsAt = updates.startsAt ?? existing.startsAt;
      const nextEndsAt = updates.endsAt ?? existing.endsAt;
      const nextLocationId = updates.locationId ?? existing.locationId;
      assertValidBookingWindow(nextStartsAt, nextEndsAt);
      const serializedAssetIds = dedupeIds(
        updates.serializedAssetIds ?? existing.serializedItems.map((item) => item.assetId)
      );
      const bulkItems = updates.bulkItems ??
        existing.bulkItems.map((item) => ({
          bulkSkuId: item.bulkSkuId,
          quantity: item.plannedQuantity
        }));
      const updatesEquipment = updates.serializedAssetIds !== undefined || updates.bulkItems !== undefined;
      const updatesWindow = updates.startsAt !== undefined || updates.endsAt !== undefined || updates.locationId !== undefined;

      const hasPickedUpEquipment =
        existing.serializedItems.some((item) => item.allocationStatus === "picked_up")
        || existing.bulkItems.some((item) => (item.checkedOutQuantity ?? 0) > 0);
      if (updatesEquipment && hasPickedUpEquipment) {
        throw new HttpError(409, "Equipment cannot be edited after a partial pickup");
      }

      if (updatesEquipment) {
        await assertNumberedPickupPlanLimit(tx, bulkItems);
      }

      if (updatesEquipment || updatesWindow) {
        const availability = await checkAvailability(tx, {
          locationId: nextLocationId,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          serializedAssetIds,
          bulkItems,
          excludeBookingId: bookingId,
          bookingKind: "RESERVATION",
        });

        if (availability.conflicts.length > 0 || availability.shortages.length > 0 || availability.unavailableAssets.length > 0) {
          throw new HttpError(409, "Availability conflict", availability);
        }
      }

      const title = updates.title === undefined ? undefined : normalizeBookingTitle(updates.title);
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          title,
          requesterUserId: updates.requesterUserId,
          locationId: nextLocationId,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          notes: updates.notes
        }
      });

      if (!updatesEquipment) {
        if (updatesWindow) {
          await tx.assetAllocation.updateMany({
            where: { bookingId },
            data: {
              startsAt: nextStartsAt,
              endsAt: nextEndsAt,
            },
          });
        }
      } else {
        await tx.bookingSerializedItem.deleteMany({ where: { bookingId } });
        await tx.assetAllocation.deleteMany({ where: { bookingId } });
        await tx.bookingBulkItem.deleteMany({ where: { bookingId } });

        if (serializedAssetIds.length > 0) {
          await tx.bookingSerializedItem.createMany({
            data: serializedAssetIds.map((assetId) => ({
              bookingId,
              assetId,
              allocationStatus: "active"
            }))
          });

          await tx.assetAllocation.createMany({
            data: serializedAssetIds.map((assetId) => ({
              bookingId,
              assetId,
              startsAt: nextStartsAt,
              endsAt: nextEndsAt,
              active: true,
              kind: "RESERVATION"
            }))
          });
        }

        if (bulkItems.length > 0) {
          await tx.bookingBulkItem.createMany({
            data: bulkItems.map((item) => ({
              bookingId,
              bulkSkuId: item.bulkSkuId,
              plannedQuantity: item.quantity
            }))
          });
        }
      }

      // Granular equipment audit entries
      const equipEntries = diffEquipment(
        existing.serializedItems.map((i) => i.assetId),
        serializedAssetIds,
        existing.bulkItems.map((i) => ({ bulkSkuId: i.bulkSkuId, quantity: i.plannedQuantity })),
        bulkItems
      );

      // General "updated" entry for non-equipment fields
      const fieldChanges: AuditJson = {};
      if (title && title !== existing.title) fieldChanges.title = title;
      if (updates.notes !== undefined && updates.notes !== existing.notes) fieldChanges.notes = updates.notes ?? null;
      if (updates.startsAt && updates.startsAt.toISOString() !== existing.startsAt.toISOString()) fieldChanges.startsAt = updates.startsAt.toISOString();
      if (updates.endsAt && updates.endsAt.toISOString() !== existing.endsAt.toISOString()) fieldChanges.endsAt = updates.endsAt.toISOString();

      const actorRole = await lookupActorRole(tx, actorUserId);

      if (Object.keys(fieldChanges).length > 0 || equipEntries.length === 0) {
        await createAuditEntryTx(tx, {
          actorId: actorUserId,
          actorRole,
          entityType: "booking",
          entityId: bookingId,
          action: "updated",
          before: {
            title: existing.title,
            startsAt: existing.startsAt.toISOString(),
            endsAt: existing.endsAt.toISOString(),
            notes: existing.notes,
          } as AuditJson as Record<string, unknown>,
          after: fieldChanges as Record<string, unknown>,
        });
      }

      if (equipEntries.length > 0) {
        await createAuditEntriesTx(
          tx,
          equipEntries.map((entry) => ({
            actorId: actorUserId,
            actorRole,
            entityType: "booking",
            entityId: bookingId,
            action: entry.action,
            before: entry.beforeJson as Record<string, unknown>,
            after: entry.afterJson as Record<string, unknown>,
          })),
        );
      }

      const shouldReconcileSchedule = Boolean(
        existing.eventId
        || existing.shiftAssignmentId
        || (updates.requesterUserId !== undefined && existing.eventId),
      );
      if (shouldReconcileSchedule) {
        const scheduleOutcome = await reconcileReservationScheduleTx(tx, {
          bookingId,
          requesterUserId: updates.requesterUserId ?? existing.requesterUserId,
          requester: nextRequester,
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
            actorRole,
            entityType: "shift_assignment",
            entityId: scheduleOutcome.releasedAssignmentId,
            action: "shift_assignment_removed",
            before: {
              source: "event_gear_reservation",
              bookingId,
            },
            after: {
              reason: "reservation_schedule_reconciled",
            },
          });
        }
        if (scheduleOutcome.status === "needs_review" || scheduleOutcome.status === "blocked_working_copy") {
          await createAuditEntryTx(tx, {
            actorId: actorUserId,
            actorRole,
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
        include: bookingInclude
      });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    handleBookingMutationRace(error);
  }

  for (const assignmentId of scheduleNotificationAssignmentIds) {
    await dispatchScheduleAssignmentNotifications(assignmentId, "assigned");
  }
  return updated;
}

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
        if (existing.kind === BookingKind.RESERVATION && existing.requesterUserId && existing.requester) {
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

        return tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: bookingInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    for (const assignmentId of scheduleNotificationAssignmentIds) {
      await dispatchScheduleAssignmentNotifications(assignmentId, "assigned");
    }
    return updated;
  } catch (error) {
    handleBookingMutationRace(error);
  }
}

export async function cancelReservation(bookingId: string, actorUserId: string) {
  let releasedAssignmentId: string | null = null;
  const result = await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });

    if (!booking) {
      throw new HttpError(404, "Reservation not found");
    }

    if (booking.kind !== BookingKind.RESERVATION) {
      throw new HttpError(400, "Only reservations can be cancelled");
    }

    // Route policy also blocks these, but it reads outside this transaction —
    // a reservation completed in that window must not be flipped to CANCELLED.
    if (booking.status === BookingStatus.CANCELLED) {
      throw new HttpError(400, "Reservation is already cancelled");
    }
    if (booking.status === BookingStatus.COMPLETED) {
      throw new HttpError(400, "Cannot cancel a completed reservation");
    }

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
        after: { reason: "reservation_cancelled" },
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
          reason: "Reservation cancelled while its schedule working copy was open.",
        },
      });
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED }
    });

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

    return { success: true, scheduleAssignmentReleased: Boolean(releasedAssignmentId) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (releasedAssignmentId) {
    await createShiftScheduleNotification(releasedAssignmentId, "removed");
  }
  return result;
}

export async function updateCheckout(
  bookingId: string,
  actorUserId: string,
  updates: UpdateBookingInput,
  expectedUpdatedAt?: Date,
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

      const serializedAssetIds = dedupeIds(
        updates.serializedAssetIds ?? existing.serializedItems.map((item) => item.assetId)
      );
      const bulkItems = updates.bulkItems ??
        existing.bulkItems.map((item) => ({
          bulkSkuId: item.bulkSkuId,
          quantity: item.plannedQuantity
        }));
      const updatesEquipment = updates.serializedAssetIds !== undefined || updates.bulkItems !== undefined;
      const updatesWindow = updates.endsAt !== undefined || updates.locationId !== undefined;

      if (updates.bulkItems !== undefined) {
        assertCheckoutDistinctBulkSkuLimit(bulkItems);
        assertCheckoutBulkLineChangeLimit(existing.bulkItems, bulkItems);
      }

      if (updatesEquipment || updatesWindow) {
        const availability = await checkAvailability(tx, {
          locationId: nextLocationId,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          serializedAssetIds,
          bulkItems,
          excludeBookingId: bookingId,
          bookingKind: "CHECKOUT",
        });

        if (availability.conflicts.length > 0 || availability.shortages.length > 0 || availability.unavailableAssets.length > 0) {
          throw new HttpError(409, "Conflicts with another booking", availability);
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

      if (!updatesEquipment) {
        if (updatesWindow) {
          await tx.assetAllocation.updateMany({
            where: { bookingId },
            data: {
              startsAt: nextStartsAt,
              endsAt: nextEndsAt,
            },
          });
        }
      } else {
        // Diff-based equipment edits. A checkout carries custody state that a
        // delete-all rebuild erases: returned serialized items would flip back
        // to "active", numbered bulk unit allocations cascade away leaving
        // stale CHECKED_OUT flags, and bulk quantity changes without matching
        // stock movements drift BulkStockBalance — which availability reads.
        const nextAssetIdSet = new Set(serializedAssetIds);
        const removedSerialized = existing.serializedItems.filter((item) => !nextAssetIdSet.has(item.assetId));
        const returnedRemoval = removedSerialized.find((item) => item.allocationStatus === "returned");
        if (returnedRemoval) {
          throw new HttpError(409, "A returned item cannot be removed from this checkout's record");
        }
        const currentAssetIdSet = new Set(existing.serializedItems.map((item) => item.assetId));
        const addedAssetIds = serializedAssetIds.filter((assetId) => !currentAssetIdSet.has(assetId));

        if (removedSerialized.length > 0) {
          const removedIds = removedSerialized.map((item) => item.assetId);
          await tx.bookingSerializedItem.deleteMany({ where: { bookingId, assetId: { in: removedIds } } });
          await tx.assetAllocation.deleteMany({ where: { bookingId, assetId: { in: removedIds } } });
        }
        if (addedAssetIds.length > 0) {
          await tx.bookingSerializedItem.createMany({
            data: addedAssetIds.map((assetId) => ({
              bookingId,
              assetId,
              allocationStatus: "active"
            }))
          });

          await tx.assetAllocation.createMany({
            data: addedAssetIds.map((assetId) => ({
              bookingId,
              assetId,
              startsAt: nextStartsAt,
              endsAt: nextEndsAt,
              active: true,
              kind: "CHECKOUT"
            }))
          });
        }

        // Bulk rows: SKUs with kiosk custody activity are kiosk-owned; the
        // rest may be re-planned here with matching stock movements.
        const nextBulkMap = new Map(bulkItems.map((item) => [item.bulkSkuId, item.quantity]));
        const currentBulkSkuIds = new Set(existing.bulkItems.map((item) => item.bulkSkuId));
        const increases: BulkRequest[] = [];
        const decreases: BulkRequest[] = [];

        for (const item of existing.bulkItems) {
          const nextQuantity = nextBulkMap.get(item.bulkSkuId);
          if (nextQuantity === item.plannedQuantity) continue;
          const hasCustodyState = item.checkedOutQuantity !== null
            || (item.checkedInQuantity ?? 0) > 0
            || item.unitAllocations.length > 0;
          if (hasCustodyState) {
            throw new HttpError(409, "Bulk gear on this checkout has kiosk custody activity. Return or adjust it at the kiosk instead.");
          }
          if (nextQuantity === undefined) {
            decreases.push({ bulkSkuId: item.bulkSkuId, quantity: item.plannedQuantity });
            await tx.bookingBulkItem.deleteMany({ where: { id: item.id } });
          } else {
            const delta = nextQuantity - item.plannedQuantity;
            if (delta > 0) increases.push({ bulkSkuId: item.bulkSkuId, quantity: delta });
            else decreases.push({ bulkSkuId: item.bulkSkuId, quantity: -delta });
            await tx.bookingBulkItem.update({
              where: { id: item.id },
              data: { plannedQuantity: nextQuantity },
            });
          }
        }

        const addedBulk = bulkItems.filter((item) => !currentBulkSkuIds.has(item.bulkSkuId));
        if (addedBulk.length > 0) {
          await tx.bookingBulkItem.createMany({
            data: addedBulk.map((item) => ({
              bookingId,
              bulkSkuId: item.bulkSkuId,
              plannedQuantity: item.quantity,
            }))
          });
          increases.push(...addedBulk.map((item) => ({ bulkSkuId: item.bulkSkuId, quantity: item.quantity })));
        }

        if (decreases.length > 0) {
          await upsertBulkBalancesAndMovements(tx, {
            locationId: existing.locationId,
            bookingId,
            actorUserId,
            kind: BulkMovementKind.CHECKIN,
            items: decreases,
          });
        }
        if (increases.length > 0) {
          await upsertBulkBalancesAndMovements(tx, {
            locationId: existing.locationId,
            bookingId,
            actorUserId,
            kind: BulkMovementKind.CHECKOUT,
            items: increases,
          });
        }

        if (updatesWindow) {
          await tx.assetAllocation.updateMany({
            where: { bookingId },
            data: { startsAt: nextStartsAt, endsAt: nextEndsAt },
          });
        }
      }

      // Granular equipment audit entries
      const equipEntries = diffEquipment(
        existing.serializedItems.map((i) => i.assetId),
        serializedAssetIds,
        existing.bulkItems.map((i) => ({ bulkSkuId: i.bulkSkuId, quantity: i.plannedQuantity })),
        bulkItems
      );

      const fieldChanges: AuditJson = {};
      if (title && title !== existing.title) fieldChanges.title = title;
      if (updates.notes !== undefined && updates.notes !== existing.notes) fieldChanges.notes = updates.notes ?? null;
      if (updates.endsAt && updates.endsAt.toISOString() !== existing.endsAt.toISOString()) fieldChanges.endsAt = updates.endsAt.toISOString();

      const actorRole = await lookupActorRole(tx, actorUserId);

      if (Object.keys(fieldChanges).length > 0 || equipEntries.length === 0) {
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
      }

      if (equipEntries.length > 0) {
        await createAuditEntriesTx(
          tx,
          equipEntries.map((entry) => ({
            actorId: actorUserId,
            actorRole,
            entityType: "booking",
            entityId: bookingId,
            action: entry.action,
            before: entry.beforeJson as Record<string, unknown>,
            after: entry.afterJson as Record<string, unknown>,
          })),
        );
      }

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
      await dispatchScheduleAssignmentNotifications(assignmentId, "assigned");
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

      const serializedAssetIds = existing.serializedItems.map((i) => i.assetId);
      const bulkItems = existing.bulkItems.map((i) => ({
        bulkSkuId: i.bulkSkuId,
        quantity: i.plannedQuantity
      }));

      const availability = await checkAvailability(tx, {
        locationId: existing.locationId,
        startsAt: existing.startsAt,
        endsAt: newEndsAt,
        serializedAssetIds,
        bulkItems,
        excludeBookingId: bookingId,
        bookingKind: existing.kind,
      });

      // Shortages matter here too: extending bulk gear over a window where
      // future reservations depend on that quantity over-commits the stock.
      // unavailableAssets stays out deliberately — gear already in custody
      // should not be blocked from extension by a later retire flag.
      if (availability.conflicts.length > 0 || availability.shortages.length > 0) {
        throw new HttpError(409, "Conflicts with another booking", availability);
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

export async function cancelBooking(bookingId: string, actorUserId: string) {
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

    if (booking.kind === BookingKind.CHECKOUT && booking.status === BookingStatus.OPEN) {
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
