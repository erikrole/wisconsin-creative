import type { ComponentType } from "react";
import {
  AlarmClock,
  AlarmClockCheck,
  Aperture,
  ArrowLeftRight,
  AudioLines,
  BadgeCheck,
  BatteryCharging,
  BatteryLow,
  Binoculars,
  Boxes,
  BusFront,
  Cable,
  Camera,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clapperboard,
  Clock3,
  CloudRain,
  Combine,
  Dumbbell,
  Flame,
  Focus,
  Gift,
  HardDrive,
  Handshake,
  LayoutGrid,
  LifeBuoy,
  Lightbulb,
  MoonStar,
  PackageCheck,
  PackageOpen,
  QrCode,
  Repeat2,
  ScanLine,
  ScanSearch,
  ShieldCheck,
  ShoppingCart,
  Shuffle,
  Sparkles,
  Sunrise,
  Sunset,
  Ticket,
  Timer,
  Trophy,
  Truck,
  UserCheck,
  Warehouse,
} from "lucide-react";

/**
 * The one web badge icon map, shared by every surface that draws a badge.
 *
 * iOS learned this the hard way: the badge page and the reward celebration each
 * carried their own Lucide table, twelve catalog icons resolved differently
 * between them, and a badge changed picture between the popup that announced it
 * and the shelf it landed on. The web carried the same two copies. This is the
 * single table, guarded by `tests/badges-display.test.ts`.
 */
const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  AlarmClock,
  AlarmClockCheck,
  Aperture,
  ArrowLeftRight,
  AudioLines,
  BadgeCheck,
  BatteryCharging,
  BatteryLow,
  Binoculars,
  Boxes,
  BusFront,
  Cable,
  Camera,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clapperboard,
  Clock3,
  CloudRain,
  Combine,
  Dumbbell,
  Flame,
  Focus,
  Gift,
  HardDrive,
  Handshake,
  LayoutGrid,
  LifeBuoy,
  Lightbulb,
  MoonStar,
  PackageCheck,
  PackageOpen,
  QrCode,
  Repeat2,
  ScanLine,
  ScanSearch,
  ShieldCheck,
  ShoppingCart,
  Shuffle,
  Sparkles,
  Sunrise,
  Sunset,
  Ticket,
  Timer,
  Trophy,
  Truck,
  UserCheck,
  Warehouse,
};

/** The glyph for a catalog icon name, falling back to the generic trophy. */
export function badgeIcon(icon: string | null | undefined): ComponentType<{ className?: string }> {
  return (icon ? iconMap[icon] : undefined) ?? Trophy;
}

/** Every icon name this map answers. Exported for the coverage test. */
export const badgeIconNames = Object.keys(iconMap);

/** The facts that decide how a badge is drawn. */
export type BadgeArtworkInput = {
  category: string;
  kind?: string | null;
  trigger?: string | null;
  source?: string | null;
};

export function isManualBadge(badge: BadgeArtworkInput): boolean {
  return badge.source === "MANUAL" || (badge.kind === "RULE" && badge.trigger === "manual");
}
