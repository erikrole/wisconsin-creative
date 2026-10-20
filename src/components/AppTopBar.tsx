"use client";

import Link from "next/link";
import { BellIcon, SearchIcon } from "lucide-react";
import PageBreadcrumb from "@/components/PageBreadcrumb";
import { RolePreviewControl } from "@/components/RolePreviewControl";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type CurrentUser } from "@/hooks/use-current-user";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";

/** Quiet icon button shared by every top bar control, so hover, focus and size stay identical. */
export const topBarButtonClass = cn(
  "relative inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-transparent text-[color:var(--sidebar-text)] no-underline shadow-none outline-none",
  "transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] hover:no-underline",
  "focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)] active:scale-100",
  "max-md:size-10 [&_svg]:size-[18px]! [&_svg]:stroke-[1.75]",
);

/**
 * App top bar: sidebar toggle, where you are, and the few things that need you.
 * It shares the sidebar's chrome tokens and typeface so the two read as one frame, and page-scoped
 * themes cannot restyle it. Search lives in the sidebar (and Cmd/Ctrl+K) on desktop; a phone keeps
 * a search button here because its sidebar is a drawer.
 */
export function AppTopBar({
  isCollaborator,
  onSearch,
  unreadNotifications,
  user,
}: {
  isCollaborator: boolean;
  onSearch: () => void;
  unreadNotifications: number;
  user: CurrentUser;
}) {
  const { isMobile, open, openMobile } = useSidebar();
  const sidebarLabel = isMobile
    ? (openMobile ? "Close navigation" : "Open navigation")
    : (open ? "Collapse sidebar" : "Expand sidebar");
  const notificationLabel = unreadNotifications > 0
    ? `Notifications (${unreadNotifications} unread)`
    : "Notifications";

  return (
    <header
      data-app-shell-header
      className={cn(
        chromeFont.className,
        "flex h-12 items-center gap-1 border-b border-[var(--sidebar-border)] px-2 md:px-3",
        "bg-[var(--sidebar-bg)]",
      )}
    >
      <SidebarTrigger aria-label={sidebarLabel} title={sidebarLabel} className={topBarButtonClass} />
      <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-[var(--sidebar-border)] max-md:hidden" />

      <div className="flex min-w-0 flex-1 items-center">
        <PageBreadcrumb />
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {!isCollaborator && (
          <button
            type="button"
            className={cn(topBarButtonClass, "md:hidden")}
            onClick={onSearch}
            aria-label="Search items, bookings, people, pages, and guides"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <SearchIcon aria-hidden="true" />
          </button>
        )}
        <RolePreviewControl user={user} className={topBarButtonClass} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Link prefetch={false} href="/notifications" aria-label={notificationLabel} className={topBarButtonClass}>
              <BellIcon aria-hidden="true" />
              {unreadNotifications > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    // Same pill as the sidebar badges; pb-px centers Lato's low-sitting digits.
                    "absolute -top-0.5 -right-0.5 flex h-4 items-center justify-center rounded-full bg-[var(--wi-red)] pb-px text-[10px] font-bold leading-none text-white tabular-nums ring-2 ring-[var(--sidebar-bg)]",
                    unreadNotifications > 9 ? "px-1" : "w-4",
                  )}
                >
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              )}
            </Link>
          </TooltipTrigger>
          <TooltipContent>{notificationLabel}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
