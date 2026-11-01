"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  RefreshCw,
  Settings2Icon,
  MoreHorizontalIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import EmptyState from "@/components/EmptyState";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import { useUrlState } from "@/hooks/use-url-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INSTITUTION_TZ } from "@/lib/format";
import { Spinner } from "@/components/ui/spinner";
import { dispatchNotificationCountChanged } from "@/lib/notification-count-sync";
import { notificationDestinationPath } from "@/lib/notification-destination";
import { formatNotificationTime as formatTime, notificationMeta } from "@/lib/notification-meta";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  channel: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

type NotificationsData = {
  notifications: Notification[];
  total: number;
  inboxTotal: number;
  unreadCount: number;
};

type MeData = {
  id: string;
  role: string;
};

function canProcessNotifications(role: string | undefined) {
  return role === "ADMIN" || role === "STAFF";
}

function notificationDate(notification: Notification) {
  return notification.sentAt ?? notification.createdAt;
}

const centralDay = new Intl.DateTimeFormat("en-CA", { timeZone: INSTITUTION_TZ });

/** Day group for a notification on the Central calendar: Today, Yesterday, This week, or the date. */
function dayLabel(dateStr: string): string {
  const day = (date: Date) => Date.parse(centralDay.format(date));
  const diffDays = Math.round((day(new Date()) - day(new Date(dateStr))) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: INSTITUTION_TZ });
}

function NotificationsSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 p-1">
          <Skeleton className="size-9 rounded-full shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

const LIMIT = 20;

export default function NotificationsPage() {
  const [processing, setProcessing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingIds, setMarkingIds] = useState<Set<string>>(() => new Set());
  const processingRef = useRef(false);
  const markingAllRef = useRef(false);
  const markingIdsRef = useRef(new Set<string>());

  // URL-synced filters
  const [page, setPage] = useUrlState<number>(
    "page",
    (v) => {
      const parsed = v ? Number(v) : 0;
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    },
    (v) => (v === 0 ? null : String(v)),
  );
  const [unreadOnly, setUnreadOnly] = useUrlState<boolean>(
    "unread",
    (v) => v === "true",
    (v) => (v ? "true" : null),
  );

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(LIMIT));
    params.set("offset", String(page * LIMIT));
    if (unreadOnly) params.set("unread", "true");
    return `/api/notifications?${params}`;
  }, [page, unreadOnly]);

  const queryClient = useQueryClient();
  const queryKey = ["fetch", fetchUrl];

  const { data: meData } = useFetch<MeData>({
    url: "/api/me",
    transform: (json) => (json as Record<string, unknown>).user as MeData,
    refetchOnFocus: false,
  });

  const { data, loading, refreshing, error, reload } = useFetch<NotificationsData>({
    url: fetchUrl,
    transform: (json) => ({
      notifications: (json.data as Notification[]) ?? [],
      total: (json.total as number) ?? 0,
      inboxTotal: (json.inboxTotal as number) ?? (json.total as number) ?? 0,
      unreadCount: (json.unreadCount as number) ?? 0,
    }),
  });

  const rawNotifications = data?.notifications;
  const notifications = useMemo(() => rawNotifications ?? [], [rawNotifications]);
  const total = data?.total ?? 0;
  const inboxTotal = data?.inboxTotal ?? 0;
  const unreadCount = data?.unreadCount ?? 0;
  const hasNotifications = inboxTotal > 0;
  const canProcess = canProcessNotifications(meData?.role);

  /** Optimistically update the raw query cache for notifications */
  const setNotificationsData = useCallback(
    (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      queryClient.setQueryData<Record<string, unknown>>(["fetch", fetchUrl], (prev) =>
        prev ? updater(prev) : prev,
      );
    },
    [fetchUrl, queryClient],
  );

  const invalidateNotificationQueries = useCallback(() => queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "fetch"
      && typeof query.queryKey[1] === "string"
      && query.queryKey[1].startsWith("/api/notifications?"),
  }), [queryClient]);

  const totalPages = Math.ceil(total / LIMIT);

  useEffect(() => {
    if (loading || page === 0) return;
    if (total === 0 || page >= totalPages) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [loading, page, setPage, total, totalPages]);

  async function markAllRead() {
    if (markingAllRef.current) return;
    markingAllRef.current = true;
    setMarkingAll(true);

    // Save previous state for rollback
    const prevData = queryClient.getQueryData<Record<string, unknown>>(queryKey);

    // Optimistic update: mark all notifications as read
    const now = new Date().toISOString();
    setNotificationsData((prev) => ({
      ...prev,
      unreadCount: 0,
      total: unreadOnly ? 0 : prev.total,
      data: unreadOnly
        ? []
        : ((prev.data as Notification[]) ?? []).map((n) => n.readAt ? n : { ...n, readAt: now }),
    }));
    dispatchNotificationCountChanged(0);

    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const message = await parseErrorMessage(res, "Failed to mark notifications as read");
        // Rollback on server error
        if (prevData) {
          queryClient.setQueryData(queryKey, prevData);
          dispatchNotificationCountChanged((prevData.unreadCount as number) ?? unreadCount);
        }
        toast.error(message);
      } else {
        await invalidateNotificationQueries();
      }
    } catch (err) {
      // Rollback on network error
      if (prevData) {
        queryClient.setQueryData(queryKey, prevData);
        dispatchNotificationCountChanged((prevData.unreadCount as number) ?? unreadCount);
      }
      toast.error(err instanceof TypeError
        ? "You’re offline. Check your connection."
        : "Failed to mark notifications as read. Please try again.");
    } finally {
      markingAllRef.current = false;
      setMarkingAll(false);
    }
  }

  async function markRead(id: string) {
    if (markingIdsRef.current.has(id)) return;
    markingIdsRef.current.add(id);
    setMarkingIds(new Set(markingIdsRef.current));

    // Save previous state for rollback
    const prevData = queryClient.getQueryData<Record<string, unknown>>(queryKey);

    // Optimistic update: mark the single notification as read
    const now = new Date().toISOString();
    setNotificationsData((prev) => ({
      ...prev,
      unreadCount: Math.max(0, ((prev.unreadCount as number) ?? 0) - 1),
      total: unreadOnly ? Math.max(0, ((prev.total as number) ?? 0) - 1) : prev.total,
      data: unreadOnly
        ? ((prev.data as Notification[]) ?? []).filter((n) => n.id !== id)
        : ((prev.data as Notification[]) ?? []).map((n) => n.id === id ? { ...n, readAt: now } : n),
    }));
    dispatchNotificationCountChanged(Math.max(0, unreadCount - 1));

    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read", id }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const message = await parseErrorMessage(res, "Failed to mark notification as read");
        // Rollback on server error
        if (prevData) {
          queryClient.setQueryData(queryKey, prevData);
          dispatchNotificationCountChanged((prevData.unreadCount as number) ?? unreadCount);
        }
        toast.error(message);
      } else {
        await invalidateNotificationQueries();
      }
    } catch (err) {
      // Rollback on network error
      if (prevData) {
        queryClient.setQueryData(queryKey, prevData);
        dispatchNotificationCountChanged((prevData.unreadCount as number) ?? unreadCount);
      }
      toast.error(err instanceof TypeError
        ? "You’re offline. Check your connection."
        : "Failed to mark notification as read. Please try again.");
    } finally {
      markingIdsRef.current.delete(id);
      setMarkingIds(new Set(markingIdsRef.current));
    }
  }

  async function runProcessing() {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    try {
      const res = await fetch("/api/notifications/process", {
        method: "POST",
      });
      if (handleAuthRedirect(res, "/notifications")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to process overdue notifications"));
        return;
      }
      const json = await parseJsonSafely<{ scanned?: number; notificationsCreated?: number }>(res);
      const created = json?.notificationsCreated ?? 0;
      toast.success(
        created > 0
          ? `Overdue check complete: ${created} notification${created === 1 ? "" : "s"} created.`
          : "Overdue check complete: no new notifications.",
      );
      reload();
    } catch (err) {
      toast.error(err instanceof TypeError
        ? "You’re offline. Check your connection."
        : "Failed to process overdue notifications");
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }

  // Group notifications by day
  const grouped = useMemo(() => {
    const groups: { label: string; items: Notification[] }[] = [];
    let currentLabel = "";
    for (const n of notifications) {
      const label = dayLabel(notificationDate(n));
      if (label !== currentLabel) {
        groups.push({ label, items: [n] });
        currentLabel = label;
      } else {
        groups[groups.length - 1]!.items.push(n); // at least one group exists: push happened above when label changed
      }
    }
    return groups;
  }, [notifications]);

  const visibleStart = total === 0 ? 0 : page * LIMIT + 1;
  const visibleEnd = Math.min((page + 1) * LIMIT, total);

  return (
    <FadeUp>
      <PageHeader title="Notifications" className="max-sm:flex-row max-sm:items-center max-sm:justify-between">
        {unreadCount > 0 && (
          <Button className="h-10" variant="outline" onClick={markAllRead} disabled={markingAll}>
            {markingAll ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            {markingAll ? "Marking all read" : "Mark all read"}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-10" variant="outline" aria-label="More notification actions">
              <MoreHorizontalIcon data-icon="inline-start" />
              <span className="max-sm:sr-only">More</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={reload} disabled={loading || refreshing}>
              <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </DropdownMenuItem>
            {canProcess && (
              <DropdownMenuItem onSelect={runProcessing} disabled={processing}>
                {processing ? "Checking overdue" : "Check overdue"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/notifications">
                <Settings2Icon className="size-4" />
                Preferences
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-2">
          <Tabs
            panels={false}
            value={unreadOnly ? "unread" : "all"}
            onValueChange={(value) => {
              setUnreadOnly(value === "unread");
              setPage(0);
            }}
          >
            <TabsList aria-label="Filter notifications">
              <TabsTrigger value="all" className="px-3 text-sm">All</TabsTrigger>
              <TabsTrigger value="unread" className="px-3 text-sm">
                Unread
                {unreadCount > 0 && <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{unreadCount}</span>}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {refreshing && (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner />
              Updating
            </span>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {loading && !data ? (
            <NotificationsSkeleton />
          ) : error && !data ? (
            <EmptyState
              icon={error === "network" ? "wifi-off" : "bell"}
              title={error === "network" ? "Notifications are offline" : "Could not load notifications"}
              description={error === "network" ? "Check your connection and try again." : "The inbox is temporarily unavailable."}
              actionLabel="Try again"
              onAction={reload}
            />
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={unreadOnly ? "check" : "bell"}
              title={
                unreadOnly
                  ? "You're all caught up"
                  : "No notifications yet"
              }
              description={
                unreadOnly
                  ? "Every notification has been reviewed. Show all to revisit earlier updates."
                  : "Overdue alerts, booking updates, schedule changes, and other work will appear here."
              }
              actionLabel={unreadOnly && hasNotifications ? "Show all" : undefined}
              onAction={unreadOnly && hasNotifications ? () => {
                setUnreadOnly(false);
                setPage(0);
              } : undefined}
            />
          ) : (
            <div className="pb-2">
              {grouped.map((group) => (
                <div key={group.label}>
                  <div className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">{group.label}</div>
                  {group.items.map((n) => (
                    <NotificationRow
                      key={n.id}
                      marking={markingIds.has(n.id)}
                      notification={n}
                      onMarkRead={markRead}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">Showing {visibleStart}-{visibleEnd} of {total}</span>
          <div className="flex items-center gap-2">
            <Button className="h-10" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button className="h-10" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </FadeUp>
  );
}

function NotificationRow({
  marking,
  notification,
  onMarkRead,
}: {
  marking: boolean;
  notification: Notification;
  onMarkRead: (id: string) => void;
}) {
  const meta = notificationMeta(notification.type);
  const Icon = meta.icon;
  const href = getNotificationHref(notification);
  const actionLabel = getNotificationActionLabel(notification);
  const unread = !notification.readAt;

  return (
    <div className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", meta.toneClass)}>
        <Icon aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-pretty text-sm", unread ? "font-semibold text-foreground" : "text-foreground/80")}>
          {href ? (
            <Link href={href} className="outline-none after:absolute after:inset-0 focus-visible:underline">
              {notification.title}
              {actionLabel && <span className="sr-only">. {actionLabel}</span>}
            </Link>
          ) : notification.title}
        </p>
        {notification.body && (
          <p className="mt-0.5 line-clamp-2 text-pretty text-sm text-muted-foreground">{notification.body}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {meta.label} · <span className="tabular-nums">{formatTime(notificationDate(notification))}</span>
        </p>
      </div>
      {unread && (
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            onClick={() => onMarkRead(notification.id)}
            disabled={marking}
            aria-label="Mark read"
            title="Mark read"
          >
            {marking ? <Spinner /> : <CheckIcon />}
          </Button>
          <span aria-label="Unread" className="size-2 rounded-full bg-[var(--brand-red)]" />
        </div>
      )}
    </div>
  );
}

function getNotificationHref(notification: Notification) {
  return notificationDestinationPath(notification.payload, notification.type);
}

function getNotificationActionLabel(notification: Notification) {
  if (notification.type === "badge_awarded") {
    return "Open badges";
  }

  if (typeof notification.payload?.bookingId === "string") {
    return isReservationNotification(notification)
      ? "Open reservation"
      : "Open checkout";
  }

  if (typeof notification.payload?.shiftGroupId === "string") {
    return "Open schedule";
  }

  const href = getNotificationHref(notification);
  if (!href) return null;
  if (href.startsWith("/events/") || href.startsWith("/schedule")) return "Open event";
  if (href.startsWith("/settings/")) return "Open settings";
  if (href.startsWith("/items")) return "Open items";
  if (href.startsWith("/staff/")) return "Open profile";
  if (href.startsWith("/licenses")) return "Open licenses";

  return "Open details";
}

function isReservationNotification(notification: Notification) {
  return notification.payload?.bookingKind === "RESERVATION"
    || notification.type.startsWith("reservation_");
}
