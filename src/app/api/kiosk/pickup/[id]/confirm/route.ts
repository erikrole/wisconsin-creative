import { BookingKind, Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { pickupConfirmBody } from "@/lib/schemas/kiosk";
import { badges, earnedBadgesSince } from "@/lib/badges";
import { createBooking } from "@/lib/services/bookings";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";

/**
 * Confirm kiosk pickup: open checkout custody for a complete pickup, or for
 * the scanned subset of a reservation when partial is requested.
 * Called after the student scans their items at the kiosk.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const badgeWindowStart = new Date(Date.now() - 1);
  const { actorId, partial } = pickupConfirmBody.parse(await req.json());
  let openedBookingId = params.id;
  let openedSourceKey = params.id;
  let openedUserId = actorId;
  let actorRole: Role = "STUDENT";

  await db.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: actorId },
        select: { id: true, name: true, role: true },
      });
      if (!user) throw new HttpError(404, "User not found");
      actorRole = user.role;

      const booking = await tx.booking.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          status: true,
          kind: true,
          title: true,
          requesterUserId: true,
          serializedItems: {
            select: {
              assetId: true,
              asset: { select: { assetTag: true, name: true } },
            },
          },
          scanEvents: {
            where: {
              success: true,
              assetId: { not: null },
            },
            select: { assetId: true, phase: true },
          },
          bulkItems: {
            select: {
              plannedQuantity: true,
              checkedOutQuantity: true,
              bulkSku: { select: { name: true, trackByNumber: true } },
            },
          },
        },
      });

      if (!booking || (booking.kind !== "CHECKOUT" && booking.kind !== "RESERVATION")) {
        throw new HttpError(404, "Checkout not found");
      }

      if (partial && booking.kind === "CHECKOUT") {
        throw new HttpError(409, "Partial pickup is only available for reservations");
      }

      if (booking.kind === "RESERVATION") return;

      if (booking.requesterUserId !== actorId) {
        throw new HttpError(403, "Only the current checkout owner can confirm pickup at the kiosk");
      }

      if (booking.status !== "PENDING_PICKUP") {
        if (booking.status === "OPEN") {
          throw new HttpError(409, "This pickup was already confirmed. You're all set.");
        }
        if (booking.status === "COMPLETED") {
          throw new HttpError(409, "This checkout was already completed.");
        }
        if (booking.status === "CANCELLED") {
          throw new HttpError(409, "This pickup was cancelled. Ask staff for help.");
        }
        throw new HttpError(409, `Cannot confirm pickup — booking is in ${booking.status} state`);
      }

      const scannedSerializedAssetIds = new Set(
        booking.scanEvents
          .filter((event) => event.phase === "CHECKOUT")
          .map((event) => event.assetId),
      );
      const missingSerialized = booking.serializedItems.find(
        (item) => !scannedSerializedAssetIds.has(item.assetId),
      );
      if (missingSerialized) {
        const label = missingSerialized.asset.name || missingSerialized.asset.assetTag;
        throw new HttpError(409, `Scan ${label} before confirming pickup`);
      }

      const incompleteBulk = booking.bulkItems.find(
        (item) => item.bulkSku.trackByNumber &&
          (item.checkedOutQuantity ?? 0) < item.plannedQuantity,
      );
      if (incompleteBulk) {
        throw new HttpError(
          409,
          `Scan all ${incompleteBulk.bulkSku.name} units before confirming pickup`,
        );
      }

      const updated = await tx.booking.updateMany({
        where: { id: params.id, status: "PENDING_PICKUP" },
        data: { status: "OPEN", pickupKioskDeviceId: kiosk.kioskId },
      });
      if (updated.count !== 1) {
        throw new HttpError(409, "Pickup was already confirmed. Refresh this checkout.");
      }

      await createAuditEntryTx(tx, {
        actorId,
        actorRole: user.role,
        entityType: "booking",
        entityId: params.id,
        action: "kiosk_pickup",
        after: {
          status: "OPEN",
          source: "KIOSK",
          kioskDeviceId: kiosk.kioskId,
          locationName: kiosk.locationName,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  const sourceReservation = await db.booking.findUnique({
    where: { id: params.id },
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
          bulkSku: {
            select: {
              id: true,
              name: true,
              binQrCodeValue: true,
              trackByNumber: true,
            },
          },
        },
      },
      scanEvents: {
        where: {
          success: true,
          phase: "CHECKOUT",
        },
        select: {
          assetId: true,
          bulkSkuId: true,
          scanType: true,
          scanValue: true,
        },
        orderBy: { createdAt: "asc" },
      },
      derivedCheckouts: {
        select: {
          serializedItems: { select: { assetId: true } },
          bulkItems: {
            select: {
              bulkSkuId: true,
              unitAllocations: {
                select: {
                  bulkSkuUnit: { select: { unitNumber: true } },
                },
              },
            },
          },
        },
      },
      events: {
        orderBy: { ordinal: "asc" },
        select: { eventId: true },
      },
    },
  });

  if (sourceReservation?.kind === "CHECKOUT") {
    openedUserId = sourceReservation.requesterUserId;
  }

  if (sourceReservation?.kind === "RESERVATION") {
    if (sourceReservation.status !== "BOOKED") {
      if (sourceReservation.status === "COMPLETED") {
        throw new HttpError(409, "This reservation was already picked up. You're all set.");
      }
      if (sourceReservation.status === "CANCELLED") {
        throw new HttpError(409, "This reservation was cancelled. Ask staff for help.");
      }
      throw new HttpError(409, `Cannot confirm pickup — booking is in ${sourceReservation.status} state`);
    }
    if (sourceReservation.requesterUserId !== actorId) {
      throw new HttpError(403, "Only the reservation requester can confirm pickup at the kiosk");
    }

    const derivedCheckouts = sourceReservation.derivedCheckouts ?? [];
    const pickedSerializedAssetIds = new Set(
      derivedCheckouts.flatMap((checkout) => checkout.serializedItems.map((item) => item.assetId)),
    );
    const pickedUnitNumbersBySku = new Map<string, Set<number>>();
    for (const checkout of derivedCheckouts) {
      for (const item of checkout.bulkItems) {
        const numbers = pickedUnitNumbersBySku.get(item.bulkSkuId) ?? new Set<number>();
        for (const allocation of item.unitAllocations) {
          numbers.add(allocation.bulkSkuUnit.unitNumber);
        }
        pickedUnitNumbersBySku.set(item.bulkSkuId, numbers);
      }
    }

    const scannedSerializedAssetIds = new Set(
      sourceReservation.scanEvents
        .filter((event) => event.scanType === "SERIALIZED")
        .map((event) => event.assetId)
        .filter(Boolean),
    );
    const remainingSerializedItems = sourceReservation.serializedItems.filter(
      (item) => item.allocationStatus !== "picked_up" && !pickedSerializedAssetIds.has(item.assetId),
    );
    const missingSerialized = remainingSerializedItems.find(
      (item) => !scannedSerializedAssetIds.has(item.assetId),
    );
    if (!partial && missingSerialized) {
      const label = missingSerialized.asset.name || missingSerialized.asset.assetTag;
      throw new HttpError(409, `Scan ${label} before confirming pickup`);
    }
    const selectedSerializedAssetIds = remainingSerializedItems
      .filter((item) => scannedSerializedAssetIds.has(item.assetId))
      .map((item) => item.assetId);

    const bulkItems: Array<{ bulkSkuId: string; quantity: number }> = [];
    const bulkUnitItems: Array<{ bulkSkuId: string; unitNumber: number }> = [];
    for (const item of sourceReservation.bulkItems) {
      const remainingQuantity = Math.max(
        0,
        item.plannedQuantity - (item.checkedOutQuantity ?? 0),
      );
      if (!item.bulkSku.trackByNumber) {
        // Quantity-tracked stock is an aggregate row with no physical scan
        // step. Include the remaining quantity whenever this pickup is
        // confirmed, including a partial pickup of serialized gear.
        if (remainingQuantity > 0) {
          bulkItems.push({ bulkSkuId: item.bulkSkuId, quantity: remainingQuantity });
        }
        continue;
      }

      const pickedUnitNumbers = pickedUnitNumbersBySku.get(item.bulkSkuId) ?? new Set<number>();
      const stagedUnitNumbers = new Set(
        sourceReservation.scanEvents
        .filter((event) => event.scanType === "BULK_BIN" && event.bulkSkuId === item.bulkSkuId)
        .map((event) => parseDerivedBulkUnitQr(event.scanValue, [item.bulkSku]))
        .filter((match): match is NonNullable<typeof match> => !!match),
      );
      // Dedupe by unit number and remove units already transferred by an
      // earlier partial pickup. Both the scan event and the linked checkout
      // are durable, so reopening this reservation cannot reset or rebind it.
      const currentStagedUnitNumbers = [...stagedUnitNumbers]
        .map((unit) => unit.unitNumber)
        .filter((unitNumber) => !pickedUnitNumbers.has(unitNumber));
      if (!partial && currentStagedUnitNumbers.length < remainingQuantity) {
        throw new HttpError(409, `Scan all ${item.bulkSku.name} units before confirming pickup`);
      }
      const selectedUnitNumbers = currentStagedUnitNumbers.slice(0, remainingQuantity);
      if (selectedUnitNumbers.length > 0) {
        bulkItems.push({ bulkSkuId: item.bulkSkuId, quantity: selectedUnitNumbers.length });
      }
      bulkUnitItems.push(...selectedUnitNumbers.map((unitNumber) => ({
        bulkSkuId: item.bulkSkuId,
        unitNumber,
      })));
    }

    if (selectedSerializedAssetIds.length === 0 && bulkItems.length === 0) {
      throw new HttpError(
        409,
        partial
          ? "Scan at least one item before choosing partial pickup"
          : "This reservation has no remaining items to pick up",
      );
    }

    const eventIds = sourceReservation.events.map((event) => event.eventId);
    const checkout = await createBooking({
      kind: BookingKind.CHECKOUT,
      custodySource: "KIOSK",
      title: sourceReservation.title,
      requesterUserId: sourceReservation.requesterUserId,
      locationId: sourceReservation.locationId,
      startsAt: new Date(),
      endsAt: sourceReservation.endsAt,
      notes: sourceReservation.notes ?? undefined,
      createdBy: actorId,
      sourceReservationId: sourceReservation.id,
      eventIds: eventIds.length > 0 ? eventIds : undefined,
      eventId: eventIds.length === 0 ? sourceReservation.eventId ?? undefined : undefined,
      sportCode: sourceReservation.sportCode ?? undefined,
      shiftAssignmentId: sourceReservation.shiftAssignmentId ?? undefined,
      kitId: sourceReservation.kitId ?? undefined,
      pickupKioskDeviceId: kiosk.kioskId,
      sourceReservationPickup: true,
      serializedAssetIds: selectedSerializedAssetIds,
      bulkItems,
      // Bound inside createBooking's transaction: a failed unit bind rolls
      // back the checkout and reservation fulfillment together.
      bulkUnitItems,
    });

    await createAuditEntry({
      actorId,
      actorRole,
      entityType: "booking",
      entityId: checkout.id,
      action: "kiosk_pickup",
      after: {
        status: "OPEN",
        source: "KIOSK",
        kioskDeviceId: kiosk.kioskId,
        locationName: kiosk.locationName,
        sourceReservationId: sourceReservation.id,
        partial,
      },
    });

    openedBookingId = checkout.id;
    openedSourceKey = sourceReservation.id;
    openedUserId = sourceReservation.requesterUserId;
  }

  await badges.onCheckoutOpened({
    userId: openedUserId,
    bookingId: openedBookingId,
    source: "kiosk_pickup",
    sourceKey: openedSourceKey,
  });
  const earnedBadges = await earnedBadgesSince(openedUserId, badgeWindowStart);

  return ok({
    success: true,
    bookingId: openedBookingId,
    ...(partial ? { partial: true } : {}),
    ...(earnedBadges.length > 0 ? { earnedBadges } : {}),
  });
});
