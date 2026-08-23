"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRightIcon,
  Bell,
  CalendarDaysIcon,
  CheckCircle2,
  CircleIcon,
  ExternalLink,
  KeyRoundIcon,
  PackageSearchIcon,
  RefreshCw,
  Settings2Icon,
  ShirtIcon,
  UserRoundIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/components/ui/item";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { useUrlState } from "@/hooks/use-url-state";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { dispatchNotificationCountChanged } from "@/lib/notification-count-sync";
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

type NotificationMeta = {
  icon: typeof AlertTriangle;
  label: string;
  toneClass: string;
};

function notificationMeta(type: string): NotificationMeta {
  if (type.startsWith("checkout_due") || type.startsWith("checkout_overdue")) {
    return {
      icon: AlertTriangle,
      label: "Overdue",
      toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
    };
  }

  switch (type) {
    case "overdue_nudge":
      return {
        icon: AlertTriangle,
        label: "Overdue",
        toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
      };
    case "shift_gear_up":
      return {
        icon: ShirtIcon,
        label: "Shift",
        toneClass: "bg-[var(--green-bg)] text-[var(--green-text)]",
      };
    case "trade_claimed":
    case "trade_approved":
    case "trade_completed":
      return {
        icon: ArrowLeftRightIcon,
        label: "Trade",
        toneClass: "bg-[var(--blue-bg)] text-[var(--blue-text)]",
      };
    case "trade_declined":
    case "trade_expired":
      return {
        icon: ArrowLeftRightIcon,
        label: "Trade",
        toneClass: "bg-[var(--red-bg)] text-[var(--red-text)]",
      };
    case "badge_awarded":
      return {
        icon: UserRoundIcon,
        label: "Recognition",
        toneClass: "bg-[var(--purple-bg)] text-[var(--purple-text)]",
      };
    case "calendar_sync_failure":
      return {
        icon: CalendarDaysIcon,
        label: "Calendar",
        toneClass: "bg-[var(--red-bg)] text-[var(--red-text)]",
      };
    case "firmware_update_released":
    case "low_stock":
      return {
        icon: PackageSearchIcon,
        label: "Inventory",
        toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
      };
    default:
      if (type.startsWith("reservation_")) {
        return {
          icon: Bell,
          label: "Reservation",
          toneClass: "bg-[var(--purple-bg)] text-[var(--purple-text)]",
        };
      }
      if (type.startsWith("shift_") || type.startsWith("time_off_")) {
        return {
          icon: CalendarDaysIcon,
          label: "Schedule",
          toneClass: "bg-[var(--blue-bg)] text-[var(--blue-text)]",
        };
      }
      if (type.startsWith("license_")) {
        return {
          icon: KeyRoundIcon,
          label: "License",
          toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
        };
      }
      return {
        icon: CircleIcon,
        label: "Notice",
        toneClass: "bg-muted text-muted-foreground",
      };
  }
}

function canProcessNotifications(role: string | undefined) {
  return role === "ADMIN" || role === "STAFF";
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function notificationDate(notification: Notification) {
  return notification.sentAt ?? notification.createdAt;
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const notifDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor(
    (today.getTime() - notifDay.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  return notifDay.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

function NotificationsSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-lg border border-border/50 p-3">
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
  const railItems: OperationalStatusRailItem[] = unreadCount > 0 ? [{
    id: "unread",
    label: "Unread",
    value: unreadCount,
    detail: "Notifications that still need review.",
    icon: Bell,
    tone: "warning",
    onSelect: () => {
      setUnreadOnly(true);
      setPage(0);
    },
  }] : [];

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
      <PageHeader
        title="Notifications"
        description="Updates that need your attention across gear, bookings, shifts, and trades."
      >
        <Button className="h-10" variant="outline" asChild>
          <Link href="/settings/notifications">
            <Settings2Icon data-icon="inline-start" />
            Preferences
          </Link>
        </Button>
        <Button className="h-10" variant="outline" onClick={reload} disabled={loading || refreshing}>
          <RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
        {canProcess && (
          <Button className="h-10" variant="outline" onClick={runProcessing} disabled={processing}>
            {processing && <Spinner data-icon="inline-start" />}
            {processing ? "Checking overdue" : "Check overdue"}
          </Button>
        )}
        {unreadCount > 0 && (
          <Button className="h-10" onClick={markAllRead} disabled={markingAll}>
            {markingAll && <Spinner data-icon="inline-start" />}
            {markingAll ? "Marking all read" : "Mark all read"}
          </Button>
        )}
      </PageHeader>

      <OperationalStatusRail
        className="mb-4"
        orientation={{
          label: "Inbox",
          value: `${inboxTotal} ${inboxTotal === 1 ? "notification" : "notifications"}`,
          icon: Bell,
        }}
        items={railItems}
        allClearLabel={unreadCount === 0 ? "No unread notifications" : undefined}
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <ToggleGroup
            type="single"
            value={unreadOnly ? "unread" : "all"}
            onValueChange={(value) => {
              if (!value) return;
              setUnreadOnly(value === "unread");
              setPage(0);
            }}
            aria-label="Filter notifications"
          >
            <ToggleGroupItem value="all" className="min-h-10">All</ToggleGroupItem>
            <ToggleGroupItem value="unread" className="min-h-10">
              Unread
              {unreadCount > 0 && <span className="tabular-nums">{unreadCount}</span>}
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {refreshing && (
              <span className="inline-flex items-center gap-2" role="status">
                <Spinner />
                Updating
              </span>
            )}
            <span className="tabular-nums">
              {total > 0 ? `${visibleStart}-${visibleEnd} of ${total}` : unreadOnly ? "No unread" : "Inbox empty"}
            </span>
          </div>
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
            <div className="divide-y">
              {grouped.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center justify-between bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>{group.label}</span>
                    <span className="tabular-nums">{group.items.length}</span>
                  </div>
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

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {totalPages > 1 ? `Showing ${visibleStart}-${visibleEnd} of ${total}` : `${total} ${total === 1 ? "notification" : "notifications"}`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button className="h-10" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button className="h-10" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
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
    <Item
      size="sm"
      className={cn(
        "group items-start transition-[background-color,box-shadow] max-sm:flex-col",
        unread ? "bg-primary/5 hover:bg-primary/10" : "bg-background hover:bg-muted/35",
      )}
    >
      <ItemMedia variant="icon" className={meta.toneClass}>
        <Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle
          className={
            unread
              ? "w-full items-start gap-2 font-semibold text-foreground"
              : "w-full items-start gap-2 font-normal text-muted-foreground"
          }
        >
          <span className="min-w-0 flex-1 text-balance">{notification.title}</span>
          <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
            {formatTime(notificationDate(notification))}
          </span>
        </ItemTitle>
        <ItemDescription className="text-pretty">
          {notification.body ?? "Open the related workflow for details."}
        </ItemDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" size="sm">
            {meta.label}
          </Badge>
          {unread ? (
            <Badge variant="blue" size="sm">
              Unread
            </Badge>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 />
              Read
            </span>
          )}
        </div>
      </ItemContent>
      <ItemActions className="max-sm:w-full max-sm:flex-row max-sm:justify-end">
        {href && actionLabel && (
          <Button
            variant="outline"
            className="h-10 text-xs max-sm:flex-1"
            asChild
          >
            <Link href={href}>
              {actionLabel}
              <ExternalLink data-icon="inline-end" />
            </Link>
          </Button>
        )}
        {unread && (
          <Button
            variant="ghost"
            className="h-10 text-xs text-muted-foreground max-sm:flex-1"
            onClick={() => onMarkRead(notification.id)}
            disabled={marking}
          >
            {marking && <Spinner data-icon="inline-start" />}
            {marking ? "Marking read" : "Mark read"}
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

function getNotificationHref(notification: Notification) {
  if (typeof notification.payload?.href === "string") {
    return notification.payload.href;
  }

  if (typeof notification.payload?.bookingId === "string") {
    return isReservationNotification(notification)
      ? `/reservations/${notification.payload.bookingId}`
      : `/checkouts/${notification.payload.bookingId}`;
  }

  if (typeof notification.payload?.shiftGroupId === "string") {
    return "/schedule";
  }

  return null;
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
  if (href.startsWith("/users/")) return "Open profile";
  if (href.startsWith("/licenses")) return "Open licenses";

  return "Open details";
}

function isReservationNotification(notification: Notification) {
  return notification.payload?.bookingKind === "RESERVATION"
    || notification.type.startsWith("reservation_");
}
