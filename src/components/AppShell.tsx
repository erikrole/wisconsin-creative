"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SearchIcon, ClipboardCheckIcon, CalendarCheckIcon, BellIcon, UserIcon, LayoutGridIcon, LayersIcon, BookOpenIcon, ArrowRightIcon } from "lucide-react";
import AppSidebar from "./Sidebar";
import { AssetImage } from "@/components/AssetImage";
import { OperationalPartialResultsAlert } from "@/components/OperationalFeedback";
import { OperationalLoadingState } from "@/components/OperationalLoadingState";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import PageBreadcrumb from "@/components/PageBreadcrumb";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { STATUS_STYLES } from "@/lib/status-styles";
import { useQueryClient } from "@tanstack/react-query";
import { type CurrentUser, useCurrentUser } from "@/hooks/use-current-user";
import { RECENT_SEARCHES_STORAGE_KEY, clearLocalTraces } from "@/lib/local-traces";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { getVisiblePageSearchResults, type PageSearchResult } from "@/lib/search-pages";
import { assetSearchTitle } from "@/lib/search-result-title";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BOOKING_CHANGE_SYNC_EVENT } from "@/hooks/use-booking-change-sync";
import { NOTIFICATION_COUNT_CHANGED_EVENT } from "@/lib/notification-count-sync";
import { ProfileCompletionWizard } from "@/components/profile-completion/ProfileCompletionWizard";
import { hasDashboardCountFailure } from "@/app/(app)/dashboard-types";
import {
  BadgeEarnedCelebration,
  type EarnedBadgeReward,
} from "@/components/badges/BadgeEarnedCelebration";
import { RolePreviewBanner, RolePreviewControl } from "@/components/RolePreviewControl";

type EntitySearchResult = {
  type: "item" | "checkout" | "reservation" | "user";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  imageUrl?: string | null;
  // Item-specific fields for status display
  computedStatus?: string;
  activeBooking?: { requesterName: string; requesterAvatarUrl?: string | null; isOverdue: boolean; endsAt?: string } | null;
};

type SearchResult = EntitySearchResult | PageSearchResult;

type ApiSearchList<T> = {
  data?: T[];
};

type AssetSearchItem = {
  id: string;
  assetTag?: string | null;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  type?: string | null;
  imageUrl?: string | null;
  computedStatus?: string | null;
  activeBooking?: {
    requesterName?: string | null;
    requesterAvatarUrl?: string | null;
    isOverdue?: boolean | null;
    endsAt?: string | null;
  } | null;
};

type BookingSearchItem = {
  id: string;
  title?: string | null;
  requester?: { name?: string | null } | null;
};

type UserSearchItem = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type NotificationCountResponse = {
  unreadCount?: unknown;
};

type DashboardStatsBadgeResponse = {
  data?: {
    myOverdueCount?: unknown;
    myDueTodayCount?: unknown;
  };
  partialFailures?: unknown[];
};

type RecentBadgeAwardsResponse = {
  data?: {
    awards?: EarnedBadgeReward[];
    nextCursor?: string;
  };
};

function dashboardBadgeCountsAreTrusted(response: DashboardStatsBadgeResponse | null) {
  const partialFailures = Array.isArray(response?.partialFailures)
    ? response.partialFailures.filter((failure): failure is string => typeof failure === "string")
    : [];
  return !hasDashboardCountFailure(partialFailures);
}

const SEARCH_RESULT_SOURCES = {
  items: "Items",
  checkouts: "Checkouts",
  reservations: "Reservations",
  users: "Users",
} as const;

type BottomNavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: "overdue";
};

const bottomNavItems: BottomNavItem[] = [
  { label: "Home", href: "/", icon: LayoutGridIcon },
  { label: "Schedule", href: "/schedule", icon: CalendarCheckIcon },
  { label: "Bookings", href: "/bookings", icon: BookOpenIcon, badge: "overdue" as const },
  { label: "Items", href: "/items", icon: LayersIcon },
];

const collaboratorBottomNavItems: BottomNavItem[] = [
  { label: "Home", href: "/", icon: LayoutGridIcon },
  { label: "Schedule", href: "/schedule", icon: CalendarCheckIcon },
  { label: "My Gear", href: "/bookings", icon: BookOpenIcon, badge: "overdue" as const },
  { label: "Items", href: "/items", icon: LayersIcon },
  { label: "People", href: "/users", icon: UserIcon },
  { label: "Notifications", href: "/notifications", icon: BellIcon },
];

const COLLABORATOR_ROUTE_CAPABILITY: Array<{ matches: (pathname: string) => boolean; capability: string }> = [
  { matches: (value) => value === "/schedule" || value.startsWith("/schedule/"), capability: "PUBLISHED_SCHEDULE_VIEW" },
  { matches: (value) => value === "/items" || (value.startsWith("/items/") && value !== "/items/new"), capability: "GEAR_CATALOG_VIEW" },
  { matches: (value) => value === "/bookings" || value.startsWith("/bookings/"), capability: "MY_GEAR_VIEW" },
  { matches: (value) => value === "/reservations/new", capability: "RESERVATION_CREATE" },
  { matches: (value) => value === "/users" || value.startsWith("/users/"), capability: "PEOPLE_DIRECTORY_VIEW" },
];

function collaboratorCanVisit(pathname: string, user: CurrentUser): boolean {
  const alwaysAllowed = pathname === "/"
    || pathname === "/welcome"
    || pathname === "/profile"
    || pathname === "/scoreboard"
    || pathname.startsWith("/scoreboard/")
    || pathname === "/settings/profile"
    || pathname === "/settings/security"
    || pathname === "/settings/notifications"
    || pathname === `/users/${user.id}`
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
  const [overdueBadgeCount, setOverdueBadgeCount] = useState(0);
  const [dueTodayBadgeCount, setDueTodayBadgeCount] = useState(0);
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
    let stopped = false;
    let loading = false;
    let memoryCursor: string | null = null;

    async function loadEarnedBadges() {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;

      try {
        let after = memoryCursor;
        try {
          after = localStorage.getItem(cursorKey) ?? after;
        } catch {
          // Keep polling with the in-memory cursor when storage is unavailable.
        }
        const search = after ? `?after=${encodeURIComponent(after)}` : "";
        const response = await fetch(`/api/badges/recent${search}`);
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
        await fetch("/api/badges/events/app-open", { method: "POST" });
      } catch {
        // Easter eggs are ambient. Reward polling continues normally.
      }
      await loadEarnedBadges();
    }

    void refreshBadgeRewards();
    const interval = window.setInterval(loadEarnedBadges, 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshBadgeRewards();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // Deliberately keyed on identity alone. An app open is a foreground event,
    // not a navigation, and this effect owns a POST with a durable side effect.
  }, [isRolePreview, rewardUserId]);

  // Badge counts — refresh on navigation so counts stay fresh after user actions
  useEffect(() => {
    if (!user) return;

    const controller = new AbortController();
    async function loadBadgeCounts() {
      try {
        const [notificationsResult, dashboardResult] = await Promise.allSettled([
          fetch("/api/notifications/count", { signal: controller.signal }),
          fetch("/api/dashboard/stats", { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;

        if (notificationsResult.status === "fulfilled") {
          if (handleAuthRedirect(notificationsResult.value, pathname)) return;
          if (notificationsResult.value.ok) {
            const json = await parseJsonSafely<NotificationCountResponse>(notificationsResult.value);
            if (typeof json?.unreadCount === "number") {
              setUnreadNotifications(json.unreadCount);
            }
          }
        }

        if (dashboardResult.status === "fulfilled") {
          if (handleAuthRedirect(dashboardResult.value, pathname)) return;
          if (dashboardResult.value.ok) {
            const json = await parseJsonSafely<DashboardStatsBadgeResponse>(dashboardResult.value);
            if (dashboardBadgeCountsAreTrusted(json)) {
              const count = json?.data?.myOverdueCount;
              const dueToday = json?.data?.myDueTodayCount;
              // User-scoped overdue count so STUDENT sees only their own overdue
              if (typeof count === "number") {
                setOverdueBadgeCount(count);
              }
              if (typeof dueToday === "number") {
                setDueTodayBadgeCount(dueToday);
              }
            }
          }
        }
      } catch {
        // Badge counts are ambient chrome; keep the last known values on failure.
      }
    }

    loadBadgeCounts();

    return () => { controller.abort(); };
  }, [pathname, user]);

  useEffect(() => {
    if (!user) return;

    const refreshBookingBadges = async () => {
      try {
        const response = await fetch("/api/dashboard/stats");
        if (handleAuthRedirect(response, pathname) || !response.ok) return;
        const json = await parseJsonSafely<DashboardStatsBadgeResponse>(response);
        if (dashboardBadgeCountsAreTrusted(json)) {
          const overdue = json?.data?.myOverdueCount;
          const dueToday = json?.data?.myDueTodayCount;
          if (typeof overdue === "number") setOverdueBadgeCount(overdue);
          if (typeof dueToday === "number") setDueTodayBadgeCount(dueToday);
        }
      } catch {
        // Keep the last known chrome counts until the next sync/navigation refresh.
      }
    };

    window.addEventListener(BOOKING_CHANGE_SYNC_EVENT, refreshBookingBadges);
    return () => window.removeEventListener(BOOKING_CHANGE_SYNC_EVENT, refreshBookingBadges);
  }, [pathname, user]);

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
  const [cmdQuery, setCmdQuery] = useState("");
  const [cmdResults, setCmdResults] = useState<SearchResult[]>([]);
  const [cmdLoading, setCmdLoading] = useState(false);
  const [cmdError, setCmdError] = useState<"network" | "server" | null>(null);
  const [cmdPartialFailures, setCmdPartialFailures] = useState<string[]>([]);
  const cmdAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isCollaborator) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCollaborator]);

  // Live search when query changes
  useEffect(() => {
    if (isCollaborator) {
      setCmdResults([]);
      setCmdLoading(false);
      setCmdError(null);
      setCmdPartialFailures([]);
      return;
    }
    const q = cmdQuery.trim();
    if (!q) { setCmdResults([]); setCmdLoading(false); setCmdError(null); setCmdPartialFailures([]); return; }

    setCmdLoading(true);
    setCmdError(null);
    setCmdPartialFailures([]);
    cmdAbortRef.current?.abort();
    const controller = new AbortController();
    cmdAbortRef.current = controller;

    const timer = setTimeout(async () => {
      const encoded = encodeURIComponent(q);
      try {
        const [itemsRes, checkoutsRes, reservationsRes, usersRes] = await Promise.allSettled([
          fetch(`/api/assets?q=${encoded}&limit=8`, { signal: controller.signal }),
          fetch(`/api/checkouts?q=${encoded}&status_in=OPEN,PENDING_PICKUP&limit=8`, { signal: controller.signal }),
          fetch(`/api/reservations?q=${encoded}&status=BOOKED&limit=8`, { signal: controller.signal }),
          fetch(`/api/users?q=${encoded}&limit=5`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        const merged: SearchResult[] = getVisiblePageSearchResults(
          user?.role,
          q,
          8,
          user?.canViewUsageAnalytics === true,
        );
        const failures: string[] = [];
        if (itemsRes.status === "fulfilled" && handleAuthRedirect(itemsRes.value, pathname)) return;
        if (checkoutsRes.status === "fulfilled" && handleAuthRedirect(checkoutsRes.value, pathname)) return;
        if (reservationsRes.status === "fulfilled" && handleAuthRedirect(reservationsRes.value, pathname)) return;
        if (usersRes.status === "fulfilled" && handleAuthRedirect(usersRes.value, pathname)) return;

        if (itemsRes.status === "fulfilled" && itemsRes.value.ok) {
          const json = await parseJsonSafely<ApiSearchList<AssetSearchItem>>(itemsRes.value);
          const data = json?.data;
          if (!data) failures.push(SEARCH_RESULT_SOURCES.items);
          for (const item of (data ?? []).slice(0, 8)) {
            merged.push({
              type: "item", id: item.id,
              title: assetSearchTitle(item),
              subtitle: "",
              href: `/items/${item.id}`,
              imageUrl: item.imageUrl ?? null,
              computedStatus: item.computedStatus ?? undefined,
              activeBooking: item.activeBooking ? {
                requesterName: item.activeBooking.requesterName ?? "",
                requesterAvatarUrl: item.activeBooking.requesterAvatarUrl ?? null,
                isOverdue: !!item.activeBooking.isOverdue,
                endsAt: item.activeBooking.endsAt ?? undefined,
              } : null,
            });
          }
        } else {
          failures.push(SEARCH_RESULT_SOURCES.items);
        }
        if (checkoutsRes.status === "fulfilled" && checkoutsRes.value.ok) {
          const json = await parseJsonSafely<ApiSearchList<BookingSearchItem>>(checkoutsRes.value);
          const data = json?.data;
          if (!data) failures.push(SEARCH_RESULT_SOURCES.checkouts);
          for (const b of (data ?? []).slice(0, 8)) {
            merged.push({ type: "checkout", id: b.id, title: b.title ?? "Untitled checkout", subtitle: b.requester?.name || "", href: `/checkouts/${b.id}` });
          }
        } else {
          failures.push(SEARCH_RESULT_SOURCES.checkouts);
        }
        if (reservationsRes.status === "fulfilled" && reservationsRes.value.ok) {
          const json = await parseJsonSafely<ApiSearchList<BookingSearchItem>>(reservationsRes.value);
          const data = json?.data;
          if (!data) failures.push(SEARCH_RESULT_SOURCES.reservations);
          for (const b of (data ?? []).slice(0, 8)) {
            merged.push({ type: "reservation", id: b.id, title: b.title ?? "Untitled reservation", subtitle: b.requester?.name || "", href: `/reservations/${b.id}` });
          }
        } else {
          failures.push(SEARCH_RESULT_SOURCES.reservations);
        }
        if (usersRes.status === "fulfilled" && usersRes.value.ok) {
          const json = await parseJsonSafely<ApiSearchList<UserSearchItem>>(usersRes.value);
          const data = json?.data;
          if (!data) failures.push(SEARCH_RESULT_SOURCES.users);
          for (const u of (data ?? []).slice(0, 5)) {
            merged.push({ type: "user", id: u.id, title: u.name ?? "Unnamed user", subtitle: u.email || "", href: `/users/${u.id}` });
          }
        } else {
          failures.push(SEARCH_RESULT_SOURCES.users);
        }
        if (!controller.signal.aborted) {
          setCmdResults(merged);
          setCmdPartialFailures(failures);
          setCmdError(failures.length === 4 && merged.length === 0 ? "server" : null);
          setCmdLoading(false);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) { setCmdResults([]); setCmdError("network"); setCmdLoading(false); }
      }
    }, 200);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [cmdQuery, isCollaborator, pathname, user?.canViewUsageAnalytics, user?.role]);

  // Recent searches (localStorage)
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  function addRecentSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentSearches.filter((s) => s !== trimmed)].slice(0, 5);
    setRecentSearches(updated);
    try {
      localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(updated));
    } catch { /* ignore */ }
  }

  function handleCmdSelect(href: string) {
    if (cmdQuery.trim()) addRecentSearch(cmdQuery.trim());
    setCmdOpen(false);
    setCmdQuery("");
    setCmdResults([]);
    router.push(href);
  }

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
      setRecentSearches([]);
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
        />
      )}

      {!isCollaborator && <CommandDialog open={cmdOpen} onOpenChange={(open) => { setCmdOpen(open); if (!open) { setCmdQuery(""); setCmdResults([]); setCmdError(null); setCmdPartialFailures([]); } }}>
        <CommandInput placeholder="Search tag, borrower, page, setting, report..." value={cmdQuery} onValueChange={setCmdQuery} />
        <CommandList>
          {!cmdQuery.trim() && recentSearches.length > 0 && (
            <CommandGroup heading="Recent searches">
              {recentSearches.map((q) => (
                <CommandItem key={q} value={q} onSelect={() => { setCmdQuery(q); }}>
                  <SearchIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                  {q}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {cmdLoading && (
            <OperationalLoadingState
              variant="command"
              title="Searching Gear Tracker"
              rows={3}
            />
          )}
          {!cmdLoading && cmdError && cmdQuery.trim() && (
            <CommandEmpty>{cmdError === "network" ? "Search is offline. Check your connection and try again." : "Search is temporarily unavailable. Try the page shortcut or search again."}</CommandEmpty>
          )}
          {!cmdLoading && !cmdError && cmdQuery.trim() && cmdResults.length === 0 && (
            <CommandEmpty>No matches. Try a tag, borrower, page name, setting, or report.</CommandEmpty>
          )}
          {!cmdLoading && !cmdError && cmdPartialFailures.length > 0 && cmdResults.length > 0 && (
            <OperationalPartialResultsAlert
              className="mx-2 mb-2 text-xs"
              failureLabel="Unavailable result types"
              failures={cmdPartialFailures}
              noun="result type"
              recoveryCopy="Showing available matches. Refresh before treating this search as complete."
              title="Some result types did not load"
            />
          )}
          {cmdResults.filter((r) => r.type === "page").length > 0 && (
            <CommandGroup heading="Go to">
              {cmdResults.filter((r): r is PageSearchResult => r.type === "page").map((r) => (
                <CommandItem key={r.id} value={`${r.title} ${r.subtitle} ${r.href} ${r.keywords.join(" ")}`} onSelect={() => handleCmdSelect(r.href)} className="gap-3">
                  <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {cmdResults.filter((r) => r.type === "item").length > 0 && (
            <CommandGroup heading="Items">
              {cmdResults.filter((r): r is EntitySearchResult => r.type === "item").map((r) => {
                const status = r.computedStatus ?? "AVAILABLE";
                const isOverdue = r.activeBooking?.isOverdue ?? false;
                const badgeStyle = isOverdue ? STATUS_STYLES.red.badge
                  : status === "CHECKED_OUT" ? STATUS_STYLES.blue.badge
                  : status === "RESERVED" ? STATUS_STYLES.purple.badge
                  : status === "MAINTENANCE" ? STATUS_STYLES.orange.badge
                  : status === "RETIRED" ? STATUS_STYLES.gray.badge
                  : STATUS_STYLES.green.badge;
                const statusLabel = isOverdue ? "Overdue"
                  : status === "CHECKED_OUT" ? "Checked Out"
                  : status === "RESERVED" ? "Reserved"
                  : status === "MAINTENANCE" ? "In maintenance"
                  : status === "RETIRED" ? "Retired"
                  : "Available";
                const showHolder = !!r.activeBooking && (isOverdue || status === "CHECKED_OUT" || status === "RESERVED");
                return (
                  <CommandItem key={r.id} value={r.title} onSelect={() => handleCmdSelect(r.href)} className="gap-3">
                    <AssetImage src={r.imageUrl} alt={r.title} size={32} className="rounded" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.title}</div>
                      <div className="mt-0.5">
                        <Badge
                          className={badgeStyle}
                          size="sm"
                          title={showHolder ? `${statusLabel} by ${r.activeBooking?.requesterName}` : statusLabel}
                        >
                          {showHolder && (
                            <UserAvatar
                              name={r.activeBooking?.requesterName ?? "Unknown"}
                              avatarUrl={r.activeBooking?.requesterAvatarUrl}
                              size="xs"
                            />
                          )}
                          {statusLabel}
                        </Badge>
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {cmdResults.filter((r) => r.type === "checkout").length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Checkouts">
                {cmdResults.filter((r): r is EntitySearchResult => r.type === "checkout").map((r) => (
                  <CommandItem key={r.id} value={`${r.title} ${r.subtitle}`} onSelect={() => handleCmdSelect(r.href)}>
                    <ClipboardCheckIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.title}</div>
                      {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {cmdResults.filter((r) => r.type === "reservation").length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Reservations">
                {cmdResults.filter((r): r is EntitySearchResult => r.type === "reservation").map((r) => (
                  <CommandItem key={r.id} value={`${r.title} ${r.subtitle}`} onSelect={() => handleCmdSelect(r.href)}>
                    <CalendarCheckIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.title}</div>
                      {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {cmdResults.filter((r) => r.type === "user").length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Users">
                {cmdResults.filter((r): r is EntitySearchResult => r.type === "user").map((r) => (
                  <CommandItem key={r.id} value={`${r.title} ${r.subtitle}`} onSelect={() => handleCmdSelect(r.href)}>
                    <UserIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.title}</div>
                      {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {cmdQuery.trim() && cmdResults.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem onSelect={() => handleCmdSelect(`/search?q=${encodeURIComponent(cmdQuery.trim())}`)}>
                  <SearchIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                  See all results for &ldquo;{cmdQuery.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>}

      <AppSidebar
        user={user}
        onSignOut={handleLogout}
        isLoggingOut={loggingOut}
        overdueBadgeCount={overdueBadgeCount}
        dueTodayBadgeCount={dueTodayBadgeCount}
        unreadNotifications={unreadNotifications}
      />

      {!online && (
        <div className="fixed top-0 left-0 right-0 z-[var(--z-offline)] bg-[var(--orange)] text-black text-center px-4 py-1.5 text-[var(--text-sm)] font-[var(--weight-semibold)]" role="status">
          You&apos;re offline. Changes will sync when connected.
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0 max-md:pl-[env(safe-area-inset-left,0px)] max-md:pr-[env(safe-area-inset-right,0px)] print:ml-0">
        <div className="sticky top-0 z-40 print:hidden">
          <RolePreviewBanner user={user} />
          <header
            data-app-shell-header
            className="h-12 bg-card border-b border-black/[0.06] flex items-center px-6 gap-3 max-md:px-3 max-md:gap-2"
          >
          <SidebarTrigger className="shrink-0 text-foreground hover:bg-card hover:text-foreground" />
          {/* Search trigger (desktop + mobile) */}
          {!isCollaborator && <button
            className="flex-1 max-w-[400px] flex items-center gap-2 w-full py-2 px-3 border border-border rounded-lg bg-background cursor-pointer transition-colors text-[13px] text-muted-foreground hover:border-primary max-md:hidden [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
            onClick={() => setCmdOpen(true)}
            type="button"
            aria-label="Search items, checkouts, reservations, users (⌘K)"
          >
            <SearchIcon className="size-4" />
            <span>Search... (⌘K)</span>
          </button>}
          {!isCollaborator && <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden max-md:flex relative p-2 no-underline text-muted-foreground rounded-lg transition-colors hover:bg-black/5 hover:text-foreground max-md:p-2.5 max-md:min-w-[44px] max-md:min-h-[44px] max-md:items-center max-md:justify-center"
                onClick={() => setCmdOpen(true)}
                aria-label="Search"
              >
                <SearchIcon className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search (⌘K)</TooltipContent>
          </Tooltip>}
          <div className="flex items-center gap-1 ml-auto">
            <RolePreviewControl user={user} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="relative p-2 no-underline text-muted-foreground rounded-lg transition-colors hover:bg-black/5 hover:text-foreground max-md:p-2.5 max-md:min-w-[44px] max-md:min-h-[44px] max-md:flex max-md:items-center max-md:justify-center [&_a]:no-underline" asChild>
                  <Link prefetch={false} href="/notifications" aria-label={unreadNotifications > 0 ? `Notifications (${unreadNotifications} unread)` : "Notifications"}>
                    <BellIcon className="size-5" />
                    {unreadNotifications > 0 && (
                      <span className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground text-[length:var(--text-2xs)] font-bold rounded-full px-[5px] min-w-4 h-4 leading-4 text-center tabular-nums" aria-hidden="true">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>
                    )}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
          </div>
          </header>
        </div>
        <BreadcrumbProvider>
          <main id="main-content" className="py-7 px-8 flex-1 max-md:p-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom,0px))] print:pb-0">
            <div
              data-app-shell-breadcrumb-frame={pathname === "/schedule" ? "" : undefined}
              className={cn(
                pathname === "/schedule"
                  && cn(
                    "sticky z-[35] -mx-8 bg-background/95 px-8 backdrop-blur supports-[backdrop-filter]:bg-background/90 max-md:-mx-4 max-md:px-4",
                    isRolePreview ? "top-[5.5rem]" : "top-12",
                  ),
              )}
            >
              <PageBreadcrumb />
            </div>
            {children}
          </main>
        </BreadcrumbProvider>
      </div>

      {/* Mobile bottom nav */}
      <nav aria-label="Mobile navigation" className="hidden max-md:block fixed inset-x-0 bottom-0 z-[var(--z-overlay)] border-t border-border/70 bg-card/95 px-2 pb-[calc(6px+env(safe-area-inset-bottom,0px))] pt-2 shadow-[0_-10px_28px_rgba(15,23,42,0.10)] backdrop-blur supports-[backdrop-filter]:bg-card/90 print:hidden">
        <div className="mx-auto grid max-w-[460px] gap-1" style={{ gridTemplateColumns: `repeat(${visibleBottomNavItems.length}, minmax(0, 1fr))` }}>
          {visibleBottomNavItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const badgeCount = item.badge === "overdue" ? overdueBadgeCount : 0;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                aria-label={badgeCount > 0 ? `${item.label}, ${badgeCount} overdue` : item.label}
                className={cn(
                  "group relative flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[9.5px] font-semibold leading-none text-muted-foreground no-underline outline-none transition-[background-color,color,box-shadow,scale] duration-150 [-webkit-tap-highlight-color:transparent] hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.96]",
                  isActive && "bg-muted text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]",
                )}
              >
                <span
                  className={cn(
                    "relative flex size-7 items-center justify-center rounded-full transition-[background-color,color,box-shadow,scale] duration-150",
                    isActive
                      ? "bg-[var(--wi-red)]/10 text-[var(--wi-red)]"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-[18px]" />
                  {badgeCount > 0 && (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-4 text-destructive-foreground tabular-nums shadow-sm">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </span>
                <span className={cn("max-w-full truncate tracking-normal", isActive && "text-[var(--wi-red)]")}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </SidebarProvider>
  );
}
