import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { activeCheckoutAddItemBody, activeCheckoutRemoveItemBody, activeCheckoutUpdateBody } from "@/lib/schemas/kiosk";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { checkCheckoutDueTime, hasBlockingAvailabilityIssue } from "@/lib/services/availability";
import { kioskAvailabilityBlockMessage } from "@/lib/availability-copy";
import { BookingCustodyScope, Prisma } from "@prisma/client";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { endCheckoutReturnLiveActivities, updateCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { maybeAutoComplete } from "@/lib/services/bookings-checkin";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";
import { assertKioskCheckoutEditor, requireKioskActor } from "@/lib/services/kiosk-actor";
import { readKioskStaffToken, verifyKioskStaffToken } from "@/lib/kiosk-staff-token";
import { addScannedItemToActiveCheckout, removeActiveCheckoutItem, requireEditableCheckout } from "@/lib/services/kiosk-active-checkout-items";

function activeBulkQuantity(item: { checkedOutQuantity: number; checkedInQuantity: number }) {
  return Math.max(0, item.checkedOutQuantity - item.checkedInQuantity);
}

function quantityLabel(name: string, quantity: number) {
  return quantity === 1 ? name : `${name} x${quantity}`;
}

type KioskBulkDetailItem = {
  id: string;
  tagName: string;
  name: string;
  returned: boolean;
  type: "numbered_bulk" | "bulk_quantity";
  bulkSkuId: string;
  bulkSkuName: string;
  unitNumber: number | null;
  imageUrl: string | null;
  quantity?: number;
  reservationItemId?: string;
  /** Counted (not unit-numbered) stock: returned with a quantity, not scans. */
  returnsByQuantity?: boolean;
};

/** Get checkout details for kiosk return and pickup flows */
export const GET = withKiosk<{ id: string }>(async (_req, { params }) => {
  const booking = await db.booking.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      refNumber: true,
      status: true,
      kind: true,
      custodyScope: true,
      requesterUserId: true,
      updatedAt: true,
      locationId: true,
      endsAt: true,
      eventId: true,
      scanEvents: {
        where: {
          success: true,
          phase: "CHECKOUT",
        },
        orderBy: { createdAt: "asc" },
        select: {
          assetId: true,
          bulkSkuId: true,
          scanType: true,
          scanValue: true,
        },
      },
      serializedItems: {
        select: {
          id: true,
          allocationStatus: true,
          asset: {
            select: {
              id: true,
              assetTag: true,
              name: true,
              imageUrl: true,
            },
          },
        },
      },
      bulkItems: {
        select: {
          id: true,
          plannedQuantity: true,
          checkedOutQuantity: true,
          checkedInQuantity: true,
          bulkSku: {
            select: {
              id: true,
              name: true,
              category: true,
              binQrCodeValue: true,
              trackByNumber: true,
              imageUrl: true,
            },
          },
          unitAllocations: {
            select: {
              checkedInAt: true,
              bulkSkuUnit: {
                select: {
                  id: true,
                  unitNumber: true,
                },
              },
            },
            orderBy: { checkedOutAt: "asc" },
          },
        },
      },
      // A reservation may produce several linked checkouts when pickup is
      // partial. Their contents are the durable record of already handed-over
      // items, separate from scans staged for the next pickup.
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
    },
  });

  if (
    !booking ||
    (booking.kind !== "CHECKOUT" && booking.kind !== "RESERVATION") ||
    (booking.kind === "CHECKOUT" && booking.status !== "PENDING_PICKUP" && booking.status !== "OPEN") ||
    (booking.kind === "RESERVATION" && booking.status !== "BOOKED")
  ) {
    throw new HttpError(404, "Checkout not found");
  }

  const isPickupChecklist =
    (booking.kind === "CHECKOUT" && booking.status === "PENDING_PICKUP") ||
    booking.kind === "RESERVATION";
  const scanEvents = booking.scanEvents ?? [];
  const derivedCheckouts = booking.derivedCheckouts ?? [];
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
  const stagedReservationUnitsBySku = new Map<string, Array<{ unitNumber: number }>>();
  if (booking.kind === "RESERVATION") {
    for (const bulkItem of booking.bulkItems) {
      if (!bulkItem.bulkSku.trackByNumber) continue;
      const pickedUnitNumbers = pickedUnitNumbersBySku.get(bulkItem.bulkSku.id) ?? new Set<number>();
      const stagedUnitNumbers = new Set<number>();
      const stagedUnits: Array<{ unitNumber: number }> = [];
      for (const event of scanEvents) {
        if (event.scanType !== "BULK_BIN" || event.bulkSkuId !== bulkItem.bulkSku.id) continue;
        const match = parseDerivedBulkUnitQr(event.scanValue, [bulkItem.bulkSku]);
        if (!match || pickedUnitNumbers.has(match.unitNumber) || stagedUnitNumbers.has(match.unitNumber)) continue;
        stagedUnitNumbers.add(match.unitNumber);
        stagedUnits.push({ unitNumber: match.unitNumber });
      }
      stagedReservationUnitsBySku.set(bulkItem.bulkSku.id, stagedUnits);
    }
  }
  const scannedSerializedAssetIds = new Set(
    scanEvents
      .filter((event) => event.scanType === "SERIALIZED" && event.assetId)
      .map((event) => event.assetId),
  );

  const serializedSourceItems = booking.kind === "RESERVATION"
    ? booking.serializedItems.filter(
        (si) => si.allocationStatus !== "picked_up" && !pickedSerializedAssetIds.has(si.asset.id),
      )
    : booking.serializedItems;
  const serializedItems = serializedSourceItems.map((si) => ({
    id: si.asset.id,
    ...(booking.kind === "RESERVATION" ? { reservationItemId: si.id } : {}),
    tagName: si.asset.assetTag,
    name: si.asset.name || si.asset.assetTag,
    returned: isPickupChecklist
      ? scannedSerializedAssetIds.has(si.asset.id)
      : si.allocationStatus === "returned",
    type: "serialized" as const,
    imageUrl: si.asset.imageUrl,
  }));

  const numberedBulkItems = booking.bulkItems.filter((bi) => bi.bulkSku.trackByNumber);
  const numberedPickupTotal = numberedBulkItems.reduce(
    (sum, bi) => sum + (booking.kind === "RESERVATION"
      ? Math.max(0, bi.plannedQuantity - (bi.checkedOutQuantity ?? 0))
      : bi.plannedQuantity),
    0,
  );
  if (isPickupChecklist && numberedPickupTotal > MAX_EQUIPMENT_SELECTIONS_PER_REQUEST) {
    throw new HttpError(
      409,
      `Numbered pickup lists support at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} units total`,
    );
  }

  const bulkItems: KioskBulkDetailItem[] = isPickupChecklist
    ? booking.bulkItems.flatMap((bi): KioskBulkDetailItem[] => {
        if (!bi.bulkSku.trackByNumber) {
          const remainingQuantity = booking.kind === "RESERVATION"
            ? Math.max(0, bi.plannedQuantity - (bi.checkedOutQuantity ?? 0))
            : bi.plannedQuantity;
          if (remainingQuantity <= 0) return [];
          return [{
            id: `${bi.id}:bulk-quantity`,
            tagName: `x${remainingQuantity}`,
            name: quantityLabel(bi.bulkSku.name, remainingQuantity),
            quantity: remainingQuantity,
            // Quantity-tracked stock is checked out as one aggregate ledger row,
            // so there is no physical per-unit QR scan for the native checklist.
            returned: true,
            type: "bulk_quantity" as const,
            bulkSkuId: bi.bulkSku.id,
            bulkSkuName: bi.bulkSku.name,
            unitNumber: null,
            imageUrl: bi.bulkSku.imageUrl,
            ...(booking.kind === "RESERVATION" ? { reservationItemId: bi.id } : {}),
          }];
        }
        const pickedUnits = booking.kind === "CHECKOUT" && booking.status === "PENDING_PICKUP"
          ? bi.unitAllocations.filter((allocation) => !allocation.checkedInAt)
          : [];
        const stagedUnits = booking.kind === "RESERVATION"
          ? (stagedReservationUnitsBySku.get(bi.bulkSku.id) ?? [])
          : [];
        const remainingQuantity = booking.kind === "RESERVATION"
          ? Math.max(0, bi.plannedQuantity - (bi.checkedOutQuantity ?? 0))
          : bi.plannedQuantity;

        return Array.from({ length: remainingQuantity }, (_, index) => {
          const allocation = pickedUnits[index];
          const stagedUnit = stagedUnits[index];
          const unitNumber = allocation?.bulkSkuUnit.unitNumber ?? stagedUnit?.unitNumber;
          if (unitNumber !== undefined) {
            return {
              id: `${bi.id}:slot:${index + 1}`,
              tagName: `#${unitNumber}`,
              name: `${bi.bulkSku.name} #${unitNumber}`,
              returned: true,
              type: "numbered_bulk" as const,
              bulkSkuId: bi.bulkSku.id,
              bulkSkuName: bi.bulkSku.name,
              unitNumber,
              imageUrl: bi.bulkSku.imageUrl,
              ...(booking.kind === "RESERVATION" ? { reservationItemId: bi.id } : {}),
            };
          }

          return {
            id: `${bi.id}:slot:${index + 1}`,
            tagName: `#${index + 1}`,
            name: `${bi.bulkSku.name} ${index + 1}`,
            returned: false,
            type: "numbered_bulk" as const,
            bulkSkuId: bi.bulkSku.id,
            bulkSkuName: bi.bulkSku.name,
            unitNumber: null,
            imageUrl: bi.bulkSku.imageUrl,
            ...(booking.kind === "RESERVATION" ? { reservationItemId: bi.id } : {}),
          };
        });
      })
    : booking.bulkItems.flatMap((bi): KioskBulkDetailItem[] => {
        const activeAllocations = bi.unitAllocations.map((allocation) => ({
          id: allocation.bulkSkuUnit.id,
          tagName: `#${allocation.bulkSkuUnit.unitNumber}`,
          name: `${bi.bulkSku.name} #${allocation.bulkSkuUnit.unitNumber}`,
          returned: !!allocation.checkedInAt,
          type: "numbered_bulk" as const,
          bulkSkuId: bi.bulkSku.id,
          bulkSkuName: bi.bulkSku.name,
          unitNumber: allocation.bulkSkuUnit.unitNumber,
          imageUrl: bi.bulkSku.imageUrl,
        }));
        const missingQuantity = Math.max(0, activeBulkQuantity(bi) - bi.unitAllocations.filter((allocation) => !allocation.checkedInAt).length);
        if (missingQuantity <= 0) return activeAllocations;
        return [
          ...activeAllocations,
          {
            id: `${bi.id}:bulk-quantity`,
            tagName: `x${missingQuantity}`,
            name: quantityLabel(bi.bulkSku.name, missingQuantity),
            quantity: missingQuantity,
            returned: false,
            type: "bulk_quantity" as const,
            bulkSkuId: bi.bulkSku.id,
            bulkSkuName: bi.bulkSku.name,
            unitNumber: null,
            imageUrl: bi.bulkSku.imageUrl,
            ...(bi.bulkSku.trackByNumber ? {} : { returnsByQuantity: true }),
          },
        ];
      });
  const numberedBulkTotal = isPickupChecklist
    ? numberedBulkItems.reduce(
        (sum, bi) => sum + (booking.kind === "RESERVATION"
          ? Math.max(0, bi.plannedQuantity - (bi.checkedOutQuantity ?? 0))
          : bi.plannedQuantity),
        0,
      )
    : numberedBulkItems.reduce((sum, bi) => sum + Math.max(bi.unitAllocations.length, bi.checkedOutQuantity), 0);
  const scannedBulkCounts = booking.kind === "RESERVATION"
    ? new Map(
        [...stagedReservationUnitsBySku.entries()].map(([bulkSkuId, units]) => [bulkSkuId, units.length]),
      )
    : scanEvents
        .filter((event) => event.scanType === "BULK_BIN" && event.bulkSkuId)
        .reduce((counts, event) => {
          counts.set(event.bulkSkuId!, (counts.get(event.bulkSkuId!) ?? 0) + 1);
          return counts;
        }, new Map<string, number>());
  const numberedBulkCompleted = isPickupChecklist
    ? numberedBulkItems.reduce(
        (sum, bi) => sum + (booking.kind === "RESERVATION"
          ? (scannedBulkCounts.get(bi.bulkSku.id) ?? 0)
          : (bi.checkedOutQuantity ?? 0)),
        0,
      )
    : numberedBulkItems.reduce(
        (sum, bi) => sum + Math.max(
          bi.checkedInQuantity,
          bi.unitAllocations.filter((allocation) => !!allocation.checkedInAt).length,
        ),
        0,
      );

  return ok({
    id: booking.id,
    title: displayBookingTitle(booking.title),
    refNumber: booking.refNumber,
    status: booking.status,
    requesterId: booking.custodyScope === BookingCustodyScope.SHARED
      ? null
      : booking.requesterUserId,
    custodyScope: booking.custodyScope,
    endsAt: booking.endsAt,
    eventId: booking.eventId ?? null,
    updatedAt: booking.updatedAt,
    locationId: booking.locationId,
    scanSummary: {
      serializedTotal: serializedItems.length,
      numberedBulkTotal,
      numberedBulkCompleted,
    },
    items: [...serializedItems, ...bulkItems],
  });
});

export const PATCH = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const body = activeCheckoutUpdateBody.parse(await req.json());
  const actorId = body.actorId;
  const requestedEndsAt = body.endsAt ? new Date(body.endsAt) : null;

  const updated = await db.$transaction(async (tx) => {
    const actor = await requireKioskActor(tx, actorId);
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });
    assertKioskCheckoutEditor(actor, booking);
    // C5: changing someone else's due back as staff needs a staff card scan,
    // not a tapped name. The holder and SHARED custody are unchanged.
    if (booking.custodyScope !== BookingCustodyScope.SHARED && booking.requesterUserId !== actor.id) {
      verifyKioskStaffToken(readKioskStaffToken(req), { actorId: actor.id, kioskId: kiosk.kioskId });
    }

    if (requestedEndsAt && requestedEndsAt <= new Date()) {
      throw new HttpError(400, "Return time must be in the future");
    }
    if (requestedEndsAt && requestedEndsAt <= booking.startsAt) {
      throw new HttpError(400, "Return time must be after checkout start");
    }

    if (requestedEndsAt) {
      const availability = await checkCheckoutDueTime(tx, booking, requestedEndsAt);
      if (hasBlockingAvailabilityIssue(availability)) {
        throw new HttpError(
          409,
          kioskAvailabilityBlockMessage(availability, "item"),
          availability,
        );
      }
    }

    const next = await tx.booking.update({
      where: { id: booking.id },
      data: {
        title: body.title === undefined ? undefined : normalizeBookingTitle(body.title),
        endsAt: requestedEndsAt ?? undefined,
      },
      select: { id: true, title: true, endsAt: true },
    });

    if (requestedEndsAt) {
      await tx.assetAllocation.updateMany({
        where: { bookingId: booking.id, active: true },
        data: { endsAt: requestedEndsAt },
      });
    }

    await createAuditEntryTx(tx, {
      actorId,
      actorRole: actor.role,
      entityType: "booking",
      entityId: booking.id,
      action: "kiosk_checkout_updated",
      before: {
        title: booking.title,
        endsAt: booking.endsAt.toISOString(),
      },
      after: {
        title: next.title,
        endsAt: next.endsAt.toISOString(),
        kioskDeviceId: kiosk.kioskId,
        staffCardVerified: booking.custodyScope !== BookingCustodyScope.SHARED && booking.requesterUserId !== actor.id,
      },
    });

    return next;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (requestedEndsAt) {
    await updateCheckoutReturnLiveActivities({ bookingId: updated.id, endsAt: updated.endsAt });
    await scheduleCheckoutReturnLiveActivity({ bookingId: updated.id, endsAt: updated.endsAt });
  }

  return ok({
    success: true,
    booking: {
      ...updated,
      title: displayBookingTitle(updated.title),
    },
  });
});

export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const body = activeCheckoutAddItemBody.parse(await req.json());
  const actorId = body.actorId;
  const scanValue = body.scanValue;

  const bulkUnit = await findBulkUnitByScanValue(scanValue);
  const asset = bulkUnit ? null : await findAssetByScanValue(scanValue, {
    id: true,
    assetTag: true,
    name: true,
    imageUrl: true,
    status: true,
    category: { select: { name: true } },
  });

  if (!bulkUnit && !asset) {
    return ok({ success: false, error: "Item not found" });
  }

  const result = await db.$transaction(async (tx) => {
    const actor = await requireKioskActor(tx, actorId);
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });
    assertKioskCheckoutEditor(actor, booking);
    return addScannedItemToActiveCheckout(tx, { actor, booking, kiosk, scanValue, bulkUnit, asset });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok(result);
});

export const DELETE = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const body = activeCheckoutRemoveItemBody.parse(await req.json());
  const actorId = body.actorId;

  const result = await db.$transaction(async (tx) => {
    const actor = await requireKioskActor(tx, actorId);
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });
    assertKioskCheckoutEditor(actor, booking);

    const removed = await removeActiveCheckoutItem(tx, {
      actor,
      booking,
      kiosk,
      target: body.assetId
        ? { assetId: body.assetId }
        : { bulkSkuId: body.bulkSkuId!, unitNumber: body.unitNumber! },
    });
    if (!removed.success) return removed;
    // Removing the last active item must not leave an empty OPEN checkout:
    // complete it through the same path returns use (ledger settle, scan
    // session close, completion audit) in this transaction.
    const completedAt = await maybeAutoComplete(tx, booking.id, booking.locationId, actorId, {
      auditAction: "auto_completed_by_kiosk_checkin",
      returnedFor: booking,
    });
    return completedAt ? { ...removed, completed: true } : removed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if ("completed" in result && result.completed) {
    await endCheckoutReturnLiveActivities(params.id);
  }

  return ok(result);
});
