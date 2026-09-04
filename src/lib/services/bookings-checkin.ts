import {
  BookingCustodyScope,
  BookingKind,
  BookingStatus,
  BulkMovementKind,
  BulkUnitStatus,
  Prisma,
  ScanPhase,
  ScanSessionStatus
} from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx, lookupActorRole } from "@/lib/audit";
import { badges } from "@/lib/badges";
import { settleBulkLedgerAtCompletion, upsertBulkBalancesAndMovements } from "./bookings-helpers";
import { assetLocationEvidence, reconcileAssetLocationToKiosk, type KioskLocationEvidence } from "./kiosk-location";
import { endCheckoutReturnLiveActivities } from "./live-activities";

export function wasReturnedOnTime(endsAt: Date, completedAt: Date) {
  return completedAt.getTime() <= endsAt.getTime() + 15 * 60 * 1000;
}

/**
 * Shared auto-complete check for checkinItems, checkinBulkItem, kioskCheckinAsset,
 * and scanKioskCheckinBulkUnit. Completes the booking if all serialized items are
 * returned and all bulk items are fully checked in. Returns the completion
 * timestamp if booking was completed.
 */
export async function maybeAutoComplete(
  tx: Prisma.TransactionClient,
  bookingId: string,
  locationId: string,
  actorUserId: string,
  opts: {
    auditAction: string;
  }
): Promise<Date | null> {
  const remainingActive = await tx.bookingSerializedItem.count({
    where: { bookingId, allocationStatus: "active" }
  });

  const currentBulkItems = await tx.bookingBulkItem.findMany({
    where: { bookingId }
  });
  const bulkRemaining = currentBulkItems.some(
    (item) => (item.checkedInQuantity ?? 0) < (item.checkedOutQuantity ?? item.plannedQuantity)
  );

  if (remainingActive > 0 || bulkRemaining) return null;
  const completedAt = new Date();

  // Deactivate remaining allocations
  await tx.assetAllocation.updateMany({
    where: { bookingId, active: true },
    data: { active: false }
  });

  // Ledger reconciliation from movement truth. Per-scan and per-quantity
  // returns already restocked what they returned; this restores only what the
  // movements say is still outstanding (e.g. pre-per-scan-restock history).
  await settleBulkLedgerAtCompletion(tx, { bookingId, locationId, actorUserId });

  // Complete booking
  await tx.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.COMPLETED, completedAt }
  });

  // Close scan session
  await tx.scanSession.updateMany({
    where: { bookingId, phase: ScanPhase.CHECKIN, status: ScanSessionStatus.OPEN },
    data: { status: ScanSessionStatus.COMPLETED, completedAt }
  });

  // Audit
  const actorRole = await lookupActorRole(tx, actorUserId);
  await createAuditEntryTx(tx, {
    actorId: actorUserId,
    actorRole,
    entityType: "booking",
    entityId: bookingId,
    action: opts.auditAction,
  });

  return completedAt;
}

export async function markCheckoutCompleted(bookingId: string, actorUserId: string) {
  const completedAt = new Date();
  const result = await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        bulkItems: {
          include: {
            bulkSku: { select: { trackByNumber: true } },
            unitAllocations: {
              where: { checkedOutAt: { not: null }, checkedInAt: null },
              include: { bulkSkuUnit: { select: { id: true, unitNumber: true } } },
            },
          },
        },
      },
    });

    if (!booking || booking.kind !== BookingKind.CHECKOUT) {
      throw new HttpError(404, "Checkout not found");
    }

    if (booking.status !== BookingStatus.OPEN) {
      throw new HttpError(400, `Checkout is not open (current status: ${booking.status})`);
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.COMPLETED,
        completedAt
      }
    });

    await tx.assetAllocation.updateMany({
      where: { bookingId },
      data: { active: false }
    });

    // Unreturned numbered bulk units get auto-marked LOST below. They are
    // physically gone, so they must not be restored to bulk stock — onHand
    // feeds checkBulkShortages even for numbered SKUs, and restoring lost
    // units would let reservations over-promise batteries that don't exist.
    const lostUnitIds: string[] = [];
    const lostAllocationIds: string[] = [];
    const lostUnitNumbers: Array<{ bulkSkuId: string; unitNumbers: number[] }> = [];
    const lostCountBySku = new Map<string, number>();

    for (const bulkItem of booking.bulkItems) {
      if (!bulkItem.bulkSku.trackByNumber) continue;
      const unreturned = bulkItem.unitAllocations;
      if (unreturned.length === 0) continue;

      lostUnitIds.push(...unreturned.map((a) => a.bulkSkuUnit.id));
      lostAllocationIds.push(...unreturned.map((a) => a.id));
      lostUnitNumbers.push({
        bulkSkuId: bulkItem.bulkSkuId,
        unitNumbers: unreturned.map((a) => a.bulkSkuUnit.unitNumber),
      });
      lostCountBySku.set(bulkItem.bulkSkuId, unreturned.length);
    }

    // Restore outstanding stock from movement truth (checkout movements minus
    // check-in movements minus lost units) — field math can't tell whether a
    // given checkedInQuantity increment already wrote its restock movement.
    await settleBulkLedgerAtCompletion(tx, {
      bookingId,
      locationId: booking.locationId,
      actorUserId,
      lostBySku: lostCountBySku,
    });

    const actorRole = await lookupActorRole(tx, actorUserId);

    if (lostUnitIds.length > 0) {
      await tx.bulkSkuUnit.updateMany({
        where: { id: { in: lostUnitIds } },
        data: {
          status: BulkUnitStatus.LOST,
          notes: `Auto-marked LOST on booking completion (${booking.refNumber || bookingId})`,
        },
      });

      // Close the custody episode: an open allocation on a completed booking
      // would make the unit read as phantom "checked out" the moment staff
      // mark a found battery AVAILABLE. Loss attribution survives — the
      // bulk-losses report reads the latest allocation, open or closed.
      await tx.bookingBulkUnitAllocation.updateMany({
        where: { id: { in: lostAllocationIds } },
        data: { checkedInAt: completedAt },
      });

      await createAuditEntryTx(tx, {
        actorId: actorUserId,
        actorRole,
        entityType: "booking",
        entityId: bookingId,
        action: "bulk_units_auto_lost",
        after: { lostUnits: lostUnitNumbers },
      });
    }

    await tx.scanSession.updateMany({
      where: {
        bookingId,
        phase: ScanPhase.CHECKIN,
        status: ScanSessionStatus.OPEN
      },
      data: {
        status: ScanSessionStatus.COMPLETED,
        completedAt
      }
    });

    await createAuditEntryTx(tx, {
      actorId: actorUserId,
      actorRole,
      entityType: "booking",
      entityId: bookingId,
      action: "checkin_completed",
    });

    return {
      success: true,
      userId: booking.requesterUserId,
      shouldAwardBadge: booking.custodyScope === BookingCustodyScope.PERSON,
      completedAt,
      wasOnTime: wasReturnedOnTime(booking.endsAt, completedAt),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (result.shouldAwardBadge) {
    await badges.onCheckoutReturned({
      userId: result.userId,
      bookingId,
      completedAt: result.completedAt,
      wasOnTime: result.wasOnTime,
      sourceKey: bookingId,
    });
  }
  await endCheckoutReturnLiveActivities(bookingId);

  return { success: true };
}

export async function forceCompleteCheckout(args: {
  bookingId: string;
  actorUserId: string;
  reason: string;
}) {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    throw new HttpError(400, "A reason of at least 10 characters is required");
  }

  const result = await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      include: {
        serializedItems: true,
        bulkItems: {
          include: {
            unitAllocations: {
              where: { checkedOutAt: { not: null }, checkedInAt: null },
              include: { bulkSkuUnit: { select: { id: true, unitNumber: true } } },
            },
          },
        },
      },
    });

    if (!booking || booking.kind !== BookingKind.CHECKOUT) {
      throw new HttpError(404, "Checkout not found");
    }

    if (booking.status !== BookingStatus.OPEN) {
      throw new HttpError(400, `Checkout is not open (current status: ${booking.status})`);
    }

    const completedAt = new Date();
    const actorRole = await lookupActorRole(tx, args.actorUserId);
    const serializedReturnedCount = booking.serializedItems.filter(
      (item) => item.allocationStatus !== "returned",
    ).length;
    const checkinItems = booking.bulkItems
      .map((item) => {
        const outQty = item.checkedOutQuantity ?? item.plannedQuantity;
        const checkedInQty = item.checkedInQuantity ?? 0;
        return {
          bulkItemId: item.id,
          bulkSkuId: item.bulkSkuId,
          outQty,
          checkedInQty,
          quantity: Math.max(0, outQty - checkedInQty),
        };
      })
      .filter((item) => item.quantity > 0);
    const returnedUnitIds = booking.bulkItems.flatMap((item) =>
      item.unitAllocations.map((allocation) => allocation.bulkSkuUnit.id),
    );
    const returnedUnitAllocationIds = booking.bulkItems.flatMap((item) =>
      item.unitAllocations.map((allocation) => allocation.id),
    );
    const returnedUnits = booking.bulkItems
      .map((item) => ({
        bulkSkuId: item.bulkSkuId,
        unitNumbers: item.unitAllocations.map((allocation) => allocation.bulkSkuUnit.unitNumber),
      }))
      .filter((item) => item.unitNumbers.length > 0);

    await tx.bookingSerializedItem.updateMany({
      where: { bookingId: booking.id, allocationStatus: { not: "returned" } },
      data: { allocationStatus: "returned" },
    });

    await tx.assetAllocation.updateMany({
      where: { bookingId: booking.id, active: true },
      data: { active: false },
    });

    for (const item of checkinItems) {
      await tx.bookingBulkItem.update({
        where: { id: item.bulkItemId },
        data: { checkedInQuantity: item.outQty },
      });
    }

    if (returnedUnitIds.length > 0) {
      await tx.bookingBulkUnitAllocation.updateMany({
        where: { id: { in: returnedUnitAllocationIds } },
        data: { checkedInAt: completedAt },
      });

      await tx.bulkSkuUnit.updateMany({
        where: { id: { in: returnedUnitIds } },
        data: { status: BulkUnitStatus.AVAILABLE },
      });
    }

    await settleBulkLedgerAtCompletion(tx, {
      bookingId: booking.id,
      locationId: booking.locationId,
      actorUserId: args.actorUserId,
    });

    await tx.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.COMPLETED, completedAt },
    });

    await tx.scanSession.updateMany({
      where: { bookingId: booking.id, phase: ScanPhase.CHECKIN, status: ScanSessionStatus.OPEN },
      data: { status: ScanSessionStatus.COMPLETED, completedAt },
    });

    await tx.overrideEvent.create({
      data: {
        bookingId: booking.id,
        actorUserId: args.actorUserId,
        reason,
        details: {
          type: "admin_force_complete",
          refNumber: booking.refNumber,
          serializedReturnedCount,
          bulkReturnedQuantity: checkinItems.reduce((sum, item) => sum + item.quantity, 0),
          returnedUnits,
          completedAt: completedAt.toISOString(),
        },
      },
    });

    await createAuditEntryTx(tx, {
      actorId: args.actorUserId,
      actorRole,
      entityType: "booking",
      entityId: booking.id,
      action: "admin_force_completed_checkout",
      after: {
        reason,
        serializedReturnedCount,
        bulkReturnedQuantity: checkinItems.reduce((sum, item) => sum + item.quantity, 0),
        returnedUnits,
        completedAt,
      },
    });

    return {
      userId: booking.requesterUserId,
      shouldAwardBadge: booking.custodyScope === BookingCustodyScope.PERSON,
      completedAt,
      wasOnTime: wasReturnedOnTime(booking.endsAt, completedAt),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (result.shouldAwardBadge) {
    await badges.onCheckoutReturned({
      userId: result.userId,
      bookingId: args.bookingId,
      completedAt: result.completedAt,
      wasOnTime: result.wasOnTime,
      sourceKey: args.bookingId,
    });
  }
  await endCheckoutReturnLiveActivities(args.bookingId);

  return { success: true };
}

/**
 * Partial check-in: return individual serialized items from a checkout.
 * Marks each item's allocationStatus as "returned" and deactivates its allocation.
 * If all serialized items are returned (and bulk items fully checked in),
 * auto-completes the checkout.
 *
 * Source: BRIEF_CHECKOUT_UX_V2.md — "Partial check-in: multi-item
 * allocations can be returned incrementally without triggering completion"
 */
export async function checkinItems(
  bookingId: string,
  actorUserId: string,
  assetIds: string[]
) {
  return db.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { serializedItems: true, bulkItems: true }
      });

      if (!booking || booking.kind !== BookingKind.CHECKOUT) {
        throw new HttpError(404, "Checkout not found");
      }

      if (booking.status !== BookingStatus.OPEN) {
        throw new HttpError(400, "Can only check in items from an open checkout");
      }

      // Validate all requested assets belong to this checkout
      const bookingAssetIds = new Set(booking.serializedItems.map((i) => i.assetId));
      const invalid = assetIds.filter((id) => !bookingAssetIds.has(id));
      if (invalid.length > 0) {
        throw new HttpError(400, `Assets not in this checkout: ${invalid.join(", ")}`);
      }

      // Validate none are already returned
      const alreadyReturned = booking.serializedItems
        .filter((i) => assetIds.includes(i.assetId) && i.allocationStatus === "returned")
        .map((i) => i.assetId);
      if (alreadyReturned.length > 0) {
        throw new HttpError(400, `Assets already returned: ${alreadyReturned.join(", ")}`);
      }

      // Mark items as returned (batched — avoids N+1 sequential queries)
      await tx.bookingSerializedItem.updateMany({
        where: { bookingId, assetId: { in: assetIds } },
        data: { allocationStatus: "returned" }
      });

      await tx.assetAllocation.updateMany({
        where: { bookingId, assetId: { in: assetIds }, active: true },
        data: { active: false }
      });

      const actorRole = await lookupActorRole(tx, actorUserId);
      await createAuditEntryTx(tx, {
        actorId: actorUserId,
        actorRole,
        entityType: "booking",
        entityId: bookingId,
        action: "partial_checkin",
        after: { returnedAssetIds: assetIds },
      });

      const completedAt = await maybeAutoComplete(tx, bookingId, booking.locationId, actorUserId, {
        auditAction: "auto_completed_by_partial_checkin"
      });

      const remainingActive = completedAt
        ? 0
        : await tx.bookingSerializedItem.count({ where: { bookingId, allocationStatus: "active" } });

      return {
        success: true,
        returnedAssetIds: assetIds,
        remainingActiveItems: remainingActive,
        autoCompleted: completedAt !== null,
        badgeEvent: completedAt && booking.custodyScope === BookingCustodyScope.PERSON
          ? {
              userId: booking.requesterUserId,
              bookingId,
              completedAt,
              wasOnTime: wasReturnedOnTime(booking.endsAt, completedAt),
              sourceKey: bookingId,
            }
          : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ).then(async (result) => {
    if (result.badgeEvent) {
      await badges.onCheckoutReturned(result.badgeEvent);
      await endCheckoutReturnLiveActivities(bookingId);
    }
    return {
      success: result.success,
      returnedAssetIds: result.returnedAssetIds,
      remainingActiveItems: result.remainingActiveItems,
      autoCompleted: result.autoCompleted,
    };
  });
}

/**
 * Kiosk-flavored per-asset return.
 *
 * Mirrors the core of `checkinItems` (validate booking → mark serialized
 * item returned → deactivate allocation) but is scoped to a single asset
 * and emits no per-scan audit (kiosk audits at complete, not per-scan).
 *
 * Auto-completes the booking via `maybeAutoComplete` when this scan returns
 * the last outstanding item — otherwise a dropped kiosk session between the
 * last scan and the explicit "Complete Return" tap leaves the booking stuck
 * OPEN even though every item shows returned.
 *
 * Caller is responsible for the SERIALIZABLE transaction boundary so
 * `update` + `updateMany` are atomic against concurrent scans.
 */
export async function kioskCheckinAsset(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; assetId: string; kioskLocationId?: string; actorUserId: string },
): Promise<
  | {
      ok: true;
      alreadyReturned: false;
      locationEvidence?: KioskLocationEvidence;
      completed: boolean;
      badgeEvent: { userId: string; bookingId: string; completedAt: Date; wasOnTime: boolean; sourceKey: string } | null;
    }
  | { ok: false; reason: "not_in_booking" | "already_returned" }
> {
  const item = await tx.bookingSerializedItem.findUnique({
    where: {
      bookingId_assetId: {
        bookingId: args.bookingId,
        assetId: args.assetId,
      },
    },
  });
  if (!item) return { ok: false, reason: "not_in_booking" };
  if (item.allocationStatus === "returned") {
    return { ok: false, reason: "already_returned" };
  }

  const booking = await tx.booking.findUnique({
    where: { id: args.bookingId },
    select: { locationId: true, requesterUserId: true, custodyScope: true, endsAt: true },
  });

  const locationEvidence = args.kioskLocationId && booking
    ? await assetLocationEvidence(tx, {
        assetId: args.assetId,
        expectedLocationId: booking.locationId,
      })
    : undefined;

  await tx.bookingSerializedItem.update({
    where: { id: item.id },
    data: { allocationStatus: "returned" },
  });
  await tx.assetAllocation.updateMany({
    where: {
      bookingId: args.bookingId,
      assetId: args.assetId,
      active: true,
    },
    data: { active: false },
  });
  if (args.kioskLocationId) {
    await reconcileAssetLocationToKiosk(tx, {
      assetId: args.assetId,
      kioskLocationId: args.kioskLocationId,
    });
  }

  if (locationEvidence && booking && args.kioskLocationId !== booking.locationId) {
    locationEvidence.locationMismatch = true;
    locationEvidence.message = locationEvidence.message ?? "Location mismatch: returned at a different kiosk than expected. Updated to this kiosk.";
  }

  const completedAt = booking
    ? await maybeAutoComplete(tx, args.bookingId, booking.locationId, args.actorUserId, {
        auditAction: "auto_completed_by_kiosk_checkin",
      })
    : null;

  return {
    ok: true,
    alreadyReturned: false,
    locationEvidence,
    completed: completedAt !== null,
    badgeEvent:
      completedAt && booking && booking.custodyScope === BookingCustodyScope.PERSON
        ? {
            userId: booking.requesterUserId,
            bookingId: args.bookingId,
            completedAt,
            wasOnTime: wasReturnedOnTime(booking.endsAt, completedAt),
            sourceKey: args.bookingId,
          }
        : null,
  };
}

/**
 * Kiosk-flavored check-in completion.
 *
 * Re-reads the booking inside a SERIALIZABLE transaction (closing the
 * race where a concurrent scan finishes after the route's pre-read),
 * then delegates the "all returned? → COMPLETED + close scan sessions
 * + bulk balance restore" logic to `maybeAutoComplete`. (LOST handling
 * lives in `markCheckoutCompleted` only — kiosk completion never marks
 * units LOST because it completes only when everything is returned.)
 *
 * `kioskCheckinAsset` also auto-completes on the scan that returns the
 * last item, so by the time the student taps "Complete Return" the
 * booking is very often already COMPLETED. Treat that as success rather
 * than a 404 — otherwise the explicit tap that follows a normal, final
 * scan would surface an error even though the return already succeeded.
 *
 * Returns `before/after` counts so the route can stamp the kiosk audit
 * entry with the same shape it always has.
 */
export async function kioskCompleteCheckin(args: {
  bookingId: string;
  actorUserId: string;
}): Promise<{
  refNumber: string | null;
  totalItems: number;
  returnedItems: number;
  returnedItemNames: string[];
  completed: boolean;
}> {
  return db.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: args.bookingId },
        include: {
          serializedItems: {
            include: { asset: { select: { name: true, assetTag: true } } },
          },
          bulkItems: {
            include: {
              bulkSku: { select: { name: true } },
              unitAllocations: {
                include: { bulkSkuUnit: { select: { unitNumber: true } } },
              },
            },
          },
        },
      });
      if (
        !booking ||
        booking.kind !== BookingKind.CHECKOUT ||
        (booking.status !== BookingStatus.OPEN && booking.status !== BookingStatus.COMPLETED)
      ) {
        throw new HttpError(404, "Active checkout not found");
      }
      const alreadyCompleted = booking.status === BookingStatus.COMPLETED;

      // Count serialized assets AND bulk units so battery-only (or mixed)
      // returns report a truthful "N of M" instead of 0. Numbered batteries
      // track per-unit allocations; plain bulk falls back to quantities.
      const serializedTotal = booking.serializedItems.length;
      const serializedReturned = booking.serializedItems.filter(
        (i) => i.allocationStatus === "returned",
      ).length;

      let bulkTotal = 0;
      let bulkReturned = 0;
      for (const item of booking.bulkItems) {
        const units = item.unitAllocations.filter((u) => u.checkedOutAt !== null);
        if (units.length > 0) {
          bulkTotal += units.length;
          bulkReturned += units.filter((u) => u.checkedInAt !== null).length;
        } else {
          const out = item.checkedOutQuantity ?? item.plannedQuantity;
          const inn = item.checkedInQuantity ?? 0;
          bulkTotal += Math.max(0, out);
          bulkReturned += Math.max(0, Math.min(inn, out));
        }
      }

      const totalItems = serializedTotal + bulkTotal;
      const returnedItems = serializedReturned + bulkReturned;
      const returnedItemNames = [
        ...booking.serializedItems
          .filter((item) => item.allocationStatus === "returned")
          .map((item) => item.asset.assetTag),
        ...booking.bulkItems.flatMap((item) => {
          const returnedUnits = item.unitAllocations.filter(
            (unit) => unit.checkedOutAt !== null && unit.checkedInAt !== null,
          );
          if (returnedUnits.length > 0) {
            return returnedUnits.map(
              (unit) => `${item.bulkSku.name} #${unit.bulkSkuUnit.unitNumber}`,
            );
          }
          const returnedQuantity = Math.max(
            0,
            Math.min(item.checkedInQuantity ?? 0, item.checkedOutQuantity ?? item.plannedQuantity),
          );
          return returnedQuantity > 0
            ? [`${item.bulkSku.name} ×${returnedQuantity}`]
            : [];
        }),
      ];

      // Already completed by the last scan's auto-complete — don't re-run
      // maybeAutoComplete (it would double-settle the bulk ledger and
      // duplicate the completion audit entry).
      const completedAt = alreadyCompleted
        ? null
        : await maybeAutoComplete(
            tx,
            booking.id,
            booking.locationId,
            args.actorUserId,
            {
              auditAction: "auto_completed_by_kiosk_checkin",
            },
          );

      return {
        refNumber: booking.refNumber,
        totalItems,
        returnedItems,
        returnedItemNames,
        completed: alreadyCompleted || completedAt !== null,
        badgeEvent: completedAt && booking.custodyScope === BookingCustodyScope.PERSON
          ? {
              userId: booking.requesterUserId,
              bookingId: booking.id,
              completedAt,
              wasOnTime: wasReturnedOnTime(booking.endsAt, completedAt),
              sourceKey: booking.id,
            }
          : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ).then(async (result) => {
    if (result.badgeEvent) {
      await badges.onCheckoutReturned(result.badgeEvent);
      await endCheckoutReturnLiveActivities(args.bookingId);
    }
    return {
      refNumber: result.refNumber,
      totalItems: result.totalItems,
      returnedItems: result.returnedItems,
      returnedItemNames: result.returnedItemNames,
      completed: result.completed,
    };
  });
}

/**
 * Check in a partial quantity of a bulk item on an open checkout.
 * Updates checkedInQuantity and returns bulk stock to the location balance.
 * Auto-completes the checkout if all items (serialized + bulk) are now returned.
 */
export async function checkinBulkItem(
  bookingId: string,
  actorUserId: string,
  bulkItemId: string,
  quantity: number
) {
  return db.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { serializedItems: true, bulkItems: true }
      });

      if (!booking || booking.kind !== BookingKind.CHECKOUT) {
        throw new HttpError(404, "Checkout not found");
      }

      if (booking.status !== BookingStatus.OPEN) {
        throw new HttpError(400, "Can only check in items from an open checkout");
      }

      const bulkItem = booking.bulkItems.find((i) => i.id === bulkItemId);
      if (!bulkItem) {
        throw new HttpError(400, "Bulk item not in this checkout");
      }

      const outQty = bulkItem.checkedOutQuantity ?? bulkItem.plannedQuantity;
      const alreadyIn = bulkItem.checkedInQuantity ?? 0;
      const remaining = outQty - alreadyIn;

      if (quantity <= 0 || quantity > remaining) {
        throw new HttpError(400, `Invalid quantity: ${remaining} remaining to return`);
      }

      const newCheckedIn = alreadyIn + quantity;

      await tx.bookingBulkItem.update({
        where: { id: bulkItemId },
        data: { checkedInQuantity: newCheckedIn }
      });

      // Return stock to location balance
      await upsertBulkBalancesAndMovements(tx, {
        bookingId,
        locationId: booking.locationId,
        actorUserId,
        kind: BulkMovementKind.CHECKIN,
        items: [{ bulkSkuId: bulkItem.bulkSkuId, quantity }]
      });

      const actorRole = await lookupActorRole(tx, actorUserId);
      await createAuditEntryTx(tx, {
        actorId: actorUserId,
        actorRole,
        entityType: "booking",
        entityId: bookingId,
        action: "partial_bulk_checkin",
        after: { bulkItemId, quantity, newCheckedIn, outQty },
      });

      const completedAt = await maybeAutoComplete(tx, bookingId, booking.locationId, actorUserId, {
        auditAction: "auto_completed_by_bulk_checkin"
      });

      return {
        success: true,
        bulkItemId,
        checkedInQuantity: newCheckedIn,
        totalQuantity: outQty,
        autoCompleted: completedAt !== null,
        badgeEvent: completedAt && booking.custodyScope === BookingCustodyScope.PERSON
          ? {
              userId: booking.requesterUserId,
              bookingId,
              completedAt,
              wasOnTime: wasReturnedOnTime(booking.endsAt, completedAt),
              sourceKey: bookingId,
            }
          : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ).then(async (result) => {
    if (result.badgeEvent) {
      await badges.onCheckoutReturned(result.badgeEvent);
      await endCheckoutReturnLiveActivities(bookingId);
    }
    return {
      success: result.success,
      bulkItemId: result.bulkItemId,
      checkedInQuantity: result.checkedInQuantity,
      totalQuantity: result.totalQuantity,
      autoCompleted: result.autoCompleted,
    };
  });
}
