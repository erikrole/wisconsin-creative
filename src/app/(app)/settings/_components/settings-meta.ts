import type { ComponentType } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  Database,
  Download,
  FolderTree,
  KeyRound,
  Landmark,
  MapPin,
  Monitor,
  Palette,
  ShieldAlert,
  Smartphone,
  Timer,
  UserRound,
  Users,
  Warehouse,
} from "lucide-react";
import type { SettingsGroup } from "@/lib/nav-sections";

type SettingsIcon = ComponentType<{ className?: string }>;

export const SETTINGS_GROUP_META: Record<SettingsGroup, {
  description: string;
  icon: SettingsIcon;
}> = {
  Personal: {
    description: "Your account, alerts, and how the app looks on this device.",
    icon: UserRound,
  },
  People: {
    description: "Who can sign in and what outside partners can do.",
    icon: Users,
  },
  Inventory: {
    description: "The labels that make gear findable in forms and filters.",
    icon: FolderTree,
  },
  Booking: {
    description: "Loan, reservation, extension, and overdue rules.",
    icon: Timer,
  },
  Schedule: {
    description: "Sports coverage, calendar feeds, and venue identity.",
    icon: CalendarDays,
  },
  Devices: {
    description: "Counter kiosks used for checkout and return.",
    icon: Smartphone,
  },
  System: {
    description: "Audit evidence, exports, and bounded diagnostics.",
    icon: Database,
  },
};

export const SETTINGS_SECTION_ICONS: Record<string, SettingsIcon> = {
  "/settings/profile": UserRound,
  "/settings/security": KeyRound,
  "/settings/notifications": Bell,
  "/settings/appearance": Palette,
  "/settings/allowed-emails": Users,
  "/settings/collaborator-access": Landmark,
  "/settings/categories": FolderTree,
  "/settings/departments": Warehouse,
  "/settings/checkout-policies": Timer,
  "/settings/reservation-rules": CalendarDays,
  "/settings/bookings": Timer,
  "/settings/escalation": ShieldAlert,
  "/settings/sports": Activity,
  "/settings/calendar-sources": CalendarDays,
  "/settings/locations": MapPin,
  "/settings/venue-mappings": MapPin,
  "/settings/kiosk-devices": Monitor,
  "/settings/audit": ShieldAlert,
  "/settings/data-export": Download,
  "/settings/database": Database,
  "/settings/app-activity": Activity,
};

export function settingsSectionIcon(href: string): SettingsIcon {
  return SETTINGS_SECTION_ICONS[href] ?? Database;
}
