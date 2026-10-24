"use client";

import { SearchIcon } from "lucide-react";
import { NotificationsPopover } from "@/components/NotificationsPopover";
import PageBreadcrumb from "@/components/PageBreadcrumb";
import { RolePreviewControl } from "@/components/RolePreviewControl";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { type CurrentUser } from "@/hooks/use-current-user";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";

/** Quiet icon button shared by every top bar control, so hover, focus and size stay identical. */
const topBarButtonClass = cn(
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

  return (
    <header
      data-app-shell-header
      className={cn(
        chromeFont.className,
        "flex h-12 items-center gap-1 border-b border-[var(--sidebar-border)] px-2 md:px-3",
        "bg-[var(--sidebar-bg)]",
      )}
    >
      <SidebarTrigger
        aria-label={sidebarLabel}
        aria-keyshortcuts={isMobile ? undefined : "["}
        title={isMobile ? sidebarLabel : `${sidebarLabel} ( [ )`}
        className={topBarButtonClass}
      />
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
        <NotificationsPopover unreadCount={unreadNotifications} triggerClassName={topBarButtonClass} />
      </div>
    </header>
  );
}
