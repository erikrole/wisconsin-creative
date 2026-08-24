"use client";

import Link from "next/link";
import { AnimatePresence } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardCheckIcon, CalendarCheckIcon } from "lucide-react";
import { ScaleIn } from "@/components/ui/motion";
import { formatDayLabel, formatRelativeTime } from "@/lib/format";
import { sportLabel } from "@/lib/sports";
import { formatCallTime, isFullDayBoundaryWindow } from "@/lib/shift-call-windows";
import { GearAvatarStack } from "./dashboard-avatars";
import { DashboardBookingRow, dashboardBookingAccent } from "./booking-row";
import { DashboardFooterLink, DashboardSectionHeader } from "./section-header";
import type { DashboardData, CreateBookingContext } from "../dashboard-types";
import type { FilteredDashboardData } from "@/hooks/use-dashboard-filters";
import { DashboardStateSurface } from "./dashboard-motion";

type Props = {
  data: DashboardData;
  filtered: FilteredDashboardData | null;
  activeSport: string | null;
  hasActiveFilter: boolean;
  now: Date;
  acting: boolean;
  onSelectBooking: (id: string) => void;
  onDeleteDraft: (draftId: string) => void;
  onCreateBooking?: (ctx: CreateBookingContext) => void;
};

export function MyGearColumn({
  data,
  filtered,
  activeSport,
  hasActiveFilter,
  now,
  acting,
  onSelectBooking,
  onDeleteDraft,
  onCreateBooking,
}: Props) {
  const visibleMyCheckouts = filtered?.myCheckouts ?? data.myCheckouts.items;
  const visibleMyReservations = filtered?.myReservations ?? data.myReservations;
  const visibleMyShifts = filtered?.myShifts ?? data.myShifts;
  const myCheckoutsCount = filtered ? visibleMyCheckouts.length : data.myCheckouts.total;
  const myReservationsCount = filtered ? visibleMyReservations.length : data.myReservations.length;
  const myShiftsCount = filtered ? visibleMyShifts.length : data.myShifts.length;
  const personalGearEmpty = visibleMyCheckouts.length === 0 && visibleMyReservations.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <span className="px-0.5 text-xs font-semibold text-muted-foreground">My gear</span>

      {personalGearEmpty ? (
        <ScaleIn delay={0}>
          <Card elevation="flat">
            <CardContent className="flex min-h-[88px] items-center justify-between gap-4 p-4 max-sm:flex-col max-sm:items-start">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <ClipboardCheckIcon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {activeSport ? `No ${activeSport} gear assigned` : "No personal gear assigned"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Checkouts and upcoming reservations are clear.
                  </p>
                </div>
              </div>
              {onCreateBooking && (
                <div className="flex shrink-0 gap-2 max-sm:w-full">
                  <Button
                    size="sm"
                    className="h-10 max-sm:flex-1"
                    onClick={() => onCreateBooking({ kind: "RESERVATION" })}
                  >
                    Reserve
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </ScaleIn>
      ) : (
        <>
          {/* My Checkouts */}
          <ScaleIn delay={0}>
          <Card elevation="flat">
            <DashboardSectionHeader title="My checkouts" href="/checkouts?mine=true" count={myCheckoutsCount} />
            {visibleMyCheckouts.length === 0 ? (
              <div className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 px-4 py-5 text-center text-sm text-muted-foreground"><ClipboardCheckIcon className="size-5 opacity-45" />{activeSport ? `No ${activeSport} checkouts` : "You have no gear checked out"}</div>
            ) : (
              <CardContent className="p-0">
                {visibleMyCheckouts.map((c) => {
                  return (
                    <DashboardBookingRow
                      key={c.id}
                      booking={c}
                      now={now}
                      accent={dashboardBookingAccent(c, now, "checkout")}
                      showDueBadge
                      onSelectBooking={onSelectBooking}
                    />
                  );
                })}
                {!hasActiveFilter && data.myCheckouts.total > data.myCheckouts.items.length && (
                  <DashboardFooterLink href="/checkouts?mine=true">View all {data.myCheckouts.total} &rarr;</DashboardFooterLink>
                )}
              </CardContent>
            )}
          </Card>
          </ScaleIn>

          {/* My Reservations */}
          <ScaleIn delay={0.05}>
          <Card elevation="flat">
            <DashboardSectionHeader title="My reservations" href="/reservations?mine=true" count={myReservationsCount} />
            {visibleMyReservations.length === 0 ? (
              <div className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 px-4 py-5 text-center text-sm text-muted-foreground"><CalendarCheckIcon className="size-5 opacity-45" />{activeSport ? `No ${activeSport} reservations` : "No reservations coming up"}</div>
            ) : (
              <CardContent className="p-0">
                {visibleMyReservations.map((r) => (
                  <DashboardBookingRow
                    key={r.id}
                    booking={r}
                    now={now}
                    accent="reservation"
                    showPickupBadge
                    onSelectBooking={onSelectBooking}
                  />
                ))}
                {!hasActiveFilter && data.myReservations.length >= 5 && (
                  <DashboardFooterLink href="/reservations?mine=true">View all &rarr;</DashboardFooterLink>
                )}
              </CardContent>
            )}
          </Card>
          </ScaleIn>
        </>
      )}

      {/* My Shifts */}
      {visibleMyShifts.length > 0 && (
        <ScaleIn delay={0.1}>
        <Card elevation="flat">
          <DashboardSectionHeader title="My shifts" href="/schedule" count={myShiftsCount} />
          <CardContent className="p-0">
            {visibleMyShifts.map((s) => {
              const gearLabel = s.gearStatus === "checked_out" ? "Gear out" : s.gearStatus === "reserved" ? "Reserved" : s.gearStatus === "draft" ? "Draft" : null;
              const eventTitle = s.event.opponent
                ? `${s.event.isHome === false ? "at" : "vs"} ${s.event.opponent}`
                : s.event.summary;
              // Only Student assignments have a report time. Staff rows use
              // the event date and leave the call-time position empty.
              // An all-day event never has a call time, whatever window a slot
              // may still carry, so the event's own flag decides first.
              const studentCallWindow = s.workerType === "ST" && !s.event.allDay && s.callStartsAt && s.callEndsAt
                ? { startsAt: s.callStartsAt, endsAt: s.callEndsAt }
                : null;
              const isFullDayDefault = studentCallWindow ? isFullDayBoundaryWindow(studentCallWindow) : false;
              const isAllDayDisplay = s.event.allDay || isFullDayDefault;
              const displayDate = studentCallWindow?.startsAt ?? s.event.startsAt;
              return (
                <div key={s.id} className="group flex min-h-16 w-full items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/45 [&+&]:border-t [&+&]:border-border/40">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-bold text-foreground truncate">
                      {s.event.sportCode && <span className="text-xs font-bold mr-1">{sportLabel(s.event.sportCode)}</span>}
                      <span className="text-muted-foreground font-normal">{eventTitle}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground leading-snug">
                      {formatDayLabel(displayDate, now, isAllDayDisplay)}
                      {studentCallWindow && !isFullDayDefault && `, Call ${formatCallTime(studentCallWindow)}`}
                      {s.event.locationName && ` \u00B7 ${s.event.locationName}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {gearLabel ? (
                      <>
                        <GearAvatarStack items={s.gearItems} totalCount={s.gearItemCount} />
                        <Badge variant={s.gearStatus === "checked_out" ? "blue" : s.gearStatus === "reserved" ? "purple" : "gray"}>
                          {gearLabel}
                        </Badge>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() => onCreateBooking?.({
                          kind: "RESERVATION",
                          title: eventTitle,
                          startsAt: s.event.startsAt,
                          endsAt: s.event.endsAt,
                          locationId: s.event.locationId || undefined,
                          eventId: s.event.id,
                          sportCode: s.event.sportCode || undefined,
                        })}
                      >
                        Prep gear
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
        </ScaleIn>
      )}

      {/* Drafts */}
      <AnimatePresence initial={false}>
        {data.drafts.length > 0 && (
          <DashboardStateSurface key="drafts" layout>
            <Card elevation="flat">
              <DashboardSectionHeader title="Drafts" count={data.drafts.length} />
              <CardContent className="p-0">
                <AnimatePresence initial={false}>
                  {data.drafts.map((d) => (
                    <DashboardStateSurface
                      key={d.id}
                      layout
                      className="group flex min-h-16 w-full items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/45 [&+&]:border-t [&+&]:border-border/40"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">
                          <Badge variant="outline" size="sm" className="mr-1.5">{d.kind === "CHECKOUT" ? "Checkout" : "Reservation"}</Badge>
                          {d.title || "Untitled"}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground leading-snug">
                          {d.itemCount > 0 && <>{d.itemCount} item{d.itemCount !== 1 ? "s" : ""} &middot; </>}
                          Edited {formatRelativeTime(d.updatedAt, now)}
                        </span>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {d.kind === "RESERVATION" && (
                          <Button variant="outline" size="sm" className="h-10" asChild>
                            <Link href={`/reservations?draftId=${d.id}`}>
                              Continue
                            </Link>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10"
                          disabled={acting}
                          onClick={() => onDeleteDraft(d.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </DashboardStateSurface>
                  ))}
                </AnimatePresence>
              </CardContent>
            </Card>
          </DashboardStateSurface>
        )}
      </AnimatePresence>
    </div>
  );
}
