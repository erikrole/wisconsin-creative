import { type KioskOperationContext } from "@/lib/services/kiosk-operation-receipts";
import { BookingCustodyScope, BookingKind, BookingStatus, Prisma, Role } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { isSerializationConflict } from "@/lib/serialization";
import { type BulkRequest } from "@/lib/services/availability";
import { hasCollaboratorCapability, type CollaboratorActor } from "@/lib/collaborator-access";
import {
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
  MAX_LINKED_EVENTS_PER_BOOKING,
} from "@/lib/request-limits";
import { isBookingAllocationConstraintError } from "@/lib/prisma-errors";
import { unique } from "@/lib/utils";
import { assertBookingDuration } from "@/lib/time";

export type CreateBookingInput = {
  /** Internal kiosk completion receipt, committed atomically with custody. */
  kioskCompletionReceipt?: KioskOperationContext;
  kind: BookingKind;
  custodyScope?: BookingCustodyScope;
  /** Reservation-only concurrency cap. When present, the active BOOKED count
   * is checked in the same SERIALIZABLE transaction as the insert. */
  maxConcurrentReservations?: number;
  custodySource?: "KIOSK" | "ADMIN_OVERRIDE";
  /** Required when an admin creates checkout custody without a kiosk scan. */
  adminOverrideReason?: string;
  title: string;
  requesterUserId: string;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  serializedAssetIds: string[];
  bulkItems: BulkRequest[];
  notes?: string;
  createdBy: string;
  sourceReservationId?: string;
  /** Owned DRAFT row consumed atomically when a reservation is created. */
  sourceDraftId?: string;
  eventId?: string;
  /** Optional multi-event linking. If provided, events are sorted chronologically
   * and the first one becomes the primary (`Booking.eventId`). Mutually exclusive
   * with `eventId` — callers pick one. Cap five events. */
  eventIds?: string[];
  sportCode?: string;
  shiftAssignmentId?: string;
  kitId?: string;
  /** KioskDevice that handled pickup — captured at kiosk custody transitions. */
  pickupKioskDeviceId?: string;
  /** Kiosk reservation pickup: exact numbered bulk units to bind inside the
   * same transaction that opens the checkout and completes the reservation,
   * so a failed unit bind rolls the whole pickup back. CHECKOUT kind only. */
  bulkUnitItems?: Array<{ bulkSkuId: string; unitNumber: number }>;
  /** When set with sourceReservationId, serializedAssetIds and bulkItems are
   * the exact reservation items being picked up now. The source reservation
   * remains BOOKED until every remaining item is picked up. */
  sourceReservationPickup?: boolean;
};

export type UpdateBookingInput = {
  title?: string;
  requesterUserId?: string;
  locationId?: string;
  startsAt?: Date;
  endsAt?: Date;
  serializedAssetIds?: string[];
  bulkItems?: BulkRequest[];
  notes?: string;
};

/** Extra writes that must commit with a booking update (same transaction). */
export type BookingUpdateOptions = {
  afterUpdateTx?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export type TransferBookingOwnerInput = {
  targetUserId: string;
  reason?: string;
};

export const OWNER_TRANSFER_STATUSES = new Set<BookingStatus>([
  BookingStatus.DRAFT,
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
]);

export const EVENT_LINK_STATUSES = new Set<BookingStatus>([
  BookingStatus.DRAFT,
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
]);

function hasDuplicateIds(ids: string[]) {
  return new Set(ids).size !== ids.length;
}

export function isStaffOrAdmin(role: Role | null | undefined) {
  return role === Role.ADMIN || role === Role.STAFF;
}

export function assertValidBookingWindow(startsAt: Date, endsAt: Date) {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new HttpError(400, "Invalid startsAt or endsAt");
  }
  if (endsAt <= startsAt) {
    throw new HttpError(400, "endsAt must be later than startsAt");
  }
  assertBookingDuration(startsAt, endsAt);
}

export function assertValidCreateEventLinks(input: CreateBookingInput) {
  if (input.eventId && input.eventIds && input.eventIds.length > 0) {
    throw new HttpError(400, "Provide either eventId or eventIds, not both");
  }
  if (input.eventIds && input.eventIds.length > MAX_LINKED_EVENTS_PER_BOOKING) {
    throw new HttpError(400, `A booking may link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events`);
  }
  if (input.eventIds && hasDuplicateIds(input.eventIds)) {
    throw new HttpError(400, "eventIds must be unique");
  }
}

export function assertValidEventLinks(eventIds: string[]) {
  if (eventIds.length > MAX_LINKED_EVENTS_PER_BOOKING) {
    throw new HttpError(400, `A booking may link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events`);
  }
  if (hasDuplicateIds(eventIds)) {
    throw new HttpError(400, "eventIds must be unique");
  }
}

export function assertValidCreateEquipment(serializedAssetIds: string[], bulkItems: BulkRequest[]) {
  if (serializedAssetIds.length === 0 && bulkItems.length === 0) {
    throw new HttpError(400, "Add at least one piece of equipment");
  }

  const seenBulkSkuIds = new Set<string>();
  for (const item of bulkItems) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new HttpError(400, "Bulk item quantities must be positive whole numbers");
    }
    if (seenBulkSkuIds.has(item.bulkSkuId)) {
      throw new HttpError(400, "Duplicate bulk item");
    }
    seenBulkSkuIds.add(item.bulkSkuId);
  }
}

export function exactEventSetMatches(
  candidate: { eventId: string | null; events: Array<{ eventId: string }> },
  eventIds: string[],
) {
  const candidateIds = candidate.events.length > 0
    ? candidate.events.map((event) => event.eventId)
    : candidate.eventId ? [candidate.eventId] : [];
  if (candidateIds.length !== eventIds.length) return false;
  const expected = new Set(eventIds);
  return candidateIds.every((eventId) => expected.has(eventId));
}

export function mergeReservationNotes(existing: string | null, incoming?: string) {
  const current = existing?.trim() ?? "";
  const addition = incoming?.trim() ?? "";
  if (!addition || addition === current || current.includes(addition)) return current || null;
  if (!current) return addition;
  return `${current}\n\nAdded with consolidated gear:\n${addition}`;
}

export function additiveBulkRequests(
  existing: Array<{ bulkSkuId: string; plannedQuantity: number }>,
  incoming: BulkRequest[],
) {
  const totals = new Map(existing.map((item) => [item.bulkSkuId, item.plannedQuantity]));
  for (const item of incoming) {
    totals.set(item.bulkSkuId, (totals.get(item.bulkSkuId) ?? 0) + item.quantity);
  }
  return [...totals].map(([bulkSkuId, quantity]) => ({ bulkSkuId, quantity }));
}

export async function assertNumberedPickupPlanLimit(
  tx: Prisma.TransactionClient,
  bulkItems: BulkRequest[],
): Promise<void> {
  if (bulkItems.length === 0) return;

  const numberedSkus = await tx.bulkSku.findMany({
    where: {
      id: { in: unique(bulkItems.map((item) => item.bulkSkuId)) },
      trackByNumber: true,
    },
    select: { id: true },
  });
  const numberedSkuIds = new Set(numberedSkus.map((sku) => sku.id));
  const numberedPickupTotal = bulkItems.reduce(
    (total, item) => total + (numberedSkuIds.has(item.bulkSkuId) ? item.quantity : 0),
    0,
  );

  if (numberedPickupTotal > MAX_EQUIPMENT_SELECTIONS_PER_REQUEST) {
    throw new HttpError(
      400,
      `Numbered pickup plans support at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} units total`,
    );
  }
}

export function assertCheckoutCustodySource(input: CreateBookingInput) {
  if (
    input.kind === BookingKind.CHECKOUT
    && input.custodySource !== "KIOSK"
    && input.custodySource !== "ADMIN_OVERRIDE"
  ) {
    throw new HttpError(403, "Direct checkout custody can only be created at a kiosk");
  }

  if (input.adminOverrideReason !== undefined && input.custodySource !== "ADMIN_OVERRIDE") {
    throw new HttpError(400, "Admin override details require admin checkout custody");
  }

  if (input.custodySource === "ADMIN_OVERRIDE") {
    if (input.kind !== BookingKind.CHECKOUT || !input.sourceReservationId || !input.sourceReservationPickup) {
      throw new HttpError(400, "Admin checkout override requires a reservation pickup");
    }
    const reason = input.adminOverrideReason?.trim() ?? "";
    if (reason.length < 10) {
      throw new HttpError(400, "Reason must be at least 10 characters");
    }
  }
}

export function assertValidMaxConcurrentReservations(input: CreateBookingInput) {
  const cap = input.maxConcurrentReservations;
  if (cap === undefined) return;
  if (input.kind !== BookingKind.RESERVATION) {
    throw new HttpError(400, "maxConcurrentReservations only applies to reservations");
  }
  if (!Number.isFinite(cap) || !Number.isInteger(cap) || cap < 1 || cap > 50) {
    throw new HttpError(400, "maxConcurrentReservations must be a whole number between 1 and 50");
  }
}

export function handleBookingMutationRace(error: unknown): never {
  if (isSerializationConflict(error)) {
    throw new HttpError(409, "Someone else submitted at the same time; please try again.");
  }
  if (isBookingAllocationConstraintError(error)) {
    throw new HttpError(409, "One or more items are no longer available");
  }
  throw error;
}

export function eventLinkWhereForActor(
  eventIds: string[],
  actor: CollaboratorActor,
): Prisma.CalendarEventWhereInput {
  const where: Prisma.CalendarEventWhereInput = { id: { in: eventIds } };
  if (actor.role !== Role.COLLABORATOR) return where;
  if (!hasCollaboratorCapability(actor, "PUBLISHED_SCHEDULE_VIEW")) {
    throw new HttpError(403, "Forbidden");
  }
  return {
    ...where,
    isHidden: false,
    archivedAt: null,
    shiftGroup: {
      is: {
        publishedAt: { not: null },
        archivedAt: null,
        lastPublishedSnapshot: { not: Prisma.JsonNull },
      },
    },
  };
}
