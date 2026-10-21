import {
  AlertTriangle,
  ArrowLeftRightIcon,
  Bell,
  CalendarDaysIcon,
  CircleIcon,
  KeyRoundIcon,
  PackageSearchIcon,
  ShirtIcon,
  UserRoundIcon,
} from "lucide-react";

export type NotificationMeta = {
  icon: typeof AlertTriangle;
  label: string;
  toneClass: string;
};

/** Icon, short label and tone for a notification type, shared by the inbox page and the bell popover. */
export function notificationMeta(type: string): NotificationMeta {
  if (type.startsWith("checkout_due") || type.startsWith("checkout_overdue")) {
    return {
      icon: AlertTriangle,
      label: "Overdue",
      toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
    };
  }

  switch (type) {
    case "overdue_nudge":
      return {
        icon: AlertTriangle,
        label: "Overdue",
        toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
      };
    case "shift_gear_up":
      return {
        icon: ShirtIcon,
        label: "Shift",
        toneClass: "bg-[var(--green-bg)] text-[var(--green-text)]",
      };
    case "trade_claimed":
    case "trade_approved":
    case "trade_completed":
      return {
        icon: ArrowLeftRightIcon,
        label: "Trade",
        toneClass: "bg-[var(--blue-bg)] text-[var(--blue-text)]",
      };
    case "trade_declined":
    case "trade_expired":
      return {
        icon: ArrowLeftRightIcon,
        label: "Trade",
        toneClass: "bg-[var(--red-bg)] text-[var(--red-text)]",
      };
    case "badge_awarded":
      return {
        icon: UserRoundIcon,
        label: "Recognition",
        toneClass: "bg-[var(--purple-bg)] text-[var(--purple-text)]",
      };
    case "calendar_sync_failure":
      return {
        icon: CalendarDaysIcon,
        label: "Calendar",
        toneClass: "bg-[var(--red-bg)] text-[var(--red-text)]",
      };
    case "firmware_update_released":
    case "low_stock":
      return {
        icon: PackageSearchIcon,
        label: "Inventory",
        toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
      };
    default:
      if (type.startsWith("reservation_")) {
        return {
          icon: Bell,
          label: "Reservation",
          toneClass: "bg-[var(--purple-bg)] text-[var(--purple-text)]",
        };
      }
      if (type.startsWith("shift_") || type.startsWith("time_off_")) {
        return {
          icon: CalendarDaysIcon,
          label: "Schedule",
          toneClass: "bg-[var(--blue-bg)] text-[var(--blue-text)]",
        };
      }
      if (type.startsWith("license_")) {
        return {
          icon: KeyRoundIcon,
          label: "License",
          toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
        };
      }
      return {
        icon: CircleIcon,
        label: "Notice",
        toneClass: "bg-muted text-muted-foreground",
      };
  }
}

/** Compact relative time ("5m ago", "3d ago"), falling back to a date after a week. */
export function formatNotificationTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
