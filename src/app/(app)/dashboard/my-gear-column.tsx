"use client";

import Link from "next/link";
import { AnimatePresence } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardCheckIcon, CalendarCheckIcon } from "lucide-react";
import { ScaleIn } from "@/components/ui/motion";
import { formatRelativeTime } from "@/lib/format";
import { DashboardBookingRow, dashboardBookingAccent } from "./booking-row";
import { DashboardFooterLink, DashboardSectionHeader } from "./section-header";
import type { DashboardData, CreateBookingContext } from "../dashboard-types";
import type { FilteredDashboardData } from "@/hooks/use-dashboard-filters";
import { DashboardStateSurface } from "./dashboard-motion";
import { MyEventsCard } from "./event-cards";

type Props = {
  data: DashboardData;
  filtered: FilteredDashboardData | null;
  activeSport: string | null;
  hasActiveFilter: boolean;
  now: Date;
  actingId: string | null;
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
  actingId,
  onSelectBooking,
  onDeleteDraft,
  onCreateBooking,
}: Props) {
  const visibleMyEventWork = filtered?.myEventWork ?? data.myEventWork;
  // Gear for an event the viewer works is shown on that event's card, so the
  // reservation list keeps only what stands on its own.
  const eventGearIds = new Set(visibleMyEventWork.flatMap((work) => work.gearBookings.map((b) => b.id)));
  const visibleMyCheckouts = filtered?.myCheckouts ?? data.myCheckouts.items;
  const visibleMyReservations = (filtered?.myReservations ?? data.myReservations).filter((r) => !eventGearIds.has(r.id));
  const myCheckoutsCount = filtered ? visibleMyCheckouts.length : data.myCheckouts.total;
  const myReservationsCount = visibleMyReservations.length;
  const personalGearEmpty = visibleMyCheckouts.length === 0 && visibleMyReservations.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <span className="px-0.5 text-xs font-semibold text-muted-foreground">My work</span>

      {visibleMyEventWork.length > 0 && (
        <ScaleIn delay={0}>
          <MyEventsCard
            eventWork={visibleMyEventWork}
            now={now}
            onSelectBooking={onSelectBooking}
            onCreateBooking={onCreateBooking}
          />
        </ScaleIn>
      )}

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
                        <Button variant="outline" size="sm" className="h-10" asChild>
                          <Link href={d.kind === "CHECKOUT" ? `/checkouts/new?draftId=${d.id}` : `/reservations/new?draftId=${d.id}`}>
                            Continue
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10"
                          loading={actingId === d.id}
                          disabled={actingId !== null && actingId !== d.id}
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
