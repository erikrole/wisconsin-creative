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

/**
 * Pickup counters that share kit membership and kit calling.
 * Camp Randall and Camp Randall Stadium are the same gear room.
 */
export const KIT_SHARED_PICKUP_LOCATION_GROUPS = [
  ["Camp Randall", "Camp Randall Stadium"],
] as const;

function normalizeLocationName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function kitPickupGroupKey(name: string) {
  const normalized = normalizeLocationName(name);
  for (const group of KIT_SHARED_PICKUP_LOCATION_GROUPS) {
    if (group.some((alias) => normalizeLocationName(alias) === normalized)) {
      return normalizeLocationName(group[0]);
    }
  }
  return normalized;
}

export function kitPickupAliasNames(name: string) {
  const key = kitPickupGroupKey(name);
  for (const group of KIT_SHARED_PICKUP_LOCATION_GROUPS) {
    if (normalizeLocationName(group[0]) === key) return [...group];
  }
  return [name];
}

export function locationsShareKitPickup(left: string, right: string) {
  return kitPickupGroupKey(left) === kitPickupGroupKey(right);
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
