import { formatRelativeTime } from "@/lib/format";
import {
  bookingStatusBadgeVariant,
  bookingStatusLabel,
  type BookingDisplayKind,
  type BookingStatusBadgeVariant,
} from "@/lib/booking-status-display";
export function formatRelative(iso: string) { return formatRelativeTime(iso, new Date()); }

export function toLocalDateTimeValue(date: Date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

/** Status → shadcn Badge variant, kind-aware for BOOKED */
export function statusBadgeVariant(status: string, kind?: BookingDisplayKind): BookingStatusBadgeVariant {
  return bookingStatusBadgeVariant(status, kind);
}

/** Universal user-facing status labels — DB enum stays unchanged */
export function statusLabel(status: string, kind?: BookingDisplayKind): string {
  return bookingStatusLabel(status, kind);
}

/** Audit log fields to never display in the history tab */
export const HIDDEN_AUDIT_FIELDS = new Set([
  "_actorRole", "_actorId", "_actorEmail", "_actorName",
  "updatedAt", "createdAt", "id", "organizationId",
]);

/** Audit log fields that contain IDs — show "set"/"removed"/"changed" instead of raw values */
export const ID_AUDIT_FIELDS = new Set([
  "categoryId", "departmentId", "locationId", "requesterUserId",
]);

export const EQUIPMENT_ACTIONS = new Set([
  "booking.items_added",
  "booking.items_removed",
  "booking.items_qty_changed",
]);

export const actionLabels: Record<string, string> = {
  create: "created booking",
  created: "created booking",
  update: "updated",
  updated: "updated",
  owner_transferred: "transferred owner",
  events_updated: "updated linked events",
  extend: "extended",
  extended: "extended",
  cancel: "cancelled",
  cancelled: "cancelled",
  checkin_completed: "completed check in",
  admin_force_completed_checkout: "closed checkout without scan",
  admin_force_checkout: "force-checked out reservation",
  cancelled_by_checkout_conversion: "converted to checkout",
  "booking.items_added": "added items",
  "booking.items_removed": "removed items",
  "booking.items_qty_changed": "changed item quantities",
  kiosk_checkout: "checked out at kiosk",
  kiosk_checkout_updated: "updated at kiosk",
  kiosk_checkin: "checked in at kiosk",
  kiosk_return: "returned at kiosk",
  kiosk_pickup: "picked up at kiosk",
  auto_completed_by_kiosk_checkin: "completed the booking by returning at kiosk",
  auto_completed_by_bulk_checkin: "completed the booking by bulk return",
  auto_completed_by_partial_checkin: "completed the booking after partial return",
  reservation_consolidated: "added gear to the existing reservation",
  reservations_merged: "combined matching reservations",
  merged_into_reservation: "combined this reservation into another gear plan",
};

/** Friendly label for an audit action, humanizing unknown codes. */
export function auditActionLabel(action: string): string {
  return actionLabels[action] || action.replace(/[._]+/g, " ");
}

export function urgencyBadgeClassName(urgency: string): string {
  switch (urgency) {
    case "overdue":
      return "border-[var(--red-text)]/30 bg-[var(--red-bg)] text-[var(--red-text)]";
    case "critical":
    case "warning":
      return "border-[var(--orange-text)]/30 bg-[var(--orange-bg)] text-[var(--orange-text)]";
    default:
      return "";
  }
}
