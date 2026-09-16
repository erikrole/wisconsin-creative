import { BookingKind, BookingStatus, type Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http";

export type LeftoverReservationPickup = {
  id: string;
  refNumber: string | null;
  title: string;
};

/**
 * A partial kiosk pickup that still has remaining gear should not be followed
 * by a second direct checkout for the same person at the same counter.
 */
export async function findLeftoverReservationPickup(
  tx: Prisma.TransactionClient,
  args: { requesterUserId: string; locationId: string },
): Promise<LeftoverReservationPickup | null> {
  const reservations = await tx.booking.findMany({
    where: {
      requesterUserId: args.requesterUserId,
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      locationId: args.locationId,
    },
    select: {
      id: true,
      refNumber: true,
      title: true,
      serializedItems: { select: { allocationStatus: true } },
      bulkItems: { select: { plannedQuantity: true, checkedOutQuantity: true } },
      derivedCheckouts: { select: { id: true } },
    },
    take: 25,
  });

  const leftover = reservations.find((row) => {
    if (row.derivedCheckouts.length === 0) return false;
    const remainingSerialized = row.serializedItems.some((item) => item.allocationStatus === "active");
    const remainingBulk = row.bulkItems.some(
      (item) => item.plannedQuantity > (item.checkedOutQuantity ?? 0),
    );
    return remainingSerialized || remainingBulk;
  });

  return leftover
    ? { id: leftover.id, refNumber: leftover.refNumber, title: leftover.title }
    : null;
}

export function leftoverReservationPickupConflict(row: LeftoverReservationPickup) {
  const label = row.refNumber ?? "this reservation";
  return new HttpError(
    409,
    `Finish pickup for ${label} first instead of starting a new checkout.`,
    {
      errorCode: "leftover_reservation_pickup",
      reservationId: row.id,
      refNumber: row.refNumber,
    },
  );
}
