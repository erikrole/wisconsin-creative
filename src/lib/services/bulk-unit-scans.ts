import { BookingKind, BookingStatus, BulkMovementKind, BulkUnitStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { upsertBulkBalancesAndMovements } from "@/lib/services/bookings-helpers";
import { effectiveBulkUnitStatus } from "@/lib/bulk-unit-status";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { HttpError } from "@/lib/http";

type TxClient = Prisma.TransactionClient;

type KioskScanErrorCode =
  | "not_found"
  | "not_in_booking"
  | "duplicate"
  | "wrong_status"
  | "already_checked_out"
  | "already_returned"
  | "not_checked_out"
  | "quantity_exceeded";

type NumberedBulkSku = {
  id: string;
  name: string;
  category: string;
  binQrCodeValue: string | null;
  trackByNumber: boolean;
};

type BookingBulkItemWithSku = {
  id: string;
  bulkSkuId: string;
  plannedQuantity: number;
  checkedOutQuantity: number;
  checkedInQuantity?: number;
  bulkSku: NumberedBulkSku;
};

type BulkUnitScanItem = {
  id: string;
  name: string;
  tagName: string;
  type: string;
  unitNumber: number;
  bulkSkuId: string;
};

type KioskUnitScanResult =
  | { handled: false }
  | { handled: true; success: true; item: BulkUnitScanItem }
  | { handled: true; success: false; error: string; errorCode: KioskScanErrorCode };

function unitDisplayName(skuName: string, unitNumber: number) {
  return `${skuName} #${unitNumber}`;
}

function unitTagName(unitNumber: number) {
  return `#${unitNumber}`;
}

function expectedSkuNames(items: BookingBulkItemWithSku[]) {
  return items.map((item) => item.bulkSku.name).join(", ");
}

async function resolveDerivedScan(
  tx: TxClient,
  scanValue: string,
  bookingBulkItems: BookingBulkItemWithSku[],
) {
  const bookingDerived = parseDerivedBulkUnitQr(
    scanValue,
    bookingBulkItems.map((item) => item.bulkSku),
  );
  if (bookingDerived) {
    return {
      belongsToBooking: true,
      derived: bookingDerived,
      scannedSku: bookingBulkItems.find((item) => item.bulkSkuId === bookingDerived.bulkSkuId)?.bulkSku ?? null,
    };
  }

  const activeNumberedSkus = await tx.bulkSku.findMany({
    where: { active: true, trackByNumber: true },
    select: {
      id: true,
      name: true,
      category: true,
      binQrCodeValue: true,
      trackByNumber: true,
    },
  });
  const globalDerived = parseDerivedBulkUnitQr(scanValue, activeNumberedSkus);
  if (!globalDerived) return null;

  return {
    belongsToBooking: false,
    derived: globalDerived,
    scannedSku: activeNumberedSkus.find((sku) => sku.id === globalDerived.bulkSkuId) ?? null,
  };
}

function statusLabel(status: BulkUnitStatus) {
  return status.replace(/_/g, " ").toLowerCase();
}

export async function scanKioskPickupBulkUnit(
  tx: TxClient,
  args: { bookingId: string; scanValue: string },
): Promise<KioskUnitScanResult> {
  const booking = await tx.booking.findUnique({
    where: { id: args.bookingId },
    include: {
      bulkItems: { include: { bulkSku: true } },
    },
  });

  if (
    !booking ||
    booking.kind !== BookingKind.CHECKOUT ||
    booking.status !== BookingStatus.PENDING_PICKUP
  ) {
    throw new HttpError(404, "Pending pickup not found");
  }

  const resolved = await resolveDerivedScan(tx, args.scanValue, booking.bulkItems);
  if (!resolved) return { handled: false };
  const { derived } = resolved;

  if (!resolved.belongsToBooking) {
    const scanned = resolved.scannedSku
      ? `${resolved.scannedSku.name} #${derived.unitNumber}`
      : `unit #${derived.unitNumber}`;
    return {
      handled: true,
      success: false,
      error: `Wrong battery type: scanned ${scanned}, but this pickup expects ${expectedSkuNames(booking.bulkItems)}`,
      errorCode: "not_in_booking",
    };
  }

  const bulkItem = booking.bulkItems.find((item) => item.bulkSkuId === derived.bulkSkuId);
  if (!bulkItem || !bulkItem.bulkSku.trackByNumber) {
    return { handled: true, success: false, error: "Battery unit is not in this checkout", errorCode: "not_in_booking" };
  }

  const unit = await tx.bulkSkuUnit.findUnique({
    where: {
      bulkSkuId_unitNumber: {
        bulkSkuId: bulkItem.bulkSkuId,
        unitNumber: derived.unitNumber,
      },
    },
    include: {
      allocations: {
        where: {
          checkedOutAt: { not: null },
          checkedInAt: null,
        },
        take: 1,
        include: {
          bookingBulkItem: {
            include: {
              booking: {
                select: {
                  title: true,
                  requester: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!unit) {
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${derived.unitNumber} does not exist`, errorCode: "not_found" };
  }

  const existingAllocation = await tx.bookingBulkUnitAllocation.findUnique({
    where: {
      bookingBulkItemId_bulkSkuUnitId: {
        bookingBulkItemId: bulkItem.id,
        bulkSkuUnitId: unit.id,
      },
    },
  });
  if (existingAllocation?.checkedOutAt) {
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${unit.unitNumber} already scanned`, errorCode: "duplicate" };
  }

  const activeAllocation = unit.allocations?.[0] ?? null;
  const unitStatus = effectiveBulkUnitStatus(unit, activeAllocation);
  if (unitStatus === BulkUnitStatus.CHECKED_OUT) {
    const activeBooking = activeAllocation?.bookingBulkItem.booking;
    const holder = activeBooking?.requester.name;
    return {
      handled: true,
      success: false,
      error: `${bulkItem.bulkSku.name} #${unit.unitNumber} is already checked out${holder ? ` to ${holder}` : ""}`,
      errorCode: "already_checked_out",
    };
  }

  const checkedOutQuantity = bulkItem.checkedOutQuantity ?? 0;
  if (checkedOutQuantity >= bulkItem.plannedQuantity) {
    return {
      handled: true,
      success: false,
      error: `${bulkItem.bulkSku.name} already has ${bulkItem.plannedQuantity} of ${bulkItem.plannedQuantity} units scanned`,
      errorCode: "quantity_exceeded",
    };
  }

  if (unitStatus !== BulkUnitStatus.AVAILABLE) {
    return {
      handled: true,
      success: false,
      error: `${bulkItem.bulkSku.name} #${unit.unitNumber} is marked ${statusLabel(unitStatus)} and cannot be picked up`,
      errorCode: "wrong_status",
    };
  }

  const now = new Date();
  await tx.bookingBulkUnitAllocation.create({
    data: {
      bookingBulkItemId: bulkItem.id,
      bulkSkuUnitId: unit.id,
      checkedOutAt: now,
    },
  });
  await tx.bulkSkuUnit.update({
    where: { id: unit.id },
    data: { status: BulkUnitStatus.CHECKED_OUT },
  });
  await tx.bookingBulkItem.update({
    where: { id: bulkItem.id },
    data: { checkedOutQuantity: { increment: 1 } },
  });

  return {
    handled: true,
    success: true,
    item: {
      id: `${bulkItem.id}:slot:${checkedOutQuantity + 1}`,
      name: unitDisplayName(bulkItem.bulkSku.name, unit.unitNumber),
      tagName: unitTagName(unit.unitNumber),
      type: bulkItem.bulkSku.category,
      unitNumber: unit.unitNumber,
      bulkSkuId: bulkItem.bulkSkuId,
    },
  };
}

export async function stageKioskReservationPickupBulkUnit(
  tx: TxClient,
  args: { bookingId: string; scanValue: string; actorUserId?: string; deviceContext?: string | null },
): Promise<KioskUnitScanResult> {
  const booking = await tx.booking.findUnique({
    where: { id: args.bookingId },
    include: {
      bulkItems: { include: { bulkSku: true } },
      derivedCheckouts: {
        select: {
          bulkItems: {
            select: {
              bulkSkuId: true,
              unitAllocations: {
                select: {
                  bulkSkuUnitId: true,
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
    booking.kind !== BookingKind.RESERVATION ||
    booking.status !== BookingStatus.BOOKED
  ) {
    throw new HttpError(404, "Pending pickup not found");
  }

  const resolved = await resolveDerivedScan(tx, args.scanValue, booking.bulkItems);
  if (!resolved) return { handled: false };
  const { derived } = resolved;

  if (!resolved.belongsToBooking) {
    const scanned = resolved.scannedSku
      ? `${resolved.scannedSku.name} #${derived.unitNumber}`
      : `unit #${derived.unitNumber}`;
    return {
      handled: true,
      success: false,
      error: `Wrong battery type: scanned ${scanned}, but this pickup expects ${expectedSkuNames(booking.bulkItems)}`,
      errorCode: "not_in_booking",
    };
  }

  const bulkItem = booking.bulkItems.find((item) => item.bulkSkuId === derived.bulkSkuId);
  if (!bulkItem || !bulkItem.bulkSku.trackByNumber) {
    return { handled: true, success: false, error: "Battery unit is not in this reservation", errorCode: "not_in_booking" };
  }

  const unit = await tx.bulkSkuUnit.findUnique({
    where: {
      bulkSkuId_unitNumber: {
        bulkSkuId: bulkItem.bulkSkuId,
        unitNumber: derived.unitNumber,
      },
    },
    include: {
      allocations: {
        where: {
          checkedOutAt: { not: null },
          checkedInAt: null,
        },
        take: 1,
        include: {
          bookingBulkItem: {
            include: {
              booking: {
                select: {
                  title: true,
                  requester: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!unit) {
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${derived.unitNumber} does not exist`, errorCode: "not_found" };
  }

  const derivedCheckouts = booking.derivedCheckouts ?? [];
  const pickedUnitIds = new Set(
    derivedCheckouts.flatMap((checkout) =>
      checkout.bulkItems
        .filter((item) => item.bulkSkuId === bulkItem.bulkSkuId)
        .flatMap((item) => item.unitAllocations.map((allocation) => allocation.bulkSkuUnitId)),
    ),
  );
  if (pickedUnitIds.has(unit.id)) {
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${unit.unitNumber} already picked up`, errorCode: "duplicate" };
  }
  const pickedUnitNumbers = new Set(
    derivedCheckouts.flatMap((checkout) =>
      checkout.bulkItems
        .filter((item) => item.bulkSkuId === bulkItem.bulkSkuId)
        .flatMap((item) => item.unitAllocations.map((allocation) => allocation.bulkSkuUnit.unitNumber)),
    ),
  );

  const stagedScans = await tx.scanEvent.findMany({
    where: {
      bookingId: booking.id,
      phase: "CHECKOUT",
      scanType: "BULK_BIN",
      success: true,
      bulkSkuId: bulkItem.bulkSkuId,
    },
    select: { scanValue: true },
  });
  const stagedUnits = stagedScans
    .map((event) => parseDerivedBulkUnitQr(event.scanValue, [bulkItem.bulkSku]))
    .filter((match): match is NonNullable<typeof match> => !!match);
  if (stagedUnits.some((match) => match.unitNumber === unit.unitNumber)) {
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${unit.unitNumber} already scanned`, errorCode: "duplicate" };
  }

  const stagedUnitNumbers = new Set(
    stagedUnits
      .map((stagedUnit) => stagedUnit.unitNumber)
      .filter((unitNumber) => !pickedUnitNumbers.has(unitNumber)),
  );
  const remainingQuantity = Math.max(
    0,
    bulkItem.plannedQuantity - (bulkItem.checkedOutQuantity ?? 0),
  );
  if (stagedUnitNumbers.size >= remainingQuantity) {
    const totalPickedOrScanned = pickedUnitNumbers.size + stagedUnitNumbers.size;
    return {
      handled: true,
      success: false,
      error: `${bulkItem.bulkSku.name} already has ${totalPickedOrScanned} of ${bulkItem.plannedQuantity} units picked up or scanned`,
      errorCode: "quantity_exceeded",
    };
  }

  const activeAllocation = unit.allocations?.[0] ?? null;
  const unitStatus = effectiveBulkUnitStatus(unit, activeAllocation);
  if (unitStatus === BulkUnitStatus.CHECKED_OUT) {
    const activeBooking = activeAllocation?.bookingBulkItem.booking;
    const holder = activeBooking?.requester.name;
    return {
      handled: true,
      success: false,
      error: `${bulkItem.bulkSku.name} #${unit.unitNumber} is already checked out${holder ? ` to ${holder}` : ""}`,
      errorCode: "already_checked_out",
    };
  }

  if (unitStatus !== BulkUnitStatus.AVAILABLE) {
    return {
      handled: true,
      success: false,
      error: `${bulkItem.bulkSku.name} #${unit.unitNumber} is marked ${statusLabel(unitStatus)} and cannot be picked up`,
      errorCode: "wrong_status",
    };
  }

  await tx.scanEvent.create({
    data: {
      bookingId: booking.id,
      actorUserId: args.actorUserId ?? booking.requesterUserId,
      scanType: "BULK_BIN",
      scanValue: args.scanValue,
      success: true,
      phase: "CHECKOUT",
      bulkSkuId: bulkItem.bulkSkuId,
      quantity: 1,
      deviceContext: args.deviceContext ?? "kiosk",
    },
  });

  return {
    handled: true,
    success: true,
    item: {
      id: `${bulkItem.id}:slot:${stagedUnitNumbers.size + 1}`,
      name: unitDisplayName(bulkItem.bulkSku.name, unit.unitNumber),
      tagName: unitTagName(unit.unitNumber),
      type: bulkItem.bulkSku.category,
      unitNumber: unit.unitNumber,
      bulkSkuId: bulkItem.bulkSkuId,
    },
  };
}

export async function scanKioskCheckinBulkUnit(
  tx: TxClient,
  args: { bookingId: string; scanValue: string; kioskLocationId: string },
): Promise<KioskUnitScanResult> {
  const booking = await tx.booking.findUnique({
    where: { id: args.bookingId },
    include: {
      bulkItems: { include: { bulkSku: true } },
    },
  });

  if (
    !booking ||
    booking.kind !== BookingKind.CHECKOUT ||
    booking.status !== BookingStatus.OPEN
  ) {
    throw new HttpError(404, "Active checkout not found");
  }

  const resolved = await resolveDerivedScan(tx, args.scanValue, booking.bulkItems);
  if (!resolved) return { handled: false };
  const { derived } = resolved;

  if (!resolved.belongsToBooking) {
    const scanned = resolved.scannedSku
      ? `${resolved.scannedSku.name} #${derived.unitNumber}`
      : `unit #${derived.unitNumber}`;
    return {
      handled: true,
      success: false,
      error: `Wrong battery type: scanned ${scanned}, but this return expects ${expectedSkuNames(booking.bulkItems)}`,
      errorCode: "not_in_booking",
    };
  }

  const bulkItem = booking.bulkItems.find((item) => item.bulkSkuId === derived.bulkSkuId);
  if (!bulkItem || !bulkItem.bulkSku.trackByNumber) {
    return { handled: true, success: false, error: "Battery unit is not in this checkout", errorCode: "not_in_booking" };
  }

  const unit = await tx.bulkSkuUnit.findUnique({
    where: {
      bulkSkuId_unitNumber: {
        bulkSkuId: bulkItem.bulkSkuId,
        unitNumber: derived.unitNumber,
      },
    },
    include: {
      allocations: {
        where: {
          checkedOutAt: { not: null },
          checkedInAt: null,
        },
        take: 1,
        include: {
          bookingBulkItem: {
            include: {
              booking: {
                select: {
                  title: true,
                  requester: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!unit) {
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${derived.unitNumber} does not exist`, errorCode: "not_found" };
  }

  const allocation = await tx.bookingBulkUnitAllocation.findUnique({
    where: {
      bookingBulkItemId_bulkSkuUnitId: {
        bookingBulkItemId: bulkItem.id,
        bulkSkuUnitId: unit.id,
      },
    },
  });

  if (!allocation || !allocation.checkedOutAt) {
    const activeAllocation = unit.allocations?.[0] ?? null;
    const unitStatus = effectiveBulkUnitStatus(unit, activeAllocation);
    if (unitStatus === BulkUnitStatus.CHECKED_OUT) {
      const activeBooking = activeAllocation?.bookingBulkItem.booking;
      const holder = activeBooking?.requester.name;
      return {
        handled: true,
        success: false,
        error: `${bulkItem.bulkSku.name} #${unit.unitNumber} is checked out on another booking${holder ? ` to ${holder}` : ""}`,
        errorCode: "wrong_status",
      };
    }
    if (unitStatus === BulkUnitStatus.LOST || unitStatus === BulkUnitStatus.RETIRED) {
      return {
        handled: true,
        success: false,
        error: `${bulkItem.bulkSku.name} #${unit.unitNumber} is marked ${statusLabel(unitStatus)}`,
        errorCode: "wrong_status",
      };
    }
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${unit.unitNumber} is not checked out on this booking`, errorCode: "not_checked_out" };
  }
  if (allocation.checkedInAt) {
    return { handled: true, success: false, error: `${bulkItem.bulkSku.name} #${unit.unitNumber} already returned`, errorCode: "already_returned" };
  }

  const now = new Date();
  await tx.bookingBulkUnitAllocation.update({
    where: { id: allocation.id },
    data: { checkedInAt: now },
  });
  await tx.bulkSkuUnit.update({
    where: { id: unit.id },
    data: { status: BulkUnitStatus.AVAILABLE },
  });
  await tx.bookingBulkItem.update({
    where: { id: bulkItem.id },
    data: { checkedInQuantity: { increment: 1 } },
  });
  // The unit is physically back on the shelf now — restock the ledger with
  // the return, not at completion, so availability sees it immediately and
  // every checkedInQuantity increment carries its own movement.
  await upsertBulkBalancesAndMovements(tx, {
    bookingId: booking.id,
    locationId: args.kioskLocationId,
    actorUserId: booking.requesterUserId,
    kind: BulkMovementKind.CHECKIN,
    items: [{ bulkSkuId: bulkItem.bulkSkuId, quantity: 1 }],
  });

  return {
    handled: true,
    success: true,
    item: {
      id: unit.id,
      name: unitDisplayName(bulkItem.bulkSku.name, unit.unitNumber),
      tagName: unitTagName(unit.unitNumber),
      type: bulkItem.bulkSku.category,
      unitNumber: unit.unitNumber,
      bulkSkuId: bulkItem.bulkSkuId,
    },
  };
}

export async function findBulkUnitByScanValue(scanValue: string) {
  const skus = await db.bulkSku.findMany({
    where: { trackByNumber: true, active: true },
    select: { id: true, binQrCodeValue: true, trackByNumber: true },
  });
  const derived = parseDerivedBulkUnitQr(scanValue, skus);
  if (!derived) return null;

  const unit = await db.bulkSkuUnit.findUnique({
    where: {
      bulkSkuId_unitNumber: {
        bulkSkuId: derived.bulkSkuId,
        unitNumber: derived.unitNumber,
      },
    },
    include: {
      bulkSku: {
        select: {
          id: true,
          name: true,
          category: true,
          imageUrl: true,
          active: true,
        },
      },
    },
  });
  if (!unit || !unit.bulkSku.active) return null;

  const activeAllocation = await db.bookingBulkUnitAllocation.findFirst({
    where: {
      bulkSkuUnitId: unit.id,
      checkedOutAt: { not: null },
      checkedInAt: null,
    },
    select: {
      bookingBulkItem: {
        select: {
          booking: {
            select: {
              title: true,
              endsAt: true,
              requester: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { checkedOutAt: "desc" },
  });

  const booking = activeAllocation?.bookingBulkItem.booking;
  const status = effectiveBulkUnitStatus(unit, activeAllocation);

  return {
    id: unit.id,
    name: unitDisplayName(unit.bulkSku.name, unit.unitNumber),
    tagName: unitTagName(unit.unitNumber),
    type: unit.bulkSku.category,
    imageUrl: unit.bulkSku.imageUrl,
    status,
    bulkSkuName: unit.bulkSku.name,
    bulkSkuId: unit.bulkSku.id,
    unitNumber: unit.unitNumber,
    holder: booking?.requester.name,
    dueAt: booking?.endsAt.toISOString(),
    bookingTitle: booking?.title,
  };
}
