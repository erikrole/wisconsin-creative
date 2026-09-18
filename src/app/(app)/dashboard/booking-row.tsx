"use client";

import type { ReactNode } from "react";
import { Clock3Icon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";
import { formatEventDateTime, formatOperationalDateTime, isDueToday } from "@/lib/format";
import type { ItemThumb } from "../dashboard-types";

type DashboardBookingRowItem = {
  id: string;
  title: string;
  requesterName: string;
  requesterAvatarUrl: string | null;
  startsAt: string;
  endsAt: string;
  itemCount: number;
  isOverdue?: boolean;
  items: ItemThumb[];
};

type Accent = "owned" | "checkout" | "reservation" | "due" | "overdue" | "pending-pickup" | "pending-pickup-late";

type Props = {
  booking: DashboardBookingRowItem;
  now: Date;
  accent: Accent;
  showDueBadge?: boolean;
  /** When set, renders a pickup badge using booking.startsAt instead of the due badge. */
  showPickupBadge?: boolean;
  actions?: ReactNode;
  onSelectBooking: (id: string) => void;
};

const accentClasses: Record<Accent, string> = {
  owned: "border-l-primary hover:bg-muted/45",
  checkout: "border-l-[var(--blue)] hover:bg-muted/45",
  reservation: "border-l-[var(--purple)] hover:bg-muted/45",
  due: "border-l-[var(--orange)] hover:bg-muted/45",
  overdue: "border-l-[var(--wi-red)] hover:bg-muted/45",
  "pending-pickup": "border-l-[var(--orange)] hover:bg-muted/45",
  "pending-pickup-late": "border-l-[var(--orange)] hover:bg-muted/45",
};

export function dashboardBookingAccent(
  booking: { isOverdue?: boolean; endsAt: string },
  now: Date,
  fallback: Accent,
): Accent {
  if (booking.isOverdue) return "overdue";
  if (isDueToday(booking.endsAt, now)) return "due";
  return fallback;
}

export function DashboardBookingRow({
  booking,
  now,
  accent,
  showDueBadge = false,
  showPickupBadge = false,
  actions,
  onSelectBooking,
}: Props) {
  const pickupIsLate = showPickupBadge && new Date(booking.startsAt).getTime() < now.getTime();
  const timingPrefix = showPickupBadge
    ? (pickupIsLate ? "Pickup was due" : "Pickup")
    : "Due";
  const timingDateTime = formatOperationalDateTime(
    showPickupBadge ? booking.startsAt : booking.endsAt,
    now,
    { month: "short" },
  );
  const timingTone = booking.isOverdue
    ? "text-[var(--wi-red)]"
    : isDueToday(booking.endsAt, now) || pickupIsLate
      ? "text-[var(--orange)]"
      : "text-muted-foreground";

  return (
    <div
      className={cn(
        "group flex min-h-16 items-center gap-2.5 border-l-[3px] px-4 py-2.5 pl-[13px] transition-colors [&+&]:border-t [&+&]:border-t-border/40",
        accentClasses[accent],
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 self-stretch items-center gap-3 rounded-sm border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => onSelectBooking(booking.id)}
        aria-label={`Open ${booking.title}`}
      >
        <UserAvatar
          name={booking.requesterName}
          avatarUrl={booking.requesterAvatarUrl}
          size="md"
          className="ring-1 ring-foreground/10"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[0.9375rem] font-bold leading-tight text-foreground">
            {booking.title}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-snug text-muted-foreground">
            <span className="truncate">{booking.requesterName}</span>
            <span className="text-muted-foreground/50" aria-hidden="true">·</span>
            <span className="shrink-0">
              {booking.itemCount} item{booking.itemCount !== 1 ? "s" : ""}
            </span>
          </span>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {actions}
        {(showDueBadge || showPickupBadge) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn("inline-flex cursor-default items-center gap-1.5 whitespace-nowrap text-xs tabular-nums sm:text-sm", timingTone)}>
                <Clock3Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="font-medium">{timingPrefix}</span>
                <span className="font-bold">{timingDateTime}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{formatEventDateTime(booking.startsAt, booking.endsAt)}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
