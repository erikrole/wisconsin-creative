/**
 * Pickup counters currently supported by reservation workflows.
 *
 * The location catalog is intentionally broader because it also represents
 * event venues, inventory homes, and kiosk locations. Keep this allowlist
 * scoped to reservation pickup rather than filtering the catalog globally.
 */
export const RESERVATION_PICKUP_LOCATION_NAMES = [
  "Camp Randall",
  "Camp Randall Stadium",
  "Kohl Center",
] as const;

export const RESERVATION_PICKUP_LOCATION_ERROR =
  "Reservations can only use Camp Randall or Kohl Center as pickup locations.";

function normalizeLocationName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isSupportedReservationPickupLocationName(name: string | null | undefined) {
  if (!name) return false;
  const normalized = normalizeLocationName(name);
  return RESERVATION_PICKUP_LOCATION_NAMES.some(
    (supportedName) => normalizeLocationName(supportedName) === normalized,
  );
}

export function isSupportedReservationPickupLocation(
  location: { active: boolean; name: string } | null | undefined,
) {
  return Boolean(location?.active && isSupportedReservationPickupLocationName(location.name));
}

export function filterSupportedReservationPickupLocations<T extends { name: string }>(locations: readonly T[]) {
  return locations.filter((location) => isSupportedReservationPickupLocationName(location.name));
}
