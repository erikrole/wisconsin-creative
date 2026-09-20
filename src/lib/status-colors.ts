/** Equipment status → human-readable label */
export function statusLabelEquipment(status: string): string {
  switch (status) {
    case "AVAILABLE": return "Available";
    case "CHECKED_OUT": return "Checked out";
    case "PENDING_PICKUP": return "Pending pickup";
    case "RESERVED": return "Reserved";
    case "MAINTENANCE": return "Maintenance";
    case "RETIRED": return "Retired";
    default: return status;
  }
}

/** Equipment status → badge variant */
export function statusBadgeVariantEquipment(status: string): "green" | "blue" | "purple" | "orange" | "gray" {
  switch (status) {
    case "AVAILABLE": return "green";
    case "CHECKED_OUT": return "blue";
    case "PENDING_PICKUP": return "orange";
    case "RESERVED": return "purple";
    case "MAINTENANCE": return "orange";
    default: return "gray";
  }
}

/**
 * Equipment+booking status → badge variant for search/scan contexts, where a
 * result can be either an asset or a booking.
 *
 * `BOOKED` is purple here for the same reason it is purple everywhere else:
 * it is claimed work, not active custody. It used to return blue, which made a
 * reservation in search results read as checked out. Kind does not enter into
 * it -- `BOOKED` is purple for checkouts and reservations alike -- so the
 * absence of kind at these call sites is not a reason to diverge.
 */
export function statusBadgeVariant(status: string): string {
  switch (status) {
    case "AVAILABLE": return "green";
    case "OPEN":
    case "CHECKED_OUT": return "blue";
    case "BOOKED":
    case "RESERVED": return "purple";
    case "PENDING_PICKUP":
    case "MAINTENANCE": return "orange";
    case "OVERDUE": return "red";
    default: return "gray";
  }
}
