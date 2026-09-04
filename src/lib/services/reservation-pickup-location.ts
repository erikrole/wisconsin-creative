import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  isSupportedReservationPickupLocation,
  RESERVATION_PICKUP_LOCATION_ERROR,
  RESERVATION_PICKUP_LOCATION_NAMES,
} from "@/lib/reservation-pickup-locations";

export async function assertSupportedReservationPickupLocation(locationId: string) {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { active: true, name: true },
  });
  if (!isSupportedReservationPickupLocation(location)) {
    throw new HttpError(400, RESERVATION_PICKUP_LOCATION_ERROR);
  }
  return location;
}

export async function defaultReservationPickupLocationId() {
  const location = await db.location.findFirst({
    where: {
      active: true,
      name: { in: [...RESERVATION_PICKUP_LOCATION_NAMES] },
    },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (!location) {
    throw new HttpError(500, "No supported reservation pickup locations configured. Please add Camp Randall or Kohl Center in Settings.");
  }
  return location.id;
}
