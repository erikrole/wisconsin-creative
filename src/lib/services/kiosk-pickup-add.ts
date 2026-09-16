import { AllocationKind, BookingCustodyScope, BookingKind, BookingStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx, lookupActorRole } from "@/lib/audit";
import { kioskAvailabilityBlockMessage } from "@/lib/availability-copy";
import { checkAvailability } from "@/lib/services/availability";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";
import { kioskRosterUserWhere } from "@/lib/user-visibility";

export type AddedPickupItem = {
  id: string;
  name: string;
  tagName: string;
};

export type AddReservationPickupSerializedResult =
  | { success: true; addedToPlan: true; item: AddedPickupItem }
  | { success: false; error: string; errorCode: "unavailable" | "conflict" };

export type PickupAddPreflight =
  | { ok: true; item: AddedPickupItem }
  | { ok: false; error: string; errorCode: "unavailable" | "conflict" };

const bookingSelect = {
  id: true,
  kind: true,
  status: true,
  custodyScope: true,
  requesterUserId: true,
  locationId: true,
  startsAt: true,
  endsAt: true,
  serializedItems: { select: { assetId: true, allocationStatus: true } },
  bulkItems: { select: { plannedQuantity: true } },
} as const;

type PickupAddBooking = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function namedItem(asset: { id: string; name: string | null; assetTag: string }): AddedPickupItem {
  return {
    id: asset.id,
    name: asset.name || asset.assetTag,
    tagName: asset.assetTag,
  };
}

async function loadPickupAddBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<PickupAddBooking> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: bookingSelect,
  });
  if (!booking || booking.kind !== BookingKind.RESERVATION || booking.status !== BookingStatus.BOOKED) {
    throw new HttpError(409, "Refresh this reservation before adding an item");
  }
  return booking;
}

async function requirePickupAddActor(
  tx: Prisma.TransactionClient,
  booking: PickupAddBooking,
  actorUserId: string,
) {
  const actor = await tx.user.findFirst({
    where: { id: actorUserId, ...kioskRosterUserWhere() },
    select: { id: true, role: true },
  });
  if (!actor) throw new HttpError(403, "This user cannot operate kiosk custody");
  if (
    booking.custodyScope !== BookingCustodyScope.SHARED
    && booking.requesterUserId !== actor.id
    && actor.role !== "ADMIN"
    && actor.role !== "STAFF"
  ) {
    throw new HttpError(403, "Only the reservation requester can add an item at pickup");
  }
  return actor;
}

async function evaluatePickupAddAvailability(
  tx: Prisma.TransactionClient,
  booking: PickupAddBooking,
  asset: { id: string; name: string | null; assetTag: string },
): Promise<PickupAddPreflight> {
  if (booking.serializedItems.some((item) => item.assetId === asset.id)) {
    throw new HttpError(409, `${asset.assetTag} is already on this reservation`);
  }

  const plannedCount = booking.serializedItems.length
    + booking.bulkItems.reduce((sum, item) => sum + item.plannedQuantity, 0);
  if (plannedCount + 1 > MAX_EQUIPMENT_SELECTIONS_PER_REQUEST) {
    throw new HttpError(400, "This reservation has too many items");
  }

  const availability = await checkAvailability(tx, {
    locationId: booking.locationId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    serializedAssetIds: [asset.id],
    bulkItems: [],
    excludeBookingId: booking.id,
    bookingKind: BookingKind.RESERVATION,
  });
  if (
    availability.unavailableAssets.length > 0
    || availability.conflicts.length > 0
    || availability.shortages.length > 0
  ) {
    const errorCode = availability.conflicts.length > 0 ? "conflict" : "unavailable";
    return {
      ok: false,
      error: kioskAvailabilityBlockMessage(availability, asset.name || asset.assetTag),
      errorCode,
    };
  }
  return { ok: true, item: namedItem(asset) };
}

/**
 * Off-plan pickup scans ask before mutating. This checks whether the scanned
 * item can be added so the kiosk can show Add or Discard.
 */
export async function preflightReservationPickupSerializedAdd(args: {
  bookingId: string;
  actorUserId: string;
  asset: { id: string; name: string | null; assetTag: string };
}): Promise<PickupAddPreflight> {
  return db.$transaction(async (tx) => {
    const booking = await loadPickupAddBooking(tx, args.bookingId);
    await requirePickupAddActor(tx, booking, args.actorUserId);
    return evaluatePickupAddAvailability(tx, booking, args.asset);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Add an off-plan serialized asset to a BOOKED reservation and stage its
 * pickup scan in the same transaction, so a change of mind at the counter
 * does not require a second checkout.
 */
export async function addAndStageReservationPickupSerialized(args: {
  bookingId: string;
  actorUserId: string;
  scanValue: string;
  asset: {
    id: string;
    name: string | null;
    assetTag: string;
  };
  deviceContext: string;
}): Promise<AddReservationPickupSerializedResult> {
  return db.$transaction(async (tx) => {
    const booking = await loadPickupAddBooking(tx, args.bookingId);
    const actor = await requirePickupAddActor(tx, booking, args.actorUserId);
    const preview = await evaluatePickupAddAvailability(tx, booking, args.asset);
    if (!preview.ok) {
      return { success: false, error: preview.error, errorCode: preview.errorCode };
    }

    await tx.bookingSerializedItem.create({
      data: {
        bookingId: booking.id,
        assetId: args.asset.id,
        allocationStatus: "active",
      },
    });
    await tx.assetAllocation.create({
      data: {
        bookingId: booking.id,
        assetId: args.asset.id,
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
        assetId: args.asset.id,
        deviceContext: args.deviceContext,
      },
    });
    await tx.booking.update({
      where: { id: booking.id },
      data: { updatedAt: new Date() },
    });

    const actorRole = await lookupActorRole(tx, actor.id);
    const item = preview.item;
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole,
      entityType: "booking",
      entityId: booking.id,
      action: "kiosk_pickup_item_added",
      before: { serializedAssetIds: booking.serializedItems.map((row) => row.assetId) },
      after: { serializedAssetIds: [...booking.serializedItems.map((row) => row.assetId), args.asset.id], item },
    });

    return { success: true, addedToPlan: true, item };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
