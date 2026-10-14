import { AllocationKind, BookingCustodyScope, BookingKind, BookingStatus, BulkUnitStatus, CollaboratorPolicyStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx, lookupActorRole } from "@/lib/audit";
import { kioskAvailabilityBlockMessage } from "@/lib/availability-copy";
import { hasCollaboratorCapability } from "@/lib/collaborator-access";
import { checkAvailability } from "@/lib/services/availability";
import { findBulkUnitByScanValue, stageKioskReservationPickupBulkUnit } from "@/lib/services/bulk-unit-scans";
import { updateReservation } from "@/lib/services/bookings-lifecycle";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";
import { kioskRosterUserWhere } from "@/lib/user-visibility";

type AddedPickupItem = {
  id: string;
  name: string;
  tagName: string;
};

type AddReservationPickupSerializedResult =
  | { success: true; addedToPlan: true; item: AddedPickupItem }
  | { success: false; error: string; errorCode: "unavailable" | "conflict" };

type PickupAddPreflight =
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

export const kioskPickupPlanActorSelect = {
  id: true,
  role: true,
  collaboratorPolicy: {
    select: {
      status: true,
      grants: { select: { capabilityKey: true } },
    },
  },
} as const;

type KioskPickupPlanActor = Prisma.UserGetPayload<{ select: typeof kioskPickupPlanActorSelect }>;

/**
 * Remaining custody window for a leftover pickup add. Past overlaps should
 * not block an item that is free at the counter now.
 */
export function remainingPickupAllocationWindow(
  booking: { startsAt: Date; endsAt: Date },
  now = new Date(),
) {
  const startsAt = booking.startsAt.getTime() > now.getTime() ? booking.startsAt : now;
  const endsAt = booking.endsAt.getTime() > startsAt.getTime()
    ? booking.endsAt
    : new Date(startsAt.getTime() + 60_000);
  return { startsAt, endsAt };
}

export function assertKioskPickupPlanActor(
  booking: { custodyScope: BookingCustodyScope; requesterUserId: string },
  actor: {
    id: string;
    role: Role;
    collaboratorPolicy?: KioskPickupPlanActor["collaboratorPolicy"];
  },
) {
  if (actor.role === Role.ADMIN || actor.role === Role.STAFF) return;
  if (booking.custodyScope === BookingCustodyScope.SHARED) return;
  if (booking.requesterUserId !== actor.id) {
    throw new HttpError(403, "Only the reservation requester can change remaining pickup items");
  }
  const capabilities = actor.collaboratorPolicy?.status === CollaboratorPolicyStatus.ACTIVE
    ? actor.collaboratorPolicy.grants.map((grant) => grant.capabilityKey)
    : [];
  if (actor.role === Role.COLLABORATOR && !hasCollaboratorCapability({ role: actor.role, capabilities }, "RESERVATION_EDIT_OWN")) {
    throw new HttpError(403, "Your collaborator access does not include this reservation action");
  }
}

function namedItem(asset: { id: string; name: string | null; assetTag: string }): AddedPickupItem {
  return {
    id: asset.id,
    name: asset.name || asset.assetTag,
    tagName: asset.assetTag,
  };
}

function isPickupAllocationOverlap(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : "";
  return code === "23P01" || message.includes("asset_allocations_no_overlap");
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
    select: kioskPickupPlanActorSelect,
  });
  if (!actor) throw new HttpError(403, "This user cannot operate kiosk custody");
  assertKioskPickupPlanActor(booking, actor);
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

  const window = remainingPickupAllocationWindow(booking);
  const availability = await checkAvailability(tx, {
    locationId: booking.locationId,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
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
  try {
    return await db.$transaction(async (tx) => {
    const booking = await loadPickupAddBooking(tx, args.bookingId);
    const actor = await requirePickupAddActor(tx, booking, args.actorUserId);
    const preview = await evaluatePickupAddAvailability(tx, booking, args.asset);
    if (!preview.ok) {
      return { success: false, error: preview.error, errorCode: preview.errorCode };
    }
    const window = remainingPickupAllocationWindow(booking);

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
        startsAt: window.startsAt,
        endsAt: window.endsAt,
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
  } catch (error) {
    if (isPickupAllocationOverlap(error)) {
      return {
        success: false,
        error: `${args.asset.assetTag} is no longer available`,
        errorCode: "conflict",
      };
    }
    throw error;
  }
}

/**
 * A scan that names a bulk SKU rather than a serialized asset: a numbered unit
 * (`{bin}-{n}`) or the bin QR of a counted SKU. Either can be added to a
 * BOOKED reservation at pickup, including a unit of a SKU that is not on the
 * plan yet or one past its planned quantity.
 */
export type PickupBulkAddTarget = {
  bulkSkuId: string;
  skuName: string;
  category: string | null;
  unitNumber: number | null;
  /** Set when the scanned unit cannot go out now (held, damaged, ...). */
  blockedReason: string | null;
  item: { id: string; name: string; tagName: string; type: string | null; bulkSkuId: string; unitNumber?: number };
};

export async function resolvePickupBulkAddTarget(scanValue: string): Promise<PickupBulkAddTarget | null> {
  const unit = await findBulkUnitByScanValue(scanValue);
  if (unit) {
    const label = `${unit.bulkSkuName} #${unit.unitNumber}`;
    return {
      bulkSkuId: unit.bulkSkuId,
      skuName: unit.bulkSkuName,
      category: unit.type ?? null,
      unitNumber: unit.unitNumber,
      blockedReason: unit.status === BulkUnitStatus.AVAILABLE
        ? null
        : `${label} is ${unit.status.replace(/_/g, " ").toLowerCase()} and cannot be added`,
      item: { id: unit.id, name: label, tagName: label, type: unit.type ?? null, bulkSkuId: unit.bulkSkuId, unitNumber: unit.unitNumber },
    };
  }
  const sku = await db.bulkSku.findFirst({
    where: { active: true, trackByNumber: false, OR: [{ id: scanValue }, { binQrCodeValue: scanValue }] },
    select: { id: true, name: true, category: true },
  });
  if (!sku) return null;
  return {
    bulkSkuId: sku.id,
    skuName: sku.name,
    category: sku.category ?? null,
    unitNumber: null,
    blockedReason: null,
    item: { id: sku.id, name: sku.name, tagName: sku.name, type: sku.category ?? null, bulkSkuId: sku.id },
  };
}

/** Ask-before-mutate check for an off-plan bulk scan, mirroring the serialized preflight. */
export async function preflightReservationPickupBulkAdd(args: {
  bookingId: string;
  actorUserId: string;
  target: PickupBulkAddTarget;
}): Promise<{ ok: true } | { ok: false; error: string; errorCode: "unavailable" | "conflict" }> {
  if (args.target.blockedReason) {
    return { ok: false, error: args.target.blockedReason, errorCode: "unavailable" };
  }
  return db.$transaction(async (tx) => {
    const booking = await loadPickupAddBooking(tx, args.bookingId);
    await requirePickupAddActor(tx, booking, args.actorUserId);
    const plannedCount = booking.serializedItems.length
      + booking.bulkItems.reduce((sum, item) => sum + item.plannedQuantity, 0);
    if (plannedCount + 1 > MAX_EQUIPMENT_SELECTIONS_PER_REQUEST) {
      throw new HttpError(400, "This reservation has too many items");
    }
    const window = remainingPickupAllocationWindow(booking);
    const availability = await checkAvailability(tx, {
      locationId: booking.locationId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: args.target.bulkSkuId, quantity: 1 }],
      excludeBookingId: booking.id,
      bookingKind: BookingKind.RESERVATION,
    });
    if (availability.unavailableAssets.length > 0 || availability.conflicts.length > 0 || availability.shortages.length > 0) {
      return {
        ok: false as const,
        error: kioskAvailabilityBlockMessage(availability, args.target.skuName),
        errorCode: availability.conflicts.length > 0 ? "conflict" as const : "unavailable" as const,
      };
    }
    return { ok: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type AddReservationPickupBulkResult =
  | { success: true; addedToPlan: true; item: PickupBulkAddTarget["item"] }
  | { success: false; error: string; errorCode: string };

/**
 * Add one off-plan bulk unit (or one counted unit) to a BOOKED reservation's
 * plan, then stage a numbered unit's pickup scan so it counts as picked.
 * The plan change goes through updateReservation so availability and stock
 * holds follow the normal reservation rules.
 */
export async function addAndStageReservationPickupBulk(args: {
  bookingId: string;
  actorUserId: string;
  scanValue: string;
  target: PickupBulkAddTarget;
  deviceContext: string;
}): Promise<AddReservationPickupBulkResult> {
  const preview = await preflightReservationPickupBulkAdd(args);
  if (!preview.ok) return { success: false, error: preview.error, errorCode: preview.errorCode };

  const booking = await db.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      serializedItems: { select: { assetId: true } },
      bulkItems: { select: { bulkSkuId: true, plannedQuantity: true } },
    },
  });
  if (!booking) throw new HttpError(409, "Refresh this reservation before adding an item");
  const planFor = (delta: number) => {
    const bulkItems = booking.bulkItems.map((item) => ({
      bulkSkuId: item.bulkSkuId,
      quantity: item.plannedQuantity + (item.bulkSkuId === args.target.bulkSkuId ? delta : 0),
    }));
    if (delta > 0 && !bulkItems.some((item) => item.bulkSkuId === args.target.bulkSkuId)) {
      bulkItems.push({ bulkSkuId: args.target.bulkSkuId, quantity: delta });
    }
    return { serializedAssetIds: booking.serializedItems.map((row) => row.assetId), bulkItems };
  };

  try {
    await updateReservation(args.bookingId, args.actorUserId, planFor(1));
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) {
      return { success: false, error: error.message, errorCode: "conflict" };
    }
    throw error;
  }

  if (args.target.unitNumber === null) {
    return { success: true, addedToPlan: true, item: args.target.item };
  }
  const staged = await db.$transaction(
    (tx) => stageKioskReservationPickupBulkUnit(tx, {
      bookingId: args.bookingId,
      scanValue: args.scanValue,
      actorUserId: args.actorUserId,
      deviceContext: args.deviceContext,
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (staged.handled && staged.success) {
    return { success: true, addedToPlan: true, item: staged.item as PickupBulkAddTarget["item"] };
  }
  // The unit could not be staged: give the reserved slot back.
  await updateReservation(args.bookingId, args.actorUserId, planFor(0)).catch(() => undefined);
  return {
    success: false,
    error: staged.handled && !staged.success ? staged.error : `${args.target.item.name} could not be added`,
    errorCode: staged.handled && !staged.success ? staged.errorCode : "unavailable",
  };
}
