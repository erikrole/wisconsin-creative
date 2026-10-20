"use client";

import Link from "next/link";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";

export type MobileTabItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: "overdue";
};

/**
 * Phone tab bar. Same chrome as the sidebar and top bar: translucent rail, hairline border, and
 * the active tab marked by its accent icon and bold label rather than a filled pill.
 */
export function MobileTabBar({
  items,
  pathname,
  overdueCount,
}: {
  items: MobileTabItem[];
  pathname: string;
  overdueCount: number;
}) {
  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        chromeFont.className,
        "fixed inset-x-0 bottom-0 z-[var(--z-overlay)] hidden border-t border-[var(--sidebar-border)] px-2 pb-[calc(4px+env(safe-area-inset-bottom,0px))] pt-1 max-md:block print:hidden",
        "bg-[var(--sidebar-bg)]",
      )}
    >
      <div className="mx-auto grid max-w-[460px]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
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
              className={cn(
                "flex min-h-[50px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 no-underline outline-none [-webkit-tap-highlight-color:transparent]",
                "transition-opacity duration-100 hover:no-underline active:opacity-60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]",
              )}
            >
              <span className="relative flex size-6 items-center justify-center" aria-hidden="true">
                <Icon
                  className={cn(
                    "size-[22px] stroke-[1.75] transition-colors duration-100",
                    isActive ? "text-[color:var(--sidebar-icon-active)]" : "text-[color:var(--sidebar-muted)]",
                  )}
                />
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
              <span
                className={cn(
                  "max-w-full truncate text-[11px] leading-[14px]",
                  isActive ? "font-bold text-[color:var(--sidebar-text-active)]" : "text-[color:var(--sidebar-text)]",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
