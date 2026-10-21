"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CalendarDaysIcon, UserIcon, HouseIcon, CameraIcon, ClipboardListIcon } from "lucide-react";
import AppSidebar from "./Sidebar";
import { OperationalLoadingState } from "@/components/OperationalLoadingState";
import { AppTopBar } from "@/components/AppTopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { MobileTabBar, type MobileTabItem } from "@/components/MobileTabBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useIsRestoring, useQueryClient } from "@tanstack/react-query";
import { type CurrentUser, useCurrentUser } from "@/hooks/use-current-user";
import { clearLocalTraces } from "@/lib/local-traces";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { toast } from "sonner";
import { BOOKING_CHANGE_SYNC_EVENT } from "@/hooks/use-booking-change-sync";
import { isBackgroundPollingPaused } from "@/hooks/use-operational-polling-activity";
import { NOTIFICATION_COUNT_CHANGED_EVENT } from "@/lib/notification-count-sync";
import { ProfileCompletionWizard } from "@/components/profile-completion/ProfileCompletionWizard";
import { dashboardStatsQueryOptions, dashboardStatsQueryKey, useDashboardStats } from "@/hooks/use-dashboard-data";
import { useSidebarCounts } from "@/hooks/use-sidebar-counts";
import {
  BadgeEarnedCelebration,
  type EarnedBadgeReward,
} from "@/components/badges/BadgeEarnedCelebration";
import { RolePreviewBanner } from "@/components/RolePreviewControl";

type NotificationCountResponse = {
  unreadCount?: unknown;
};

type RecentBadgeAwardsResponse = {
  data?: {
    awards?: EarnedBadgeReward[];
    nextCursor?: string;
  };
};

const bottomNavItems: MobileTabItem[] = [
  { label: "Home", href: "/", icon: HouseIcon },
  { label: "Schedule", href: "/schedule", icon: CalendarDaysIcon },
  { label: "Bookings", href: "/bookings", icon: ClipboardListIcon, badge: "overdue" as const },
  { label: "Items", href: "/items", icon: CameraIcon },
];

const collaboratorBottomNavItems: MobileTabItem[] = [
  { label: "Home", href: "/", icon: HouseIcon },
  { label: "Schedule", href: "/schedule", icon: CalendarDaysIcon },
  { label: "My Gear", href: "/bookings", icon: ClipboardListIcon, badge: "overdue" as const },
  { label: "Items", href: "/items", icon: CameraIcon },
  { label: "People", href: "/staff", icon: UserIcon },
];

const COLLABORATOR_ROUTE_CAPABILITY: Array<{ matches: (pathname: string) => boolean; capability: string }> = [
  { matches: (value) => value === "/schedule" || value.startsWith("/schedule/"), capability: "PUBLISHED_SCHEDULE_VIEW" },
  { matches: (value) => value === "/items" || (value.startsWith("/items/") && value !== "/items/new"), capability: "GEAR_CATALOG_VIEW" },
  { matches: (value) => value === "/bookings" || value.startsWith("/bookings/"), capability: "MY_GEAR_VIEW" },
  { matches: (value) => value === "/resources" || value === "/resources/", capability: "BRAND_ASSETS_VIEW" },
  { matches: (value) => value === "/reservations/new", capability: "RESERVATION_CREATE" },
  { matches: (value) => value === "/staff" || value.startsWith("/staff/"), capability: "PEOPLE_DIRECTORY_VIEW" },
];

function collaboratorCanVisit(pathname: string, user: CurrentUser): boolean {
  const alwaysAllowed = pathname === "/"
    || pathname === "/welcome"
    || pathname === "/profile"
    || pathname === "/scoreboard"
    || pathname.startsWith("/scoreboard/")
    || pathname === "/settings"
    || pathname === "/settings/profile"
    || pathname === "/settings/security"
    || pathname === "/settings/notifications"
    || pathname === "/settings/appearance"
    || pathname === `/staff/${user.id}`
    || pathname === "/notifications"
    || pathname.startsWith("/notifications/");
  if (alwaysAllowed) return true;
  const route = COLLABORATOR_ROUTE_CAPABILITY.find((entry) => entry.matches(pathname));
  return Boolean(route && user.capabilities?.includes(route.capability));
}

export default function AppShell({
  children,
  initialUser,
  defaultSidebarOpen = true,
}: {
  children: React.ReactNode;
  initialUser?: CurrentUser;
  defaultSidebarOpen?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const { data: user, isLoading } = useCurrentUser(initialUser);
  const isCollaborator = user?.role === "COLLABORATOR";
  const isRolePreview = Boolean(user?.preview?.readOnly);
  const visibleBottomNavItems = isCollaborator
    ? collaboratorBottomNavItems.filter((item) => {
        const route = COLLABORATOR_ROUTE_CAPABILITY.find((entry) => entry.matches(item.href));
        return !route || user?.capabilities?.includes(route.capability);
      })
    : bottomNavItems;
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const { data: dashboardStats } = useDashboardStats();
  const overdueBadgeCount = dashboardStats?.myOverdueCount ?? 0;
  const dueTodayBadgeCount = dashboardStats?.myDueTodayCount ?? 0;
  const { data: sidebarCounts } = useSidebarCounts(user?.role === "ADMIN" || user?.role === "STAFF");
  const [earnedBadgeQueue, setEarnedBadgeQueue] = useState<EarnedBadgeReward[]>([]);
  // The reward poll needs the current path only to build an auth return URL. Held
  // in a ref so it cannot sit in the effect's dependency list: `pathname` there
  // tore the poll down and re-bootstrapped it on every client-side navigation,
  // which re-POSTed the app-open easter-egg event and reset the 15s interval.
  const rewardPathRef = useRef(pathname);
  rewardPathRef.current = pathname;

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!isCollaborator || !user) return;
    const allowed = collaboratorCanVisit(pathname, user);
    if (!allowed) router.replace("/");
  }, [isCollaborator, pathname, router, user]);

  const rewardUserId = user?.role === "COLLABORATOR" ? null : user?.id ?? null;
  useEffect(() => {
    if (!rewardUserId || isRolePreview) return;

    const cursorKey = `gear-tracker:badge-reward-cursor:${rewardUserId}`;
    // Reward polling is ambient chrome. It starts at 15s and backs off while
    // nothing is being awarded so an idle tab stops hammering the route, then
    // snaps back to 15s the moment an award lands or the tab is refocused.
    const BASE_POLL_MS = 15_000;
    const MAX_POLL_MS = 120_000;
    const controller = new AbortController();
    let stopped = false;
    let loading = false;
    let memoryCursor: string | null = null;
    let pollDelayMs = BASE_POLL_MS;
    let pollTimer: number | undefined;

    function resetPollDelay() {
      pollDelayMs = BASE_POLL_MS;
    }

    // A burst read (mount or refocus) is not evidence that the account is
    // idle, so its empty responses must not carry backoff into the steady
    // cadence. Always resume the fast interval after one.
    function startSteadyPolling() {
      resetPollDelay();
      scheduleNextPoll();
    }

    function scheduleNextPoll() {
      if (stopped) return;
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(async () => {
        await loadEarnedBadges();
        scheduleNextPoll();
      }, pollDelayMs);
    }

    async function loadEarnedBadges() {
      if (loading || isBackgroundPollingPaused()) return;
      loading = true;

      try {
        let after = memoryCursor;
        try {
          after = localStorage.getItem(cursorKey) ?? after;
        } catch {
          // Keep polling with the in-memory cursor when storage is unavailable.
        }
        const search = after ? `?after=${encodeURIComponent(after)}` : "";
        const response = await fetch(`/api/badges/recent${search}`, { signal: controller.signal });
        if (response.status === 400 && after) {
          memoryCursor = null;
          try { localStorage.removeItem(cursorKey); } catch { /* storage unavailable */ }
          return;
        }
        if (handleAuthRedirect(response, rewardPathRef.current) || !response.ok || stopped) return;

        const json = await parseJsonSafely<RecentBadgeAwardsResponse>(response);
        const nextCursor = json?.data?.nextCursor;
        if (typeof nextCursor === "string") {
          memoryCursor = nextCursor;
          try { localStorage.setItem(cursorKey, nextCursor); } catch { /* storage unavailable */ }
        }

        const awards = Array.isArray(json?.data?.awards) ? json.data.awards : [];
        if (awards.length > 0) {
          resetPollDelay();
        } else {
          pollDelayMs = Math.min(pollDelayMs * 2, MAX_POLL_MS);
        }
        if (awards.length > 0 && !stopped) {
          setEarnedBadgeQueue((current) => {
            const seen = new Set(current.map((badge) => badge.id));
            return [...current, ...awards.filter((badge) => !seen.has(badge.id))];
          });
        }
      } catch {
        // Reward chrome is ambient. Keep the cursor and retry on the next poll.
      } finally {
        loading = false;
      }
    }

    function hasRewardCursor() {
      if (memoryCursor) return true;
      try {
        return Boolean(localStorage.getItem(cursorKey));
      } catch {
        return false;
      }
    }

    async function refreshBadgeRewards() {
      // Overnight and background tabs must not mint an app-open award or read badges.
      if (isBackgroundPollingPaused()) return;
      // Establish the no-replay cursor before a foreground easter egg can
      // create an award, then immediately read again so the reward cannot be
      // skipped by first-load cursor initialization.
      await loadEarnedBadges();
      if (!hasRewardCursor()) {
        // A malformed cursor is cleared by the first read. Establish a fresh
        // boundary before allowing this foreground event to mint an award.
        await loadEarnedBadges();
      }
      if (!hasRewardCursor()) return;
      try {
        await fetch("/api/badges/events/app-open", { method: "POST", signal: controller.signal });
      } catch {
        // Easter eggs are ambient. Reward polling continues normally.
      }
      await loadEarnedBadges();
    }

    void refreshBadgeRewards().then(startSteadyPolling);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back during the day refreshes immediately. Quiet hours stay paused
      // until the steady timer notices morning.
      if (isBackgroundPollingPaused(false)) return;
      // A refocus is a fresh signal that the user is here: drop back to the
      // fast cadence before re-reading.
      resetPollDelay();
      void refreshBadgeRewards().then(startSteadyPolling);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      window.clearTimeout(pollTimer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // Deliberately keyed on identity alone. An app open is a foreground event,
    // not a navigation, and this effect owns a POST with a durable side effect.
  }, [isRolePreview, rewardUserId]);

  // Navigation shares the same fresh stats read as Home; simultaneous consumers
  // and booking invalidations join one request instead of hitting Neon twice.
  const badgeUserId = user?.id;
  useEffect(() => {
    if (!badgeUserId || isRestoring) return;
    const controller = new AbortController();
    void queryClient.fetchQuery({
      ...dashboardStatsQueryOptions(badgeUserId),
      // Mutations on another route may have changed custody since the last read.
      // Preserve navigation freshness while joining any request already in flight.
      staleTime: 0,
    }).catch(() => {
      // The shared query retains the last trusted counts on failure.
    });
    async function loadNotifications() {
      try {
        const response = await fetch("/api/notifications/count", { signal: controller.signal });
        if (controller.signal.aborted || handleAuthRedirect(response, pathname) || !response.ok) return;
        const json = await parseJsonSafely<NotificationCountResponse>(response);
        if (!controller.signal.aborted && typeof json?.unreadCount === "number") {
          setUnreadNotifications(json.unreadCount);
        }
      } catch {
        // Keep the last known count on failure.
      }
    }
    void loadNotifications();
    return () => { controller.abort(); };
  }, [pathname, badgeUserId, isRestoring, queryClient]);

  useEffect(() => {
    if (!badgeUserId) return;
    const refreshBookingBadges = () => {
      void queryClient.invalidateQueries(
        { queryKey: dashboardStatsQueryKey(badgeUserId) },
        { cancelRefetch: false },
      );
    };
    window.addEventListener(BOOKING_CHANGE_SYNC_EVENT, refreshBookingBadges);
    return () => window.removeEventListener(BOOKING_CHANGE_SYNC_EVENT, refreshBookingBadges);
  }, [badgeUserId, queryClient]);

  useEffect(() => {
    function handleNotificationCountChanged(event: Event) {
      const unreadCount = (event as CustomEvent<{ unreadCount?: unknown }>).detail?.unreadCount;
      if (typeof unreadCount === "number") {
        setUnreadNotifications(Math.max(0, unreadCount));
      }
    }

    window.addEventListener(NOTIFICATION_COUNT_CHANGED_EVENT, handleNotificationCountChanged);
    return () => window.removeEventListener(NOTIFICATION_COUNT_CHANGED_EVENT, handleNotificationCountChanged);
  }, []);

  // Command palette state
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    if (isCollaborator) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        const onSettings = pathname.startsWith("/settings");
        if (onSettings) return;
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCollaborator, pathname]);

  // Offline detection
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Shared-machine hygiene: drop persisted history and cached entity data
      // so the next person can't read the previous user's traces.
      clearLocalTraces();
      queryClient.clear();
      router.replace("/login");
    } catch {
      setLoggingOut(false);
      toast.error("Could not log out. Check your connection and try again.");
    }
  }

  if (isLoading) {
    return (
      <OperationalLoadingState
        variant="page"
        title="Loading workspace"
        description="Checking your session and preparing the navigation."
        rows={3}
      />
    );
  }

  if (!user) return null;

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <a href="#main-content" className="absolute -top-[100px] left-4 z-[var(--z-sidebar)] px-4 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] rounded-[var(--radius)] font-[var(--weight-semibold)] text-[var(--text-base)] no-underline transition-[top] duration-200 focus:top-4">Skip to content</a>

      {/* Command palette */}
      {pathname !== "/welcome" && <ProfileCompletionWizard autoOpen={pathname !== "/"} />}

      {earnedBadgeQueue[0] && (
        <BadgeEarnedCelebration
          reward={earnedBadgeQueue[0]}
          remaining={earnedBadgeQueue.length - 1}
          onDismiss={() => setEarnedBadgeQueue((current) => current.slice(1))}
          onViewShelf={rewardUserId ? () => router.push(`/staff/${rewardUserId}?tab=badges`) : undefined}
        />
      )}


      {!isCollaborator && (
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} user={user} pathname={pathname} />
      )}

      <AppSidebar
        user={user}
        onSignOut={handleLogout}
        isLoggingOut={loggingOut}
        overdueBadgeCount={overdueBadgeCount}
        dueTodayBadgeCount={dueTodayBadgeCount}
        onSearch={isCollaborator ? undefined : () => setCmdOpen(true)}
        attentionCounts={{
          "/wishlist": { count: sidebarCounts?.openWishes ?? 0, suffix: "waiting on a decision" },
          "/licenses": { count: sidebarCounts?.reportedLicenses ?? 0, suffix: "reported codes" },
        }}
      />

      <div className="flex flex-1 flex-col min-w-0 max-md:pl-[env(safe-area-inset-left,0px)] max-md:pr-[env(safe-area-inset-right,0px)] print:ml-0">
        {!online && (
          <div className="bg-[var(--orange)] px-4 py-1.5 text-center text-[var(--text-sm)] font-[var(--weight-semibold)] text-black" role="status">
            You&apos;re offline. Changes will sync when connected.
          </div>
        )}
        <BreadcrumbProvider>
          <div className="sticky top-0 z-40 print:hidden">
            <RolePreviewBanner user={user} />
            <AppTopBar
              isCollaborator={isCollaborator}
              onSearch={() => setCmdOpen(true)}
              unreadNotifications={unreadNotifications}
              user={user}
            />
          </div>
          <main id="main-content" className="flex-1 px-8 py-5 max-md:p-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom,0px))] print:pb-0">
            {children}
          </main>
        </BreadcrumbProvider>
      </div>

      <MobileTabBar items={visibleBottomNavItems} pathname={pathname} overdueCount={overdueBadgeCount} showMore={!isCollaborator} />
    </SidebarProvider>
  );
}
