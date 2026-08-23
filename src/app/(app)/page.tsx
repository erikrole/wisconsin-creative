"use client";

import Link from "next/link";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
const BookingDetailsSheet = lazy(() => import("@/components/BookingDetailsSheet"));
import EmptyState from "@/components/EmptyState";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { PageHeader } from "@/components/PageHeader";
import { Progress } from "@/components/ui/progress";
import StatusIndicator from "@/components/ui/status-indicator";
import { AlertTriangleIcon, CalendarClockIcon, ClockAlertIcon, PackageIcon, PackageOpenIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { formatRelativeTime } from "@/lib/format";
import { handleAuthRedirect } from "@/lib/errors";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { useBookingChangeSync } from "@/hooks/use-booking-change-sync";
import { useDashboardFilters } from "@/hooks/use-dashboard-filters";
import { DashboardSkeleton } from "./dashboard/dashboard-skeleton";
import { FilterChips } from "./dashboard/filter-chips";
import { OverdueBanner } from "./dashboard/overdue-banner";
import { FlaggedItemsBanner } from "./dashboard/flagged-items-banner";
import { LostBulkUnitsCard } from "./dashboard/lost-bulk-units-card";
import { MyGearColumn } from "./dashboard/my-gear-column";
import { TeamActivityColumn } from "./dashboard/team-activity-column";
import { PageTransition } from "@/components/ui/motion";
import type { CreateBookingContext } from "./dashboard-types";
import { useCurrentUser } from "@/hooks/use-current-user";
import { CollaboratorHome } from "./dashboard/collaborator-home";
import { DashboardStateSurface } from "./dashboard/dashboard-motion";

export default function DashboardPage() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return <DashboardSkeleton />;
  if (user?.role === "COLLABORATOR") return <CollaboratorHome name={user.name} capabilities={user.capabilities ?? []} />;
  return <InternalDashboardPage />;
}

function InternalDashboardPage() {
  const {
    data,
    fastStats,
    fetchError,
    refreshing,
    statsSyncIssue,
    lastRefreshed,
    loadData,
    setData,
  } = useDashboardData();
  const bookingSync = useBookingChangeSync();

  // The hook owns the only fast-stats query and validates partial failures
  // before exposing cached stats for the early render.
  const stats = data?.stats ?? fastStats?.stats ?? null;
  const pendingPickupTotal = data?.pendingPickups.total ?? fastStats?.pendingPickupTotal ?? 0;
  const overdueCount = data?.overdueCount ?? fastStats?.overdueCount ?? null;
  // Role from full payload, falling back to cached stats payload so the early
  // render doesn't briefly show staff-only buttons to a returning student.
  const role = data?.role ?? fastStats?.role ?? null;

  const filters = useDashboardFilters(data);
  const [now, setNow] = useState(() => new Date());
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const confirm = useConfirm();

  // ── Navigate to booking wizard ──
  const router = useRouter();

  const handleCreateBooking = useCallback((ctx: CreateBookingContext) => {
    const base = "/reservations/new";
    const params = new URLSearchParams();
    if (ctx.title) params.set("title", ctx.title);
    if (ctx.startsAt) params.set("startsAt", ctx.startsAt);
    if (ctx.endsAt) params.set("endsAt", ctx.endsAt);
    if (ctx.locationId) params.set("locationId", ctx.locationId);
    if (ctx.eventId) params.set("eventId", ctx.eventId);
    if (ctx.sportCode) params.set("sportCode", ctx.sportCode);
    const qs = params.toString();
    router.push(qs ? `${base}?${qs}` : base);
  }, [router]);

  // Live countdown tick every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Ref guard prevents double-fire when two rapid clicks read stale state
  const actionBusyRef = useRef(false);

  const handleDeleteDraft = async (draftId: string) => {
    const draft = data?.drafts.find((d) => d.id === draftId);
    if (!draft) return;
    const ok = await confirm({
      title: `Delete ${draft.kind === "CHECKOUT" ? "checkout" : "reservation"} draft?`,
      message: "This removes the saved draft from your dashboard. The booking has not been created yet, and this recovery point cannot be restored.",
      confirmLabel: "Delete draft",
      variant: "danger",
    });
    if (!ok) return;
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActing(draftId);
    const prevDrafts = data!.drafts;
    setData((prev) => prev ? { ...prev, drafts: prev.drafts.filter((x) => x.id !== draftId) } : prev);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
      if (handleAuthRedirect(res, "/")) return;
      if (res.ok) {
        toast.success("Draft deleted");
      } else {
        setData((prev) => prev ? { ...prev, drafts: prevDrafts } : prev);
        toast.error("Could not delete the draft. It has been restored on the dashboard.");
      }
    } catch {
      setData((prev) => prev ? { ...prev, drafts: prevDrafts } : prev);
      toast.error("Could not reach the server. The draft has been restored on the dashboard.");
    } finally {
      actionBusyRef.current = false;
      setActing(null);
    }
  };

  if (fetchError) {
    return (
      <EmptyState
        icon={fetchError === "network" ? "bell" : "box"}
        title={fetchError === "network" ? "You\u2019re offline" : "Couldn\u2019t load your dashboard"}
        description={fetchError === "network"
          ? "Check your connection and try again."
          : "The dashboard could not load. Refresh before using these counts for daily work."}
        actionLabel="Try again"
        onAction={() => loadData()}
      />
    );
  }

  // Show full skeleton only on true first load (no cache at all).
  // If we have fast stats from a prior session, render the top section
  // immediately and skeleton only the columns.
  if (!data && !stats) return <DashboardSkeleton />;

  // Use early-resolved role: prefer full payload, fall back to cached stats.
  // While role is still null we do not render role-gated buttons (avoids flicker).
  const isStudent = role === "STUDENT";
  const isStaff = role === "STAFF" || role === "ADMIN";
  const isAdmin = role === "ADMIN";
  const roleKnown = role !== null;
  const statsEmpty = stats
    ? stats.checkedOut === 0 && stats.overdue === 0 && stats.reserved === 0
      && stats.dueToday === 0 && pendingPickupTotal === 0
    : false;
  const dataEmpty = data
    ? data.myCheckouts.total === 0 && data.teamCheckouts.total === 0 &&
      data.teamReservations.total === 0 && data.pendingPickups.total === 0 &&
      data.staleReservations.total === 0 &&
      data.upcomingEvents.length === 0 && data.myReservations.length === 0 &&
      data.drafts.length === 0 && data.myShifts.length === 0 &&
      data.flaggedItems.length === 0 && data.lostBulkUnits.length === 0
    : false;
  const isFirstRun = statsEmpty && (data ? dataEmpty : true);
  const dashboardRailItems: OperationalStatusRailItem[] = stats ? [
    ...(stats.overdue > 0 ? [{
      id: "overdue",
      label: "Overdue",
      value: stats.overdue,
      detail: "Checkouts already past their due time.",
      icon: AlertTriangleIcon,
      tone: "critical" as const,
      href: "/checkouts?filter=overdue",
    }] : []),
    ...(stats.dueToday > 0 ? [{
      id: "due-today",
      label: "Due today",
      value: stats.dueToday,
      detail: "Open checkouts due back today.",
      icon: CalendarClockIcon,
      tone: "warning" as const,
      href: "/bookings?tab=checkouts&filter=due-today",
    }] : []),
    ...(pendingPickupTotal > 0 ? [{
      id: "pending-pickup",
      label: "Pending pickup",
      value: pendingPickupTotal,
      detail: "Scheduled pickup has passed without a kiosk handoff.",
      icon: ClockAlertIcon,
      tone: "warning" as const,
      href: "/bookings?tab=reservations",
    }] : []),
    ...(stats.checkedOut > 0 ? [{
      id: "checked-out",
      label: "Checked out",
      value: stats.checkedOut,
      detail: "Open checkouts in active custody.",
      icon: PackageOpenIcon,
      tone: "info" as const,
      href: "/bookings?tab=checkouts&status=OPEN",
    }] : []),
    ...(stats.reserved > 0 ? [{
      id: "reserved",
      label: "Reserved",
      value: stats.reserved,
      detail: "Upcoming reservations waiting for pickup.",
      icon: PackageIcon,
      tone: "neutral" as const,
      href: "/bookings?tab=reservations",
    }] : []),
  ] : [];

  return (
    <PageTransition>
      {/* ══════ Page Header + Quick Actions ══════ */}
      <PageHeader
        title="Dashboard"
        titleAccessory={(
          <StatusIndicator
            state={bookingSync.state}
            label={bookingSync.label}
            size="sm"
            title={bookingSync.description}
            className="h-6 px-2 text-[11px] font-bold shadow-[0_0_14px_rgba(34,197,94,0.2)]"
            labelClassName="font-bold"
          />
        )}
        className="mb-4 max-md:mb-3"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          {statsSyncIssue && (
            <StatusIndicator
              state="fixing"
              label={statsSyncIssue.label}
              size="sm"
              title={statsSyncIssue.description}
              className="h-10 px-3"
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-10"
                onClick={() => loadData()}
                disabled={refreshing}
                aria-label="Refresh dashboard"
              >
                <RefreshCwIcon className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} data-icon="inline-start" />
                Refresh
              </Button>
            </TooltipTrigger>
            <TooltipContent>{lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), now)}` : "Refresh dashboard"}</TooltipContent>
          </Tooltip>
          <FilterChips {...filters} />
          {roleKnown && !isStudent && (
            <Button className="h-10" onClick={() => handleCreateBooking({ kind: "RESERVATION" })}>
              <PlusIcon className="size-3.5" data-icon="inline-start" />
              New reservation
            </Button>
          )}
        </div>
      </PageHeader>

      {/* ══════ Operational Status ══════ */}
      {refreshing && <Progress className="h-0.5 mb-1" />}
      {stats && (
        <OperationalStatusRail
          className="mb-4"
          orientation={{
            label: "Active bookings",
            value: `${stats.checkedOut + stats.reserved + pendingPickupTotal}`,
            icon: PackageIcon,
          }}
          items={dashboardRailItems}
          allClearLabel={dashboardRailItems.length === 0 ? "No active booking work" : undefined}
          detailsLabel="Booking breakdown"
          details={(
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <OperationalMetricCard label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "red" : "muted"} href="/checkouts?filter=overdue" />
              <OperationalMetricCard label="Due today" value={stats.dueToday} tone={stats.dueToday > 0 ? "orange" : "muted"} href="/bookings?tab=checkouts&filter=due-today" />
              <OperationalMetricCard label="Pending pickup" value={pendingPickupTotal} tone={pendingPickupTotal > 0 ? "orange" : "muted"} href="/bookings?tab=reservations" />
              <OperationalMetricCard label="Checked out" value={stats.checkedOut} tone="blue" href="/bookings?tab=checkouts&status=OPEN" />
              <OperationalMetricCard label="Reserved" value={stats.reserved} tone="purple" href="/bookings?tab=reservations" />
            </div>
          )}
        />
      )}

      {/* ══════ Welcome Banner (first-run) ══════ */}
      {isFirstRun && (
        <div className="relative bg-card border border-border rounded-xl mb-4 overflow-hidden animate-[empty-fade-in_0.4s_ease-out]">
          {/* Red accent stripe */}
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--wi-red)]" aria-hidden="true" />
          <div className="px-6 py-5 pl-8">
            <p
              className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground/50 mb-1"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Getting started
            </p>
            <h2
              className="text-[20px]! font-black! leading-tight mb-4"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Welcome to Wisconsin Creative
            </h2>
            <div className="flex gap-3 max-md:flex-col">
              {[
                { href: "/items", label: "Add equipment", n: "01" },
                { href: "/import", label: "Import from spreadsheet", n: "02" },
                { href: "/settings/calendar-sources", label: "Set up calendar sync", n: "03" },
              ].map(({ href, label, n }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex min-h-10 flex-1 items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 no-underline transition-[background-color,border-color,scale] hover:border-[var(--wi-red)]/30 hover:bg-[var(--wi-red)]/[0.03] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span
                    className="text-[11px] tabular-nums text-muted-foreground/40 group-hover:text-[var(--wi-red)]/60 transition-colors shrink-0"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {n}
                  </span>
                  <span
                    className="text-[13px] text-foreground/80"
                    style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}
                  >
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {/* ══════ Overdue Banner ══════ */}
        {overdueCount !== null && overdueCount > 0 && (
          <DashboardStateSurface key="overdue" layout>
            <OverdueBanner
              overdueCount={overdueCount}
              overdueItems={data?.overdueItems ?? []}
              now={now}
              onSelectBooking={setSelectedBookingId}
              canAction={roleKnown && !isStudent}
            />
          </DashboardStateSurface>
        )}

        {/* ══════ Flagged Items Banner (staff/admin only) ══════ */}
        {isStaff && data && data.flaggedItems.length > 0 && (
          <DashboardStateSurface key="flagged-items" layout>
            <FlaggedItemsBanner items={data.flaggedItems} />
          </DashboardStateSurface>
        )}

        {/* ══════ Lost Bulk Units (admin only) ══════ */}
        {isAdmin && data && data.lostBulkUnits.length > 0 && (
          <DashboardStateSurface key="lost-bulk-units" layout>
            <LostBulkUnitsCard items={data.lostBulkUnits} />
          </DashboardStateSurface>
        )}
      </AnimatePresence>

      {/* ══════ Two-Column Split ══════ */}
      <AnimatePresence initial={false} mode="popLayout">
        {data ? (
          <DashboardStateSurface
            key="dashboard-columns"
            variant="shift"
            layout
            className={isStudent ? "grid max-w-[640px] grid-cols-1 gap-6" : "grid grid-cols-1 items-start gap-4 md:grid-cols-2 md:gap-6"}
          >
            <MyGearColumn
              data={data}
              filtered={filters.filtered}
              activeSport={filters.activeSport}
              hasActiveFilter={filters.hasActiveFilter}
              now={now}
              acting={acting !== null}
              onSelectBooking={setSelectedBookingId}
              onDeleteDraft={handleDeleteDraft}
              onCreateBooking={handleCreateBooking}
            />
            {!isStudent && (
              <TeamActivityColumn
                data={data}
                filtered={filters.filtered}
                activeSport={filters.activeSport}
                hasActiveFilter={filters.hasActiveFilter}
                now={now}
                onSelectBooking={setSelectedBookingId}
              />
            )}
          </DashboardStateSurface>
        ) : (
          <DashboardStateSurface key="dashboard-columns-loading" variant="shift" layout>
            {/* Stats were available from cache but full data is still loading. */}
            <DashboardSkeleton columnsOnly />
          </DashboardStateSurface>
        )}
      </AnimatePresence>

      {/* ══════ Booking Detail Sheet ══════ */}
      {selectedBookingId && (
        <Suspense>
          <BookingDetailsSheet
            bookingId={selectedBookingId}
            onClose={() => setSelectedBookingId(null)}
            onUpdated={() => loadData()}
          />
        </Suspense>
      )}

      {/* Remote creation is reservation-first. Checkout custody starts at kiosk pickup. */}
    </PageTransition>
  );
}
