"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { Check, ChevronDown, Clock3 } from "lucide-react";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SIBLING_MAP,
  buildBreadcrumbItems,
  getRecentEntities,
  isQuietBreadcrumbRoute,
  saveRecentEntity,
  visibleSiblingsForRole,
  type RecentEntity,
  type SiblingItem,
} from "@/lib/breadcrumbs";
import { useCurrentUser } from "@/hooks/use-current-user";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";

// The trail lives in the app top bar, so it drops the "Home" root (the sidebar already offers it)
// and keeps at most the last two crumbs visible behind an ellipsis.
const COLLAPSE_THRESHOLD = 2;
const CRUMB_MAX_WIDTH = "max-w-[42vw] md:max-w-[260px]";
const breadcrumbItemClass = "min-w-0";
const separatorClass = "px-0.5 text-[13.5px] text-[color:var(--sidebar-border)] dark:text-[color:var(--sidebar-muted)]";
const crumbControlClass = cn(
  "group relative inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-1.5 text-[13.5px] text-[color:var(--sidebar-text)] no-underline outline-none",
  "transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-[color:var(--sidebar-text-active)] hover:no-underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-ring)]",
  "max-md:h-10 max-md:text-[15px] [&_svg]:size-3.5 [&_svg]:shrink-0",
);
const crumbPageClass = cn(
  "relative inline-flex h-8 min-w-0 items-center rounded-md px-1.5 text-[13.5px] font-bold text-[color:var(--sidebar-text-active)] outline-none",
  "max-md:h-10 max-md:text-[15px] [&_svg]:size-3.5 [&_svg]:shrink-0",
);
const menuContentClass = cn(chromeFont.className, "w-72 rounded-xl p-1.5");

export default function PageBreadcrumb() {
  const pathname = usePathname();
  const { label: entityLabel } = useBreadcrumbLabel();
  const { data: currentUser } = useCurrentUser();
  const currentUserRole = currentUser?.role;
  const canViewOwnerReport = currentUser?.canViewUsageAnalytics === true;
  const [expanded, setExpanded] = useState(false);

  // Reset collapse when navigating
  useEffect(() => { setExpanded(false); }, [pathname]);

  const firstSegment = pathname.split("/").filter(Boolean)[0] ?? "";
  const { items: allItems, onDetailPage } = buildBreadcrumbItems(pathname, entityLabel);
  const hasDynamicSegment = onDetailPage;
  const isQuietRoute = isQuietBreadcrumbRoute(pathname);

  // Re-read recents only when section changes or after we save a new entity.
  // Empty deps would miss cross-section navigation; keying on firstSegment +
  // entityLabel covers both cases without reading on every render.
  const recentEntities = useMemo(
    () => (onDetailPage ? getRecentEntities(firstSegment) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDetailPage, firstSegment, entityLabel],
  );

  useEffect(() => {
    if (entityLabel && hasDynamicSegment) {
      saveRecentEntity({ href: pathname, label: entityLabel, section: firstSegment });
    }
  }, [entityLabel, pathname, firstSegment, hasDynamicSegment]);

  // On the dashboard the trail is just the page itself, named as the sidebar names it; everywhere
  // else the root is implied.
  const trail = allItems.length > 1 ? allItems.slice(1) : [{ href: "/", label: "Dashboard", isPage: true }];
  if (trail.length === 0) return null;

  const shouldCollapse = !expanded && trail.length > COLLAPSE_THRESHOLD;
  const visibleItems: typeof trail = shouldCollapse ? trail.slice(-COLLAPSE_THRESHOLD) : trail;
  const showSkeleton = onDetailPage && !entityLabel;

  return (
    <Breadcrumb className={cn(chromeFont.className, "flex min-w-0 items-center print:hidden")}>
      <BreadcrumbList className="min-w-0 flex-nowrap gap-0 sm:gap-0">
        {shouldCollapse && (
          <>
            <BreadcrumbItem className={breadcrumbItemClass}>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className={cn(crumbControlClass, "px-1")}
                aria-label="Show full breadcrumb path"
              >
                <BreadcrumbEllipsis className="size-6" />
              </button>
            </BreadcrumbItem>
            <BreadcrumbSeparator className={separatorClass}>/</BreadcrumbSeparator>
          </>
        )}
        {visibleItems.map((item, i) => {
          const siblingItems = SIBLING_MAP[item.href];
          const visibleSiblings = siblingItems
            ? visibleSiblingsForRole(siblingItems, currentUserRole, canViewOwnerReport)
            : [];
          const hasSiblings = !item.isPage && visibleSiblings.length > 0;
          const hasRecent = item.isPage && onDetailPage && recentEntities.length > 1;
          // Ancestors give way first on a phone, so the current page keeps its room.
          const isAncestor = i < visibleItems.length - 1 || showSkeleton;

          return (
            <Fragment key={item.href}>
              {i > 0 && <BreadcrumbSeparator className={separatorClass}>/</BreadcrumbSeparator>}
              <BreadcrumbItem className={cn(breadcrumbItemClass, isAncestor && "shrink-[2]")}>
                {item.isPage && !hasRecent ? (
                  <BreadcrumbPage className={cn(crumbPageClass, CRUMB_MAX_WIDTH, isQuietRoute && "px-1")}>
                    <span className="truncate">{item.label}</span>
                  </BreadcrumbPage>
                ) : hasSiblings ? (
                  <SiblingDropdown
                    currentHref={item.href}
                    label={item.label}
                    siblings={visibleSiblings}
                  />
                ) : hasRecent ? (
                  <RecentDropdown
                    currentLabel={item.label}
                    recents={recentEntities}
                    currentHref={pathname}
                  />
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={item.href} className={cn(crumbControlClass, CRUMB_MAX_WIDTH)}>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
        {showSkeleton && (
          <>
            <BreadcrumbSeparator className={separatorClass}>/</BreadcrumbSeparator>
            <BreadcrumbItem className={breadcrumbItemClass}>
              <Skeleton className="h-5 w-28 rounded bg-[var(--sidebar-active)]" />
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function SiblingDropdown({
  currentHref,
  label,
  siblings,
}: {
  currentHref: string;
  label: string;
  siblings: ReadonlyArray<SiblingItem>;
}) {
  const current = siblings.find((s) => s.href === currentHref);
  const menuLabel = current?.group ? `${label}: ${current.group}` : `${label} pages`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(crumbControlClass, CRUMB_MAX_WIDTH)} aria-label={`Open ${label} pages`}>
        <span className="truncate">{label}</span>
        <ChevronDown className="opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={menuContentClass}>
        <DropdownMenuLabel className="text-[12px] font-bold text-muted-foreground">
          {menuLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {siblings.map((s) => (
          s.href === currentHref ? (
            <DropdownMenuItem key={s.href} disabled className="items-start gap-2 py-2 data-[disabled]:opacity-100">
              <Check className="mt-0.5 opacity-80" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{s.label}</span>
                {s.description && (
                  <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
                    {s.description}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={s.href} asChild className="py-2">
              <Link href={s.href} className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{s.label}</span>
                {s.description && (
                  <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
                    {s.description}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          )
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RecentDropdown({
  currentLabel,
  recents,
  currentHref,
}: {
  currentLabel: string;
  recents: RecentEntity[];
  currentHref: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(crumbPageClass, CRUMB_MAX_WIDTH, "gap-1")}
        aria-current="page"
        aria-label="Recently visited in this section"
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={menuContentClass}>
        <DropdownMenuLabel className="flex items-center gap-2 text-[12px] font-bold text-muted-foreground [&_svg]:size-3.5">
          <Clock3 />
          Recently visited
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recents.map((r) => (
          r.href === currentHref ? (
            <DropdownMenuItem key={r.href} disabled className="gap-2 py-2 data-[disabled]:opacity-100">
              <Check className="opacity-80" />
              <span className="truncate font-semibold">{r.label}</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={r.href} asChild className="py-2">
              <Link href={r.href} className="min-w-0">
                <span className="block truncate">{r.label}</span>
              </Link>
            </DropdownMenuItem>
          )
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
