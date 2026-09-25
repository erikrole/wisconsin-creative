import { rejectKioskOperation, kioskOperationContext, readKioskOperationReplay, unreadableKioskOperation, claimKioskOperationReceiptTx, finishKioskOperationReceiptTx } from "@/lib/services/kiosk-operation-receipts";
import { BookingCustodyScope, BookingKind, Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { pickupConfirmBody } from "@/lib/schemas/kiosk";
import { badges, earnedBadgesSince } from "@/lib/badges";
import { createBooking } from "@/lib/services/bookings";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { requireKioskActor } from "@/lib/services/kiosk-actor";

/**
 * Confirm kiosk pickup: open checkout custody for a complete pickup, or for
 * the scanned subset of a reservation when partial is requested.
 * Called after the student scans their items at the kiosk.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const badgeWindowStart = new Date(Date.now() - 1);
  const raw: unknown = await req.json();
  const parsed = pickupConfirmBody.safeParse(raw);
  if (!parsed.success) {
    const unreadable = unreadableKioskOperation(raw);
    if (unreadable) return ok(unreadable);
    throw parsed.error;
  }
  const body = parsed.data;
  const { actorId, partial } = body;
  const receipt = kioskOperationContext({ requestId: body.requestId, kioskId: kiosk.kioskId, actorId, operation: "pickup", sourceId: params.id, payload: body });
  const replay = await readKioskOperationReplay(db, receipt);
  if (replay) return ok(replay);
  try {
  let itemCount = 0;
  let actualPartial = false;
  let remainingItemNames: string[] = [];
  let openedBookingId = params.id;
  let openedSourceKey = params.id;
  let openedPersonalUserId: string | null = actorId;
  let actorRole: Role = "STUDENT";

  await db.$transaction(
    async (tx) => {
      // Kiosk roster rule (active, not hidden, collaborators only when
      // roster-eligible); anyone else is "not found" like every kiosk mutation.
      const user = await requireKioskActor(tx, actorId);
      actorRole = user.role;

      const booking = await tx.booking.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          status: true,
          kind: true,
          title: true,
          requesterUserId: true,
          custodyScope: true,
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
      await claimKioskOperationReceiptTx(tx, receipt);
      itemCount = booking.serializedItems.length + booking.bulkItems.reduce((sum, item) => sum + item.plannedQuantity, 0);

      if (booking.custodyScope !== BookingCustodyScope.SHARED && booking.requesterUserId !== actorId) {
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
      await finishKioskOperationReceiptTx(tx, receipt, { success: true, bookingId: params.id, itemCount, partial: false });
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
      custodyScope: true,
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
    openedPersonalUserId = sourceReservation.custodyScope !== BookingCustodyScope.SHARED
      ? sourceReservation.requesterUserId
      : null;
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
    if (sourceReservation.custodyScope !== BookingCustodyScope.SHARED && sourceReservation.requesterUserId !== actorId) {
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
      kioskCompletionReceipt: receipt,
      custodyScope: sourceReservation.custodyScope,
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
      shiftAssignmentId: sourceReservation.custodyScope !== BookingCustodyScope.SHARED
        ? sourceReservation.shiftAssignmentId ?? undefined
        : undefined,
      kitId: sourceReservation.kitId ?? undefined,
      pickupKioskDeviceId: kiosk.kioskId,
      sourceReservationPickup: true,
      serializedAssetIds: selectedSerializedAssetIds,
      bulkItems,
      // Bound inside createBooking's transaction: a failed unit bind rolls
      // back the checkout and reservation fulfillment together.
      bulkUnitItems,
    });

    itemCount = selectedSerializedAssetIds.length + bulkItems.reduce((sum, item) => sum + item.quantity, 0);
    remainingItemNames = [
      ...remainingSerializedItems
        .filter((item) => !selectedSerializedAssetIds.includes(item.assetId))
        .map((item) => item.asset.name || item.asset.assetTag),
      ...sourceReservation.bulkItems.flatMap((item) => {
        const remainingQuantity = Math.max(0, item.plannedQuantity - (item.checkedOutQuantity ?? 0));
        const taken = bulkItems.find((selected) => selected.bulkSkuId === item.bulkSkuId)?.quantity ?? 0;
        const leftover = remainingQuantity - taken;
        return leftover > 0 ? [`${leftover} × ${item.bulkSku.name}`] : [];
      }),
    ];
    actualPartial = (await db.booking.findUnique({ where: { id: params.id }, select: { status: true } }))?.status === "BOOKED";
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
    openedPersonalUserId = sourceReservation.custodyScope !== BookingCustodyScope.SHARED
      ? sourceReservation.requesterUserId
      : null;
  }

  if (openedPersonalUserId) {
    await badges.onCheckoutOpened({
      userId: openedPersonalUserId,
      bookingId: openedBookingId,
      source: "kiosk_pickup",
      sourceKey: openedSourceKey,
    });
  }
  const earnedBadges = openedPersonalUserId
    ? await earnedBadgesSince(openedPersonalUserId, badgeWindowStart)
    : [];

  return ok({
    success: true,
    bookingId: openedBookingId,
    itemCount,
    partial: actualPartial,
    ...(remainingItemNames.length > 0 ? { remainingItemNames } : {}),
    ...(earnedBadges.length > 0 ? { earnedBadges } : {}),
  });
  } catch (error) {
    const replay = await readKioskOperationReplay(db, receipt);
    if (replay) return ok(replay);
    const rejected = await rejectKioskOperation(db, receipt, error);
    if (rejected) return ok(rejected);
    throw error;
  }
});
