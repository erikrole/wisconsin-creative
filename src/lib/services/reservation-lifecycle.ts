import {
  BookingCustodyScope,
  BookingKind,
  BookingStatus,
  Prisma,
  Role,
  ScanSessionStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntriesTx, createAuditEntryTx, lookupActorRole } from "@/lib/audit";
import { checkAvailability, type BulkRequest } from "@/lib/services/availability";
import { kioskAvailabilityBlockMessage } from "@/lib/availability-copy";
import { CLAIMABLE_BULK_UNIT_WHERE } from "@/lib/bulk-unit-status";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { bookingInclude, dedupeIds, diffEquipment, type AuditJson } from "./bookings-helpers";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import {
  createShiftScheduleNotification,
  dispatchScheduleAssignmentNotifications,
} from "@/lib/services/notifications";
import {
  reconcileReservationScheduleTx,
  releaseReservationManagedAssignmentTx,
  type ReservationScheduleRequester,
} from "@/lib/services/reservation-schedule";
import { assertBookingSnapshot } from "@/lib/booking-concurrency";
import { unique } from "@/lib/utils";
import {
  assertValidBookingWindow,
  assertNumberedPickupPlanLimit,
  handleBookingMutationRace,
  UpdateBookingInput,
  BookingUpdateOptions,
} from "./bookings-lifecycle-shared";
import { createBooking } from "./booking-create";

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
      custodyScope: true,
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
    const selectedNumbers = unique([
      ...preferredNumbers,
      ...availableNumbers.filter((unitNumber) => !preferredNumbers.includes(unitNumber)),
    ]).slice(0, item.quantity);

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
    custodyScope: source.custodyScope,
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

/**
 * Close a partially picked-up reservation without handing over the rest.
 *
 * A partial kiosk pickup leaves the source reservation BOOKED so the
 * remaining gear can be collected later. When that gear is never coming
 * (wrong item swapped at the counter, plans changed, no-show for the rest),
 * staff need a supported exit that leaves picked gear on the linked checkout,
 * releases leftover holds, and records what was released. Cancel is the
 * wrong verb here because custody already opened; force-checkout is wrong
 * because the gear is still on the shelf.
 */
export async function closeReservationRemaining(args: {
  reservationId: string;
  actorUserId: string;
  reason?: string | null;
}) {
  const reason = args.reason?.trim() || null;
  if (reason && reason.length > 1000) {
    throw new HttpError(400, "Reason must be at most 1000 characters");
  }

  return db.$transaction(async (tx) => {
    const source = await tx.booking.findUnique({
      where: { id: args.reservationId },
      select: {
        id: true,
        kind: true,
        status: true,
        refNumber: true,
        serializedItems: {
          select: {
            assetId: true,
            allocationStatus: true,
            asset: { select: { assetTag: true, name: true } },
          },
        },
        bulkItems: {
          select: {
            bulkSkuId: true,
            plannedQuantity: true,
            checkedOutQuantity: true,
            bulkSku: { select: { name: true } },
          },
        },
        derivedCheckouts: { select: { id: true, refNumber: true } },
      },
    });

    if (!source || source.kind !== BookingKind.RESERVATION) {
      throw new HttpError(404, "Reservation not found");
    }
    if (source.status !== BookingStatus.BOOKED) {
      throw new HttpError(409, `Reservation is not in BOOKED status (current: ${source.status})`);
    }

    const pickedSerialized = source.serializedItems.filter((item) => item.allocationStatus === "picked_up");
    const pickedBulkQuantity = source.bulkItems.reduce((sum, item) => sum + (item.checkedOutQuantity ?? 0), 0);
    if (source.derivedCheckouts.length === 0 && pickedSerialized.length === 0 && pickedBulkQuantity === 0) {
      throw new HttpError(
        409,
        "Nothing from this reservation has been picked up yet. Cancel the reservation instead.",
      );
    }

    const releasedSerialized = source.serializedItems
      .filter((item) => item.allocationStatus === "active")
      .map((item) => ({ assetId: item.assetId, name: item.asset.name || item.asset.assetTag }));
    const releasedBulk = source.bulkItems
      .map((item) => ({
        bulkSkuId: item.bulkSkuId,
        name: item.bulkSku.name,
        quantity: Math.max(0, item.plannedQuantity - (item.checkedOutQuantity ?? 0)),
      }))
      .filter((item) => item.quantity > 0);

    const now = new Date();
    const updated = await tx.booking.updateMany({
      where: { id: source.id, status: BookingStatus.BOOKED },
      data: { status: BookingStatus.COMPLETED, completedAt: now },
    });
    if (updated.count !== 1) {
      throw new HttpError(409, "This reservation changed. Refresh and try again.");
    }

    // Remaining holds are released. Gear already handed over lives on the
    // linked checkout, so it is removed from the reservation plan instead of
    // left looking like current reservation custody.
    await tx.bookingSerializedItem.deleteMany({
      where: { bookingId: source.id },
    });
    await tx.assetAllocation.updateMany({
      where: { bookingId: source.id, active: true },
      data: { active: false },
    });
    await tx.bookingBulkItem.deleteMany({
      where: { bookingId: source.id },
    });
    await tx.scanSession.updateMany({
      where: { bookingId: source.id, status: ScanSessionStatus.OPEN },
      data: { status: ScanSessionStatus.CANCELLED },
    });

    const actorRole = await lookupActorRole(tx, args.actorUserId);
    await createAuditEntryTx(tx, {
      actorId: args.actorUserId,
      actorRole,
      entityType: "booking",
      entityId: source.id,
      action: "reservation_closed_remaining_released",
      before: {
        status: BookingStatus.BOOKED,
        remainingSerializedAssetIds: releasedSerialized.map((item) => item.assetId),
        remainingBulk: releasedBulk.map((item) => ({ bulkSkuId: item.bulkSkuId, quantity: item.quantity })),
      },
      after: {
        status: BookingStatus.COMPLETED,
        reason,
        releasedSerialized,
        releasedBulk,
        pickedSerializedAssetIds: pickedSerialized.map((item) => item.assetId),
        linkedCheckoutIds: source.derivedCheckouts.map((checkout) => checkout.id),
      },
    });

    return {
      id: source.id,
      status: BookingStatus.COMPLETED,
      releasedSerialized,
      releasedBulk,
      linkedCheckouts: source.derivedCheckouts,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * After pickup gear already lives on a derived checkout, a completed
 * reservation should not keep those lines as if the requester still has
 * them on the reservation. Used to repair a close-remaining that left
 * picked-up history on the plan.
 */
export async function detachRolledReservationPlan(args: {
  reservationId: string;
  actorUserId: string;
  expectedRefNumber: string;
}) {
  return db.$transaction(async (tx) => {
    const source = await tx.booking.findUnique({
      where: { id: args.reservationId },
      select: {
        id: true,
        kind: true,
        status: true,
        refNumber: true,
        serializedItems: {
          select: { assetId: true, allocationStatus: true, asset: { select: { assetTag: true, name: true } } },
        },
        bulkItems: {
          select: {
            bulkSkuId: true,
            plannedQuantity: true,
            checkedOutQuantity: true,
            bulkSku: { select: { name: true } },
          },
        },
        derivedCheckouts: { select: { id: true, refNumber: true, status: true } },
      },
    });
    if (!source || source.kind !== BookingKind.RESERVATION) {
      throw new HttpError(404, "Reservation not found");
    }
    if (source.refNumber !== args.expectedRefNumber) {
      throw new HttpError(409, `Ref mismatch: ${source.refNumber}`);
    }
    if (source.status !== BookingStatus.COMPLETED) {
      throw new HttpError(409, `Reservation is not COMPLETED (current: ${source.status})`);
    }
    if (source.derivedCheckouts.length === 0) {
      throw new HttpError(409, "No linked checkout to roll items onto.");
    }

    const rolledSerialized = source.serializedItems.filter((item) => item.allocationStatus === "picked_up");
    const rolledBulk = source.bulkItems.filter((item) => (item.checkedOutQuantity ?? 0) > 0);
    if (rolledSerialized.length === 0 && rolledBulk.length === 0) {
      return {
        id: source.id,
        status: source.status,
        rolledSerialized: [],
        rolledBulk: [],
        linkedCheckouts: source.derivedCheckouts,
      };
    }

    if (rolledSerialized.length > 0) {
      await tx.bookingSerializedItem.deleteMany({
        where: {
          bookingId: source.id,
          assetId: { in: rolledSerialized.map((item) => item.assetId) },
          allocationStatus: "picked_up",
        },
      });
    }
    if (rolledBulk.length > 0) {
      await tx.bookingBulkItem.deleteMany({
        where: {
          bookingId: source.id,
          bulkSkuId: { in: rolledBulk.map((item) => item.bulkSkuId) },
        },
      });
    }

    const actorRole = await lookupActorRole(tx, args.actorUserId);
    await createAuditEntryTx(tx, {
      actorId: args.actorUserId,
      actorRole,
      entityType: "booking",
      entityId: source.id,
      action: "reservation_picked_items_moved_to_checkout",
      before: {
        serializedAssetIds: rolledSerialized.map((item) => item.assetId),
        bulkSkuIds: rolledBulk.map((item) => item.bulkSkuId),
      },
      after: {
        linkedCheckoutIds: source.derivedCheckouts.map((checkout) => checkout.id),
        rolledSerialized: rolledSerialized.map((item) => item.asset.name || item.asset.assetTag),
        rolledBulk: rolledBulk.map((item) => item.bulkSku.name),
      },
    });

    return {
      id: source.id,
      status: source.status,
      rolledSerialized,
      rolledBulk,
      linkedCheckouts: source.derivedCheckouts,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * After a reservation plan edit, mark staged (not yet picked up) kiosk pickup
 * scans unsuccessful only where the plan no longer needs them:
 * - a removed serialized item loses its scans;
 * - a removed or reduced quantity-tracked line loses its scans;
 * - a reduced numbered-unit line keeps the earliest distinct staged units up to
 *   the new remaining quantity (the order kiosk confirm selects them in) and
 *   releases only the excess.
 * Added items and increased quantities keep every existing scan.
 */
async function invalidateStagedPickupScansForPlanEditTx(
  tx: Prisma.TransactionClient,
  args: {
    bookingId: string;
    existingSerializedItems: Array<{ assetId: string; allocationStatus: string }>;
    existingBulkItems: Array<{ bulkSkuId: string; plannedQuantity: number; checkedOutQuantity: number | null }>;
    nextSerializedAssetIds: string[];
    nextBulkItems: BulkRequest[];
  },
): Promise<void> {
  const nextAssetIds = new Set(args.nextSerializedAssetIds);
  const removedAssetIds = args.existingSerializedItems
    .filter((item) => item.allocationStatus !== "picked_up" && !nextAssetIds.has(item.assetId))
    .map((item) => item.assetId);

  const nextQuantityBySku = new Map<string, number>();
  for (const item of args.nextBulkItems) {
    nextQuantityBySku.set(item.bulkSkuId, (nextQuantityBySku.get(item.bulkSkuId) ?? 0) + item.quantity);
  }
  const reducedBulk = args.existingBulkItems
    .map((item) => {
      const picked = item.checkedOutQuantity ?? 0;
      return {
        bulkSkuId: item.bulkSkuId,
        previousRemaining: Math.max(0, item.plannedQuantity - picked),
        nextRemaining: Math.max(0, (nextQuantityBySku.get(item.bulkSkuId) ?? 0) - picked),
      };
    })
    .filter((item) => item.nextRemaining < item.previousRemaining);

  const releaseWholeSkuIds: string[] = [];
  const partialNumbered: Array<{ bulkSkuId: string; keep: number }> = [];
  if (reducedBulk.length > 0) {
    const skus = await tx.bulkSku.findMany({
      where: { id: { in: reducedBulk.map((item) => item.bulkSkuId) } },
      select: { id: true, trackByNumber: true, binQrCodeValue: true },
    });
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    for (const item of reducedBulk) {
      if (item.nextRemaining > 0 && skuById.get(item.bulkSkuId)?.trackByNumber) {
        partialNumbered.push({ bulkSkuId: item.bulkSkuId, keep: item.nextRemaining });
      } else {
        releaseWholeSkuIds.push(item.bulkSkuId);
      }
    }

    if (partialNumbered.length > 0) {
      const partialSkuIds = partialNumbered.map((item) => item.bulkSkuId);
      const [stagedScans, pickedAllocations] = await Promise.all([
        tx.scanEvent.findMany({
          where: {
            bookingId: args.bookingId,
            phase: "CHECKOUT",
            success: true,
            scanType: "BULK_BIN",
            bulkSkuId: { in: partialSkuIds },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, bulkSkuId: true, scanValue: true },
        }),
        tx.bookingBulkUnitAllocation.findMany({
          where: {
            bookingBulkItem: {
              bulkSkuId: { in: partialSkuIds },
              booking: { sourceReservationId: args.bookingId },
            },
          },
          select: { bulkSkuUnit: { select: { bulkSkuId: true, unitNumber: true } } },
        }),
      ]);
      const pickedUnitKeys = new Set(
        pickedAllocations.map((row) => `${row.bulkSkuUnit.bulkSkuId}:${row.bulkSkuUnit.unitNumber}`),
      );
      const excessScanIds: string[] = [];
      for (const { bulkSkuId, keep } of partialNumbered) {
        const sku = skuById.get(bulkSkuId)!;
        const keptUnits = new Set<number>();
        for (const scan of stagedScans) {
          if (scan.bulkSkuId !== bulkSkuId) continue;
          const match = parseDerivedBulkUnitQr(scan.scanValue, [sku]);
          // Already-transferred units and unparseable rows are not staged
          // pickup work; leave their evidence untouched.
          if (!match || pickedUnitKeys.has(`${bulkSkuId}:${match.unitNumber}`)) continue;
          if (keptUnits.has(match.unitNumber)) continue;
          if (keptUnits.size < keep) {
            keptUnits.add(match.unitNumber);
            continue;
          }
          excessScanIds.push(scan.id);
        }
      }
      // A duplicate scan of a kept unit stays successful; confirm dedupes by
      // unit number. Only units beyond the new quantity are released.
      if (excessScanIds.length > 0) {
        await tx.scanEvent.updateMany({
          where: { id: { in: excessScanIds } },
          data: { success: false },
        });
      }
    }
  }

  const releaseFilters: Prisma.ScanEventWhereInput[] = [];
  if (removedAssetIds.length > 0) releaseFilters.push({ assetId: { in: removedAssetIds } });
  if (releaseWholeSkuIds.length > 0) releaseFilters.push({ bulkSkuId: { in: releaseWholeSkuIds } });
  if (releaseFilters.length > 0) {
    await tx.scanEvent.updateMany({
      where: { bookingId: args.bookingId, phase: "CHECKOUT", success: true, OR: releaseFilters },
      data: { success: false },
    });
  }
}

export async function updateReservation(
  bookingId: string,
  actorUserId: string,
  updates: UpdateBookingInput,
  expectedUpdatedAt?: Date,
  options: BookingUpdateOptions = {},
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
          derivedCheckouts: { select: { id: true } },
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
      if (
        existing.custodyScope === BookingCustodyScope.SHARED
        && updates.requesterUserId
        && updates.requesterUserId !== existing.requesterUserId
      ) {
        throw new HttpError(400, "Shared travel-case reservations do not have a personal owner");
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

      const pickedAssetIds = new Set(existing.serializedItems.filter((item) => item.allocationStatus === "picked_up").map((item) => item.assetId));
      const pickedBulkBySku = new Map(existing.bulkItems.map((item) => [item.bulkSkuId, item.checkedOutQuantity ?? 0]));
      if ([...pickedAssetIds].some((id) => !serializedAssetIds.includes(id)) || existing.bulkItems.some((item) => (bulkItems.find((next) => next.bulkSkuId === item.bulkSkuId)?.quantity ?? 0) < (item.checkedOutQuantity ?? 0))) {
        throw new HttpError(409, "Items already picked up are on the checkout. Edit the remaining items only.");
      }
      const remainingAssetIds = serializedAssetIds.filter((id) => !pickedAssetIds.has(id));
      const remainingBulkItems = bulkItems.map((item) => ({ bulkSkuId: item.bulkSkuId, quantity: item.quantity - (pickedBulkBySku.get(item.bulkSkuId) ?? 0) })).filter((item) => item.quantity > 0);

      if (updatesEquipment) {
        await assertNumberedPickupPlanLimit(tx, bulkItems);
      }

      if (updatesEquipment || updatesWindow) {
        // A plan-only edit changes custody of the lines it adds or grows. Gear
        // already on the plan was cleared when it was reserved, so it must not
        // block an edit that removes something else (a kit item that went
        // into maintenance after booking has to be removable).
        const plannedBySku = new Map(existing.bulkItems.map((item) => [item.bulkSkuId, item.plannedQuantity]));
        const existingAssetIds = new Set(existing.serializedItems.map((item) => item.assetId));
        const checkAssetIds = updatesWindow ? remainingAssetIds : remainingAssetIds.filter((id) => !existingAssetIds.has(id));
        const checkBulkItems = updatesWindow
          ? remainingBulkItems
          : remainingBulkItems.filter((item) => {
              const next = bulkItems.find((candidate) => candidate.bulkSkuId === item.bulkSkuId)?.quantity ?? 0;
              return next > (plannedBySku.get(item.bulkSkuId) ?? 0);
            });
        const availability = await checkAvailability(tx, {
          locationId: nextLocationId,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          serializedAssetIds: checkAssetIds,
          bulkItems: checkBulkItems,
          excludeBookingId: bookingId,
          bookingKind: "RESERVATION",
          forCollaborator: nextRequester?.role === Role.COLLABORATOR,
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
          requesterUserId: updates.requesterUserId,
          locationId: nextLocationId,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          notes: updates.notes
        }
      });

      if (updatesEquipment) {
        const currentAssetIds = new Set(existing.serializedItems.map((item) => item.assetId));
        const removedIds = existing.serializedItems.filter((item) => !serializedAssetIds.includes(item.assetId)).map((item) => item.assetId);
        const addedIds = serializedAssetIds.filter((id) => !currentAssetIds.has(id));
        await tx.bookingSerializedItem.deleteMany({ where: { bookingId, assetId: { in: removedIds }, allocationStatus: "active" } });
        await tx.assetAllocation.updateMany({ where: { bookingId, assetId: { in: removedIds }, active: true }, data: { active: false } });
        if (addedIds.length) {
          await tx.bookingSerializedItem.createMany({ data: addedIds.map((assetId) => ({ bookingId, assetId, allocationStatus: "active" })) });
          await tx.assetAllocation.createMany({ data: addedIds.map((assetId) => ({ bookingId, assetId, startsAt: nextStartsAt, endsAt: nextEndsAt, active: true, kind: "RESERVATION" as const })) });
        }
        const nextSkuIds = bulkItems.map((item) => item.bulkSkuId);
        await tx.bookingBulkItem.deleteMany({ where: { bookingId, bulkSkuId: { notIn: nextSkuIds }, checkedOutQuantity: 0 } });
        for (const item of bulkItems) {
          await tx.bookingBulkItem.upsert({
            where: { bookingId_bulkSkuId: { bookingId, bulkSkuId: item.bulkSkuId } },
            create: { bookingId, bulkSkuId: item.bulkSkuId, plannedQuantity: item.quantity },
            update: { plannedQuantity: item.quantity },
          });
        }
        // Keep evidence, but release staged pickup scans only for the lines
        // this edit removed or reduced. Untouched lines keep their scans so
        // "keep the scanned batteries, drop the rest" does not force a full
        // rescan. Scans on derived checkouts remain the durable handoff record.
        await invalidateStagedPickupScansForPlanEditTx(tx, {
          bookingId,
          existingSerializedItems: existing.serializedItems,
          existingBulkItems: existing.bulkItems,
          nextSerializedAssetIds: serializedAssetIds,
          nextBulkItems: bulkItems,
        });
      }
      if (updatesWindow) {
        await tx.assetAllocation.updateMany({ where: { bookingId, active: true }, data: { startsAt: nextStartsAt, endsAt: nextEndsAt } });
      }

      // A plan edit that removes the last remaining gear from a reservation
      // whose pickup already started must complete the reservation. Left
      // BOOKED, it has nothing to scan, drops off the kiosk hub once its
      // window passes, and no supported action can ever close it.
      const pickupStarted = pickedAssetIds.size > 0
        || existing.bulkItems.some((item) => (item.checkedOutQuantity ?? 0) > 0)
        || (existing.derivedCheckouts?.length ?? 0) > 0;
      const completedByEdit = updatesEquipment
        && existing.status === BookingStatus.BOOKED
        && pickupStarted
        && remainingAssetIds.length === 0
        && remainingBulkItems.length === 0;
      if (completedByEdit) {
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: BookingStatus.COMPLETED, completedAt: new Date() },
        });
        if (pickedAssetIds.size > 0) {
          await tx.bookingSerializedItem.deleteMany({
            where: {
              bookingId,
              assetId: { in: [...pickedAssetIds] },
              allocationStatus: "picked_up",
            },
          });
        }
        await tx.bookingBulkItem.deleteMany({
          where: { bookingId },
        });
        await tx.assetAllocation.updateMany({
          where: { bookingId, active: true },
          data: { active: false },
        });
        await tx.scanSession.updateMany({
          where: { bookingId, status: ScanSessionStatus.OPEN },
          data: { status: ScanSessionStatus.CANCELLED },
        });
        await createAuditEntryTx(tx, {
          actorId: actorUserId,
          actorRole: await lookupActorRole(tx, actorUserId),
          entityType: "booking",
          entityId: bookingId,
          action: "completed_after_plan_edit",
          before: { status: existing.status },
          after: {
            status: BookingStatus.COMPLETED,
            pickedSerializedAssetIds: [...pickedAssetIds],
            reason: "remaining_items_removed",
          },
        });
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
        existing.custodyScope === BookingCustodyScope.PERSON
        && (
          existing.eventId
          || existing.shiftAssignmentId
          || (updates.requesterUserId !== undefined && existing.eventId)
        ),
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

  for (const assignmentId of scheduleNotificationAssignmentIds) {
    await dispatchScheduleAssignmentNotifications(assignmentId, "assigned", { actorUserId });
  }
  return updated;
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
