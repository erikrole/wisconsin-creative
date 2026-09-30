"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDayLabel, formatTimeShort } from "@/lib/format";
import { buildEventCards, eventTitle, type EventCard } from "@/lib/home-agenda";
import { sportLabel } from "@/lib/sports";
import { cn } from "@/lib/utils";
import { GearAvatarStack } from "./dashboard-avatars";
import { DashboardFooterLink, DashboardSectionHeader } from "./section-header";
import type { BookingSummary, CreateBookingContext, MyEventWork } from "../dashboard-types";

const MAX_CARDS = 5;

const siteRail: Record<string, string> = {
  HOME: "border-l-[var(--wi-red)]",
  AWAY: "border-l-[var(--blue)]",
  NEUTRAL: "border-l-[var(--purple)]",
};

type Props = {
  eventWork: MyEventWork[];
  now: Date;
  onSelectBooking: (id: string) => void;
  onCreateBooking?: (ctx: CreateBookingContext) => void;
};

/**
 * One card per event the viewer works: when to report, where, their role,
 * and the gear for it in the same place. Replaces the old My shifts rows,
 * which left the matching reservation as a separate row elsewhere.
 */
export function MyEventsCard({ eventWork, now, onSelectBooking, onCreateBooking }: Props) {
  const cards = buildEventCards({ myCheckouts: [], myReservations: [], myPendingPickups: [], myEventWork: eventWork });
  if (cards.length === 0) return null;

  return (
    <Card elevation="flat">
      <DashboardSectionHeader title="My events" href="/schedule" count={cards.length} />
      <CardContent className="p-0">
        {cards.slice(0, MAX_CARDS).map((card) => (
          <EventRow
            key={card.id}
            card={card}
            now={now}
            onSelectBooking={onSelectBooking}
            onCreateBooking={onCreateBooking}
          />
        ))}
        {cards.length > MAX_CARDS && (
          <DashboardFooterLink href="/schedule">{cards.length - MAX_CARDS} more in Schedule &rarr;</DashboardFooterLink>
        )}
      </CardContent>
    </Card>
  );
}

function gearLine(booking: BookingSummary, now: Date): { label: string; variant: "blue" | "purple" | "orange" | "gray" } {
  if (booking.status === "OPEN") return { label: "Gear out", variant: "blue" };
  if (booking.status === "DRAFT") return { label: "Draft", variant: "gray" };
  const start = new Date(booking.startsAt);
  if (start <= now) return { label: "Ready for pickup", variant: "orange" };
  return { label: `Pickup ${formatDayLabel(booking.startsAt, now) === "Today" ? "" : `${formatDayLabel(booking.startsAt, now)} `}${formatTimeShort(booking.startsAt)}`, variant: "purple" };
}

function EventRow({
  card,
  now,
  onSelectBooking,
  onCreateBooking,
}: {
  card: EventCard;
  now: Date;
  onSelectBooking: (id: string) => void;
  onCreateBooking?: (ctx: CreateBookingContext) => void;
}) {
  const title = eventTitle(card);
  const sport = card.event.sportCode ? sportLabel(card.event.sportCode) : null;
  const day = formatDayLabel(card.hasReportTime ? card.reportAt : card.event.startsAt, now, !card.hasReportTime && card.event.allDay);
  // Only Student cards name a call time; Staff cards show the event start.
  const report = !card.hasReportTime
    ? "All day"
    : card.isCallTime
      ? `Call ${formatTimeShort(card.reportAt)}`
      : `Starts ${formatTimeShort(card.reportAt)}`;
  const kickoff = card.isCallTime ? `Starts ${formatTimeShort(card.event.startsAt)}` : null;
  const gear = card.gearBookings[0] as BookingSummary | undefined;
  const gearState = gear ? gearLine(gear, now) : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-l-[3px] px-4 py-3 pl-[13px] [&+&]:border-t [&+&]:border-t-border/40",
        siteRail[card.event.site ?? ""] ?? "border-l-border",
      )}
    >
      <Link
        href={`/events/${card.event.id}`}
        className="flex min-w-0 flex-col gap-0.5 rounded-sm no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={`Open ${sport ? `${sport} ` : ""}${title}`}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[0.9375rem] font-bold text-foreground">
            {sport && <span className="mr-1">{sport}</span>}
            <span className="font-normal text-muted-foreground">{title}</span>
          </span>
          <span className="ml-auto shrink-0 text-xs font-semibold text-foreground tabular-nums">{day}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {[report, kickoff, card.event.locationName, card.shift.area ? titleCase(card.shift.area) : null].filter(Boolean).join(" · ")}
        </span>
        {card.shift.callNote && (
          <span className="line-clamp-2 text-xs text-muted-foreground/90">“{card.shift.callNote}”</span>
        )}
      </Link>

      <div className="flex min-h-10 items-center gap-2">
        {gear && gearState ? (
          <button
            type="button"
            onClick={() => onSelectBooking(gear.id)}
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md bg-muted/50 px-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`Open gear for ${title}: ${gearState.label}`}
          >
            <GearAvatarStack items={gear.items} totalCount={gear.itemCount} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {gear.itemCount} item{gear.itemCount === 1 ? "" : "s"}
              {card.gearBookings.length > 1 && ` · +${card.gearBookings.length - 1} more booking${card.gearBookings.length === 2 ? "" : "s"}`}
            </span>
            <Badge variant={gearState.variant}>{gearState.label}</Badge>
          </button>
        ) : (
          <>
            <span className="flex-1 text-xs text-muted-foreground">No gear reserved yet</span>
            {onCreateBooking && (
              <Button
                variant="outline"
                size="sm"
                className="h-10"
                onClick={() => onCreateBooking({
                  kind: "RESERVATION",
                  title,
                  startsAt: card.event.startsAt,
                  endsAt: card.event.endsAt,
                  locationId: card.event.locationId || undefined,
                  eventId: card.event.id,
                  sportCode: card.event.sportCode || undefined,
                })}
              >
                Prep gear
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Shift areas are enum names: `LIVE_PRODUCTION` reads as "Live Production". */
function titleCase(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}
