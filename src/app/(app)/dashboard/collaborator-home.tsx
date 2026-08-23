"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { BellIcon, CalendarDaysIcon, PackageIcon, PlusIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { OperationalLoadingState } from "@/components/OperationalLoadingState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { DashboardStateSurface } from "./dashboard-motion";

type Booking = {
  id: string;
  title: string;
  kind: "CHECKOUT" | "RESERVATION";
  status: string;
  startsAt: string;
  endsAt: string;
  location: { name: string };
};

type FollowedEvent = {
  id: string;
  isFollowing: boolean;
  event: { summary: string; startsAt: string; venue: { name: string } | null };
};

function dateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function bookingState(booking: Booking) {
  if (booking.status === "DRAFT") {
    return { label: "Draft", variant: "gray" as const, detail: "Saved draft" };
  }
  if (booking.status === "PENDING_PICKUP" || booking.kind === "RESERVATION") {
    return { label: "Pickup", variant: "orange" as const, detail: `Starts ${dateTime(booking.startsAt)}` };
  }
  return { label: "Return", variant: "blue" as const, detail: `Due ${dateTime(booking.endsAt)}` };
}

export function CollaboratorHome({ name, capabilities }: { name: string; capabilities: string[] }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [events, setEvents] = useState<FollowedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const canViewGear = capabilities.includes("MY_GEAR_VIEW");
  const canBrowseGear = capabilities.includes("GEAR_CATALOG_VIEW");
  const canViewSchedule = capabilities.includes("PUBLISHED_SCHEDULE_VIEW");
  const canCreateReservation = capabilities.includes("RESERVATION_CREATE");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [bookingsResponse, scheduleResponse] = await Promise.all([
        canViewGear ? fetch("/api/bookings?active=true&limit=20") : Promise.resolve(null),
        canViewSchedule ? fetch("/api/schedule/published?limit=20") : Promise.resolve(null),
      ]);
      if ((bookingsResponse && handleAuthRedirect(bookingsResponse)) || (scheduleResponse && handleAuthRedirect(scheduleResponse))) return;
      if ((bookingsResponse && !bookingsResponse.ok) || (scheduleResponse && !scheduleResponse.ok)) {
        setError(true);
        return;
      }
      const [bookingJson, scheduleJson] = await Promise.all([
        bookingsResponse ? parseJsonSafely<{ data?: Booking[] }>(bookingsResponse) : Promise.resolve(null),
        scheduleResponse ? parseJsonSafely<{ data?: FollowedEvent[] }>(scheduleResponse) : Promise.resolve(null),
      ]);
      setBookings(bookingJson?.data ?? []);
      setEvents((scheduleJson?.data ?? []).filter((event) => event.isFollowing));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [canViewGear, canViewSchedule]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome, ${name.split(" ")[0]}`}
        description={
          canViewGear && canViewSchedule ? "Your gear handoffs and followed event updates."
          : canViewSchedule ? "Updates for the events you follow."
          : canViewGear ? "Your gear handoffs."
          : "Notifications from the crew."
        }
      >
        {canCreateReservation && (
          <Button className="h-10" asChild>
            <Link href="/reservations/new">
              <PlusIcon className="size-3.5" data-icon="inline-start" />
              New reservation
            </Link>
          </Button>
        )}
      </PageHeader>
      <AnimatePresence initial={false} mode="popLayout">
        {loading ? (
          <DashboardStateSurface key="collaborator-loading" variant="shift" layout>
            <OperationalLoadingState variant="page" title="Loading your workspace" rows={4} />
          </DashboardStateSurface>
        ) : error ? (
          <DashboardStateSurface key="collaborator-error" variant="shift" layout>
            <EmptyState icon="wifi-off" title="Could not load your workspace" description="Retry before relying on pickup or return times." actionLabel="Retry" onAction={() => void load()} />
          </DashboardStateSurface>
        ) : (
          <DashboardStateSurface key="collaborator-content" variant="shift" layout className="grid gap-4 lg:grid-cols-2">
            {!canViewGear && !canViewSchedule && (
              <Card className="shadow-xs lg:col-span-2">
                <CardContent className="p-6">
                  <EmptyState inline icon="bell" title="Your collaborator account is active" description="An administrator has not enabled gear or published Schedule access for this affiliation." actionLabel="View notifications" actionHref="/notifications" />
                </CardContent>
              </Card>
            )}
            {canViewGear && (
              <Card className="shadow-xs">
                <CardHeader className="flex-row items-center justify-between p-4">
                  <CardTitle className="flex items-center gap-2 text-base!"><PackageIcon className="size-4" />My Gear</CardTitle>
                  <Button variant="outline" size="sm" className="h-10" asChild><Link href="/bookings">View all</Link></Button>
                </CardHeader>
                <CardContent className="p-0">
                  {bookings.length === 0 ? (
                    <EmptyState inline icon="box" title="No active gear" description="Your reservations and kiosk handoffs will appear here." actionLabel={canBrowseGear ? "Browse items" : undefined} actionHref={canBrowseGear ? "/items" : undefined} />
                  ) : (
                    <div className="divide-y">
                      {bookings.map((booking) => {
                        const state = bookingState(booking);
                        return (
                          <Link key={booking.id} href="/bookings" className="flex min-h-14 items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-muted/50">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">{booking.title}</p>
                              <p className="text-xs text-muted-foreground tabular-nums">{state.detail} · {booking.location.name}</p>
                            </div>
                            <Badge variant={state.variant} size="sm">{state.label}</Badge>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {canViewSchedule && (
              <Card className="shadow-xs">
                <CardHeader className="flex-row items-center justify-between p-4">
                  <CardTitle className="flex items-center gap-2 text-base!"><BellIcon className="size-4" />Followed events</CardTitle>
                  <Button variant="outline" size="sm" className="h-10" asChild><Link href="/schedule">Published Schedule</Link></Button>
                </CardHeader>
                <CardContent className="p-0">
                  {events.length === 0 ? (
                    <EmptyState inline icon="calendar" title="No followed events" description="Follow a published event to keep its crew updates here." actionLabel="Open Schedule" actionHref="/schedule" />
                  ) : (
                    <div className="divide-y">
                      {events.slice(0, 6).map((item) => (
                        <Link key={item.id} href="/schedule" className="flex min-h-14 items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-muted/50">
                          <CalendarDaysIcon className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{item.event.summary}</p>
                            <p className="text-xs text-muted-foreground tabular-nums">{dateTime(item.event.startsAt)}{item.event.venue ? ` · ${item.event.venue.name}` : ""}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </DashboardStateSurface>
        )}
      </AnimatePresence>
    </div>
  );
}
