import { BookingKind, BulkMovementKind, BulkUnitStatus, type Prisma, type Role } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import type { KioskContext } from "@/lib/auth";
import { CLAIMABLE_BULK_UNIT_WHERE } from "@/lib/bulk-unit-status";
import { checkAvailability, hasBlockingAvailabilityIssue } from "@/lib/services/availability";
import { kioskAvailabilityBlockMessage, kioskHeldItemMessage } from "@/lib/availability-copy";
import { upsertBulkBalancesAndMovements } from "@/lib/services/bookings-helpers";
import type { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";

/**
 * Item add/remove on an active kiosk checkout, shared by
 * `POST`/`DELETE /api/kiosk/checkout/[id]` and the atomic
 * `POST /api/kiosk/checkout/[id]/swap`. Callers own the SERIALIZABLE
 * transaction, the actor rule, and `assertKioskCheckoutEditor`.
 */

export type EditableCheckout = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  locationId: string;
  requesterUserId: string;
  custodyScope: "PERSON" | "SHARED";
};

export type ScannedAsset = {
  id: string;
  assetTag: string;
  name: string | null;
  imageUrl: string | null;
  status: string;
  category: { name: string } | null;
};

export type ScannedBulkUnit = NonNullable<Awaited<ReturnType<typeof findBulkUnitByScanValue>>>;

export type ActiveItemTarget = { assetId: string } | { bulkSkuId: string; unitNumber: number };

/**
 * Same model for a swap: Asset has no product id, so "same model" is the same
 * brand and model (the indexed pair), compared case- and space-insensitively.
 * Numbered units match on `bulkSkuId`.
 */
export function isSameAssetModel(a: { brand: string; model: string }, b: { brand: string; model: string }) {
  const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a.brand) === norm(b.brand) && norm(a.model) === norm(b.model);
}

type MutationResult = { success: boolean; error?: string; message?: string };

/** An OPEN checkout, global across kiosks (no location scope). */
export async function requireEditableCheckout(
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
      custodyScope: true,
    },
  });
  if (!booking) throw new HttpError(404, "Active checkout not found");
  return booking;
}

const NUMBERED_BALANCE_RECONCILIATION_REASON =
  "Reconciled numbered-unit balance from available unit records before exact kiosk checkout";

async function reconcileNumberedUnitBalanceDeficit(
  tx: Prisma.TransactionClient,
  args: {
    bulkSkuId: string;
    locationId: string;
    bookingId: string;
    actorId: string;
    actorRole: Role;
  },
) {
  const [remainingAvailableUnits, balances] = await Promise.all([
    tx.bulkSkuUnit.count({
      where: { bulkSkuId: args.bulkSkuId, ...CLAIMABLE_BULK_UNIT_WHERE },
    }),
    tx.bulkStockBalance.findMany({
      where: { bulkSkuId: args.bulkSkuId },
      select: { onHandQuantity: true },
    }),
  ]);

  // The scanned unit has already been claimed. Add it back to the expected
  // pre-checkout count so the normal CHECKOUT movement below leaves the
  // aggregate ledger equal to the remaining effectively available units.
  const expectedBeforeCheckout = remainingAvailableUnits + 1;
  const recordedBeforeCheckout = balances.reduce(
    (sum, balance) => sum + balance.onHandQuantity,
    0,
  );
  const deficit = expectedBeforeCheckout - recordedBeforeCheckout;
  if (deficit <= 0) return 0;

  await tx.bulkStockBalance.upsert({
    where: {
      bulkSkuId_locationId: {
        bulkSkuId: args.bulkSkuId,
        locationId: args.locationId,
      },
    },
    create: {
      bulkSkuId: args.bulkSkuId,
      locationId: args.locationId,
      onHandQuantity: deficit,
    },
    update: { onHandQuantity: { increment: deficit } },
  });
  await tx.bulkStockMovement.create({
    data: {
      bulkSkuId: args.bulkSkuId,
      locationId: args.locationId,
      actorUserId: args.actorId,
      kind: BulkMovementKind.ADJUSTMENT,
      quantity: deficit,
      reason: NUMBERED_BALANCE_RECONCILIATION_REASON,
    },
  });
  await createAuditEntryTx(tx, {
    actorId: args.actorId,
    actorRole: args.actorRole,
    entityType: "bulk_sku",
    entityId: args.bulkSkuId,
    action: "numbered_unit_balance_reconciled",
    before: {
      onHandQuantity: recordedBeforeCheckout,
      availableUnitCount: expectedBeforeCheckout,
    },
    after: {
      onHandQuantity: recordedBeforeCheckout + deficit,
      availableUnitCount: expectedBeforeCheckout,
      quantityAdded: deficit,
      bookingId: args.bookingId,
      locationId: args.locationId,
      reason: NUMBERED_BALANCE_RECONCILIATION_REASON,
    },
  });

  return deficit;
}

export async function addScannedItemToActiveCheckout(
  tx: Prisma.TransactionClient,
  args: {
    actor: { id: string; role: Role };
    booking: EditableCheckout;
    kiosk: KioskContext;
    scanValue: string;
    bulkUnit: ScannedBulkUnit | null;
    asset: ScannedAsset | null;
  },
): Promise<MutationResult> {
  const { actor, booking, kiosk, scanValue, bulkUnit, asset } = args;
  const actorId = actor.id;
  const now = new Date();

  // New custody runs [now, endsAt). On an overdue checkout that range is
  // empty/inverted and the allocation constraint would reject it, so ask
  // for a new return time first instead of failing mid-write.
  if (booking.endsAt.getTime() <= now.getTime()) {
    return {
      success: false,
      error: "This checkout is overdue. Update the return time before adding items.",
    };
  }

  if (bulkUnit) {
    if (bulkUnit.status !== BulkUnitStatus.AVAILABLE) {
      return {
        success: false,
        error: kioskHeldItemMessage({
          itemName: bulkUnit.name,
          holder: bulkUnit.holder,
          dueAt: bulkUnit.dueAt,
          status: bulkUnit.status,
        }),
      };
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

    // Claim on effective availability: orphaned CHECKED_OUT flags with no
    // active allocation self-heal here instead of failing the add. This exact
    // physical scan is stronger custody evidence than aggregate reservation
    // demand, so overlapping BOOKED family quantities do not veto the unit.
    // The kiosk stock movement below still enforces a non-negative ledger.
    const updatedUnit = await tx.bulkSkuUnit.updateMany({
      where: { id: unit.id, ...CLAIMABLE_BULK_UNIT_WHERE },
      data: { status: BulkUnitStatus.CHECKED_OUT },
    });
    if (updatedUnit.count !== 1) {
      return { success: false, error: `${unit.bulkSku.name} #${unit.unitNumber} is no longer available` };
    }

    const existingItem = await tx.bookingBulkItem.findUnique({
      where: { bookingId_bulkSkuId: { bookingId: booking.id, bulkSkuId: unit.bulkSkuId } },
    });
    const previous = existingItem ? await tx.bookingBulkUnitAllocation.findUnique({
      where: { bookingBulkItemId_bulkSkuUnitId: { bookingBulkItemId: existingItem.id, bulkSkuUnitId: unit.id } },
    }) : null;
    const bulkItem = await tx.bookingBulkItem.upsert({
      where: { bookingId_bulkSkuId: { bookingId: booking.id, bulkSkuId: unit.bulkSkuId } },
      create: { bookingId: booking.id, bulkSkuId: unit.bulkSkuId, plannedQuantity: 1, checkedOutQuantity: 1 },
      update: previous?.checkedInAt
        ? { checkedInQuantity: { decrement: 1 } }
        : { plannedQuantity: { increment: 1 }, checkedOutQuantity: { increment: 1 } },
      select: { id: true },
    });
    // One allocation is the current manifest state. Scan evidence retains
    // every handoff, including the previous cycle before reopening the row.
    if (previous?.checkedInAt) {
      await tx.bookingBulkUnitAllocation.update({
        where: { id: previous.id }, data: { checkedOutAt: now, checkedInAt: null },
      });
    } else {
      await tx.bookingBulkUnitAllocation.create({
        data: { bookingBulkItemId: bulkItem.id, bulkSkuUnitId: unit.id, checkedOutAt: now },
      });
    }
    await tx.scanEvent.create({ data: {
      bookingId: booking.id, actorUserId: actorId, scanType: "BULK_BIN", scanValue,
      phase: "CHECKOUT", success: true, bulkSkuId: unit.bulkSkuId, quantity: 1,
      deviceContext: JSON.stringify({ kioskId: kiosk.kioskId, previousCycle: previous?.checkedInAt ? { checkedOutAt: previous.checkedOutAt, checkedInAt: previous.checkedInAt } : null }), actualLocationId: kiosk.locationId,
    } });

    // Unit status/allocation is the numbered-family source of truth. Repair
    // any older aggregate deficit before writing this exact checkout
    // movement so a valid physical scan cannot dead-end on stale balance.
    await reconcileNumberedUnitBalanceDeficit(tx, {
      bulkSkuId: unit.bulkSkuId,
      locationId: kiosk.locationId,
      bookingId: booking.id,
      actorId,
      actorRole: actor.role,
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
    return {
      success: false,
      error: kioskAvailabilityBlockMessage(availability, asset.name || asset.assetTag),
    };
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
}

export async function removeActiveCheckoutItem(
  tx: Prisma.TransactionClient,
  args: {
    actor: { id: string; role: Role };
    booking: EditableCheckout;
    kiosk: KioskContext;
    target: ActiveItemTarget;
  },
): Promise<MutationResult> {
  const { actor, booking, kiosk, target } = args;
  const actorId = actor.id;
  if ("assetId" in target) {
    const item = await tx.bookingSerializedItem.findUnique({
      where: { bookingId_assetId: { bookingId: booking.id, assetId: target.assetId } },
      include: { asset: { select: { assetTag: true, name: true } } },
    });
    if (!item || item.allocationStatus !== "active") {
      return { success: false, error: "Item is not active on this checkout" };
    }

    await tx.bookingSerializedItem.update({ where: { id: item.id }, data: { allocationStatus: "returned" } });
    await tx.assetAllocation.updateMany({
      where: { bookingId: booking.id, assetId: target.assetId, active: true },
      data: { active: false },
    });

    await createAuditEntryTx(tx, {
      actorId,
      actorRole: actor.role,
      entityType: "booking",
      entityId: booking.id,
      action: "kiosk_checkout_item_removed",
      before: {
        assetId: target.assetId,
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
        bulkSkuId: target.bulkSkuId,
        unitNumber: target.unitNumber,
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
  if (allocation.bookingBulkItem.checkedOutQuantity <= allocation.bookingBulkItem.checkedInQuantity) {
    throw new HttpError(409, "Battery counts do not match active custody. Refresh the checkout before editing.");
  }
  await tx.bookingBulkUnitAllocation.update({
    where: { id: allocation.id }, data: { checkedInAt: new Date() },
  });
  await tx.bulkSkuUnit.update({
    where: { id: allocation.bulkSkuUnit.id }, data: { status: BulkUnitStatus.AVAILABLE },
  });
  await tx.bookingBulkItem.update({
    where: { id: allocation.bookingBulkItem.id }, data: { checkedInQuantity: { increment: 1 } },
  });

  await upsertBulkBalancesAndMovements(tx, {
    locationId: kiosk.locationId,
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
      stockLocationId: kiosk.locationId,
      kioskDeviceId: kiosk.kioskId,
      kioskName: kiosk.name,
    },
  });

  return {
    success: true,
    message: `${allocation.bulkSkuUnit.bulkSku.name} #${allocation.bulkSkuUnit.unitNumber} removed`,
  };
}
