import { AllocationKind, BookingCustodyScope, BookingKind, BookingStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx, lookupActorRole } from "@/lib/audit";
import { checkAvailability } from "@/lib/services/availability";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { kioskRosterUserWhere } from "@/lib/user-visibility";

export type PickupNamedItem = {
  id: string;
  name: string;
  tagName: string;
};

export type PickupSubstitutionCandidate = {
  scanned: PickupNamedItem;
  reserved: PickupNamedItem;
};

type RemainingSerializedItem = {
  assetId: string;
  allocationStatus: string;
  asset: {
    id: string;
    assetTag: string;
    name: string | null;
    type: string;
    categoryId: string | null;
  };
};

function namedItem(asset: { id: string; assetTag: string; name: string | null }): PickupNamedItem {
  return {
    id: asset.id,
    name: asset.name || asset.assetTag,
    tagName: asset.assetTag,
  };
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1));
  const rightTokens = right.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
  return rightTokens.reduce((score, token) => score + (leftTokens.has(token) ? 1 : 0), 0);
}

function closestRemaining(
  remaining: RemainingSerializedItem[],
  scanned: { name: string | null; assetTag: string },
) {
  const scannedLabel = `${scanned.name ?? ""} ${scanned.assetTag}`;
  return [...remaining].sort((left, right) => {
    const rightScore = tokenOverlap(`${right.asset.name ?? ""} ${right.asset.assetTag}`, scannedLabel);
    const leftScore = tokenOverlap(`${left.asset.name ?? ""} ${left.asset.assetTag}`, scannedLabel);
    return rightScore - leftScore;
  })[0] ?? null;
}

export function choosePickupSubstitutionCandidate(
  remaining: RemainingSerializedItem[],
  scanned: { id: string; name: string | null; assetTag: string; type: string; categoryId: string | null },
  alreadyScannedAssetIds: Set<string>,
) {
  const candidates = remaining.filter((item) => (
    item.allocationStatus === "active"
    && item.assetId !== scanned.id
    && !alreadyScannedAssetIds.has(item.assetId)
  ));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const sameCategory = scanned.categoryId
    ? candidates.filter((item) => item.asset.categoryId === scanned.categoryId)
    : [];
  if (sameCategory.length === 1) return sameCategory[0];
  if (sameCategory.length > 1) return closestRemaining(sameCategory, scanned);

  const scannedType = scanned.type.trim().toLowerCase();
  const sameType = scannedType
    ? candidates.filter((item) => item.asset.type.trim().toLowerCase() === scannedType)
    : [];
  if (sameType.length === 1) return sameType[0];
  if (sameType.length > 1) return closestRemaining(sameType, scanned);

  return null;
}

export async function findPickupSubstitutionCandidate(args: {
  bookingId: string;
  scanned: { id: string; name: string | null; assetTag: string; type: string; categoryId: string | null };
}): Promise<PickupSubstitutionCandidate | null> {
  const booking = await db.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      kind: true,
      status: true,
      serializedItems: {
        select: {
          assetId: true,
          allocationStatus: true,
          asset: {
            select: {
              id: true,
              assetTag: true,
              name: true,
              type: true,
              categoryId: true,
            },
          },
        },
      },
      scanEvents: {
        where: { success: true, phase: "CHECKOUT", assetId: { not: null } },
        select: { assetId: true },
      },
    },
  });
  if (!booking || booking.kind !== BookingKind.RESERVATION || booking.status !== BookingStatus.BOOKED) {
    return null;
  }

  const alreadyScannedAssetIds = new Set(
    booking.scanEvents.map((event) => event.assetId).filter((assetId): assetId is string => !!assetId),
  );
  const reserved = choosePickupSubstitutionCandidate(
    booking.serializedItems,
    args.scanned,
    alreadyScannedAssetIds,
  );
  if (!reserved) return null;

  return {
    scanned: namedItem(args.scanned),
    reserved: namedItem(reserved.asset),
  };
}

export async function substituteReservationPickupItem(args: {
  bookingId: string;
  actorUserId: string;
  scanValue: string;
  reservedAssetId: string;
  deviceContext: string;
}) {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        id: true,
        kind: true,
        status: true,
        custodyScope: true,
        requesterUserId: true,
        locationId: true,
        startsAt: true,
        endsAt: true,
        serializedItems: {
          select: {
            assetId: true,
            allocationStatus: true,
            asset: {
              select: {
                id: true,
                assetTag: true,
                name: true,
                type: true,
                categoryId: true,
              },
            },
          },
        },
        scanEvents: {
          where: { success: true, phase: "CHECKOUT", assetId: { not: null } },
          select: { assetId: true },
        },
      },
    });
    if (!booking || booking.kind !== BookingKind.RESERVATION || booking.status !== BookingStatus.BOOKED) {
      throw new HttpError(409, "Refresh this reservation before swapping an item");
    }

    const actor = await tx.user.findFirst({
      where: { id: args.actorUserId, ...kioskRosterUserWhere() },
      select: { id: true, role: true },
    });
    if (!actor) throw new HttpError(403, "This user cannot operate kiosk custody");
    if (
      booking.custodyScope !== BookingCustodyScope.SHARED
      && booking.requesterUserId !== actor.id
      && actor.role !== "ADMIN"
      && actor.role !== "STAFF"
    ) {
      throw new HttpError(403, "Only the reservation requester can swap an item at pickup");
    }

    const scanned = await findAssetByScanValue(args.scanValue, {
      id: true,
      assetTag: true,
      name: true,
      type: true,
      categoryId: true,
      status: true,
    }, tx);
    if (!scanned) throw new HttpError(404, "Item not found");

    const alreadyOnReservation = booking.serializedItems.find((item) => item.assetId === scanned.id);
    if (alreadyOnReservation) {
      throw new HttpError(409, `${scanned.assetTag} is already on this reservation`);
    }

    const alreadyScannedAssetIds = new Set(
      booking.scanEvents.map((event) => event.assetId).filter((assetId): assetId is string => !!assetId),
    );
    const reserved = choosePickupSubstitutionCandidate(
      booking.serializedItems,
      scanned,
      alreadyScannedAssetIds,
    );
    if (!reserved || reserved.assetId !== args.reservedAssetId) {
      throw new HttpError(409, "That reserved item is no longer waiting for pickup. Refresh and scan again.");
    }
    if (reserved.allocationStatus !== "active") {
      throw new HttpError(409, "That reserved item was already picked up");
    }

    const availability = await checkAvailability(tx, {
      locationId: booking.locationId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      serializedAssetIds: [scanned.id],
      bulkItems: [],
      excludeBookingId: booking.id,
      bookingKind: "RESERVATION",
    });
    if (
      availability.conflicts.length > 0
      || availability.shortages.length > 0
      || availability.unavailableAssets.length > 0
    ) {
      throw new HttpError(409, `${scanned.assetTag} is not available to swap onto this reservation`, availability);
    }

    await tx.bookingSerializedItem.deleteMany({
      where: {
        bookingId: booking.id,
        assetId: reserved.assetId,
        allocationStatus: "active",
      },
    });
    await tx.assetAllocation.updateMany({
      where: { bookingId: booking.id, assetId: reserved.assetId, active: true },
      data: { active: false },
    });
    await tx.bookingSerializedItem.create({
      data: {
        bookingId: booking.id,
        assetId: scanned.id,
        allocationStatus: "active",
      },
    });
    await tx.assetAllocation.create({
      data: {
        bookingId: booking.id,
        assetId: scanned.id,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        active: true,
        kind: AllocationKind.RESERVATION,
      },
    });
    await tx.scanEvent.create({
      data: {
        bookingId: booking.id,
        actorUserId: actor.id,
        scanType: "SERIALIZED",
        scanValue: args.scanValue,
        success: true,
        phase: "CHECKOUT",
        assetId: scanned.id,
        deviceContext: args.deviceContext,
      },
    });
    await tx.booking.update({
      where: { id: booking.id },
      data: { updatedAt: new Date() },
    });

    const actorRole = await lookupActorRole(tx, actor.id);
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole,
      entityType: "booking",
      entityId: booking.id,
      action: "booking.item_substituted",
      before: {
        serializedAssetIds: [reserved.assetId],
        reserved: namedItem(reserved.asset),
      },
      after: {
        serializedAssetIds: [scanned.id],
        scanned: namedItem(scanned),
      },
    });

    return {
      success: true as const,
      item: namedItem(scanned),
      replaced: namedItem(reserved.asset),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
