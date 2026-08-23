"use client";

import { useMemo, useState } from "react";
import {
  getUrgency,
  formatCountdown,
  formatDateShort,
  formatDuration,
  formatDateWithDayTime,
  isStartingToday,
  formatStartsIn,
} from "@/lib/format";
import type { AssetDetail, ActiveBookingDetail, UpcomingReservation } from "./types";
import { useSaveField } from "@/components/SaveableField";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import EmptyState from "@/components/EmptyState";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Check, Clock3, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { handleAuthRedirect } from "@/lib/errors";
import { bookingStatusDisplay, bookingStatusDotClassName } from "@/lib/booking-status-display";
import { UserAvatar } from "@/components/UserAvatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ── Shared: Urgency Badge ────────────────────────────── */

export function UrgencyBadge({ startsAt, endsAt, now }: { startsAt: string; endsAt: string; now: Date }) {
  const urgency = getUrgency(startsAt, endsAt, now);
  const variant = urgency === "critical" || urgency === "overdue" ? "red" : urgency === "warning" ? "orange" : "blue";
  return <Badge variant={variant} className="mt-1">{formatCountdown(endsAt, now)}</Badge>;
}

/* ── Shared: Upcoming Reservations List ──────────────── */

export function UpcomingReservationsList({
  reservations, now, onSelectBooking,
}: {
  reservations: UpcomingReservation[];
  now: Date;
  onSelectBooking: (id: string) => void;
}) {
  return (
    <>
      {reservations.map((r) => {
        const pastStart = new Date(r.startsAt) < now;
        const startsToday = !pastStart && isStartingToday(r.startsAt, now);
        const status = bookingStatusDisplay(r.status, "RESERVATION");
        return (
          <button
            key={r.bookingId}
            className={cn(
              "flex items-center justify-between w-full text-left px-4 py-3 min-h-[44px] transition-colors hover:bg-muted/50 [&+&]:border-t [&+&]:border-border/30",
              pastStart && "border-l-[3px] border-l-[var(--red)] bg-[var(--red)]/[0.06] hover:bg-[var(--red)]/10",
              startsToday && "border-l-[3px] border-l-[var(--orange)] bg-[var(--orange)]/[0.04] hover:bg-[var(--orange)]/[0.08]",
            )}
            onClick={() => onSelectBooking(r.bookingId)}
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium truncate">{r.title}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {r.requesterName} {"\u00b7"}{" "}
                {pastStart ? (
                  <>{formatDateShort(r.startsAt)} <Badge variant="red" size="sm">{formatStartsIn(r.startsAt, now)}</Badge></>
                ) : startsToday ? (
                  <Badge variant="orange" size="sm">{formatStartsIn(r.startsAt, now)}</Badge>
                ) : (
                  <>{formatDateShort(r.startsAt)} {"\u2013"} {formatDateShort(r.endsAt)}</>
                )}
              </span>
            </div>
            <Badge variant={status.variant} size="sm">
              {status.label}
            </Badge>
          </button>
        );
      })}
    </>
  );
}

/* ── Shared: Active Booking Card ─────────────────────── */

export function ActiveBookingCard({
  booking, kind, now, onSelectBooking,
}: {
  booking: ActiveBookingDetail;
  kind: string;
  now: Date;
  onSelectBooking: (id: string) => void;
}) {
  const isPendingPickup = kind === "CHECKOUT" && booking.status === "PENDING_PICKUP";
  const title = kind === "CHECKOUT"
    ? isPendingPickup ? "Pending Pickup" : "Active Checkout"
    : "Active Reservation";
  const activityLabel = kind === "CHECKOUT"
    ? isPendingPickup ? "Pending pickup" : "Checked out"
    : "Reserved";

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="p-0 py-1">
        <button
          className="flex flex-col w-full text-left px-5 py-2 pb-3 transition-colors hover:bg-muted/50"
          onClick={() => onSelectBooking(booking.id)}
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold">{booking.title}</span>
            <span className="text-sm">
              {activityLabel} by {booking.requesterName}
            </span>
            <UrgencyBadge startsAt={booking.startsAt} endsAt={booking.endsAt} now={now} />
          </div>
        </button>
      </CardContent>
    </Card>
  );
}

/* ── Shared: Recent Booking Context ────────────────────── */

function getUniqueBookingHistory(history: AssetDetail["history"]) {
  const seen = new Set<string>();
  return history
    .filter((entry) => {
      if (seen.has(entry.booking.id)) return false;
      seen.add(entry.booking.id);
      return true;
    })
    .sort((a, b) => new Date(b.booking.endsAt).getTime() - new Date(a.booking.endsAt).getTime());
}

function formatBookingRange(start: ReturnType<typeof formatDateWithDayTime>, end: ReturnType<typeof formatDateWithDayTime>) {
  if (start.date === end.date) return `${start.date} / ${start.dayTime} to ${end.dayTime}`;
  return `${start.date} to ${end.date}`;
}

export function PastBookingsPreview({
  history,
  now,
  onSelectBooking,
  limit = 4,
}: {
  history: AssetDetail["history"];
  now: Date;
  onSelectBooking: (id: string) => void;
  limit?: number;
}) {
  const pastEntries = useMemo(
    () => getUniqueBookingHistory(history)
      .filter((entry) => bookingOccupiesSchedule(entry.booking.status))
      .filter((entry) => new Date(entry.booking.endsAt) < now)
      .slice(0, limit),
    [history, limit, now],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Past Bookings</CardTitle>
        {pastEntries.length > 0 && <Badge variant="gray" size="sm">{pastEntries.length}</Badge>}
      </CardHeader>
      {pastEntries.length === 0 ? (
        <EmptyState
          inline
          icon="calendar"
          title="No past bookings yet"
          description="Completed checkouts and reservations will appear here for quick context."
        />
      ) : (
        <CardContent className="p-0 py-1">
          {pastEntries.map((entry) => {
            const booking = entry.booking;
            const from = formatDateWithDayTime(booking.startsAt);
            const to = formatDateWithDayTime(booking.endsAt);
            const status = bookingStatusDisplay(booking.status, booking.kind);
            const range = formatBookingRange(from, to);
            return (
              <button
                key={entry.id}
                type="button"
                className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] [&+&]:border-t [&+&]:border-border/30"
                onClick={() => onSelectBooking(booking.id)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar
                    name={booking.requester.name}
                    avatarUrl={booking.requester.avatarUrl}
                    size="sm"
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{booking.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{booking.requester.name}</span>
                      <span aria-hidden="true">/</span>
                      <span>{range}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={booking.kind === "CHECKOUT" ? "blue" : "purple"} size="sm">
                    {booking.kind === "CHECKOUT" ? "Checkout" : "Reservation"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{status.label}</span>
                </div>
              </button>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

/* ── Saveable Toggle Row (flat style matching SaveableField layout) ── */

function SaveableToggle({
  label,
  help,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => Promise<void>;
}) {
  const saveField = useSaveField(async () => {
    await onToggle();
  });

  return (
    <div className="group/row flex items-center gap-3 rounded-md px-3 py-2.5 min-h-[44px] transition-colors hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          {saveField.status === "saving" && <Spinner className="size-3" />}
          {saveField.status === "saved" && <Check className="size-3 text-[var(--green-text)]" />}
          {saveField.status === "error" && <X className="size-3 text-destructive" />}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 m-0">{help}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={() => saveField.save("")}
        disabled={saveField.status === "saving" || disabled}
        className="shrink-0"
      />
    </div>
  );
}

/* ── Settings Card ───────────────────────────────────────── */

function SettingsCard({ asset, canEdit, onRefresh }: { asset: AssetDetail; canEdit: boolean; onRefresh: () => void }) {
  const toggles = [
    { field: "availableForCheckout", label: "Check-out eligible", value: asset.availableForCheckout, help: "Can leave inventory through a checkout workflow." },
    { field: "availableForReservation", label: "Reservation eligible", value: asset.availableForReservation, help: "Can be reserved for future events or requests." },
    { field: "availableForCustody", label: "Custody eligible", value: asset.availableForCustody, help: "Can be assigned into a user's custody outside short-term bookings." },
  ];
  const enabledCount = toggles.filter((toggle) => toggle.value).length;

  return (
    <Card className="border-border/40 shadow-none">
      <CardHeader>
        <div>
          <CardTitle>Workflow Eligibility</CardTitle>
          <CardDescription>Policy switches for where this item is allowed to appear. Current status stays derived from real bookings.</CardDescription>
        </div>
        <Badge variant={enabledCount === 0 ? "red" : enabledCount === toggles.length ? "green" : "orange"} size="sm">
          {enabledCount}/{toggles.length} enabled
        </Badge>
      </CardHeader>
      {!canEdit && (
        <div className="mx-4 mb-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Read-only view. Admins and staff can update eligibility.
        </div>
      )}
      <div className="py-1 divide-y divide-border/30">
        {toggles.map((t) => (
          <SaveableToggle
            key={t.field}
            label={t.label}
            help={t.help}
            checked={t.value}
            disabled={!canEdit}
            onToggle={async () => {
              const res = await fetch(`/api/assets/${asset.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [t.field]: !t.value }),
              });
              if (handleAuthRedirect(res)) return;
              if (!res.ok) throw new Error();
              onRefresh();
            }}
          />
        ))}
      </div>
    </Card>
  );
}

/* ── Operational Overview (Info tab dashboard cards) ─────── */

export function OperationalOverview({
  asset,
  now,
  onSelectBooking,
}: {
  asset: AssetDetail;
  now: Date;
  onSelectBooking: (id: string) => void;
}) {
  const b = asset.activeBooking;
  const reservations = asset.upcomingReservations;

  return (
    <div className="flex flex-col gap-4">
      {/* Active Checkout / Reservation Card (always visible) */}
      {b ? (
        <ActiveBookingCard booking={b} kind={b.kind} now={now} onSelectBooking={onSelectBooking} />
      ) : (
        <Card>
          <CardHeader><CardTitle>Active Checkout</CardTitle></CardHeader>
          <EmptyState
            inline
            icon="check"
            title="Not currently checked out"
            description="This item is available unless another active reservation is shown below."
          />
        </Card>
      )}

      {/* Upcoming Reservations Card (always visible) */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Reservations</CardTitle>
          {reservations.length > 0 && (
            <Badge variant="gray" size="sm">{reservations.length}</Badge>
          )}
        </CardHeader>
        {reservations.length > 0 ? (
          <CardContent className="p-0 py-1">
            <UpcomingReservationsList reservations={reservations} now={now} onSelectBooking={onSelectBooking} />
          </CardContent>
        ) : (
          <EmptyState
            inline
            icon="calendar"
            title="No upcoming reservations"
            description="Future reservations for this item will appear here."
          />
        )}
      </Card>

      <PastBookingsPreview
        history={asset.history}
        now={now}
        onSelectBooking={onSelectBooking}
      />
    </div>
  );
}

/* ── Booking Schedule Occupancy ──────────────────────────────── */

function bookingOccupiesSchedule(status: string) {
  return status !== "CANCELLED";
}

/* ── Booking Kind Tab ───────────────────────────────────── */

export function BookingKindTab({
  kind, history, asset, now, onSelectBooking,
}: {
  kind: "CHECKOUT" | "RESERVATION";
  history: AssetDetail["history"];
  asset: AssetDetail;
  now: Date;
  onSelectBooking: (id: string) => void;
}) {
  const label = kind === "CHECKOUT" ? "checkouts" : "reservations";

  // Deduplicate and filter bookings of this kind, sorted newest first
  const allEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: AssetDetail["history"] = [];
    for (const e of history) {
      if (e.booking.kind === kind && !seen.has(e.booking.id)) {
        seen.add(e.booking.id);
        entries.push(e);
      }
    }
    entries.sort((a, b) => new Date(b.booking.startsAt).getTime() - new Date(a.booking.startsAt).getTime());
    return entries;
  }, [history, kind]);

  const activeBooking = asset.activeBooking;
  const showActiveCard = activeBooking && activeBooking.kind === kind;
  const showUpcoming = kind === "RESERVATION" && asset.upcomingReservations.length > 0;

  return (
    <div className="flex flex-col gap-4 mt-3.5">
      {/* Active booking card at top of matching tab */}
      {showActiveCard && activeBooking && (
        <ActiveBookingCard booking={activeBooking} kind={kind} now={now} onSelectBooking={onSelectBooking} />
      )}

      {/* Upcoming reservations at top of Reservations tab */}
      {showUpcoming && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Reservations</CardTitle>
            <Badge variant="gray" size="sm">{asset.upcomingReservations.length}</Badge>
          </CardHeader>
          <CardContent className="p-0 py-1">
            <UpcomingReservationsList reservations={asset.upcomingReservations} now={now} onSelectBooking={onSelectBooking} />
          </CardContent>
        </Card>
      )}

      {/* All bookings — flat table */}
      <Card>
        <CardHeader>
          <CardTitle>{kind === "CHECKOUT" ? "Checkouts" : "Reservations"}</CardTitle>
          {allEntries.length > 0 && (
            <Badge variant="gray" size="sm">{allEntries.length}</Badge>
          )}
        </CardHeader>
        {allEntries.length === 0 ? (
          <EmptyState
            inline
            icon="calendar"
            title={`No ${label} for this item`}
            description="Matching booking history will appear here after this item is used."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allEntries.map((entry) => {
                const b = entry.booking;
                const from = formatDateWithDayTime(b.startsAt);
                const to = formatDateWithDayTime(b.endsAt);
                const dur = formatDuration(b.startsAt, b.endsAt);
                const st = bookingStatusDisplay(b.status, b.kind);
                return (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
                    tabIndex={0}
                    aria-label={`Open booking ${b.title}`}
                    onClick={() => onSelectBooking(b.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectBooking(b.id); } }}
                  >
                    <TableCell>
                      <div className="font-medium text-primary">{b.title}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-block size-2 rounded-full ${bookingStatusDotClassName(st.variant)}`} />
                        <span className="text-xs text-muted-foreground">{st.label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{from.date}</div>
                      <div className="text-xs text-muted-foreground">{from.dayTime}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{to.date}</div>
                      <div className="text-xs text-muted-foreground">{to.dayTime}</div>
                    </TableCell>
                    <TableCell className="text-sm">{dur}</TableCell>
                    <TableCell className="text-sm">{b.requester.name}</TableCell>
                    <TableCell className="text-sm">{b.location.name}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ── Calendar Tab ───────────────────────────────────────── */

export function CalendarTab({ asset, onSelectBooking }: { asset: AssetDetail; onSelectBooking: (id: string) => void }) {
  const [viewDate, setViewDate] = useState(() => new Date());

  const allBookings = useMemo(
    () => asset.history
      .map((e) => e.booking)
      .filter((booking) => bookingOccupiesSchedule(booking.status)),
    [asset.history]
  );

  // Deduplicate bookings by id (same booking can appear multiple times from history)
  const uniqueBookings = useMemo(() => {
    const seen = new Set<string>();
    return allBookings.filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
  }, [allBookings]);

  // Build calendar grid for current month
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();

  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  type CalendarBooking = (typeof uniqueBookings)[number];

  const monthBookings = useMemo(() => {
    const monthStart = new Date(year, month, 1).getTime();
    const monthEnd = new Date(year, month + 1, 1).getTime();
    return uniqueBookings
      .filter((b) => {
        const startsAt = new Date(b.startsAt).getTime();
        const endsAt = new Date(b.endsAt).getTime();
        return startsAt < monthEnd && endsAt > monthStart;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [uniqueBookings, year, month]);

  const today = new Date();
  const isToday = (d: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)); }
  function goToday() { setViewDate(new Date()); }

  function ScheduleAgendaRow({ booking }: { booking: CalendarBooking }) {
    const starts = formatDateWithDayTime(booking.startsAt);
    const ends = formatDateWithDayTime(booking.endsAt);
    const status = bookingStatusDisplay(booking.status, booking.kind);
    return (
      <button
        key={booking.id}
        type="button"
        className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
        onClick={() => onSelectBooking(booking.id)}
      >
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar
            name={booking.requester.name}
            avatarUrl={booking.requester.avatarUrl}
            size="sm"
            className="shrink-0"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{booking.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <span>{booking.requester.name}</span>
              <span aria-hidden="true">/</span>
              <span>{formatBookingRange(starts, ends)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={booking.kind === "CHECKOUT" ? "blue" : "purple"} size="sm">
            {booking.kind === "CHECKOUT" ? "Checkout" : "Reservation"}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{status.label}</span>
        </div>
      </button>
    );
  }

  // Build grid cells: padding + days
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < startPad; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: null });

  const weeks: Array<Array<{ day: number | null }>> = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  type WeekMarker = {
    booking: CalendarBooking;
    startCol: number;
    endCol: number;
    startsInWeek: boolean;
    endsInWeek: boolean;
    lane: number;
  };

  function getWeekMarkers(week: Array<{ day: number | null }>): WeekMarker[] {
    const days = week.map((cell) => cell.day).filter((day): day is number => day !== null);
    if (days.length === 0) return [];

    const firstWeekDay = days[0]!;
    const lastWeekDay = days[days.length - 1]!;
    const weekStart = new Date(year, month, firstWeekDay);
    const weekEnd = new Date(year, month, lastWeekDay + 1);

    return monthBookings
      .filter((booking) => {
        const startsAt = new Date(booking.startsAt);
        const endsAt = new Date(booking.endsAt);
        return startsAt < weekEnd && endsAt > weekStart;
      })
      .map((booking, lane) => {
        const startsAt = new Date(booking.startsAt);
        const endsAt = new Date(booking.endsAt);
        const startDay = startsAt.getFullYear() === year && startsAt.getMonth() === month
          ? startsAt.getDate()
          : firstWeekDay;
        const endDay = endsAt.getFullYear() === year && endsAt.getMonth() === month
          ? endsAt.getDate()
          : lastWeekDay;
        const clampedStartDay = Math.max(startDay, firstWeekDay);
        const clampedEndDay = Math.min(endDay, lastWeekDay);
        const startCol = week.findIndex((cell) => cell.day === clampedStartDay) + 1;
        const endCol = week.findIndex((cell) => cell.day === clampedEndDay) + 1;

        return {
          booking,
          startCol,
          endCol,
          startsInWeek: startsAt >= weekStart && startsAt < weekEnd,
          endsInWeek: endsAt > weekStart && endsAt <= weekEnd,
          lane,
        };
      })
      .filter((marker) => marker.startCol > 0 && marker.endCol > 0)
      .slice(0, 3);
  }

  return (
    <div className="mt-3.5">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-10" onClick={prevMonth}>&lsaquo;</Button>
            <CardTitle className="min-w-40 text-center">{monthLabel}</CardTitle>
            <Button variant="outline" className="h-10" onClick={nextMonth}>{"\u203a"}</Button>
          </div>
          <Button variant="ghost" className="h-10" onClick={goToday}>Today</Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="overflow-hidden rounded-md border border-border/40 md:block max-md:hidden">
            <div className="grid grid-cols-7 gap-px bg-border">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="bg-background py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
              ))}
            </div>
            <div className="divide-y divide-border/40 bg-border">
              {weeks.map((week, weekIndex) => {
                const weekMarkers = getWeekMarkers(week);
                return (
                  <div key={weekIndex} className="relative grid grid-cols-7 gap-px">
                    {week.map((cell, dayIndex) => (
                      <div
                        key={`${weekIndex}-${dayIndex}`}
                        className={cn(
                          cell.day === null
                            ? "min-h-24 bg-muted/20"
                            : "min-h-24 bg-card p-1",
                          cell.day && isToday(cell.day) && "bg-primary/5",
                        )}
                      >
                        {cell.day && (
                          <span
                            className={cn(
                              "relative z-10 inline-flex size-[22px] items-center justify-center text-xs font-medium text-muted-foreground",
                              isToday(cell.day) && "rounded-full bg-destructive text-destructive-foreground",
                            )}
                          >
                            {cell.day}
                          </span>
                        )}
                      </div>
                    ))}
                    <div
                      className="pointer-events-none absolute inset-x-0 top-9 grid grid-cols-7 px-1"
                      style={{ gridTemplateRows: `repeat(${Math.max(weekMarkers.length, 1)}, 22px)` }}
                    >
                      {weekMarkers.map((marker) => (
                        <button
                          key={`${marker.booking.id}-${weekIndex}`}
                          type="button"
                          className={cn(
                            "pointer-events-auto my-px min-w-0 truncate px-2.5 text-left text-[11px] font-medium leading-5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
                            marker.booking.kind === "CHECKOUT"
                              ? "bg-[var(--blue)]/14 text-[var(--blue-text)] hover:bg-[var(--blue)]/24"
                              : "bg-[var(--purple)]/14 text-[var(--purple-text)] hover:bg-[var(--purple)]/24",
                            marker.startsInWeek ? "rounded-l-full" : "rounded-l-none",
                            marker.endsInWeek ? "rounded-r-full" : "rounded-r-none",
                          )}
                          style={{
                            gridColumn: `${marker.startCol} / ${marker.endCol + 1}`,
                            gridRow: marker.lane + 1,
                          }}
                          onClick={() => onSelectBooking(marker.booking.id)}
                          title={`${marker.booking.kind === "CHECKOUT" ? "Checkout" : "Reservation"}: ${marker.booking.title} (${marker.booking.requester.name})`}
                          aria-label={`Open ${marker.booking.title}`}
                        >
                          {marker.startsInWeek ? marker.booking.title : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border/40">
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/25 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Month Agenda</div>
                <div className="text-xs text-muted-foreground">Bookings touching {monthLabel}</div>
              </div>
              {monthBookings.length > 0 && <Badge variant="gray" size="sm">{monthBookings.length}</Badge>}
            </div>
            {monthBookings.length === 0 ? (
              <EmptyState
                inline
                icon="calendar"
                title={`No bookings in ${monthLabel}`}
                description="Use the month controls to review other booking windows."
              />
            ) : (
              <div className="divide-y divide-border/30">
                {monthBookings.map((booking) => (
                  <ScheduleAgendaRow key={booking.id} booking={booking} />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-3 justify-center">
        <div className="flex items-center gap-1.5 text-sm">
          <Badge variant="blue" size="sm">Checkout</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <Badge variant="purple" size="sm">Reservation</Badge>
        </div>
      </div>
    </div>
  );
}

/* ── Merged Bookings Tab ──────────────────────────────────── */

type BookingFilter = "all" | "checkouts" | "reservations";

export function BookingsTab({
  history, asset, now, onSelectBooking,
}: {
  history: AssetDetail["history"];
  asset: AssetDetail;
  now: Date;
  onSelectBooking: (id: string) => void;
}) {
  const [filter, setFilter] = useState<BookingFilter>("all");

  const allEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: AssetDetail["history"] = [];
    for (const e of history) {
      if (!seen.has(e.booking.id)) {
        seen.add(e.booking.id);
        if (filter === "all" || (filter === "checkouts" && e.booking.kind === "CHECKOUT") || (filter === "reservations" && e.booking.kind === "RESERVATION")) {
          entries.push(e);
        }
      }
    }
    entries.sort((a, b) => new Date(b.booking.startsAt).getTime() - new Date(a.booking.startsAt).getTime());
    return entries;
  }, [history, filter]);

  const activeBooking = asset.activeBooking;
  const showUpcoming = asset.upcomingReservations.length > 0;

  return (
    <div className="flex flex-col gap-4 mt-3.5">
      {/* Active booking card */}
      {activeBooking && (
        <ActiveBookingCard booking={activeBooking} kind={activeBooking.kind} now={now} onSelectBooking={onSelectBooking} />
      )}

      {/* Upcoming reservations */}
      {showUpcoming && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Reservations</CardTitle>
            <Badge variant="gray" size="sm">{asset.upcomingReservations.length}</Badge>
          </CardHeader>
          <CardContent className="p-0 py-1">
            <UpcomingReservationsList reservations={asset.upcomingReservations} now={now} onSelectBooking={onSelectBooking} />
          </CardContent>
        </Card>
      )}

      {/* All bookings with filter toggle */}
      <Card>
        <CardHeader>
          <CardTitle>Booking History</CardTitle>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => value && setFilter(value as BookingFilter)}
            className="rounded-md border bg-background p-0.5"
          >
            <ToggleGroupItem value="all" className="h-8 px-3 text-xs">All</ToggleGroupItem>
            <ToggleGroupItem value="checkouts" className="h-8 px-3 text-xs">Checkouts</ToggleGroupItem>
            <ToggleGroupItem value="reservations" className="h-8 px-3 text-xs">Reservations</ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        {allEntries.length === 0 ? (
          <EmptyState
            inline
            icon="calendar"
            title={`${filter === "checkouts" ? "No checkouts" : filter === "reservations" ? "No reservations" : "No bookings"} for this item`}
            description="Matching booking history will appear here after this item is used."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allEntries.map((entry) => {
                const b = entry.booking;
                const from = formatDateWithDayTime(b.startsAt);
                const to = formatDateWithDayTime(b.endsAt);
                const dur = formatDuration(b.startsAt, b.endsAt);
                const st = bookingStatusDisplay(b.status, b.kind);
                return (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
                    tabIndex={0}
                    aria-label={`Open booking ${b.title}`}
                    onClick={() => onSelectBooking(b.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectBooking(b.id); } }}
                  >
                    <TableCell>
                      <div className="font-medium text-primary">{b.title}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-block size-2 rounded-full ${bookingStatusDotClassName(st.variant)}`} />
                        <span className="text-xs text-muted-foreground">{st.label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={b.kind === "CHECKOUT" ? "blue" : "purple"} size="sm">
                        {b.kind === "CHECKOUT" ? "CO" : "Res"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{from.date}</div>
                      <div className="text-xs text-muted-foreground">{from.dayTime}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{to.date}</div>
                      <div className="text-xs text-muted-foreground">{to.dayTime}</div>
                    </TableCell>
                    <TableCell className="text-sm">{dur}</TableCell>
                    <TableCell className="text-sm">{b.requester.name}</TableCell>
                    <TableCell className="text-sm">{b.location.name}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ── Settings Tab ──────────────────────────────────────────── */

export function SettingsTab({ asset, canEdit, onRefresh }: { asset: AssetDetail; canEdit: boolean; onRefresh: () => void }) {
  return (
    <div className="mt-3.5 max-w-2xl">
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border/40 bg-card px-3 py-2 shadow-none">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Status Source
          </div>
          <div className="mt-1 text-sm font-medium">Derived</div>
        </div>
        <div className="rounded-md border border-border/40 bg-card px-3 py-2 shadow-none">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden="true" />
            Updated
          </div>
          <div className="mt-1 text-sm font-medium">{formatDateShort(asset.updatedAt)}</div>
        </div>
        <div className="rounded-md border border-border/40 bg-card px-3 py-2 shadow-none">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Policy</div>
          <div className="mt-1 text-sm font-medium">{canEdit ? "Editable" : "Read only"}</div>
        </div>
      </div>
      <SettingsCard asset={asset} canEdit={canEdit} onRefresh={onRefresh} />
    </div>
  );
}
