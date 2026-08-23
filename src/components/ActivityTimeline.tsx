"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Camera,
  CalendarClock,
  ChevronDown,
  Cog,
  Copy,
  Heart,
  KeyRound,
  LogIn,
  LogOut,
  Package,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Trash2,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Map an audit row's entity to a deep-link route, or null if no detail page exists. */
function entityHref(
  entityType: string | undefined,
  entityId: string | undefined,
  afterJson: Record<string, unknown> | null,
  entityKind?: string | null,
): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "booking": {
      const kind = (entityKind ?? (afterJson?.kind as string | undefined))?.toLowerCase();
      if (kind === "checkout") return `/checkouts/${entityId}`;
      if (kind === "reservation") return `/reservations/${entityId}`;
      // Unknown kind — let the bookings list resolve via id query.
      return `/bookings?id=${entityId}`;
    }
    case "asset":
      return `/items/${entityId}`;
    case "user":
      return `/users/${entityId}`;
    case "bulk_sku":
      return `/bulk-inventory/${entityId}`;
    case "kit":
      return `/settings/kits/${entityId}`;
    default:
      return null;
  }
}

/* ── Re-export AuditEntry type as canonical ── */

export type AuditEntry = {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string;
  createdAt: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  actor: { id?: string; name: string; email?: string; avatarUrl?: string | null } | null;
  /** Server-joined identity of the referenced entity (e.g. booking title/kind),
   *  for rows whose audit payload doesn't name their target. */
  entity?: { label?: string | null; kind?: string | null } | null;
};

/* ── Props ── */

export type ActivityTimelineProps = {
  entries: AuditEntry[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Context for generating descriptions */
  context?: "booking" | "item" | "report" | "user";
  /** Entity name for better descriptions */
  entityName?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Booking due date — return-type rows later than this get a "N late" note. */
  dueAt?: string | null;
};

/* ── Constants ── */

const SYSTEM_ACTIONS = new Set([
  "auto_escalation",
  "cron_notification",
  "auto_complete",
]);

/** Return-type events that can carry a lateness annotation. Auto-complete
 *  rows are excluded — they always accompany a return row that already
 *  carries the note. */
const RETURN_ACTIONS = new Set([
  "kiosk_checkin",
  "checkin_completed",
  "items_returned",
  "items_returned_partial",
]);

/** "20 minutes" / "3 hours" / "2 days" for a positive duration. */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(ms / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Fields that are internal/system and should not be shown in the UI */
const HIDDEN_FIELDS = new Set([
  "_actorRole",
  "_actorId",
  "_actorEmail",
  "_actorName",
  "updatedAt",
  "createdAt",
  "id",
  "organizationId",
  "sourcePayload",
  "cheqroomName",
  "fiscalYear",
  "fiscalYearPurchased",
  "consumable",
  "trackByNumber",
]);

/** Fields whose values are opaque IDs — show "changed" instead of raw value */
const ID_FIELDS = new Set([
  "categoryId",
  "departmentId",
  "locationId",
  "requesterUserId",
  "parentAssetId",
]);

const EQUIPMENT_ACTIONS = new Set([
  "booking.items_added",
  "booking.items_removed",
  "booking.items_qty_changed",
]);

/** Human-readable field name labels */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  name: "Item name",
  brand: "Brand",
  model: "Model",
  assetTag: "Asset tag",
  serialNumber: "Serial number",
  notes: "Notes",
  status: "Status",
  startsAt: "Start date",
  endsAt: "End date",
  locationId: "Location",
  categoryId: "Category",
  departmentId: "Department",
  requesterUserId: "Requester",
  parentAssetId: "Parent item",
  serializedAssetIds: "Equipment",
  bulkItems: "Item families",
  purchasePrice: "Purchase price",
  purchaseDate: "Purchase date",
  warrantyDate: "Warranty date",
  residualValue: "Residual value",
  linkUrl: "Link",
  qrCodeValue: "QR code",
  availableForReservation: "Reservation availability",
  availableForCheckout: "Checkout availability",
  availableForCustody: "Custody availability",
  imageUrl: "Image",
  // User profile fields
  email: "Email",
  phone: "Phone",
  role: "Role",
  primaryArea: "Primary area",
  athleticsEmail: "Athletics email",
  startDate: "Start date",
  directReportId: "Direct report",
  directReportName: "Direct report",
  gradYear: "Grad year",
  studentYearOverride: "Student year",
  topSize: "Top size",
  bottomSize: "Bottom size",
  shoeSize: "Shoe size",
  avatarUrl: "Profile photo",
};

/** Status vocabulary mapping */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  BOOKED: "Reserved",
  OPEN: "Checked Out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Action color scheme */
type ActionColorKey =
  | "green"
  | "blue"
  | "amber"
  | "rose"
  | "purple"
  | "muted";

const ACTION_COLORS: Record<string, ActionColorKey> = {
  created: "green",
  create: "green",
  "booking.created": "green",
  checkin_completed: "green",
  items_returned: "green",
  items_returned_partial: "green",
  checkout_completed: "green",
  checkout_scan_completed: "green",
  scan_completed: "green",
  updated: "blue",
  update: "blue",
  owner_transferred: "blue",
  events_updated: "blue",
  extended: "blue",
  extend: "blue",
  duplicated: "blue",
  profile_update: "blue",
  avatar_uploaded: "blue",
  avatar_updated: "blue",
  avatar_deleted: "amber",
  avatar_removed: "amber",
  "booking.items_added": "amber",
  "booking.items_removed": "amber",
  "booking.items_qty_changed": "amber",
  marked_maintenance: "amber",
  cleared_maintenance: "amber",
  partial_return_recorded: "amber",
  cancelled: "rose",
  cancel: "rose",
  deleted: "rose",
  retired: "rose",
  cancelled_by_checkout_conversion: "blue",
  auto_escalation: "purple",
  cron_notification: "purple",
  admin_override: "purple",
  qr_generated: "muted",
  auto_complete: "muted",
  accessory_attached: "blue",
  accessory_detached: "amber",
  accessory_moved: "blue",
  image_uploaded: "blue",
  image_deleted: "amber",
  escalation_config_updated: "purple",
  escalation_rule_updated: "purple",
  profile_updated: "blue",
  draft_discarded: "rose",
  password_reset_requested: "muted",
  password_reset_completed: "muted",
  user_deactivated: "rose",
  user_activated: "green",
  role_changed: "purple",
  login: "green",
  logout: "muted",
  registered: "green",
  password_reset_self: "muted",
  kiosk_activated: "green",
  // Asset / bulk-SKU families
  asset_created: "green",
  asset_image_set: "blue",
  asset_image_uploaded: "blue",
  asset_image_removed: "amber",
  bulk_sku_image_set: "blue",
  bulk_sku_image_uploaded: "blue",
  bulk_sku_image_removed: "amber",
  favorite_added: "muted",
  favorite_removed: "muted",
  retire: "rose",
  reactivated: "green",
  duplicate: "blue",
  csv_import: "blue",
  convert_to_numbered: "purple",
  adjust: "blue",
  add_units: "green",
  mark_labels_printed: "muted",
  bulk_units_auto_lost: "rose",
  repair_stale_checked_out: "purple",
  // Kiosk custody family
  kiosk_pickup: "green",
  kiosk_checkout: "green",
  kiosk_checkin: "green",
  kiosk_checkout_updated: "blue",
  kiosk_checkout_item_added: "amber",
  kiosk_checkout_item_removed: "amber",
  partial_bulk_checkin: "amber",
  pending_pickup_expired: "rose",
  fulfilled_by_kiosk_pickup: "green",
  admin_force_completed_checkout: "purple",
  nudge_sent: "muted",
  overdue_nudge_sent: "muted",
  auto_completed_by_kiosk_checkin: "green",
  auto_completed_by_bulk_checkin: "green",
  auto_completed_by_partial_checkin: "green",
};

/** Tinted circle behind the event-type icon, keyed by the action's color family. */
const NODE_CLASSES: Record<ActionColorKey, string> = {
  green:  "bg-[var(--green-bg)] text-[var(--green-text)]",
  blue:   "bg-[var(--blue-bg)] text-[var(--blue-text)]",
  amber:  "bg-[var(--orange-bg)] text-[var(--orange-text)]",
  rose:   "bg-[var(--red-bg)] text-[var(--red-text)]",
  purple: "bg-[var(--purple-bg)] text-[var(--purple-text)]",
  muted:  "bg-muted text-muted-foreground",
};

/** Event-type icon for the timeline rail. Exact matches first, then family prefixes. */
const ACTION_ICONS: Record<string, LucideIcon> = {
  created: Plus,
  create: Plus,
  "booking.created": Plus,
  asset_created: Plus,
  registered: Plus,
  cancelled: X,
  cancel: X,
  draft_discarded: X,
  deleted: Trash2,
  bulk_deleted: Trash2,
  retired: Trash2,
  retire: Trash2,
  bulk_retired: Trash2,
  reactivated: RotateCcw,
  bulk_unretired: RotateCcw,
  duplicated: Copy,
  duplicate: Copy,
  extended: CalendarClock,
  extend: CalendarClock,
  events_updated: CalendarClock,
  qr_generated: QrCode,
  favorite_added: Heart,
  favorite_removed: Heart,
  csv_import: Upload,
  login: LogIn,
  logout: LogOut,
  role_changed: UserRound,
  owner_transferred: UserRound,
  user_deactivated: UserRound,
  user_activated: UserRound,
  admin_override: ShieldAlert,
  admin_force_completed_checkout: ShieldAlert,
  nudge_sent: Bell,
  overdue_nudge_sent: Bell,
  auto_escalation: Bell,
  cron_notification: Bell,
};

const ICON_PREFIXES: [string, LucideIcon][] = [
  ["auto_completed_by", ScanLine],
  ["kiosk_", ScanLine],
  ["checkin", ScanLine],
  ["checkout_scan", ScanLine],
  ["scan_", ScanLine],
  ["partial_", ScanLine],
  ["fulfilled_by_kiosk", ScanLine],
  ["asset_image", Camera],
  ["bulk_sku_image", Camera],
  ["avatar_", Camera],
  ["image_", Camera],
  ["booking.items", Package],
  ["accessory_", Package],
  ["bulk_member", Package],
  ["add_units", Package],
  ["adjust", Package],
  ["convert_to_numbered", Package],
  ["password_", KeyRound],
  ["ics_token", KeyRound],
  ["calendar_event", CalendarClock],
];

function actionIcon(action: string, isSystem: boolean): LucideIcon {
  const exact = ACTION_ICONS[action];
  if (exact) return exact;
  const prefix = ICON_PREFIXES.find(([p]) => action.startsWith(p));
  if (prefix) return prefix[1];
  return isSystem ? Cog : Pencil;
}

/** Resolve a friendly target phrase from the audit entry — used by `user` context
 *  where each row references a different entity. Falls back to the entityType
 *  with a short id suffix if no human-readable name is available. */
function userTarget(entry: AuditEntry): string {
  const after = entry.afterJson ?? {};
  const before = entry.beforeJson ?? {};
  if (entry.entityType === "user") return "their profile";
  if (entry.entityType === "booking") {
    const t = (after.title as string | undefined) ?? (before.title as string | undefined);
    return t ? `booking "${t}"` : "a booking";
  }
  if (entry.entityType === "asset") {
    const t = (after.name as string | undefined) ?? (before.name as string | undefined);
    return t ? `item "${t}"` : "an item";
  }
  if (entry.entityType === "kit") {
    const t = (after.name as string | undefined) ?? (before.name as string | undefined);
    return t ? `kit "${t}"` : "a kit";
  }
  if (entry.entityType === "license") return "a license";
  return entry.entityType
    ? `a ${entry.entityType.replace(/_/g, " ")}`
    : "this resource";
}

/** Noun phrase for a booking row when the server joined its identity —
 *  `checkout "Sony kit"` instead of "the booking". */
function bookingPhrase(entry: AuditEntry, fallback: string): string {
  if (entry.entityType !== "booking") return fallback;
  const label = entry.entity?.label;
  if (!label) return fallback;
  const noun =
    entry.entity?.kind === "RESERVATION"
      ? "reservation"
      : entry.entity?.kind === "CHECKOUT"
        ? "checkout"
        : "booking";
  return `${noun} "${label}"`;
}

function auditItemName(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (typeof payload.itemName === "string" && payload.itemName.trim()) {
    return payload.itemName.trim();
  }
  if (typeof payload.tagName === "string" && payload.tagName.trim()) {
    return payload.tagName.trim();
  }
  if (typeof payload.unitNumber === "number") return `unit #${payload.unitNumber}`;
  return null;
}

function formatAuditItemNames(payload: Record<string, unknown> | null): string | null {
  const rawNames = payload?.itemNames;
  if (!Array.isArray(rawNames)) return null;
  const names = rawNames.filter(
    (name): name is string => typeof name === "string" && name.trim().length > 0,
  );
  if (names.length === 0) return null;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const visible = names.slice(0, 3);
  const remainder = names.length - visible.length;
  return remainder > 0
    ? `${visible.join(", ")}, and ${remainder} more`
    : `${visible.slice(0, -1).join(", ")}, and ${visible.at(-1)}`;
}

function kioskLocationPhrase(payload: Record<string, unknown> | null): string {
  if (typeof payload?.kioskName === "string" && payload.kioskName.trim()) {
    return `the ${payload.kioskName.trim()}`;
  }
  return "a kiosk";
}

/** Generate a natural-language description of an action */
export function describeAction(
  entry: AuditEntry,
  actorName: string,
  context: "booking" | "item" | "report" | "user",
  entityName?: string,
): string {
  const target =
    context === "booking"
      ? "this booking"
      : context === "item"
        ? entityName || "this item"
        : context === "user"
          ? userTarget(entry)
          : entityName
            ? entityName
            : entry.entityType
              ? `${entry.entityType} ${(entry.entityId ?? "").slice(0, 8)}`
              : "this resource";

  const reportPrefix = context === "report" ? `${actorName} ` : "";

  switch (entry.action) {
    case "created":
    case "create":
    case "booking.created":
      return context === "report"
        ? `${actorName} created ${target}`
        : context === "booking"
          ? "Created this booking"
          : context === "item"
            ? entry.entityType === "booking"
              ? `Created ${bookingPhrase(entry, "a booking")}`
              : "Created this item"
            : `Created ${target}`;
    case "updated":
    case "update":
      return context === "report"
        ? `${actorName} updated ${target}`
        : context === "user"
          ? `Updated ${target}`
          : "Updated details";
    case "owner_transferred": {
      const nextOwner = entry.afterJson?.requesterName as string | undefined;
      return nextOwner
        ? `${reportPrefix}Transferred ownership to ${nextOwner}`
        : `${reportPrefix}Transferred ownership`;
    }
    case "events_updated":
      return `${reportPrefix}Updated linked events`;
    case "extended":
    case "extend": {
      const newEnd =
        entry.afterJson && typeof entry.afterJson.endsAt === "string"
          ? formatDateTime(entry.afterJson.endsAt)
          : null;
      const what = context === "item" ? bookingPhrase(entry, "the checkout") : "the checkout";
      return newEnd
        ? `${reportPrefix}Extended ${what} to ${newEnd}`
        : `${reportPrefix}Extended ${what}`;
    }
    case "cancelled":
    case "cancel":
      return `${reportPrefix}Cancelled ${
        context === "report" || context === "user"
          ? target
          : context === "item"
            ? bookingPhrase(entry, "the booking")
            : "the booking"
      }`;
    case "deleted":
      return `${reportPrefix}Deleted ${target}`;
    case "retired":
      return `${reportPrefix}Retired ${target}`;
    case "checkin_completed":
      return `${reportPrefix}Completed check-in`;
    case "checkin_items":
      return `${reportPrefix}Checked in items`;
    case "checkout_completed":
      return `${reportPrefix}Completed checkout`;
    case "checkout_scan_completed":
    case "scan_completed":
      return `${reportPrefix}Completed scan`;
    case "cancelled_by_checkout_conversion":
      return `${reportPrefix}Converted reservation to checkout`;
    case "items_returned":
      return `${reportPrefix}All items returned`;
    case "items_returned_partial":
      return `${reportPrefix}Some items returned`;
    case "partial_return_recorded":
    case "partial_checkin":
      return `${reportPrefix}Recorded partial return`;
    case "auto_completed_by_partial_checkin":
      return `${reportPrefix}Auto-completed after partial check-in`;
    case "auto_completed_by_kiosk_checkin":
      return `${reportPrefix}Booking completed by the kiosk return`;
    case "auto_completed_by_bulk_checkin":
      return `${reportPrefix}Booking completed by the bulk return`;
    case "marked_maintenance":
      return `${reportPrefix}Marked as needs maintenance`;
    case "cleared_maintenance":
      return `${reportPrefix}Cleared maintenance status`;
    case "duplicated":
      return `${reportPrefix}Duplicated ${target}`;
    case "qr_generated":
      return `${reportPrefix}Generated new QR code`;
    case "admin_override":
      return `${reportPrefix}Admin override`;
    case "auto_escalation":
      return "System auto-escalated overdue notification";
    case "cron_notification":
      return "System sent scheduled notification";
    case "auto_complete":
      return "System auto-completed";
    case "booking.items_added": {
      const counts = getEquipmentCounts(entry.afterJson);
      return counts
        ? `${reportPrefix}Added ${counts}`
        : `${reportPrefix}Added items`;
    }
    case "booking.items_removed": {
      const counts = getEquipmentCounts(entry.beforeJson);
      return counts
        ? `${reportPrefix}Removed ${counts}`
        : `${reportPrefix}Removed items`;
    }
    case "booking.items_qty_changed":
      return `${reportPrefix}Changed item quantities`;
    case "edit":
      return context === "item" && entry.entityType === "booking"
        ? `${reportPrefix}Updated booking`
        : `${reportPrefix}Updated details`;
    case "bulk_move_location":
      return `${reportPrefix}Moved location`;
    case "accessory_attached": {
      const accName = entry.afterJson?.name || entry.afterJson?.accessoryName;
      return accName
        ? `${reportPrefix}Attached item "${accName}"`
        : `${reportPrefix}Attached an item`;
    }
    case "accessory_detached": {
      const detName = entry.beforeJson?.name || entry.beforeJson?.accessoryName;
      return detName
        ? `${reportPrefix}Detached item "${detName}"`
        : `${reportPrefix}Detached an item`;
    }
    case "accessory_moved": {
      const movName = entry.afterJson?.name || entry.afterJson?.accessoryName;
      return movName
        ? `${reportPrefix}Moved attachment "${movName}" to another item`
        : `${reportPrefix}Moved an attachment to another item`;
    }
    case "image_uploaded":
      return `${reportPrefix}Uploaded a photo`;
    case "image_deleted":
      return `${reportPrefix}Removed a photo`;
    case "escalation_config_updated":
      return `${reportPrefix}Updated escalation settings`;
    case "escalation_rule_updated":
      return `${reportPrefix}Updated an escalation rule`;
    case "profile_update":
    case "profile_updated": {
      // When exactly one field changed, name it directly so the row reads
      // "Updated their shoe size" instead of "Updated their profile" + 1 pill.
      const fields = entry.afterJson ? Object.keys(entry.afterJson).filter((k) => !HIDDEN_FIELDS.has(k)) : [];
      if (fields.length === 1) {
        const label = (FIELD_LABELS[fields[0]!] ?? fields[0]!).toLowerCase(); // length === 1 guard above
        return `${reportPrefix}Updated their ${label}`;
      }
      if (fields.length > 1) {
        return `${reportPrefix}Updated their profile (${fields.length} fields)`;
      }
      return `${reportPrefix}Updated their profile`;
    }
    case "avatar_uploaded":
      return `${reportPrefix}Updated their profile photo`;
    case "avatar_deleted":
      return `${reportPrefix}Removed their profile photo`;
    case "avatar_updated":
      return `${reportPrefix}Updated their profile photo`;
    case "avatar_removed":
      return `${reportPrefix}Removed their profile photo`;
    case "draft_discarded":
      return `${reportPrefix}Discarded a draft booking`;
    case "password_reset_requested":
      return `${reportPrefix}Requested a password reset`;
    case "password_reset_completed":
      return `${reportPrefix}Reset their password`;
    case "user_deactivated":
      return `${reportPrefix}Deactivated a user account`;
    case "user_activated":
      return `${reportPrefix}Activated a user account`;
    case "role_changed": {
      const before = entry.beforeJson?.role as string | undefined;
      const after = entry.afterJson?.role as string | undefined;
      if (before && after) {
        return `${reportPrefix}Changed role from ${before} to ${after}`;
      }
      if (after) return `${reportPrefix}Changed role to ${after}`;
      return `${reportPrefix}Changed a user's role`;
    }
    case "login":
      return `${reportPrefix}Signed in`;
    case "logout":
      return `${reportPrefix}Signed out`;
    case "registered":
      return `${reportPrefix}Created an account`;
    case "password_reset_self":
      return `${reportPrefix}Reset their password`;
    case "kiosk_activated":
      return "Kiosk device activated";
    case "asset_created":
      return context === "item" ? "Created this item" : `${reportPrefix}Created ${target}`;
    case "asset_image_set":
    case "bulk_sku_image_set":
      return `${reportPrefix}Set the photo`;
    case "asset_image_uploaded":
    case "bulk_sku_image_uploaded":
      return `${reportPrefix}Uploaded a photo`;
    case "asset_image_removed":
    case "bulk_sku_image_removed":
      return `${reportPrefix}Removed the photo`;
    case "favorite_added":
      return `${reportPrefix}Added to favorites`;
    case "favorite_removed":
      return `${reportPrefix}Removed from favorites`;
    case "retire":
      return `${reportPrefix}Retired ${target}`;
    case "reactivated":
      return `${reportPrefix}Reactivated ${target}`;
    case "duplicate":
      return `${reportPrefix}Duplicated ${target}`;
    case "csv_import":
      return `${reportPrefix}Imported via CSV`;
    case "convert_to_numbered":
      return `${reportPrefix}Converted to numbered units`;
    case "adjust":
      return `${reportPrefix}Adjusted stock quantity`;
    case "add_units":
      return `${reportPrefix}Added units`;
    case "mark_labels_printed":
      return `${reportPrefix}Marked labels as printed`;
    case "bulk_units_auto_lost":
      return "System marked overdue units as lost";
    case "repair_stale_checked_out":
      return `${reportPrefix}Repaired stale checked-out units`;
    case "kiosk_pickup":
      return `${reportPrefix}Picked up ${context === "item" ? bookingPhrase(entry, "gear") : "gear"} at a kiosk`;
    case "kiosk_checkout":
      return `${reportPrefix}Checked out ${context === "item" ? bookingPhrase(entry, "gear") : "gear"} at a kiosk`;
    case "kiosk_checkin":
      return `${reportPrefix}Returned ${formatAuditItemNames(entry.afterJson) ?? (context === "item" ? bookingPhrase(entry, "gear") : "gear")} at ${kioskLocationPhrase(entry.afterJson)}`;
    case "kiosk_checkout_updated":
      return `${reportPrefix}Updated the checkout at a kiosk`;
    case "kiosk_checkout_item_added":
      return `${reportPrefix}Added ${auditItemName(entry.afterJson) ?? "an item"} at ${kioskLocationPhrase(entry.afterJson)}`;
    case "kiosk_checkout_item_removed":
      return `${reportPrefix}Removed ${auditItemName(entry.beforeJson) ?? "an item"} at ${kioskLocationPhrase(entry.beforeJson)}`;
    case "partial_bulk_checkin":
      return `${reportPrefix}Recorded partial return`;
    case "pending_pickup_expired":
      return "Pickup window expired";
    case "fulfilled_by_kiosk_pickup":
      return `${reportPrefix}Fulfilled by kiosk pickup`;
    case "admin_force_completed_checkout":
      return `${reportPrefix}Closed the checkout without a scan`;
    case "nudge_sent":
    case "overdue_nudge_sent":
      return `${reportPrefix}Sent a reminder`;
    default: {
      const humanized = entry.action.replace(/[._]+/g, " ");
      const sentence = humanized.charAt(0).toUpperCase() + humanized.slice(1);
      if (context === "report") {
        return `${actorName} performed ${humanized}`;
      }
      if (context === "user") {
        return `${sentence} on ${target}`;
      }
      return sentence;
    }
  }
}

function getEquipmentCounts(
  json: Record<string, unknown> | null,
): string | null {
  if (!json) return null;
  const parts: string[] = [];
  if (Array.isArray(json.serializedAssetIds)) {
    const n = json.serializedAssetIds.length;
    parts.push(`${n} serialized item${n !== 1 ? "s" : ""}`);
  }
  if (Array.isArray(json.bulkItems)) {
    const n = json.bulkItems.length;
    parts.push(`${n} item famil${n === 1 ? "y" : "ies"}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/* ── Field change description ── */

type FieldChange = { label: string; from: string; to: string; mono?: boolean };

function describeFieldChange(
  key: string,
  before: unknown,
  after: unknown,
): FieldChange | null {
  if (HIDDEN_FIELDS.has(key)) return null;

  const label = FIELD_LABELS[key] || key;

  // For ID fields, show "set" / "removed" / "changed" instead of raw IDs
  if (ID_FIELDS.has(key)) {
    const hadBefore = before != null && before !== "";
    const hasAfter = after != null && after !== "";
    if (!hadBefore && hasAfter) return { label, from: "", to: "set" };
    if (hadBefore && !hasAfter) return { label, from: "", to: "removed" };
    return { label, from: "", to: "changed" };
  }

  // Boolean fields
  if (
    typeof after === "boolean" ||
    after === "true" ||
    after === "false"
  ) {
    return {
      label,
      from: "",
      to: String(after) === "true" ? "enabled" : "disabled",
    };
  }

  // Skip array and object fields in generic diff (shown via equipment actions or too complex)
  if (Array.isArray(before) || Array.isArray(after)) return null;
  if ((before != null && typeof before === "object") || (after != null && typeof after === "object")) return null;

  // Status fields - use human-readable labels
  if (key === "status") {
    const from =
      before == null || before === ""
        ? "empty"
        : STATUS_LABELS[String(before)] || String(before);
    const to =
      after == null || after === ""
        ? "empty"
        : STATUS_LABELS[String(after)] || String(after);
    if (from === to) return null;
    return { label, from, to };
  }

  // Date fields - format as readable dates
  if (
    key === "startsAt" ||
    key === "endsAt" ||
    key === "purchaseDate" ||
    key === "warrantyDate"
  ) {
    const from =
      before == null || before === ""
        ? "empty"
        : formatDateTime(String(before));
    const to =
      after == null || after === ""
        ? "empty"
        : formatDateTime(String(after));
    if (from === to) return null;
    return { label, from, to };
  }

  const from =
    before == null || before === "" ? "empty" : String(before);
  const to = after == null || after === "" ? "empty" : String(after);
  if (from === to) return null;
  if (key === "notes" && (looksLikeImportMetadata(from) || looksLikeImportMetadata(to))) {
    return null;
  }
  // URLs render mono with the protocol stripped — the hostname/path is the
  // information; "https://www." is noise that eats truncation budget.
  const isUrl = (v: string) => /^https?:\/\//.test(v);
  const mono = isUrl(from) || isUrl(to);
  const display = (v: string) => (isUrl(v) ? v.replace(/^https?:\/\/(www\.)?/, "") : v);
  return { label, from: display(from), to: display(to), mono };
}

function looksLikeImportMetadata(value: string): boolean {
  if (!value.trim().startsWith("{")) return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return "cheqroomName" in parsed || "fiscalYear" in parsed || "fiscalYearPurchased" in parsed;
  } catch {
    return false;
  }
}

/** Actions whose `before`/`after` JSON should render as field-change pills. */
const DIFF_ACTIONS = new Set([
  "updated",
  "update",
  "owner_transferred",
  "profile_update",
  "profile_updated",
  "role_changed",
]);

function getFieldChanges(entry: AuditEntry): FieldChange[] {
  if (!DIFF_ACTIONS.has(entry.action) || !entry.afterJson) return [];
  // Some routes (e.g. role_changed) don't always write a `before` payload —
  // the field-change describer handles missing `before` as "set"/"empty"
  // gracefully so we still render the new value as a pill.
  return Object.keys(entry.afterJson)
    .map((k) => {
      const b = (entry.beforeJson as Record<string, unknown>)?.[k];
      const a = (entry.afterJson as Record<string, unknown>)?.[k];
      return describeFieldChange(k, b, a);
    })
    .filter((c): c is FieldChange => c !== null);
}

/** True when the row would render as a phantom "Updated …" with no visible
 *  detail — every changed field is hidden/internal. Filtered out before date
 *  grouping so a day of only phantom rows doesn't leave an empty date header. */
function isPhantomEntry(entry: AuditEntry): boolean {
  return (
    DIFF_ACTIONS.has(entry.action) &&
    !!entry.afterJson &&
    getFieldChanges(entry).length === 0 &&
    // Avatar uploads / deletions are diff-less but meaningful — keep them.
    entry.action !== "avatar_uploaded" &&
    entry.action !== "avatar_deleted"
  );
}

/* ── Date grouping ── */

function getDateGroup(iso: string, today: Date): string {
  const d = new Date(iso);
  const todayStr = today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === todayStr) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Time-only — the sticky date header owns the date, so repeating it per row
 *  is pure noise. Coalesced runs show their span as a range. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimestamp(entry: RenderEntry): string {
  const newest = formatTime(entry.createdAt);
  if (entry._oldest && entry._oldest !== entry.createdAt) {
    const oldest = formatTime(entry._oldest);
    if (oldest !== newest) return `${oldest}–${newest}`;
  }
  return newest;
}

/* ── Coalescing ── */

/** Window in milliseconds for collapsing rapid identical writes. Avatar
 *  uploads and form-on-blur saves often fire 3-5 rows in a span of a few
 *  seconds; one row with a "× N" pill reads better than five duplicates. */
const COALESCE_WINDOW_MS = 60_000;

type RenderEntry = AuditEntry & {
  _count?: number;
  /** createdAt of the oldest entry folded into this row. */
  _oldest?: string;
  /** Every entry folded into this row, newest-first (including the primary). */
  _chain?: AuditEntry[];
};

/** Collapse runs of consecutive entries that share actor + action + entity.
 *  Entries arrive newest-first so the newest one is preserved as the
 *  "primary". The window compares against the oldest folded entry, so a slow
 *  run of edits (one per minute) still folds into a single row; the full run
 *  is kept on `_chain` so same-field edits can render as a value chain. */
function coalesceEntries(entries: AuditEntry[]): RenderEntry[] {
  const out: RenderEntry[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (
      last &&
      (last.actor?.id ?? null) === (entry.actor?.id ?? null) &&
      last.action === entry.action &&
      last.entityType === entry.entityType &&
      last.entityId === entry.entityId &&
      Math.abs(
        new Date(last._oldest ?? last.createdAt).getTime() -
          new Date(entry.createdAt).getTime(),
      ) <= COALESCE_WINDOW_MS
    ) {
      last._count = (last._count ?? 1) + 1;
      last._oldest = entry.createdAt;
      if (!last._chain) last._chain = [last];
      last._chain.push(entry);
      continue;
    }
    out.push({ ...entry, _count: 1 });
  }
  return out;
}

const CHAINABLE_ACTIONS = new Set([...DIFF_ACTIONS, "extended", "extend"]);

type ChainedChange = { label: string; values: string[]; delta: string | null; mono: boolean };

/** When every entry in a coalesced run changed the same single visible field,
 *  render the value path (`May 4 → May 8 → May 27`) instead of hiding the
 *  history behind a ×N badge. */
function getChainedChange(entry: RenderEntry): ChainedChange | null {
  const chain = entry._chain;
  if (!chain || chain.length < 2 || !CHAINABLE_ACTIONS.has(entry.action)) return null;

  const keys = new Set<string>();
  for (const e of chain) {
    if (!e.afterJson) return null;
    for (const k of Object.keys(e.afterJson)) {
      if (!HIDDEN_FIELDS.has(k)) keys.add(k);
    }
  }
  if (keys.size !== 1) return null;
  const key = [...keys][0]!;

  const ordered = [...chain].reverse();
  const values: string[] = [];
  let label = FIELD_LABELS[key] || key;
  let mono = false;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i]!;
    const change = describeFieldChange(
      key,
      (e.beforeJson as Record<string, unknown> | null)?.[key],
      (e.afterJson as Record<string, unknown> | null)?.[key],
    );
    if (!change) continue;
    label = change.label;
    if (change.mono) mono = true;
    if (values.length === 0 && change.from && change.from !== "empty") values.push(change.from);
    values.push(change.to);
  }
  const deduped = values.filter((v, i) => i === 0 || v !== values[i - 1]);
  // Two values is an ordinary before → after pill; a chain needs a middle.
  if (deduped.length < 3) return null;

  let delta: string | null = null;
  if (key === "startsAt" || key === "endsAt") {
    const firstRaw = (ordered[0]!.beforeJson as Record<string, unknown> | null)?.[key];
    const lastRaw = (ordered[ordered.length - 1]!.afterJson as Record<string, unknown> | null)?.[key];
    const first = typeof firstRaw === "string" ? new Date(firstRaw).getTime() : NaN;
    const last = typeof lastRaw === "string" ? new Date(lastRaw).getTime() : NaN;
    if (!Number.isNaN(first) && !Number.isNaN(last) && first !== last) {
      const days = Math.round((last - first) / 86_400_000);
      if (days !== 0) delta = `${days > 0 ? "+" : ""}${days} day${Math.abs(days) === 1 ? "" : "s"}`;
    }
  }

  return { label, values: deduped, delta, mono };
}

/* ── Skeleton loader ── */

export function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-3 items-start">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/* ── Single entry row ── */

function valuePillClass(kind: "old" | "new" | "mid", mono?: boolean) {
  return cn(
    "max-w-56 truncate rounded-md px-2 py-0.5",
    kind === "old" && "bg-[var(--red-bg)] text-[var(--red-text)] line-through",
    kind === "new" && "bg-[var(--green-bg)] font-medium text-[var(--green-text)]",
    kind === "mid" && "bg-muted text-muted-foreground",
    mono && "font-mono text-[11px]",
  );
}

function TimelineEntry({
  entry,
  context,
  entityName,
  dueAt,
}: {
  entry: RenderEntry;
  context: "booking" | "item" | "report" | "user";
  entityName?: string;
  dueAt?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const repeatCount = entry._count && entry._count > 1 ? entry._count : null;
  const isSystem = !entry.actor || SYSTEM_ACTIONS.has(entry.action);
  const actorName = entry.actor?.name
    ?? (SYSTEM_ACTIONS.has(entry.action) ? "System" : "Unknown user");
  const colorKey = ACTION_COLORS[entry.action] ?? "muted";
  const Icon = actionIcon(entry.action, isSystem);

  const description = describeAction(entry, actorName, context, entityName);
  const chained = getChainedChange(entry);
  const changes = chained ? [] : getFieldChanges(entry);
  const actorRole = (entry.afterJson?._actorRole as string | undefined) ?? null;

  // Cheqroom-style lateness context: a return after the due date names its
  // slip. Compared against the booking's final due date (extends update it).
  const lateByMs =
    dueAt && RETURN_ACTIONS.has(entry.action)
      ? new Date(entry.createdAt).getTime() - new Date(dueAt).getTime()
      : 0;
  const lateBy = lateByMs > 60_000 ? formatDuration(lateByMs) : null;

  // On user / report contexts each row references a different entity — make the
  // row clickable when a detail page exists. Item-context rows that reference a
  // booking also link out; other rows already live on the entity's own page.
  const linkable =
    (context === "user" ||
      context === "report" ||
      (context === "item" && entry.entityType === "booking")) &&
    entityHref(entry.entityType, entry.entityId, entry.afterJson, entry.entity?.kind);
  const Wrapper: React.ElementType = linkable ? Link : "div";
  const wrapperProps = linkable
    ? {
        href: linkable,
        className:
          "flex gap-3 px-3 sm:px-4 no-underline text-inherit hover:bg-muted/40 transition-colors",
      }
    : { className: "flex gap-3 px-3 sm:px-4" };

  return (
    <Wrapper {...wrapperProps}>
      {/* Event-type rail: tinted icon node + connecting hairline */}
      <div className="flex w-7 shrink-0 flex-col items-center self-stretch">
        <div
          className={cn(
            "mt-2 flex size-7 shrink-0 items-center justify-center rounded-full",
            NODE_CLASSES[colorKey],
          )}
        >
          <Icon className="size-3.5" />
        </div>
        <div className="mt-1 w-px flex-1 bg-border/50" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 py-2.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          {context !== "report" && (
            <span className="text-sm font-medium truncate">{actorName}</span>
          )}
          <span className="text-sm text-muted-foreground">
            {description}
          </span>
          {lateBy && (
            <span className="text-xs font-medium text-[var(--orange-text)]">
              {lateBy} late
            </span>
          )}
          {repeatCount && !chained && (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-[10px] tabular-nums"
            >
              ×{repeatCount}
            </Badge>
          )}
          <span
            className="text-xs text-muted-foreground/60 ml-auto shrink-0 tabular-nums"
            title={formatDateTime(entry.createdAt)}
          >
            {formatTimestamp(entry)}
          </span>
          {!linkable && (
            <button
              type="button"
              aria-label={expanded ? "Hide entry details" : "Show entry details"}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="shrink-0 self-center rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>

        {/* Chained same-field run: value path oldest → newest */}
        {chained && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{chained.label}</span>
            {chained.values.map((value, i) => (
              <Fragment key={`${i}-${value}`}>
                {i > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />}
                <span
                  className={cn(
                    valuePillClass(i === chained.values.length - 1 ? "new" : "mid", chained.mono),
                    "tabular-nums",
                  )}
                  title={value}
                >
                  {value}
                </span>
              </Fragment>
            ))}
            {chained.delta && (
              <span className="text-muted-foreground/60">({chained.delta})</span>
            )}
          </div>
        )}

        {/* Field changes: old value red + struck, new value green */}
        {changes.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {changes.map((change) => (
              <div key={change.label} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{change.label}</span>
                {change.from && change.from !== "empty" ? (
                  <>
                    <span className={valuePillClass("old", change.mono)} title={change.from}>
                      {change.from}
                    </span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
                    <span className={valuePillClass("new", change.mono)} title={change.to}>
                      {change.to}
                    </span>
                  </>
                ) : (
                  <span className={valuePillClass("new", change.mono)} title={change.to}>
                    {change.to}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Raw entry details — the API already sends this JSON to the client,
            so revealing it adds no exposure. */}
        {expanded && (
          <div className="mt-2 flex flex-col gap-2 rounded-md border border-border/40 bg-muted/40 p-2.5 text-xs">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground">When</span>
              <span className="tabular-nums">{formatDateTime(entry.createdAt)}</span>
              <span className="text-muted-foreground">Actor</span>
              <span>
                {actorName}
                {actorRole ? ` · ${actorRole}` : ""}
              </span>
              <span className="text-muted-foreground">Action</span>
              <span className="font-mono text-[11px]">{entry.action}</span>
              <span className="text-muted-foreground">Entity</span>
              <span className="break-all font-mono text-[11px]">
                {entry.entityType ?? "—"} · {entry.entityId ?? "—"}
              </span>
            </div>
            {entry.beforeJson && (
              <div>
                <span className="text-muted-foreground">Before</span>
                <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px]">
                  {JSON.stringify(entry.beforeJson, null, 2)}
                </pre>
              </div>
            )}
            {entry.afterJson && (
              <div>
                <span className="text-muted-foreground">After</span>
                <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px]">
                  {JSON.stringify(entry.afterJson, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

/* ── Main component ── */

export default function ActivityTimeline({
  entries,
  loading,
  hasMore,
  onLoadMore,
  context = "booking",
  entityName,
  emptyMessage = "No activity recorded yet.",
  dueAt,
}: ActivityTimelineProps) {
  const today = useMemo(() => new Date(), []);

  // Drop phantom rows first (so no date header renders for a day of hidden
  // writes), coalesce rapid identical writes, then group by date. Coalescing
  // before grouping means a run that straddles a date boundary (rare) folds
  // onto the newer side — the right side from a "what just happened" reading.
  const groups = useMemo(() => {
    const coalesced = coalesceEntries(entries.filter((e) => !isPhantomEntry(e)));
    const map = new Map<string, RenderEntry[]>();
    for (const entry of coalesced) {
      const group = getDateGroup(entry.createdAt, today);
      const arr = map.get(group);
      if (arr) arr.push(entry);
      else map.set(group, [entry]);
    }
    return Array.from(map.entries());
  }, [entries, today]);

  if (loading && entries.length === 0) {
    return <TimelineSkeleton />;
  }

  // Check the filtered groups, not raw entries — a page of nothing but
  // phantom rows should show the empty state, not a blank panel.
  if (groups.length === 0) {
    return (
      <Empty className="py-8 border-0">
        <EmptyDescription>{emptyMessage}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div>
      {groups.map(([dateLabel, groupEntries]) => (
        <div key={dateLabel}>
          {/* Sticky date header */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30 px-3 sm:px-4 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {dateLabel}
            </span>
          </div>

          {/* Entries — the rail hairline provides row structure, no dividers */}
          <div>
            {groupEntries.map((entry) => (
              <TimelineEntry
                key={entry.id}
                entry={entry}
                context={context}
                entityName={entityName}
                dueAt={dueAt}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Load more */}
      {hasMore && onLoadMore && (
        <>
          <Separator className="opacity-30" />
          <div className="py-3 text-center">
          <Button className="h-10"
            variant="outline"
            disabled={loading}
            onClick={onLoadMore}
          >
            {loading ? "Loading\u2026" : "Load older entries"}
          </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Re-export utilities for consumers ── */

export { EQUIPMENT_ACTIONS, HIDDEN_FIELDS as HIDDEN_AUDIT_FIELDS };
