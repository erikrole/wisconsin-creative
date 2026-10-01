import { BookingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { checkBulkShortages, checkSerializedConflicts } from "@/lib/services/availability";
import { subtractSerializedTurnaroundBuffer } from "@/lib/booking-availability-window";

type Client = Prisma.TransactionClient | PrismaClient;

/** How far ahead the kiosk looks for the next claim on this gear. */
export const EXTEND_WINDOW_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_BULK_CANDIDATES = 50;

export type KioskExtendWindow = {
  currentEndsAt: Date;
  /** Latest return time the extend PATCH would accept; null = nothing claims this gear within a year. */
  maxEndsAt: Date | null;
  limitingItem?: {
    assetTag: string;
    name: string;
    /** Omitted for SHARED holders and for counted stock. */
    holderName?: string;
    startsAt: Date;
    /** The booking that needs it next ("WHKY vs Boston"), when known. */
    bookingTitle?: string;
    /** "RESERVATION" or "CHECKOUT", when known. */
    bookingKind?: string;
    imageUrl?: string | null;
  };
};

/**
 * The latest due time an extension can reach before the booking's still-out
 * gear is claimed by another reservation or checkout. Uses the same checks as
 * `checkCheckoutDueTime` (overlap-only serialized conflicts, held bulk stock
 * credited), so the answer matches what `PATCH /api/kiosk/checkout/[id]` enforces.
 *
 * Also answers for a booking still waiting at pickup (a BOOKED reservation or
 * a legacy PENDING_PICKUP checkout). Nothing is held yet there, so it mirrors
 * the reservation/checkout edit checks `PATCH /api/kiosk/pickup/[id]/details`
 * runs instead: remaining planned stock, and the serialized turnaround buffer.
 */
export async function kioskExtendWindow(
  tx: Client,
  bookingId: string,
  now: Date = new Date(),
): Promise<KioskExtendWindow> {
  const booking = await tx.booking.findFirst({
    where: {
      id: bookingId,
      OR: [
        { kind: "CHECKOUT", status: { in: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP] } },
        { kind: "RESERVATION", status: BookingStatus.BOOKED },
      ],
    },
    select: {
      id: true,
      kind: true,
      status: true,
      endsAt: true,
      locationId: true,
      serializedItems: {
        where: { allocationStatus: "active" },
        select: { assetId: true, asset: { select: { assetTag: true, name: true, imageUrl: true } } },
      },
      bulkItems: {
        select: { bulkSkuId: true, plannedQuantity: true, checkedOutQuantity: true, checkedInQuantity: true, bulkSku: { select: { name: true } } },
      },
    },
  });
  if (!booking) throw new HttpError(404, "Active checkout not found");
  const atPickup = booking.status === BookingStatus.BOOKED || booking.status === BookingStatus.PENDING_PICKUP;

  const windowStart = new Date(Math.max(now.getTime(), booking.endsAt.getTime()));
  const horizon = new Date(windowStart.getTime() + EXTEND_WINDOW_HORIZON_MS);
  const candidates: NonNullable<KioskExtendWindow["limitingItem"]>[] = [];

  // Serialized: the earliest other allocation that would overlap the extension.
  const conflicts = await checkSerializedConflicts(tx, {
    serializedAssetIds: booking.serializedItems.map((item) => item.assetId),
    startsAt: windowStart,
    endsAt: horizon,
    excludeBookingId: booking.id,
    enforceTurnaroundBuffer: atPickup,
  });
  const assetById = new Map(booking.serializedItems.map((item) => [item.assetId, item.asset]));
  for (const conflict of conflicts) {
    const asset = assetById.get(conflict.assetId);
    candidates.push({
      assetTag: asset?.assetTag ?? conflict.assetId,
      name: asset?.name || asset?.assetTag || conflict.assetId,
      ...(conflict.conflictingBookingRequesterName ? { holderName: conflict.conflictingBookingRequesterName } : {}),
      ...(conflict.conflictingBookingTitle ? { bookingTitle: conflict.conflictingBookingTitle } : {}),
      ...(conflict.conflictingBookingKind ? { bookingKind: conflict.conflictingBookingKind } : {}),
      imageUrl: asset?.imageUrl ?? null,
      // Pickup edits keep the turnaround buffer, so the latest time is that
      // much before the next claim starts.
      startsAt: atPickup ? subtractSerializedTurnaroundBuffer(conflict.startsAt) : conflict.startsAt,
    });
  }

  // Counted stock: the first reservation start at which the held quantity
  // would no longer fit, found with `checkBulkShortages` itself.
  const held = booking.bulkItems
    .map((item) => ({
      bulkSkuId: item.bulkSkuId,
      name: item.bulkSku.name,
      quantity: !atPickup
        ? Math.max(0, item.checkedOutQuantity - item.checkedInQuantity)
        : booking.kind === "RESERVATION"
          ? Math.max(0, (item.plannedQuantity ?? 0) - (item.checkedOutQuantity ?? 0))
          : item.plannedQuantity ?? 0,
    }))
    .filter((item) => item.quantity > 0);
  if (held.length > 0) {
    // At pickup nothing is checked out yet, so no stock is credited as held.
    const heldQuantities = atPickup
      ? new Map<string, number>()
      : new Map(held.map((item) => [item.bulkSkuId, item.quantity]));
    const shortAt = (endsAt: Date) => checkBulkShortages(tx, {
      locationId: booking.locationId,
      bulkItems: held,
      startsAt: windowStart,
      endsAt,
      excludeBookingId: booking.id,
      heldQuantities,
    });
    const starts = await tx.booking.findMany({
      where: {
        id: { not: booking.id },
        status: BookingStatus.BOOKED,
        locationId: booking.locationId,
        startsAt: { gte: windowStart, lt: horizon },
        bulkItems: { some: { bulkSkuId: { in: held.map((item) => item.bulkSkuId) } } },
      },
      orderBy: { startsAt: "asc" },
      distinct: ["startsAt"],
      take: MAX_BULK_CANDIDATES,
      select: { startsAt: true },
    });
    // Already short right after the current due time: no room to extend.
    const points = [windowStart, ...starts.map((row) => row.startsAt)];
    // Shortage is monotonic in the window end, so binary-search the points.
    let lo = 0;
    let hi = points.length - 1;
    let first = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const shortages = await shortAt(new Date(points[mid]!.getTime() + 1));
      if (shortages.length > 0) {
        first = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (first >= 0) {
      const shortages = await shortAt(new Date(points[first]!.getTime() + 1));
      const sku = held.find((item) => item.bulkSkuId === shortages[0]?.bulkSkuId) ?? held[0]!;
      candidates.push({ assetTag: sku.name, name: sku.name, startsAt: points[first]! });
    }
  }

  candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const limiting = candidates[0];
  if (!limiting) return { currentEndsAt: booking.endsAt, maxEndsAt: null };
  const maxEndsAt = limiting.startsAt > windowStart ? limiting.startsAt : booking.endsAt;
  return { currentEndsAt: booking.endsAt, maxEndsAt, limitingItem: limiting };
}
