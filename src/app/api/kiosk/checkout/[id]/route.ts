import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { activeCheckoutAddItemBody, activeCheckoutRemoveItemBody, activeCheckoutUpdateBody } from "@/lib/schemas/kiosk";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { CLAIMABLE_BULK_UNIT_WHERE } from "@/lib/bulk-unit-status";
import { checkAvailability } from "@/lib/services/availability";
import { upsertBulkBalancesAndMovements } from "@/lib/services/bookings-helpers";
import { BookingCustodyScope, BookingKind, BulkMovementKind, BulkUnitStatus, Prisma } from "@prisma/client";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { updateCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { normalizeBookingTitle, normalizeTeamAbbreviations } from "@/lib/title-normalization";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";

function hasBlockingAvailabilityIssue(result: Awaited<ReturnType<typeof checkAvailability>>) {
  return result.conflicts.length > 0 || result.shortages.length > 0 || result.unavailableAssets.length > 0;
}

async function requireActor(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findFirst({
    where: { id: actorId, active: true },
    select: { id: true, role: true },
  });
  if (!actor) throw new HttpError(404, "User not found");
  return actor;
}

async function requireEditableCheckout(
  tx: Prisma.TransactionClient,
  args: { checkoutId: string },
) {
  const booking = await tx.booking.findFirst({
    where: {
      id: args.checkoutId,
      kind: "CHECKOUT",
      status: "OPEN",
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      locationId: true,
      requesterUserId: true,
    },
  });
  if (!booking) throw new HttpError(404, "Active checkout not found");
  return booking;
}

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
      endsAt: true,
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
            // Quantity-tracked stock is checked out as one aggregate ledger row,
            // so there is no physical per-unit QR scan for the native checklist.
            returned: true,
            type: "bulk_quantity" as const,
            bulkSkuId: bi.bulkSku.id,
            bulkSkuName: bi.bulkSku.name,
            unitNumber: null,
            imageUrl: bi.bulkSku.imageUrl,
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
        const missingQuantity = Math.max(0, activeBulkQuantity(bi) - bi.unitAllocations.length);
        if (missingQuantity <= 0) return activeAllocations;
        return [
          ...activeAllocations,
          {
            id: `${bi.id}:bulk-quantity`,
            tagName: `x${missingQuantity}`,
            name: quantityLabel(bi.bulkSku.name, missingQuantity),
            returned: false,
            type: "bulk_quantity" as const,
            bulkSkuId: bi.bulkSku.id,
            bulkSkuName: bi.bulkSku.name,
            unitNumber: null,
            imageUrl: bi.bulkSku.imageUrl,
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
    title: normalizeTeamAbbreviations(booking.title),
    refNumber: booking.refNumber,
    status: booking.status,
    requesterId: booking.custodyScope === BookingCustodyScope.SHARED
      ? null
      : booking.requesterUserId,
    custodyScope: booking.custodyScope,
    endsAt: booking.endsAt,
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
    const actor = await requireActor(tx, actorId);
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });

    if (requestedEndsAt && requestedEndsAt <= new Date()) {
      throw new HttpError(400, "Return time must be in the future");
    }
    if (requestedEndsAt && requestedEndsAt <= booking.startsAt) {
      throw new HttpError(400, "Return time must be after checkout start");
    }

    if (requestedEndsAt) {
      const activeSerialized = await tx.bookingSerializedItem.findMany({
        where: { bookingId: booking.id, allocationStatus: "active" },
        select: { assetId: true },
      });
      const activeBulkUnits = await tx.bookingBulkUnitAllocation.findMany({
        where: {
          checkedOutAt: { not: null },
          checkedInAt: null,
          bookingBulkItem: { bookingId: booking.id },
        },
        select: {
          bookingBulkItem: { select: { bulkSkuId: true } },
        },
      });
      const bulkCounts = new Map<string, number>();
      for (const allocation of activeBulkUnits) {
        const bulkSkuId = allocation.bookingBulkItem.bulkSkuId;
        bulkCounts.set(bulkSkuId, (bulkCounts.get(bulkSkuId) ?? 0) + 1);
      }

      const availability = await checkAvailability(tx, {
        locationId: booking.locationId,
        startsAt: booking.startsAt,
        endsAt: requestedEndsAt,
        serializedAssetIds: activeSerialized.map((item) => item.assetId),
        bulkItems: [...bulkCounts.entries()].map(([bulkSkuId, quantity]) => ({ bulkSkuId, quantity })),
        bookingKind: BookingKind.CHECKOUT,
        excludeBookingId: booking.id,
      });
      if (hasBlockingAvailabilityIssue(availability)) {
        throw new HttpError(409, "One or more items are not available through that return time", availability);
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
      title: normalizeTeamAbbreviations(updated.title),
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
    const actor = await requireActor(tx, actorId);
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });
    const now = new Date();

    if (bulkUnit) {
      if (bulkUnit.status !== BulkUnitStatus.AVAILABLE) {
        return { success: false, error: `${bulkUnit.name} is not available` };
      }

      const unit = await tx.bulkSkuUnit.findUnique({
        where: {
          bulkSkuId_unitNumber: {
            bulkSkuId: bulkUnit.bulkSkuId,
            unitNumber: bulkUnit.unitNumber,
          },
        },
        include: { bulkSku: { select: { id: true, name: true, active: true, imageUrl: true } } },
      });
      if (!unit || !unit.bulkSku.active) {
        return { success: false, error: "Battery unit not found" };
      }

      const availability = await checkAvailability(tx, {
        // The scan proves this numbered unit is physically at the authenticated
        // kiosk. An open checkout may have originated at another location, but
        // the stock being handed over comes from the current kiosk's ledger.
        locationId: kiosk.locationId,
        startsAt: now,
        endsAt: booking.endsAt,
        serializedAssetIds: [],
        bulkItems: [{ bulkSkuId: unit.bulkSkuId, quantity: 1 }],
        bookingKind: BookingKind.CHECKOUT,
        excludeBookingId: booking.id,
      });
      const shortage = availability.shortages.find((item) => item.bulkSkuId === unit.bulkSkuId);
      if (shortage) {
        return {
          success: false,
          error: `${unit.bulkSku.name} #${unit.unitNumber} cannot be added: ${shortage.available} available at ${kiosk.locationName}. Check Battery Ops stock before retrying.`,
        };
      }

      // Claim on effective availability: orphaned CHECKED_OUT flags with no
      // active allocation self-heal here instead of failing the add.
      const updatedUnit = await tx.bulkSkuUnit.updateMany({
        where: { id: unit.id, ...CLAIMABLE_BULK_UNIT_WHERE },
        data: { status: BulkUnitStatus.CHECKED_OUT },
      });
      if (updatedUnit.count !== 1) {
        return { success: false, error: `${unit.bulkSku.name} #${unit.unitNumber} is no longer available` };
      }

      const bulkItem = await tx.bookingBulkItem.upsert({
        where: {
          bookingId_bulkSkuId: {
            bookingId: booking.id,
            bulkSkuId: unit.bulkSkuId,
          },
        },
        create: {
          bookingId: booking.id,
          bulkSkuId: unit.bulkSkuId,
          plannedQuantity: 1,
          checkedOutQuantity: 1,
        },
        update: {
          plannedQuantity: { increment: 1 },
          checkedOutQuantity: { increment: 1 },
        },
        select: { id: true },
      });

      await tx.bookingBulkUnitAllocation.create({
        data: {
          bookingBulkItemId: bulkItem.id,
          bulkSkuUnitId: unit.id,
          checkedOutAt: now,
        },
      });

      await upsertBulkBalancesAndMovements(tx, {
        locationId: kiosk.locationId,
        bookingId: booking.id,
        actorUserId: actorId,
        kind: BulkMovementKind.CHECKOUT,
        items: [{ bulkSkuId: unit.bulkSkuId, quantity: 1 }],
      });

      await createAuditEntryTx(tx, {
        actorId,
        actorRole: actor.role,
        entityType: "booking",
        entityId: booking.id,
        action: "kiosk_checkout_item_added",
        after: {
          bulkSkuId: unit.bulkSkuId,
          unitNumber: unit.unitNumber,
          itemName: `${unit.bulkSku.name} #${unit.unitNumber}`,
          kioskDeviceId: kiosk.kioskId,
          kioskName: kiosk.name,
        },
      });

      return {
        success: true,
        message: `${unit.bulkSku.name} #${unit.unitNumber} added`,
      };
    }

    if (!asset) {
      return { success: false, error: "Item not found" };
    }
    if (asset.status === "RETIRED") {
      return { success: false, error: `${asset.assetTag} is retired` };
    }
    if (asset.status === "MAINTENANCE") {
      return { success: false, error: `${asset.assetTag} is in maintenance` };
    }

    const existingInBooking = await tx.bookingSerializedItem.findUnique({
      where: { bookingId_assetId: { bookingId: booking.id, assetId: asset.id } },
      select: { allocationStatus: true },
    });
    if (existingInBooking?.allocationStatus === "active") {
      return { success: false, error: `${asset.assetTag} is already on this checkout` };
    }

    const availability = await checkAvailability(tx, {
      locationId: booking.locationId,
      startsAt: now,
      endsAt: booking.endsAt,
      serializedAssetIds: [asset.id],
      bulkItems: [],
      bookingKind: BookingKind.CHECKOUT,
      excludeBookingId: booking.id,
    });
    if (hasBlockingAvailabilityIssue(availability)) {
      return { success: false, error: "Item is not available for this checkout" };
    }

    if (existingInBooking) {
      await tx.bookingSerializedItem.update({
        where: { bookingId_assetId: { bookingId: booking.id, assetId: asset.id } },
        data: { allocationStatus: "active" },
      });
    } else {
      await tx.bookingSerializedItem.create({
        data: {
          bookingId: booking.id,
          assetId: asset.id,
          allocationStatus: "active",
        },
      });
    }
    await tx.assetAllocation.create({
      data: {
        assetId: asset.id,
        bookingId: booking.id,
        startsAt: now,
        endsAt: booking.endsAt,
        active: true,
        kind: "CHECKOUT",
      },
    });

    await createAuditEntryTx(tx, {
      actorId,
      actorRole: actor.role,
      entityType: "booking",
      entityId: booking.id,
      action: "kiosk_checkout_item_added",
      after: {
        assetId: asset.id,
        tagName: asset.assetTag,
        itemName: asset.assetTag,
        kioskDeviceId: kiosk.kioskId,
        kioskName: kiosk.name,
      },
    });

    return {
      success: true,
      message: `${asset.name || asset.assetTag} added`,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok(result);
});

export const DELETE = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const body = activeCheckoutRemoveItemBody.parse(await req.json());
  const actorId = body.actorId;

  const result = await db.$transaction(async (tx) => {
    const actor = await requireActor(tx, actorId);
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });

    if (body.assetId) {
      const item = await tx.bookingSerializedItem.findUnique({
        where: { bookingId_assetId: { bookingId: booking.id, assetId: body.assetId } },
        include: { asset: { select: { assetTag: true, name: true } } },
      });
      if (!item || item.allocationStatus !== "active") {
        return { success: false, error: "Item is not active on this checkout" };
      }

      await tx.bookingSerializedItem.delete({ where: { id: item.id } });
      await tx.assetAllocation.updateMany({
        where: { bookingId: booking.id, assetId: body.assetId, active: true },
        data: { active: false },
      });

      await createAuditEntryTx(tx, {
        actorId,
        actorRole: actor.role,
        entityType: "booking",
        entityId: booking.id,
        action: "kiosk_checkout_item_removed",
        before: {
          assetId: body.assetId,
          tagName: item.asset.assetTag,
          itemName: item.asset.assetTag,
          kioskDeviceId: kiosk.kioskId,
          kioskName: kiosk.name,
        },
      });

      return { success: true, message: `${item.asset.name || item.asset.assetTag} removed` };
    }

    const allocation = await tx.bookingBulkUnitAllocation.findFirst({
      where: {
        checkedOutAt: { not: null },
        checkedInAt: null,
        bulkSkuUnit: {
          bulkSkuId: body.bulkSkuId,
          unitNumber: body.unitNumber,
        },
        bookingBulkItem: { bookingId: booking.id },
      },
      include: {
        bulkSkuUnit: {
          select: {
            id: true,
            unitNumber: true,
            bulkSkuId: true,
            bulkSku: { select: { name: true } },
          },
        },
        bookingBulkItem: {
          select: {
            id: true,
            plannedQuantity: true,
            checkedOutQuantity: true,
            checkedInQuantity: true,
          },
        },
      },
    });
    if (!allocation) {
      return { success: false, error: "Battery unit is not active on this checkout" };
    }
    if (allocation.bookingBulkItem.checkedInQuantity > 0) {
      return { success: false, error: "Returned battery units cannot be removed from checkout history" };
    }

    await tx.bookingBulkUnitAllocation.delete({ where: { id: allocation.id } });
    await tx.bulkSkuUnit.update({
      where: { id: allocation.bulkSkuUnit.id },
      data: { status: BulkUnitStatus.AVAILABLE },
    });

    if (allocation.bookingBulkItem.plannedQuantity <= 1) {
      await tx.bookingBulkItem.delete({ where: { id: allocation.bookingBulkItem.id } });
    } else {
      await tx.bookingBulkItem.update({
        where: { id: allocation.bookingBulkItem.id },
        data: {
          plannedQuantity: { decrement: 1 },
          checkedOutQuantity: { decrement: 1 },
        },
      });
    }

    await upsertBulkBalancesAndMovements(tx, {
      locationId: booking.locationId,
      bookingId: booking.id,
      actorUserId: actorId,
      kind: BulkMovementKind.CHECKIN,
      items: [{ bulkSkuId: allocation.bulkSkuUnit.bulkSkuId, quantity: 1 }],
    });

    await createAuditEntryTx(tx, {
      actorId,
      actorRole: actor.role,
      entityType: "booking",
      entityId: booking.id,
      action: "kiosk_checkout_item_removed",
      before: {
        bulkSkuId: allocation.bulkSkuUnit.bulkSkuId,
        unitNumber: allocation.bulkSkuUnit.unitNumber,
        itemName: `${allocation.bulkSkuUnit.bulkSku.name} #${allocation.bulkSkuUnit.unitNumber}`,
        kioskDeviceId: kiosk.kioskId,
        kioskName: kiosk.name,
      },
    });

    return {
      success: true,
      message: `${allocation.bulkSkuUnit.bulkSku.name} #${allocation.bulkSkuUnit.unitNumber} removed`,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok(result);
});
