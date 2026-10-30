"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import {
  ArrowRightIcon,
  BellIcon,
  BookOpenIcon,
  CalendarCheckIcon,
  CameraIcon,
  ClipboardCheckIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import { AssetImage } from "@/components/AssetImage";
import { OperationalPartialResultsAlert } from "@/components/OperationalFeedback";
import { OperationalLoadingState } from "@/components/OperationalLoadingState";
import { UserAvatar } from "@/components/UserAvatar";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type CurrentUser } from "@/hooks/use-current-user";
import { getAllRecentEntities, type RecentEntity } from "@/lib/breadcrumbs";
import { chromeFont } from "@/lib/chrome-font";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { mapGuideSearchResult, type GuideSearchHit } from "@/lib/guide-search-result";
import { RECENT_SEARCHES_STORAGE_KEY } from "@/lib/local-traces";
import { getVisiblePageSearchResults, type PageSearchResult } from "@/lib/search-pages";
import { assetSearchTitle } from "@/lib/search-result-title";
import { STATUS_STYLES } from "@/lib/status-styles";
import { setThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

type EntitySearchResult = {
  type: "item" | "checkout" | "reservation" | "user" | "guide";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  imageUrl?: string | null;
  // Item-specific fields for status display
  computedStatus?: string;
  activeBooking?: { requesterName: string; requesterAvatarUrl?: string | null; isOverdue: boolean; endsAt?: string } | null;
  status?: string;
  searchText?: string;
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

const SEARCH_RESULT_SOURCES = {
  items: "Items",
  checkouts: "Checkouts",
  reservations: "Reservations",
  users: "Staff",
  guides: "Guides",
} as const;

const RECENT_SECTION_ICONS: Partial<Record<string, React.ElementType>> = {
  items: CameraIcon,
  checkouts: ClipboardCheckIcon,
  reservations: CalendarCheckIcon,
  bookings: ClipboardCheckIcon,
  staff: UserIcon,
  resources: BookOpenIcon,
};

function sectionLabel(section: string) {
  if (section === "staff") return "Staff";
  if (section === "resources") return "Guide";
  return section.charAt(0).toUpperCase() + section.slice(1, section.endsWith("s") ? -1 : undefined);
}

/**
 * Cmd/Ctrl+K palette. With an empty query it is a launcher (recently viewed pages, recent searches,
 * actions); typing searches pages, guides, items, bookings and people. Styled with the sidebar's
 * chrome tokens and typeface so it reads as part of the same shell.
 */
export function CommandPalette({
  open,
  onOpenChange,
  user,
  pathname,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: CurrentUser | null | undefined;
  pathname: string;
}) {
  const router = useRouter();
  const isCollaborator = user?.role === "COLLABORATOR";
  const canWriteGuides = user?.role === "ADMIN" || user?.role === "STAFF";
  const [cmdQuery, setCmdQuery] = useState("");
  const [cmdResults, setCmdResults] = useState<SearchResult[]>([]);
  const cmdGroups = useMemo(() => {
    const groups = { page: [] as PageSearchResult[], guide: [] as EntitySearchResult[], item: [] as EntitySearchResult[], checkout: [] as EntitySearchResult[], reservation: [] as EntitySearchResult[], user: [] as EntitySearchResult[] };
    for (const result of cmdResults) {
      if (result.type === "page") groups.page.push(result);
      else if (result.type in groups) groups[result.type as Exclude<keyof typeof groups, "page">].push(result);
    }
    return groups;
  }, [cmdResults]);
  const [cmdLoading, setCmdLoading] = useState(false);
  const [cmdError, setCmdError] = useState<"network" | "server" | null>(null);
  const [cmdPartialFailures, setCmdPartialFailures] = useState<string[]>([]);
  const cmdAbortRef = useRef<AbortController | null>(null);

  // Launcher content is read when the palette opens, so it reflects the pages just visited.
  const [recentPages, setRecentPages] = useState<RecentEntity[]>([]);
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRecentPages(getAllRecentEntities(5).filter((page) => page.href !== pathname));
    setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, [open, pathname]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setCmdQuery("");
      setCmdResults([]);
      setCmdError(null);
      setCmdPartialFailures([]);
    }
  }

  function toggleTheme() {
    setThemeChoice(isDark ? "light" : "dark", { animate: true });
    handleOpenChange(false);
  }

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
        const [itemsRes, checkoutsRes, reservationsRes, usersRes, guidesRes] = await Promise.allSettled([
          fetch(`/api/assets?q=${encoded}&limit=8`, { signal: controller.signal }),
          fetch(`/api/checkouts?q=${encoded}&status_in=OPEN,PENDING_PICKUP&limit=8`, { signal: controller.signal }),
          fetch(`/api/reservations?q=${encoded}&status=BOOKED&limit=8`, { signal: controller.signal }),
          fetch(`/api/users?q=${encoded}&limit=5`, { signal: controller.signal }),
          fetch(`/api/resources?q=${encoded}`, { signal: controller.signal }),
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
        if (guidesRes.status === "fulfilled" && handleAuthRedirect(guidesRes.value, pathname)) return;

        if (itemsRes.status === "fulfilled" && itemsRes.value.ok) {
          const json = await parseJsonSafely<ApiSearchList<AssetSearchItem>>(itemsRes.value);
          const data = json?.data;
          if (!data) failures.push(SEARCH_RESULT_SOURCES.items);
          for (const item of (data ?? []).slice(0, 8)) {
            merged.push({
              type: "item", id: item.id,
              title: assetSearchTitle(item),
              subtitle: [item.brand, item.model].filter(Boolean).join(" "),
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
            merged.push({ type: "user", id: u.id, title: u.name ?? "Unnamed user", subtitle: u.email || "", href: `/staff/${u.id}` });
          }
        } else {
          failures.push(SEARCH_RESULT_SOURCES.users);
        }
        if (guidesRes.status === "fulfilled" && guidesRes.value.ok) {
          const json = await parseJsonSafely<ApiSearchList<GuideSearchHit>>(guidesRes.value);
          const data = json?.data;
          if (!data) failures.push(SEARCH_RESULT_SOURCES.guides);
          let guideCount = 0;
          for (const guide of (data ?? [])) {
            const mapped = mapGuideSearchResult(guide);
            if (!mapped) continue;
            merged.push(mapped);
            guideCount += 1;
            if (guideCount >= 8) break;
          }
        } else {
          failures.push(SEARCH_RESULT_SOURCES.guides);
        }
        if (!controller.signal.aborted) {
          setCmdResults(merged);
          setCmdPartialFailures(failures);
          setCmdError(failures.length === Object.keys(SEARCH_RESULT_SOURCES).length && merged.length === 0 ? "server" : null);
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
  // Re-read on open: logout clears the stored list, and this palette stays mounted.
  useEffect(() => {
    if (!open) return;
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
      setRecentSearches(stored ? JSON.parse(stored) : []);
    } catch { /* ignore */ }
  }, [open]);

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
    onOpenChange(false);
    setCmdQuery("");
    setCmdResults([]);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          chromeFont.className,
          "top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-2xl border border-[var(--sidebar-border)] bg-popover p-0 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.28)] sm:max-w-[640px] max-sm:top-3",
        )}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search pages, guides, items, bookings and people, or run an action.</DialogDescription>
        {/* Results are matched by the server and the page index; cmdk's own filter would hide items matched on a field outside their value. */}
        <CommandPrimitive
          data-slot="command"
          shouldFilter={false}
          className={cn(
            "flex h-full w-full flex-col overflow-hidden bg-transparent text-popover-foreground",
            "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[12px]! [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-[color:var(--sidebar-muted)]",
            "[&_[cmdk-item]]:min-h-10 [&_[cmdk-item]]:gap-3 [&_[cmdk-item]]:rounded-lg [&_[cmdk-item]]:px-2.5 [&_[cmdk-item]]:text-[14px]",
            "[&_[cmdk-item][data-selected=true]]:bg-[var(--sidebar-active)] [&_[cmdk-item][data-selected=true]]:text-[color:var(--sidebar-text-active)]",
          )}
        >
          <div className="flex h-14 items-center gap-3 border-b border-[var(--sidebar-border)] px-4">
            <SearchIcon className="size-[18px] shrink-0 stroke-[1.75] text-[color:var(--sidebar-muted)]" aria-hidden="true" />
            <CommandPrimitive.Input
              data-slot="command-input"
              placeholder="Search or jump to..."
              value={cmdQuery}
              onValueChange={setCmdQuery}
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-hidden placeholder:text-[color:var(--sidebar-muted)]"
            />
            <kbd className="hidden h-6 shrink-0 items-center rounded-md border border-[var(--sidebar-border)] px-1.5 font-sans text-[11px] font-bold text-[color:var(--sidebar-muted)] sm:inline-flex">
              esc
            </kbd>
          </div>
          <CommandList className="max-h-[min(460px,62vh)] scroll-py-2 p-2">
            {!cmdQuery.trim() && recentPages.length > 0 && (
              <CommandGroup heading="Recently viewed">
                {recentPages.map((page) => {
                  const Icon = RECENT_SECTION_ICONS[page.section] ?? ArrowRightIcon;
                  return (
                    <CommandItem key={page.href} value={`recent ${page.label} ${page.href}`} onSelect={() => handleCmdSelect(page.href)}>
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{page.label}</span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">{sectionLabel(page.section)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {!cmdQuery.trim() && recentSearches.length > 0 && (
              <CommandGroup heading="Recent searches">
                {recentSearches.map((q) => (
                  <CommandItem key={q} value={q} onSelect={() => { setCmdQuery(q); }}>
                    <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                    {q}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!cmdQuery.trim() && (
              <CommandGroup heading="Actions">
                <CommandItem value="action new booking reservation checkout" onSelect={() => handleCmdSelect("/reservations/new")}>
                  <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                  New booking
                </CommandItem>
                {canWriteGuides && (
                  <CommandItem value="action new guide resource" onSelect={() => handleCmdSelect("/resources/new")}>
                    <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                    New guide
                  </CommandItem>
                )}
                <CommandItem value="action notifications inbox" onSelect={() => handleCmdSelect("/notifications")}>
                  <BellIcon className="size-4 shrink-0 text-muted-foreground" />
                  Open notifications
                </CommandItem>
                <CommandItem value="action theme dark light appearance" onSelect={toggleTheme}>
                  {isDark ? <SunIcon className="size-4 shrink-0 text-muted-foreground" /> : <MoonIcon className="size-4 shrink-0 text-muted-foreground" />}
                  {isDark ? "Switch to light theme" : "Switch to dark theme"}
                </CommandItem>
                <CommandItem value="action settings preferences" onSelect={() => handleCmdSelect("/settings")}>
                  <SettingsIcon className="size-4 shrink-0 text-muted-foreground" />
                  Open settings
                </CommandItem>
              </CommandGroup>
            )}
            {cmdLoading && (
              <OperationalLoadingState
                variant="command"
                title="Searching Wisconsin Creative"
                rows={3}
              />
            )}
            {!cmdLoading && cmdError && cmdQuery.trim() && (
              <CommandEmpty>{cmdError === "network" ? "Search is offline. Check your connection and try again." : "Search is temporarily unavailable. Try the page shortcut or search again."}</CommandEmpty>
            )}
            {!cmdLoading && !cmdError && cmdQuery.trim() && cmdResults.length === 0 && (
              <CommandEmpty>No matches. Try a tag, borrower, guide, page name, setting, or report.</CommandEmpty>
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
            {cmdGroups.page.length > 0 && (
              <CommandGroup heading="Go to">
                {cmdGroups.page.map((r) => (
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
            {cmdGroups.guide.length > 0 && (
              <CommandGroup heading="Guides">
                {cmdGroups.guide.map((r) => {
                  const subtitle = [r.subtitle, r.status === "DRAFT" ? "Draft" : null].filter(Boolean).join(" · ");
                  return (
                    <CommandItem
                      key={r.id}
                      value={`${r.title} ${subtitle} ${r.searchText ?? ""} ${r.href}`}
                      onSelect={() => handleCmdSelect(r.href)}
                      className="gap-3"
                    >
                      <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.title}</div>
                        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {cmdGroups.item.length > 0 && (
              <CommandGroup heading="Items">
                {cmdGroups.item.map((r) => {
                  const status = r.computedStatus ?? "AVAILABLE";
                  const isOverdue = r.activeBooking?.isOverdue ?? false;
                  const dotClass = STATUS_STYLES[isOverdue ? "red"
                    : status === "CHECKED_OUT" ? "blue"
                    : status === "PENDING_PICKUP" || status === "MAINTENANCE" ? "orange"
                    : status === "RESERVED" ? "purple"
                    : status === "RETIRED" ? "gray"
                    : "green"].dot;
                  const statusLabel = isOverdue ? "Overdue"
                    : status === "CHECKED_OUT" ? "Checked out"
                    : status === "PENDING_PICKUP" ? "Pending pickup"
                    : status === "RESERVED" ? "Reserved"
                    : status === "MAINTENANCE" ? "Maintenance"
                    : status === "RETIRED" ? "Retired"
                    : "Available";
                  const showHolder = !!r.activeBooking && (isOverdue || status === "CHECKED_OUT" || status === "RESERVED");
                  return (
                    <CommandItem key={r.id} value={`${r.title} ${r.subtitle} ${r.id}`} onSelect={() => handleCmdSelect(r.href)} className="gap-3">
                      <AssetImage src={r.imageUrl} alt={r.title} size={28} className="rounded" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{r.title}</span>
                        {r.subtitle && <span className="ml-2 text-muted-foreground">{r.subtitle}</span>}
                      </span>
                      <span
                        className={cn("flex shrink-0 items-center gap-1.5 text-[12px]", isOverdue ? "text-[var(--red-text)]" : "text-muted-foreground")}
                        title={showHolder ? `${statusLabel} by ${r.activeBooking?.requesterName}` : statusLabel}
                      >
                        {showHolder ? (
                          <UserAvatar
                            name={r.activeBooking?.requesterName ?? "Unknown"}
                            avatarUrl={r.activeBooking?.requesterAvatarUrl}
                            size="xs"
                          />
                        ) : (
                          <span aria-hidden="true" className={cn("size-1.5 rounded-full", dotClass)} />
                        )}
                        {statusLabel}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {cmdGroups.checkout.length > 0 && (
              <CommandGroup heading="Checkouts">
                {cmdGroups.checkout.map((r) => (
                  <CommandItem key={r.id} value={`${r.title} ${r.subtitle} ${r.id}`} onSelect={() => handleCmdSelect(r.href)}>
                    <ClipboardCheckIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                    {r.subtitle && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-muted-foreground">{r.subtitle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {cmdGroups.reservation.length > 0 && (
              <CommandGroup heading="Reservations">
                {cmdGroups.reservation.map((r) => (
                  <CommandItem key={r.id} value={`${r.title} ${r.subtitle} ${r.id}`} onSelect={() => handleCmdSelect(r.href)}>
                    <CalendarCheckIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                    {r.subtitle && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-muted-foreground">{r.subtitle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {cmdGroups.user.length > 0 && (
              <CommandGroup heading="Staff">
                {cmdGroups.user.map((r) => (
                  <CommandItem key={r.id} value={`${r.title} ${r.subtitle} ${r.id}`} onSelect={() => handleCmdSelect(r.href)}>
                    <UserIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                    {r.subtitle && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-muted-foreground">{r.subtitle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {cmdQuery.trim() && cmdResults.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => handleCmdSelect(`/search?q=${encodeURIComponent(cmdQuery.trim())}`)}>
                    <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                    See all results for &ldquo;{cmdQuery.trim()}&rdquo;
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="hidden h-9 items-center gap-4 border-t border-[var(--sidebar-border)] px-4 text-[12px] text-[color:var(--sidebar-muted)] sm:flex">
            <span><kbd className="font-sans font-bold">↑↓</kbd> to move</span>
            <span><kbd className="font-sans font-bold">↵</kbd> to open</span>
            <span className="ml-auto">Search covers items, bookings, people, guides and pages</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
