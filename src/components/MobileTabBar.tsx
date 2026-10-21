"use client";

import Link from "next/link";
import { LayoutGridIcon } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";

export type MobileTabItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: "overdue";
};

const tabClass = cn(
  "flex min-h-[50px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 no-underline outline-none [-webkit-tap-highlight-color:transparent]",
  "transition-opacity duration-100 hover:no-underline active:opacity-60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]",
);

function iconClass(active: boolean) {
  return cn(
    "size-[22px] stroke-[1.75] transition-colors duration-100",
    active ? "text-[color:var(--sidebar-icon-active)]" : "text-[color:var(--sidebar-muted)]",
  );
}

function labelClass(active: boolean) {
  return cn(
    "max-w-full truncate text-[11px] leading-[14px]",
    active ? "font-bold text-[color:var(--sidebar-text-active)]" : "text-[color:var(--sidebar-text)]",
  );
}

/**
 * Phone tab bar. The last tab ("More") opens the full sidebar, and is the active tab on any page
 * that is not one of the fixed tabs, so you always see where you are. Same chrome as the sidebar
 * and top bar; the active tab is marked by its accent icon and bold label, not a filled pill.
 */
export function MobileTabBar({
  items,
  pathname,
  overdueCount,
  showMore = false,
}: {
  items: MobileTabItem[];
  pathname: string;
  overdueCount: number;
  /** Adds a "More" tab that opens the full sidebar drawer (with pinned pages on top). */
  showMore?: boolean;
}) {
  const { openMobile, setOpenMobile } = useSidebar();
  const isTabRoute = items.some((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
  const columns = items.length + (showMore ? 1 : 0);
  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        chromeFont.className,
        "fixed inset-x-0 bottom-0 z-[var(--z-overlay)] hidden border-t border-[var(--sidebar-border)] px-2 pb-[calc(4px+env(safe-area-inset-bottom,0px))] pt-1 max-md:block print:hidden",
        "bg-[var(--sidebar-bg)]",
      )}
    >
      <div className="mx-auto grid max-w-[460px]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const badgeCount = item.badge === "overdue" ? overdueCount : 0;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              aria-label={badgeCount > 0 ? `${item.label}, ${badgeCount} overdue` : item.label}
              className={tabClass}
            >
              <span className="relative flex size-6 items-center justify-center" aria-hidden="true">
                <Icon className={iconClass(isActive)} />
                {badgeCount > 0 && (
                  <span
                    className={cn(
                      // Same pill as the sidebar badges; pb-px centers Lato's low-sitting digits.
                      "absolute -right-2.5 -top-1 flex h-4 items-center justify-center rounded-full bg-[var(--wi-red)] pb-px text-[10px] font-bold leading-none text-white tabular-nums ring-2 ring-[var(--sidebar-bg)]",
                      badgeCount > 9 ? "px-1" : "w-4",
                    )}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </span>
              <span className={labelClass(isActive)}>{item.label}</span>
            </Link>
          );
        })}
        {showMore && (
          <button
            type="button"
            onClick={() => setOpenMobile(!openMobile)}
            aria-expanded={openMobile}
            aria-label="More pages"
            className={tabClass}
          >
            <span className="relative flex size-6 items-center justify-center" aria-hidden="true">
              <LayoutGridIcon className={iconClass(!isTabRoute || openMobile)} />
            </span>
            <span className={labelClass(!isTabRoute || openMobile)}>More</span>
          </button>
        )}
      </div>
    </nav>
  );
}
