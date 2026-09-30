"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlarmClockIcon,
  CalendarClockIcon,
  PackageCheckIcon,
  PackageOpenIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatTimeShort } from "@/lib/format";
import {
  buildWeekStrip,
  eventTitle,
  formatCountdownTo,
  pickContextBanner,
  pickNextUp,
  type AgendaInput,
  type ContextBanner,
  type NextUp,
  type WeekDay,
} from "@/lib/home-agenda";
import { sportLabel } from "@/lib/sports";
import { cn } from "@/lib/utils";
import type { CreateBookingContext } from "../dashboard-types";

const DISMISS_KEY = "gt.home.dismissedBanners";

function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Dismissals last for the local day; a new day brings the banner back. */
function useDismissedBanners(now: Date) {
  const day = localDayKey(now);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "null") as { day?: string; keys?: unknown } | null;
      setDismissed(stored?.day === day && Array.isArray(stored.keys) ? stored.keys.filter((k): k is string => typeof k === "string") : []);
    } catch {
      setDismissed([]);
    }
  }, [day]);

  function dismiss(key: string) {
    const next = [...dismissed, key];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify({ day, keys: next }));
    } catch {
      // Storage can be blocked; the dismissal still holds for this visit.
    }
  }

  return { dismissed, dismiss };
}

type Props = {
  input: AgendaInput;
  now: Date;
  onSelectBooking: (id: string) => void;
  onCreateBooking?: (ctx: CreateBookingContext) => void;
};

/**
 * The viewer's own day: at most one banner for what needs them now, the
 * next timed commitment with a countdown, and a seven-day strip. Hidden when
 * the viewer has nothing this week.
 */
export function PersonalAgenda({ input, now, onSelectBooking, onCreateBooking }: Props) {
  const { dismissed, dismiss } = useDismissedBanners(now);
  const candidate = useMemo(() => pickContextBanner(input, now), [input, now]);
  const banner = candidate && !dismissed.includes(candidate.key) ? candidate : null;
  const nextUp = useMemo(() => pickNextUp(input, now, candidate), [input, now, candidate]);
  const week = useMemo(() => buildWeekStrip(input, now), [input, now]);
  const hasWeek = week.some((d) => d.shifts + d.pickups + d.returns > 0);

  if (!banner && !nextUp && !hasWeek) return null;

  return (
    <section aria-label="Your day" className="mb-4 flex flex-col gap-3">
      {banner && (
        <ContextBannerCard
          banner={banner}
          onDismiss={() => dismiss(banner.key)}
          onSelectBooking={onSelectBooking}
          onCreateBooking={onCreateBooking}
        />
      )}
      {(nextUp || hasWeek) && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <NextUpCard nextUp={nextUp} now={now} onSelectBooking={onSelectBooking} />
          <WeekStrip days={week} />
        </div>
      )}
    </section>
  );
}

// ── Context banner ──────────────────────────────────────────

const bannerTone = {
  red: { rail: "border-l-[var(--wi-red)]", icon: "bg-[var(--red-bg)] text-[var(--red-text)]" },
  orange: { rail: "border-l-[var(--orange)]", icon: "bg-[var(--orange-bg)] text-[var(--orange-text)]" },
  blue: { rail: "border-l-[var(--blue)]", icon: "bg-[var(--blue-bg)] text-[var(--blue-text)]" },
} as const;

const bannerIcon = {
  overdue: TriangleAlertIcon,
  pickup: PackageOpenIcon,
  "prep-gear": PackageCheckIcon,
  "due-today": AlarmClockIcon,
} as const;

function ContextBannerCard({
  banner,
  onDismiss,
  onSelectBooking,
  onCreateBooking,
}: {
  banner: ContextBanner;
  onDismiss: () => void;
  onSelectBooking: (id: string) => void;
  onCreateBooking?: (ctx: CreateBookingContext) => void;
}) {
  const tone = bannerTone[banner.tone];
  const Icon = bannerIcon[banner.kind];
  const work = banner.eventWork;

  const action = banner.bookingId ? (
    <Button size="sm" variant="outline" className="h-10" onClick={() => onSelectBooking(banner.bookingId!)}>
      {banner.kind === "pickup" ? "View pickup" : "View checkout"}
    </Button>
  ) : work && onCreateBooking ? (
    <Button
      size="sm"
      className="h-10"
      onClick={() => onCreateBooking({
        kind: "RESERVATION",
        title: eventTitle(work),
        startsAt: work.event.startsAt,
        endsAt: work.event.endsAt,
        locationId: work.event.locationId || undefined,
        eventId: work.event.id,
        sportCode: work.event.sportCode || undefined,
      })}
    >
      Prep gear
    </Button>
  ) : null;

  return (
    <Card
      elevation="flat"
      role={banner.tone === "red" ? "alert" : "status"}
      className={cn("flex flex-row items-center gap-3 border-l-[3px] py-3 pl-[13px] pr-2 max-sm:flex-wrap", tone.rail)}
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", tone.icon)} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{banner.title}</p>
        <p className="truncate text-xs text-muted-foreground">{banner.detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:ml-[52px]">
        {action}
        <Button size="icon" variant="ghost" className="size-10" onClick={onDismiss} aria-label="Hide for today">
          <XIcon className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

// ── Next up ─────────────────────────────────────────────────

function NextUpCard({
  nextUp,
  now,
  onSelectBooking,
}: {
  nextUp: NextUp | null;
  now: Date;
  onSelectBooking: (id: string) => void;
}) {
  if (!nextUp) {
    return (
      <Card elevation="flat" className="flex min-h-[104px] flex-col justify-center gap-1 px-4 py-3">
        <span className="text-xs font-semibold text-muted-foreground">Next up</span>
        <p className="text-sm text-muted-foreground">Nothing in the next 12 hours.</p>
      </Card>
    );
  }

  const countdown = formatCountdownTo(nextUp.at, now);
  let title: string;
  let detail: string;
  let lead: string;
  if (nextUp.kind === "event") {
    const { card } = nextUp;
    const sport = card.event.sportCode ? `${sportLabel(card.event.sportCode)} ` : "";
    title = `${sport}${eventTitle(card)}`;
    lead = card.isCallTime ? "Call" : "Starts";
    const gear = card.gearBookings[0];
    detail = [
      `${lead} ${formatTimeShort(card.reportAt)}`,
      card.event.locationName,
      gear ? (gear.status === "OPEN" ? "Gear out" : `Gear pickup ${formatTimeShort(gear.startsAt)}`) : "No gear yet",
    ].filter(Boolean).join(" · ");
  } else {
    const { booking } = nextUp;
    lead = nextUp.kind === "pickup" ? "Pickup" : "Return";
    title = booking.title;
    detail = [`${lead} ${formatTimeShort(nextUp.at)}`, booking.locationName].filter(Boolean).join(" · ");
  }

  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <CalendarClockIcon className="size-3.5" aria-hidden="true" />
        Next up
        <span className="ml-auto rounded-full bg-[var(--blue-bg)] px-2 py-0.5 font-bold tabular-nums text-[var(--blue-text)]">
          {countdown}
        </span>
      </span>
      <span className="truncate text-base font-bold text-foreground">{title}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </>
  );
  const className = "flex min-h-[104px] w-full flex-col justify-center gap-1 rounded-xl px-4 py-3 text-left no-underline outline-none transition-colors hover:bg-muted/45 focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <Card elevation="flat" className="p-0">
      {nextUp.kind === "event" ? (
        <Link href={`/events/${nextUp.card.event.id}`} className={className} aria-label={`Next up ${countdown}: ${title}`}>
          {body}
        </Link>
      ) : (
        <button type="button" className={className} onClick={() => onSelectBooking(nextUp.booking.id)} aria-label={`Next up ${countdown}: ${title}`}>
          {body}
        </button>
      )}
    </Card>
  );
}

// ── Week strip ──────────────────────────────────────────────

const dotLegend = [
  { key: "shifts", label: "shift", className: "bg-[var(--wi-red)]" },
  { key: "pickups", label: "pickup", className: "bg-[var(--purple)]" },
  { key: "returns", label: "return", className: "bg-[var(--blue)]" },
] as const;

function dayLabel(day: WeekDay): string {
  const parts = dotLegend
    .filter((d) => day[d.key] > 0)
    .map((d) => `${day[d.key]} ${d.label}${day[d.key] === 1 ? "" : "s"}`);
  const name = day.date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return `${day.isToday ? "Today, " : ""}${name}: ${parts.length > 0 ? parts.join(", ") : "nothing scheduled"}`;
}

function WeekStrip({ days }: { days: WeekDay[] }) {
  return (
    <Card elevation="flat" className="flex min-h-[104px] flex-col justify-center gap-2 px-3 py-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-muted-foreground">This week</span>
        <span className="flex items-center gap-2.5 text-[11px] text-muted-foreground" aria-hidden="true">
          {dotLegend.map((d) => (
            <span key={d.key} className="inline-flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", d.className)} />
              {d.label[0]!.toUpperCase() + d.label.slice(1)}
            </span>
          ))}
        </span>
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <li
            key={day.date.toISOString()}
            aria-label={dayLabel(day)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg py-1.5",
              day.isToday ? "bg-foreground text-background" : "text-foreground",
            )}
          >
            <span className={cn("text-[11px] font-medium", day.isToday ? "text-background/70" : "text-muted-foreground")}>
              {day.date.toLocaleDateString("en-US", { weekday: "narrow" })}
            </span>
            <span className="text-sm font-bold tabular-nums">{day.date.getDate()}</span>
            <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
              {dotLegend.filter((d) => day[d.key] > 0).map((d) => (
                <span key={d.key} className={cn("size-1.5 rounded-full", d.className)} />
              ))}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
