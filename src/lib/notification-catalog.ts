/**
 * The single source of truth for notification preference categories: what
 * each one is called, who sees it, and how its push is presented. Shared by the
 * server (delivery gates, APNs payload), the preferences API (role-filtered
 * catalog), and the web settings page. No server-only imports.
 */

export type NotificationRole = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";

export type NotificationCategory =
  | "checkoutDue"
  | "checkoutOverdue"
  | "reservation"
  | "licenseExpiry"
  | "schedule"
  | "trade"
  | "gearPrep"
  | "licenseHeld"
  | "itemReports"
  | "systemAlerts"
  | "reviewQueue"
  | "timeOff"
  | "shiftReminder";

/**
 * How a category's push arrives. `off` also suppresses that category's email;
 * `silent` delivers to Notification Center without sound or lighting the
 * screen; `standard` alerts normally. In-app inbox rows are written regardless.
 */
export type PushLevel = "off" | "silent" | "standard";

export const PUSH_LEVELS: readonly PushLevel[] = ["off", "silent", "standard"];

export type NotificationCategoryGroup = "gear" | "schedule" | "account" | "admin";

export type APNsInterruptionLevel = "passive" | "active" | "time-sensitive";

export type NotificationCategoryEntry = {
  id: NotificationCategory;
  label: string;
  description: string;
  group: NotificationCategoryGroup;
  roles: readonly NotificationRole[];
  defaultLevel: PushLevel;
  /** Whether this category sends a push at all. Email-only categories are on/off. */
  push: boolean;
  /** Interruption level for `standard`. `silent` is always `passive`. */
  standardInterruption: Exclude<APNsInterruptionLevel, "passive">;
  /** Time-sensitive alerts may break through quiet hours when the user allows it. */
  urgent: boolean;
  /**
   * Native long-press action set registered by the iOS client. GT_ALERT
   * offers Mark as Read only; GT_REVIEW adds Approve and Decline.
   */
  apnsCategory: "GT_BOOKING" | "GT_SCHEDULE" | "GT_REVIEW" | "GT_ALERT";
  /** 0–1 APNs relevance: orders alerts in a stack and in the notification summary. */
  relevance: number;
};

const EVERYONE = ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"] as const;
const WORKERS = ["ADMIN", "STAFF", "STUDENT"] as const;

export const NOTIFICATION_CATALOG: readonly NotificationCategoryEntry[] = [
  {
    id: "checkoutDue",
    label: "Checkout due reminders",
    description: "Before gear you have out is due back.",
    group: "gear",
    roles: EVERYONE,
    defaultLevel: "standard",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_BOOKING",
    relevance: 0.8,
  },
  {
    id: "checkoutOverdue",
    label: "Checkout overdue alerts",
    description: "When gear is past due, including gear you're responsible for following up on.",
    group: "gear",
    roles: EVERYONE,
    defaultLevel: "standard",
    push: true,
    standardInterruption: "time-sensitive",
    urgent: true,
    apnsCategory: "GT_BOOKING",
    relevance: 1,
  },
  {
    id: "reservation",
    label: "Reservation updates",
    description: "When a reservation is created for you, changed, or cancelled.",
    group: "gear",
    roles: EVERYONE,
    defaultLevel: "standard",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_BOOKING",
    relevance: 0.6,
  },
  {
    id: "gearPrep",
    label: "Gear prep nudges",
    description: "Reminders to reserve gear for shifts you're working.",
    group: "gear",
    roles: WORKERS,
    defaultLevel: "silent",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_BOOKING",
    relevance: 0.4,
  },
  {
    id: "schedule",
    label: "Schedule updates",
    description: "Assignments, requests, and changes to shifts you're on.",
    group: "schedule",
    roles: EVERYONE,
    defaultLevel: "silent",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_SCHEDULE",
    relevance: 0.5,
  },
  {
    id: "shiftReminder",
    label: "Shift reminders",
    description: "Two hours before your call time.",
    group: "schedule",
    roles: EVERYONE,
    defaultLevel: "standard",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_SCHEDULE",
    relevance: 0.7,
  },
  {
    id: "trade",
    label: "Trade updates",
    description: "Claims, approvals, and changes to Trade Board posts you're part of.",
    group: "schedule",
    roles: WORKERS,
    defaultLevel: "standard",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_SCHEDULE",
    relevance: 0.6,
  },
  {
    id: "timeOff",
    label: "Time-off decisions",
    description: "When a time-off request is approved or denied.",
    group: "schedule",
    roles: ["STAFF", "STUDENT"],
    defaultLevel: "standard",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_ALERT",
    relevance: 0.5,
  },
  {
    id: "licenseExpiry",
    label: "License expiry reminders",
    description: "When a shared software license is about to expire or has expired.",
    group: "account",
    roles: ["ADMIN", "STAFF"],
    defaultLevel: "silent",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_ALERT",
    relevance: 0.3,
  },
  {
    id: "licenseHeld",
    label: "License return reminders",
    description: "When you've held a shared license for a while.",
    group: "account",
    roles: ["STUDENT"],
    defaultLevel: "silent",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_ALERT",
    relevance: 0.3,
  },
  {
    id: "reviewQueue",
    label: "Requests needing review",
    description: "Open-shift requests, claims, and trades waiting on an admin.",
    group: "admin",
    roles: ["ADMIN"],
    defaultLevel: "standard",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_REVIEW",
    relevance: 0.5,
  },
  {
    id: "itemReports",
    label: "Damaged and lost item reports",
    description: "Email when an item is reported damaged or lost at check-in.",
    group: "admin",
    roles: ["ADMIN", "STAFF"],
    defaultLevel: "standard",
    push: false,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_ALERT",
    relevance: 0.3,
  },
  {
    id: "systemAlerts",
    label: "System alerts",
    description: "Firmware releases for tracked gear.",
    group: "admin",
    roles: ["ADMIN"],
    defaultLevel: "silent",
    push: true,
    standardInterruption: "active",
    urgent: false,
    apnsCategory: "GT_ALERT",
    relevance: 0.2,
  },
];

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATALOG.map((c) => c.id);

export const NOTIFICATION_GROUP_LABELS: Record<NotificationCategoryGroup, string> = {
  gear: "Gear",
  schedule: "Schedule",
  account: "Account",
  admin: "Admin",
};

const CATALOG_BY_ID = new Map(NOTIFICATION_CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(id: NotificationCategory): NotificationCategoryEntry {
  const entry = CATALOG_BY_ID.get(id);
  if (!entry) throw new Error(`Unknown notification category: ${id}`);
  return entry;
}

export function isNotificationCategory(value: string): value is NotificationCategory {
  return CATALOG_BY_ID.has(value as NotificationCategory);
}

export function catalogForRole(role: NotificationRole): NotificationCategoryEntry[] {
  return NOTIFICATION_CATALOG.filter((entry) => entry.roles.includes(role));
}

/**
 * Every notification `type` the server writes, mapped to the category that
 * gates its outbound delivery. `null` means intentionally uncategorized: the
 * row is inbox-only, or (blasts, tests) governed only by channel and pause.
 */
export const NOTIFICATION_TYPE_CATEGORY: Record<string, NotificationCategory | null> = {
  checkout_due_2h: "checkoutDue",
  checkout_due_now: "checkoutDue",
  checkout_overdue_grace: "checkoutOverdue",
  checkout_overdue_4h: "checkoutOverdue",
  checkout_overdue_24h: "checkoutOverdue",
  overdue_nudge: "checkoutOverdue",
  reservation_booked: "reservation",
  reservation_updated: "reservation",
  reservation_pickup_ready: "reservation",
  reservation_cancelled: "reservation",
  shift_gear_up: "gearPrep",
  shift_reminder: "shiftReminder",
  shift_assigned: "schedule",
  shift_request_pending: "schedule",
  shift_request_approved: "schedule",
  shift_request_declined: "schedule",
  shift_assignment_removed: "schedule",
  shift_time_changed: "schedule",
  shift_personal_call_time_changed: "schedule",
  shift_schedule_published: "schedule",
  shift_schedule_updated: "schedule",
  shift_schedule_bulk_assigned: "schedule",
  published_schedule_updated: "schedule",
  shift_request_review: "reviewQueue",
  claim_review_escalated: "reviewQueue",
  claim_review_blocked: "reviewQueue",
  claim_review_auto_approved: "reviewQueue",
  trade_review_required: "reviewQueue",
  trade_posted: "trade",
  trade_claimed: "trade",
  trade_claim_pending: "trade",
  trade_claim_withdrawn: "trade",
  trade_approved: "trade",
  trade_approved_poster: "trade",
  trade_declined: "trade",
  trade_cancelled: "trade",
  trade_claim_cancelled: "trade",
  trade_expired: "trade",
  trade_claim_expired: "trade",
  time_off_approved: "timeOff",
  time_off_denied: "timeOff",
  license_expiring_soon: "licenseExpiry",
  license_expired: "licenseExpiry",
  license_held_2d: "licenseHeld",
  checkin_item_damaged: "itemReports",
  checkin_item_lost: "itemReports",
  firmware_update_released: "systemAlerts",
  // Inbox-only, or governed by channel and pause alone.
  badge_awarded: null,
  calendar_sync_failure: null,
  collaborator_affiliation_suspended: null,
  collaborator_policy_reduced: null,
  blast: null,
  low_stock: null,
};
