"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { useAuthenticatedQueryUserId } from "@/components/QueryProvider";
import { useBookingChangeSync } from "@/hooks/use-booking-change-sync";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useHydrated } from "@/hooks/use-hydrated";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { isBackgroundPollingPaused } from "@/hooks/use-operational-polling-activity";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { sendShiftTradeAction } from "@/lib/shift-trade-actions";
import { formatOperationalDateTime, formatRelativeTime } from "@/lib/format";
import type { CreateBookingContext } from "../dashboard-types";
import { FlaggedReportDialog } from "../dashboard/flagged-report-dialog";
import { GearPicksBanner } from "../dashboard/gear-picks-banner";
import { ProfileCompletionBanner } from "../dashboard/profile-completion-banner";
import { WrappedBanner } from "@/components/wrapped/WrappedBanner";
import { CantWorkDialog } from "@/components/availability/CantWorkDialog";
import {
  formatAwayDates,
  formatClockTime,
  groupWeekly,
  upcomingAway,
  type AvailabilityBlockLite,
} from "@/lib/unavailable-times";
import { GettingStartedCard } from "./GettingStartedCard";
import { HomeSkeleton, HomeView, type CantWorkSlot, type Slot } from "./HomeView";
import {
  TRADE_BOARD_HREF,
  activityRows,
  buildAttention,
  buildSummary,
  buildUpNext,
  coverageRows,
  crewRows,
  daySummary,
  formatClock,
  gearRows,
  homeRole,
  homeTabTitle,
  isTeamRole,
  overdueForViewer,
  shortDue,
  tradeRows,
  type AttentionTarget,
  type GearRow,
  type HomeActivity,
  type HomeTrade,
  type QuickAction,
  type TodayCrewEvent,
  type UpNextItem,
} from "./home-model";

const BookingDetailsSheet = lazy(() => import("@/components/BookingDetailsSheet"));

export default function HomePage() {
  const { data: user, isLoading } = useCurrentUser();
  const hydrated = useHydrated();
  if (isLoading || !hydrated) return <HomeSkeleton />;
  if (user?.role === "COLLABORATOR") {
    return (
      <CollaboratorHome
        name={user.name}
        capabilities={user.capabilities ?? []}
        readOnly={Boolean(user.preview?.readOnly)}
      />
    );
  }
  return <InternalHome name={user?.name ?? null} readOnly={Boolean(user?.preview?.readOnly)} />;
}

/* ── Shared plumbing ────────────────────────────────────── */

function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function useBookingTargets() {
  const router = useRouter();
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [reviewingReportId, setReviewingReportId] = useState<string | null>(null);
  const onTarget = useCallback((target: AttentionTarget) => {
    if (target.kind === "booking") setSelectedBookingId(target.bookingId);
    else if (target.kind === "report") setReviewingReportId(target.reportId);
    else if (target.kind === "link") router.push(target.href);
    else router.push(reservationHref(target.context));
  }, [router]);
  return { selectedBookingId, setSelectedBookingId, reviewingReportId, setReviewingReportId, onTarget };
}

// Remote creation is reservation-first. Checkout custody starts at kiosk pickup.
function reservationHref(ctx: CreateBookingContext) {
  const params = new URLSearchParams();
  if (ctx.title) params.set("title", ctx.title);
  if (ctx.startsAt) params.set("startsAt", ctx.startsAt);
  if (ctx.endsAt) params.set("endsAt", ctx.endsAt);
  if (ctx.locationId) params.set("locationId", ctx.locationId);
  if (ctx.eventId) params.set("eventId", ctx.eventId);
  if (ctx.sportCode) params.set("sportCode", ctx.sportCode);
  const qs = params.toString();
  return qs ? `/reservations/new?${qs}` : "/reservations/new";
}

/** Re-pull Home when the date rolls over, so a tab left open overnight shows today. */
function useDayRollover(now: Date, reload: () => void) {
  const day = now.toDateString();
  const [seen, setSeen] = useState(day);
  useEffect(() => {
    if (day === seen) return;
    setSeen(day);
    reload();
  }, [day, seen, reload]);
}

/** "(3) Wisconsin Creative" while gear the viewer answers for is overdue. */
function useOverdueTabBadge(count: number | null) {
  useEffect(() => {
    if (count === null) return;
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = homeTabTitle(base, count);
    return () => { document.title = base; };
  }, [count]);
}

/** Overdue reminders: one per booking per hour server-side, so a sent row stays sent. */
function useOverdueReminders() {
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindedIds, setRemindedIds] = useState<ReadonlySet<string>>(() => new Set());
  const onRemind = useCallback(async (bookingId: string) => {
    if (remindingId) return;
    setRemindingId(bookingId);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/nudge`, { method: "POST" });
      if (handleAuthRedirect(res, "/")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Couldn\u2019t send the reminder"));
        return;
      }
      setRemindedIds((prev) => new Set(prev).add(bookingId));
      toast.success("Reminder sent");
    } catch {
      toast.error("Network error. Couldn\u2019t send the reminder.");
    } finally {
      setRemindingId(null);
    }
  }, [remindingId]);
  return { remindingId, remindedIds, onRemind };
}

/** Trade Board rows for one status. Each list fails on its own, never the page. */
function useTrades(status: "OPEN" | "CLAIMED", enabled: boolean) {
  const userId = useAuthenticatedQueryUserId();
  return useQuery<HomeTrade[]>({
    queryKey: ["home-trades", userId ?? "unresolved", status],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/shift-trades?status=${status}&limit=20`, { signal });
      if (handleAuthRedirect(res, "/")) throw new DOMException("Auth redirect", "AbortError");
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<{ data?: HomeTrade[] }>(res);
      return Array.isArray(json?.data) ? json.data : [];
    },
    enabled: enabled && Boolean(userId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * A student worker's own "can't work" entries. Home keeps them one tap away so
 * adding a trip or an exam is part of the week, not a profile errand.
 */
function useCantWork(userId: string | null) {
  return useQuery<AvailabilityBlockLite[]>({
    queryKey: ["home-cant-work", userId ?? "none"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/users/${userId}/availability`, { signal });
      if (handleAuthRedirect(res, "/")) throw new DOMException("Auth redirect", "AbortError");
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<{ data?: AvailabilityBlockLite[] }>(res);
      return Array.isArray(json?.data) ? json.data : [];
    },
    enabled: Boolean(userId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

function cantWorkSlot(query: ReturnType<typeof useCantWork>): CantWorkSlot {
  const slot = slotOf(query);
  if (slot.state !== "ready") return slot;
  const away = upcomingAway(slot.rows).map((item) => ({
    id: item.id,
    title: item.label ?? "Can’t work",
    when: item.allDay ? formatAwayDates(item) : `${formatAwayDates(item)} · ${formatClockTime(item.startsAt)} – ${formatClockTime(item.endsAt)}`,
  }));
  const weekly = groupWeekly(slot.rows).map((item) => item.label ?? "Weekly time");
  return { state: "ready", rows: { away, weekly: [...new Set(weekly)] } };
}

/** Who is working which event today: the same feed as Staff › Today. */
function useTodayCrew(enabled: boolean) {
  const userId = useAuthenticatedQueryUserId();
  return useQuery<TodayCrewEvent[]>({
    queryKey: ["home-today-crew", userId ?? "unresolved"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/users/today", { signal });
      if (handleAuthRedirect(res, "/")) throw new DOMException("Auth redirect", "AbortError");
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<{ data?: { events?: TodayCrewEvent[] } }>(res);
      return Array.isArray(json?.data?.events) ? json.data.events : [];
    },
    enabled: enabled && Boolean(userId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Latest kiosk pickups and returns. Staff and admins only; fails on its own. */
function useRecentActivity(enabled: boolean) {
  const userId = useAuthenticatedQueryUserId();
  return useQuery<HomeActivity[]>({
    queryKey: ["home-activity", userId ?? "unresolved"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/dashboard/activity", { signal });
      if (handleAuthRedirect(res, "/")) throw new DOMException("Auth redirect", "AbortError");
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<{ data?: HomeActivity[] }>(res);
      return Array.isArray(json?.data) ? json.data : [];
    },
    enabled: enabled && Boolean(userId),
    staleTime: 30_000,
    // A Home tab left open overnight must not keep Neon awake; focus resumes it.
    refetchInterval: () => (isBackgroundPollingPaused() ? false : 60_000),
    refetchOnWindowFocus: true,
  });
}

function slotOf<T>(query: { data?: T; isError: boolean; refetch: () => unknown }): Slot<T> {
  if (query.data !== undefined) return { state: "ready", rows: query.data };
  if (query.isError) return { state: "error", onRetry: () => void query.refetch() };
  return { state: "loading" };
}

/* ── Students, staff and admins ─────────────────────────── */

function InternalHome({ name, readOnly }: { name: string | null; readOnly: boolean }) {
  const {
    data,
    fastStats,
    fetchError,
    refreshing,
    refreshBusy,
    statsSyncIssue,
    lastRefreshed,
    loadData,
  } = useDashboardData();
  const bookingSync = useBookingChangeSync();
  const now = useMinuteClock();
  const { selectedBookingId, setSelectedBookingId, reviewingReportId, setReviewingReportId, onTarget } = useBookingTargets();
  const reviewing = data?.flaggedItems.find((f) => f.id === reviewingReportId) ?? null;

  // Role from the full payload, falling back to cached stats so a returning
  // student never flashes staff-only rows or the New reservation button.
  const role = homeRole(data?.role ?? fastStats?.role ?? null);
  const team = isTeamRole(role);
  const openTrades = useTrades("OPEN", role === "STUDENT");
  const claimedTrades = useTrades("CLAIMED", role === "ADMIN");
  const crew = useTodayCrew(role !== null);
  const activity = useRecentActivity(team);
  const { data: me } = useCurrentUser();
  // The availability API lets student workers edit only their own times.
  const cantWorkUserId = role === "STUDENT" && me?.staffingType === "ST" && !readOnly ? me.id : null;
  const cantWork = useCantWork(cantWorkUserId);
  const [cantWorkOpen, setCantWorkOpen] = useState(false);
  const confirm = useConfirm();
  const reminders = useOverdueReminders();
  useDayRollover(now, loadData);
  useOverdueTabBadge(role && data ? overdueForViewer(role, data) : null);
  const [busyTradeId, setBusyTradeId] = useState<string | null>(null);

  // Claims and approvals go through the Trade Board's own endpoints and copy.
  // Every outcome reloads both trade lists and Home, settled or not, because a
  // lost response leaves the real state unknown.
  const onQuick = useCallback(async (quick: QuickAction) => {
    if (busyTradeId) return;
    const ok = await confirm({ title: quick.confirmTitle, message: quick.confirmMessage, confirmLabel: quick.confirmLabel });
    if (!ok) return;
    setBusyTradeId(quick.tradeId);
    try {
      const result = await sendShiftTradeAction(quick.tradeId, quick.action);
      if ("redirected" in result) return;
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      await Promise.all([openTrades.refetch(), claimedTrades.refetch()]);
      if (result.ok || result.stale) loadData();
    } finally {
      setBusyTradeId(null);
    }
  }, [busyTradeId, confirm, openTrades, claimedTrades, loadData]);

  const claimable = useMemo(
    () => (openTrades.data ?? []).filter((t) => t.viewerCanClaim),
    [openTrades.data],
  );

  const view = useMemo(() => {
    if (!role) return null;
    const retry = () => loadData();
    const pending = <T,>(build: () => T): Slot<T> => data
      ? { state: "ready", rows: build() }
      : fetchError ? { state: "error", onRetry: retry } : { state: "loading" };
    const stats = data?.stats ?? fastStats?.stats ?? null;
    return {
      summary: stats || data
        ? { state: "ready" as const, rows: buildSummary({ role, data, stats: fastStats, openTradeCount: openTrades.data ? claimable.length : null }) }
        : { state: "loading" as const },
      // Admin approvals ride along with the dashboard payload; a failed trade
      // read leaves the rest of the list intact.
      attention: pending(() => buildAttention({ role, data: data!, claimedTrades: claimedTrades.data ?? [], now })),
      upNext: pending(() => buildUpNext(data!, now)),
      myGear: pending(() => gearRows(data!.myCheckouts.items, now, false)),
      dayLine: data ? daySummary(role, data, now) : fetchError ? undefined : null,
      // The web home stays team-visible for every internal role, students
      // included; only iOS Home and collaborators are personal-only. Crew
      // coverage is a staffing question, so it stays with staff and admins.
      coverage: team ? pending(() => coverageRows(data!, now)) : undefined,
      crew: slotOf({ data: crew.data ? crewRows(crew.data) : undefined, isError: crew.isError, refetch: crew.refetch }),
      activity: team
        ? slotOf({ data: activity.data ? activityRows(activity.data, now) : undefined, isError: activity.isError, refetch: activity.refetch })
        : undefined,
      teamGear: pending(() => ({ rows: gearRows(data!.teamCheckouts.items.slice(0, 5), now, true), total: data!.teamCheckouts.total })),
      trades: role === "STUDENT"
        ? slotOf({ data: openTrades.data ? tradeRows(claimable.slice(0, 3), now) : undefined, isError: openTrades.isError, refetch: openTrades.refetch })
        : undefined,
    };
  }, [role, team, crew.data, crew.isError, crew.refetch, activity.data, activity.isError, activity.refetch, data, fastStats, fetchError, loadData, now, claimedTrades.data, openTrades.data, openTrades.isError, openTrades.refetch, claimable]);

  if (!role && !fetchError) return <HomeSkeleton />;

  return (
    <>
      <HomeView
        role={role}
        name={name}
        now={now}
        canReserve={team && !readOnly}
        sync={statsSyncIssue
          ? { label: statsSyncIssue.label, live: false, description: statsSyncIssue.description }
          : { label: bookingSync.label, live: bookingSync.state === "active", description: bookingSync.description }}
        updatedLabel={lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), now)}` : null}
        refreshing={refreshing || refreshBusy}
        onRefresh={() => loadData()}
        pageError={!data && !fastStats ? fetchError === "network" ? "network" : fetchError ? "server" : false : false}
        onRetry={() => loadData()}
        banners={<><GettingStartedCard /><ProfileCompletionBanner /><GearPicksBanner /><WrappedBanner /></>}
        dayLine={view?.dayLine}
        summary={view?.summary}
        attention={view?.attention}
        upNext={view?.upNext}
        upNextEmpty={role === "STUDENT"
          ? { title: "Nothing scheduled yet", description: "Shifts show up here once the team schedules you. You can also pick one up on the Trade Board.", href: TRADE_BOARD_HREF, action: "Open Trade Board" }
          : undefined}
        cantWork={cantWorkUserId ? cantWorkSlot(cantWork) : undefined}
        onAddCantWork={() => setCantWorkOpen(true)}
        myGear={view?.myGear}
        coverage={view?.coverage}
        teamGear={view?.teamGear}
        trades={view?.trades}
        crew={view?.crew}
        activity={view?.activity}
        tradesHref={TRADE_BOARD_HREF}
        onTarget={onTarget}
        onSelectBooking={setSelectedBookingId}
        onQuick={readOnly ? undefined : (quick) => void onQuick(quick)}
        busyTradeId={busyTradeId}
        onRemind={readOnly ? undefined : (id) => void reminders.onRemind(id)}
        remindingId={reminders.remindingId}
        remindedIds={reminders.remindedIds}
      />
      {cantWorkUserId && (
        <CantWorkDialog
          userId={cantWorkUserId}
          open={cantWorkOpen}
          onOpenChange={setCantWorkOpen}
          onSaved={() => void cantWork.refetch()}
        />
      )}
      {selectedBookingId && (
        <Suspense>
          <BookingDetailsSheet
            bookingId={selectedBookingId}
            onClose={() => setSelectedBookingId(null)}
            onUpdated={() => loadData()}
          />
        </Suspense>
      )}
      <FlaggedReportDialog
        item={reviewing}
        onClose={() => {
          setReviewingReportId(null);
          loadData();
        }}
      />
    </>
  );
}

/* ── Collaborators ──────────────────────────────────────── */

type CollaboratorBooking = {
  id: string;
  title: string;
  kind: "CHECKOUT" | "RESERVATION";
  status: string;
  startsAt: string;
  endsAt: string;
  location: { name: string } | null;
};

type CollaboratorEvent = {
  id: string;
  event: { summary: string; startsAt: string; venue: { name: string } | null };
};

async function readList<T>(url: string, signal: AbortSignal): Promise<T[]> {
  const res = await fetch(url, { signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error("server");
  const json = await parseJsonSafely<{ data?: T[] }>(res);
  return Array.isArray(json?.data) ? json.data : [];
}

/**
 * Partner staff get the same home with only what their affiliation grants:
 * their own gear and the published schedule. No team counts, no review queues.
 */
function CollaboratorHome({ name, capabilities, readOnly }: { name: string; capabilities: string[]; readOnly: boolean }) {
  const userId = useAuthenticatedQueryUserId();
  const now = useMinuteClock();
  const router = useRouter();
  const { onTarget } = useBookingTargets();
  const canViewGear = capabilities.includes("MY_GEAR_VIEW");
  const canViewSchedule = capabilities.includes("PUBLISHED_SCHEDULE_VIEW");
  const canCreateReservation = !readOnly && capabilities.includes("RESERVATION_CREATE");

  const bookings = useQuery({
    queryKey: ["home-collaborator-bookings", userId ?? "unresolved"],
    queryFn: ({ signal }) => readList<CollaboratorBooking>("/api/bookings?active=true&limit=20", signal),
    enabled: canViewGear && Boolean(userId),
  });
  const events = useQuery({
    queryKey: ["home-collaborator-schedule", userId ?? "unresolved"],
    queryFn: ({ signal }) => readList<CollaboratorEvent>("/api/schedule/published?limit=20", signal),
    enabled: canViewSchedule && Boolean(userId),
  });

  const gear = bookings.data?.map((b): GearRow => {
    // A draft is saved work, never a pickup.
    if (b.status === "DRAFT") {
      return { id: b.id, title: b.title, detail: "Saved draft", due: "Draft", tone: "neutral", person: null, personAvatarUrl: null };
    }
    const pickup = b.status === "PENDING_PICKUP" || b.kind === "RESERVATION";
    return {
      id: b.id,
      title: b.title,
      detail: b.location?.name ?? (pickup ? "Reservation" : "Checked out"),
      due: pickup ? `Pickup ${formatOperationalDateTime(b.startsAt, now, { month: "short" })}` : shortDue(b.endsAt, now),
      tone: !pickup && new Date(b.endsAt).getTime() < now.getTime() ? "critical" : "neutral",
      person: null,
      personAvatarUrl: null,
    };
  });
  const upcoming = events.data?.slice(0, 8).map((item): UpNextItem => ({
    id: item.id,
    kind: "event",
    startsAt: item.event.startsAt,
    allDay: false,
    time: formatClock(item.event.startsAt),
    title: item.event.summary,
    detail: item.event.venue?.name ?? "Published schedule",
    badge: null,
    target: { kind: "link", href: "/schedule" },
  }));

  return (
    <>
      <HomeView
        role="COLLABORATOR"
        name={name}
        now={now}
        canReserve={canCreateReservation}
        notice={!canViewGear && !canViewSchedule ? (
          <p className="rounded-xl border bg-card px-4 py-3.5 text-sm text-muted-foreground shadow-xs">
            Your collaborator account is active. An administrator hasn&rsquo;t turned on gear or schedule access for your organization yet.
          </p>
        ) : null}
        upNext={canViewSchedule ? slotOf({ data: upcoming, isError: events.isError, refetch: events.refetch }) : undefined}
        upNextEmpty={{ title: "No published events", description: "Events appear here once the schedule is published.", href: "/schedule", action: "Open Schedule" }}
        myGear={canViewGear ? slotOf({ data: gear, isError: bookings.isError, refetch: bookings.refetch }) : undefined}
        myGearHref="/bookings"
        onTarget={onTarget}
        onSelectBooking={(id) => {
          const booking = bookings.data?.find((b) => b.id === id);
          router.push(`/bookings?tab=${booking?.kind === "RESERVATION" ? "reservations" : "checkouts"}&highlight=${id}`);
        }}
      />
    </>
  );
}
