"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellIcon, CheckCheckIcon, Settings2Icon } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { chromeFont } from "@/lib/chrome-font";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { dispatchNotificationCountChanged } from "@/lib/notification-count-sync";
import { notificationDestinationPath } from "@/lib/notification-destination";
import { formatNotificationTime, notificationMeta } from "@/lib/notification-meta";
import { cn } from "@/lib/utils";

type PopoverNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

type NotificationsResponse = {
  data?: PopoverNotification[];
  unreadCount?: number;
};

const POPOVER_LIMIT = 8;

type InboxView = "all" | "unread";
const VIEWS: { value: InboxView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
];

/**
 * Bell in the top bar. Opens a short inbox in place (latest notifications, mark one or all read,
 * jump to the related page) so checking alerts no longer means leaving the page you're on.
 * All / Unread narrows the list; rows marked read stay put until the next open so nothing jumps.
 * The full history and filters stay on /notifications.
 */
export function NotificationsPopover({
  unreadCount,
  triggerClassName,
}: {
  unreadCount: number;
  triggerClassName: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<InboxView>("all");
  const [items, setItems] = useState<PopoverNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const unreadRef = useRef(unreadCount);
  unreadRef.current = unreadCount;

  const label = unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setFailed(false);
    setItems(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/notifications?limit=${POPOVER_LIMIT}${view === "unread" ? "&unread=true" : ""}`,
          { signal: controller.signal },
        );
        if (handleAuthRedirect(res)) return;
        const json = res.ok ? await parseJsonSafely<NotificationsResponse>(res) : null;
        if (controller.signal.aborted) return;
        if (!json?.data) { setFailed(true); return; }
        setItems(json.data);
        if (typeof json.unreadCount === "number") dispatchNotificationCountChanged(json.unreadCount);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [open, view]);

  // Keep the inbox page in step when it is cached behind this popover.
  const invalidateInbox = useCallback(() => queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "fetch"
      && typeof query.queryKey[1] === "string"
      && query.queryKey[1].startsWith("/api/notifications?"),
  }), [queryClient]);

  async function patch(body: Record<string, unknown>, rollback: () => void) {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error("patch failed");
      void invalidateInbox();
    } catch {
      rollback();
      toast.error("Could not update notifications. Try again.");
    }
  }

  function markRead(id: string) {
    const target = items?.find((n) => n.id === id);
    if (!target || target.readAt) return;
    const previousItems = items;
    const previousCount = unreadRef.current;
    setItems((current) => current?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? current);
    dispatchNotificationCountChanged(previousCount - 1);
    void patch({ action: "mark_read", id }, () => {
      setItems(previousItems);
      dispatchNotificationCountChanged(previousCount);
    });
  }

  function markAllRead() {
    const previousItems = items;
    const previousCount = unreadRef.current;
    const now = new Date().toISOString();
    setItems((current) => current?.map((n) => (n.readAt ? n : { ...n, readAt: now })) ?? current);
    dispatchNotificationCountChanged(0);
    void patch({ action: "mark_all_read" }, () => {
      setItems(previousItems);
      dispatchNotificationCountChanged(previousCount);
    });
  }

  function openNotification(notification: PopoverNotification) {
    markRead(notification.id);
    const href = notificationDestinationPath(notification.payload, notification.type);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} className={triggerClassName}>
          <BellIcon aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                // Same pill as the sidebar badges; pb-px centers Lato's low-sitting digits.
                "absolute -top-0.5 -right-0.5 flex h-4 items-center justify-center rounded-full bg-[var(--wi-red)] pb-px text-[10px] font-bold leading-none text-white tabular-nums ring-2 ring-[var(--sidebar-bg)]",
                unreadCount > 9 ? "px-1" : "w-4",
              )}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          chromeFont.className,
          "flex w-[min(392px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border-[var(--sidebar-border)] p-0 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)]",
        )}
      >
        <div className="flex h-12 items-center gap-2 border-b border-[var(--sidebar-border)] pl-4 pr-2">
          <h2 className="flex-1 text-[15px]! font-bold! tracking-normal!">Notifications</h2>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-[color:var(--sidebar-text)] outline-none transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]"
            >
              <CheckCheckIcon className="size-4 stroke-[1.75]" aria-hidden="true" />
              Mark all read
            </button>
          )}
          <Link
            prefetch={false}
            href="/settings/notifications"
            onClick={() => setOpen(false)}
            aria-label="Notification settings"
            title="Notification settings"
            className="inline-flex size-8 items-center justify-center rounded-md text-[color:var(--sidebar-text)] no-underline outline-none transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]"
          >
            <Settings2Icon className="size-4 stroke-[1.75]" aria-hidden="true" />
          </Link>
        </div>

        <div role="tablist" aria-label="Show" className="flex gap-1 border-b border-[var(--sidebar-border)] px-3 py-2">
          {VIEWS.map((option) => {
            const selected = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setView(option.value)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]",
                  selected
                    ? "bg-[var(--sidebar-active)] font-bold text-[color:var(--sidebar-text-active)]"
                    : "text-[color:var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)]",
                )}
              >
                {option.label}
                {option.value === "unread" && unreadCount > 0 && (
                  <span className="text-[12px] font-normal tabular-nums text-[color:var(--sidebar-muted)]">{unreadCount > 99 ? "99+" : unreadCount}</span>
                )}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="max-h-[min(440px,60vh)] overflow-y-auto p-1.5">
          {items === null && !failed && (
            <div className="flex flex-col gap-1 p-1" aria-busy="true" aria-label="Loading notifications">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex gap-3 p-2">
                  <Skeleton className="size-8 shrink-0 rounded-lg" />
                  <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {failed && items === null && (
            <p className="px-3 py-8 text-center text-[13.5px] text-muted-foreground">
              Notifications didn&apos;t load. Open the inbox to try again.
            </p>
          )}
          {items?.length === 0 && (
            <div className="flex flex-col items-center gap-1 px-3 py-10 text-center">
              <BellIcon className="mb-1 size-5 stroke-[1.75] text-[color:var(--sidebar-muted)]" aria-hidden="true" />
              <p className="text-[14px] font-bold">{view === "unread" ? "Nothing unread" : "You’re all caught up"}</p>
              <p className="text-[13px] text-muted-foreground">
                {view === "unread" ? "You’ve seen everything. Older alerts are under All." : "New alerts about your gear and shifts show up here."}
              </p>
            </div>
          )}
          {items && items.length > 0 && (
            <ul className="flex flex-col">
              {items.map((notification) => {
                const meta = notificationMeta(notification.type);
                const Icon = meta.icon;
                const unread = !notification.readAt;
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left outline-none transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]"
                    >
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", meta.toneClass)} aria-hidden="true">
                        <Icon className="size-4 stroke-[1.75]" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("line-clamp-2 text-[14px] leading-snug", unread ? "font-bold text-foreground" : "text-[color:var(--sidebar-text)]")}>
                          {notification.title}
                        </span>
                        {notification.body && (
                          <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{notification.body}</span>
                        )}
                        <span className="text-[12px] text-[color:var(--sidebar-muted)]">
                          {meta.label} · {formatNotificationTime(notification.sentAt ?? notification.createdAt)}
                        </span>
                      </span>
                      {unread && (
                        <span className="mt-2 size-2 shrink-0 rounded-full bg-[var(--sidebar-icon-active)]">
                          <span className="sr-only">Unread</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link
          prefetch={false}
          href="/notifications"
          onClick={() => setOpen(false)}
          className="flex h-10 items-center justify-center border-t border-[var(--sidebar-border)] text-[13.5px] font-bold text-[color:var(--sidebar-text)] no-underline outline-none transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] hover:no-underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]"
        >
          See all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}
