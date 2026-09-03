"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
const BookingDetailsSheet = lazy(() => import("@/components/BookingDetailsSheet"));
import { toast } from "sonner";
import { SkeletonTable } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { BOOKING_SNAPSHOT_HEADER } from "@/lib/booking-concurrency";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFormOptions } from "@/hooks/use-form-options";
import { useBookingChangeSync } from "@/hooks/use-booking-change-sync";
import { applyBookingItemsUpdate } from "@/components/booking-list/list-recovery";

import {
  SortHeader,
  BookingFilters,
  BookingTableRow,
  BookingMobileCard,
  BookingCard,
  type BookingItem,
  type BookingListConfig,
  type StatusOption,
  type ContextMenuExtra,
  type FormUser,
  type Location,
  type ListResponse,
} from "./booking-list";
import type { TabKey as BookingSheetSection } from "./booking-details/types";

/* ───── Re-exports for backward compatibility ───── */
export type { BookingItem, BookingListConfig, StatusOption, ContextMenuExtra };

/* ───── Component ───── */

type BookingListPageProps = {
  config: BookingListConfig;
  viewMode?: "table" | "cards";
  hideHeader?: boolean;
  enableBookingChangeSync?: boolean;
  initialHighlight?: string | null;
  initialSheetTab?: BookingSheetSection | null;
};

function parseBookingSheetSection(value: string | null): BookingSheetSection | null {
  return value === "details" || value === "equipment" || value === "history" ? value : null;
}

function parseBookingPage(value: string | null): number {
  const page = Number.parseInt(value ?? "", 10);
  return Number.isFinite(page) && page > 0 ? page : 0;
}

function readBookingStatus(params: URLSearchParams, defaultStatus: string | undefined): string {
  const status = params.get("status");
  if (status === "all") return "";
  return status ?? defaultStatus ?? "";
}

export default function BookingListPage({
  config,
  viewMode = "table",
  hideHeader = false,
  enableBookingChangeSync = true,
  initialHighlight,
  initialSheetTab,
}: BookingListPageProps) {
  const urlParams = useSearchParams();
  const router = useRouter();
  const urlSignature = urlParams.toString();
  useBookingChangeSync(enableBookingChangeSync);

  // ── Filter state ──
  const [page, setPageState] = useState(() => parseBookingPage(urlParams.get("page")));
  const [search, setSearch] = useState(urlParams.get("q") || "");
  const [sort, setSort] = useState(urlParams.get("sort") || "");
  const [statusFilter, setStatusFilter] = useState(() => readBookingStatus(urlParams, config.defaultStatusFilter));
  const [sportFilter, setSportFilter] = useState(urlParams.get("sport_code") || "");
  const [locationFilter, setLocationFilter] = useState(urlParams.get("location_id") || "");
  const [userFilter, setUserFilter] = useState(urlParams.get("requester_id") || "");
  const [specialFilter, setSpecialFilter] = useState(urlParams.get("filter") || "");
  const [clientReady, setClientReady] = useState(false);
  const defaultStatusFiltersKey = config.defaultStatusFilters?.join(",") ?? "";

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    const nextParams = new URLSearchParams(urlSignature);
    setSearch(nextParams.get("q") || "");
    setSort(nextParams.get("sort") || "");
    setStatusFilter(readBookingStatus(nextParams, config.defaultStatusFilter));
    setSportFilter(nextParams.get("sport_code") || "");
    setLocationFilter(nextParams.get("location_id") || "");
    setUserFilter(nextParams.get("requester_id") || "");
    setSpecialFilter(nextParams.get("filter") || "");
    setPageState(parseBookingPage(nextParams.get("page")));
  }, [config.defaultStatusFilter, urlSignature]);

  const replaceListParams = useCallback((updates: Record<string, string | null>, resetPage = true) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (resetPage) params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `/bookings?${qs}` : "/bookings", { scroll: false });
  }, [router]);

  const changePage = useCallback((nextPage: number) => {
    const boundedPage = Math.max(0, nextPage);
    setPageState(boundedPage);
    replaceListParams({ page: boundedPage > 0 ? String(boundedPage) : null }, false);
  }, [replaceListParams]);

  const changeSearch = useCallback((value: string) => {
    setSearch(value);
    setPageState(0);
    replaceListParams({ q: value || null });
  }, [replaceListParams]);

  const changeStatus = useCallback((value: string) => {
    setStatusFilter(value);
    setPageState(0);
    replaceListParams({
      status: value || (config.defaultStatusFilter ? "all" : null),
    });
  }, [config.defaultStatusFilter, replaceListParams]);

  const changeSpecialFilter = useCallback((value: string) => {
    setSpecialFilter(value);
    setPageState(0);
    replaceListParams({ filter: value || null });
  }, [replaceListParams]);

  const changeSport = useCallback((value: string) => {
    setSportFilter(value);
    setPageState(0);
    replaceListParams({ sport_code: value || null });
  }, [replaceListParams]);

  const changeLocation = useCallback((value: string) => {
    setLocationFilter(value);
    setPageState(0);
    replaceListParams({ location_id: value || null });
  }, [replaceListParams]);

  const changeRequester = useCallback((value: string) => {
    setUserFilter(value);
    setPageState(0);
    replaceListParams({ requester_id: value || null, mine: null });
  }, [replaceListParams]);

  const changeSort = useCallback((value: string) => {
    setSort(value);
    setPageState(0);
    replaceListParams({ sort: value || null });
  }, [replaceListParams]);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setStatusFilter("");
    setSportFilter("");
    setLocationFilter("");
    setUserFilter("");
    setSpecialFilter("");
    setPageState(0);
    replaceListParams({
      q: null,
      status: config.defaultStatusFilter ? "all" : null,
      sport_code: null,
      location_id: null,
      requester_id: null,
      mine: null,
      filter: null,
    });
  }, [config.defaultStatusFilter, replaceListParams]);

  // ── List data (React Query) ──
  const queryClient = useQueryClient();
  const limit = 20;
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));
    if (search) params.set("q", search);
    if (sort) params.set("sort", sort);
    if (config.activeOnly) params.set("active", "true");
    if (config.pastOnly) params.set("past", "true");
    if (specialFilter) params.set("filter", specialFilter);
    if (!specialFilter && statusFilter) params.set("status", statusFilter);
    if (!specialFilter && !statusFilter && defaultStatusFiltersKey) params.set("status_in", defaultStatusFiltersKey);
    if (config.hasSportFilter && sportFilter) params.set("sport_code", sportFilter);
    if (locationFilter) params.set("location_id", locationFilter);
    if (userFilter) params.set("requester_id", userFilter);
    return `${config.apiBase}?${params}`;
  }, [page, search, sort, statusFilter, sportFilter, locationFilter, userFilter, specialFilter, config.apiBase, config.activeOnly, config.pastOnly, config.hasSportFilter, defaultStatusFiltersKey]);

  const { data: listData, isLoading: loading, isError, refetch } = useQuery<ListResponse>({
    queryKey: ["bookingList", config.kind, listUrl],
    queryFn: async ({ signal }) => {
      const res = await fetch(listUrl, { signal });
      if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<ListResponse>(res);
      if (!json || !Array.isArray(json.data) || typeof json.total !== "number") {
        throw new Error("server");
      }
      return json;
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const reload = async () => { await refetch(); };
  const listItems = listData?.data;
  const items = useMemo(() => listItems ?? [], [listItems]);
  const total = listData?.total ?? 0;

  // On background refresh failure (cached data still visible): toast instead of replacing UI
  const prevIsErrorRef = useRef(false);
  useEffect(() => {
    if (isError && !prevIsErrorRef.current && listData) {
      toast.error(typeof navigator !== "undefined" && !navigator.onLine
        ? "You're offline — showing cached data"
        : `Couldn't refresh — showing cached data`);
    }
    prevIsErrorRef.current = isError;
  }, [isError, listData]);

  // Only show error screen on initial load (no cached data to fall back on)
  const loadError: false | "network" | "server" = isError && !listData
    ? (typeof navigator !== "undefined" && !navigator.onLine ? "network" : "server")
    : false;
  const showInitialSkeleton = !clientReady || (loading && !listData);

  /** Optimistic update helper — mutates the cached list data */
  const setItems = (updater: BookingItem[] | ((prev: BookingItem[]) => BookingItem[])) => {
    queryClient.setQueryData<ListResponse>(["bookingList", config.kind, listUrl], (prev) => {
      return applyBookingItemsUpdate(prev, updater);
    });
  };

  // ── Form options (React Query, shared cache) ──
  const { data: formOpts, isError: formOptionsError, refetch: refetchFormOptions } = useFormOptions();
  const users: FormUser[] = formOpts?.users ?? [];
  const locations: Location[] = formOpts?.locations ?? [];

  // ── Current user (React Query, shared cache) ──
  const { data: meData } = useCurrentUser();
  const currentUserId = meData?.id ?? "";
  // Treat the role-preview shell as a distinct read-only actor so client-side
  // row menus do not offer actions that the server will reject.
  const currentUserRole = meData?.preview?.readOnly ? "ROLE_PREVIEW" : meData?.role ?? "";
  const currentUserCapabilities = meData?.preview?.readOnly ? [] : meData?.capabilities ?? [];
  const canCreateReservation = meData != null && !meData.preview?.readOnly && (
    meData.role !== "COLLABORATOR" || currentUserCapabilities.includes("RESERVATION_CREATE")
  );
  // initialRequester is now handled inside the wizard page

  // Apply "mine" filter from URL once user data loads
  useEffect(() => {
    const nextParams = new URLSearchParams(urlSignature);
    if (nextParams.get("mine") === "true" && meData?.id && userFilter !== meData.id) {
      setUserFilter(meData.id);
    }
  }, [meData?.id, urlSignature, userFilter]);

  // ── Navigate to wizard page for creation ──
  const navigateToCreate = useCallback(() => {
    if (!canCreateReservation) return;
    const nextParams = new URLSearchParams(urlSignature);
    const base = "/reservations/new";
    const params = new URLSearchParams();
    const title = nextParams.get("title");
    const startsAt = nextParams.get("startsAt");
    const endsAt = nextParams.get("endsAt");
    const locationId = nextParams.get("locationId");
    const newFor = nextParams.get("newFor");
    const eventId = nextParams.get("eventId");
    const sportCode = nextParams.get("sportCode");
    const draftId = nextParams.get("draftId");
    const requesterUserId = nextParams.get("requesterUserId");
    if (title) params.set("title", title);
    if (startsAt) params.set("startsAt", startsAt);
    if (endsAt) params.set("endsAt", endsAt);
    if (locationId) params.set("locationId", locationId);
    if (newFor) params.set("newFor", newFor);
    if (eventId) params.set("eventId", eventId);
    if (sportCode) params.set("sportCode", sportCode);
    if (draftId) params.set("draftId", draftId);
    if (requesterUserId) params.set("requesterUserId", requesterUserId);
    const qs = params.toString();
    router.push(qs ? `${base}?${qs}` : base);
  }, [canCreateReservation, router, urlSignature]);

  // Auto-navigate to wizard if deep-link params present
  useEffect(() => {
    const nextParams = new URLSearchParams(urlSignature);
    if (nextParams.get("create") === "true" || nextParams.get("title") || nextParams.get("draftId") || nextParams.get("newFor")) {
      navigateToCreate();
    }
  }, [navigateToCreate, urlSignature]);

  // ── Sheet + menu ──
  // initialHighlight prop takes precedence over URL param (avoids multi-tab race when all tabs mount simultaneously)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    initialHighlight !== undefined ? (initialHighlight || null) : (urlParams.get("highlight") || urlParams.get("id") || null)
  );
  const [pendingSheetTab, setPendingSheetTab] = useState<BookingSheetSection | null>(
    initialHighlight !== undefined ? (initialSheetTab ?? null) : parseBookingSheetSection(urlParams.get("sheetTab"))
  );

  const openBookingDetails = useCallback((id: string, sheetTab: BookingSheetSection | null = null) => {
    setPendingSheetTab(sheetTab);
    setSelectedBookingId(id);
  }, []);

  useEffect(() => {
    if (initialHighlight) {
      setSelectedBookingId(initialHighlight);
      setPendingSheetTab(initialSheetTab ?? null);
    }
  }, [initialHighlight, initialSheetTab]);

  // Clear highlight/sheetTab from URL after consuming them (only when using URL-based highlight for deep links)
  useEffect(() => {
    const next = new URLSearchParams(urlSignature);
    if (initialHighlight === undefined && (next.get("highlight") || next.get("id") || next.get("sheetTab"))) {
      const highlightId = next.get("highlight") || next.get("id");
      if (highlightId) {
        setSelectedBookingId(highlightId);
        setPendingSheetTab(parseBookingSheetSection(next.get("sheetTab")));
      }
      next.delete("highlight");
      next.delete("id");
      next.delete("sheetTab");
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    }
  }, [initialHighlight, router, urlSignature]);

  const [extendingId, setExtendingId] = useState<string | null>(null);
  const extendingRef = useRef(false);

  // ── Overdue-first sort: float overdue items to top of current page ──
  const sortedItems = useMemo(() => {
    if (!config.overdueStatus) return items;
    const now = new Date();
    return [...items].sort((a, b) => {
      const aOverdue = a.status === config.overdueStatus && new Date(a.endsAt) < now;
      const bOverdue = b.status === config.overdueStatus && new Date(b.endsAt) < now;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      // Within overdue group: longest overdue first
      if (aOverdue && bOverdue) return new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
      return 0;
    });
  }, [items, config.overdueStatus]);

  // ── Data fetching is handled by React Query above ──

  // ── Menu handlers ──

  async function handleExtendFromMenu(bookingId: string, days: number) {
    const item = items.find((i) => i.id === bookingId);
    if (!item || extendingId || extendingRef.current) return;
    extendingRef.current = true;
    setExtendingId(bookingId);
    try {
      const res = await fetchWithTimeout(`/api/bookings/${bookingId}/extend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [BOOKING_SNAPSHOT_HEADER]: new Date(item.updatedAt).toISOString(),
        },
        body: JSON.stringify({ endsAt: new Date(new Date(item.endsAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString() }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success(`Extended by ${days} day${days !== 1 ? "s" : ""}`);
      } else {
        const msg = await parseErrorMessage(res, "Could not extend the booking. Refresh and check for conflicts.");
        toast.error(msg);
      }
      await reload();
    } catch {
      toast.error("Could not reach the server. The booking was not extended.");
    } finally {
      extendingRef.current = false;
      setExtendingId(null);
    }
  }

  // (Create flow is now a separate page — no sheet callbacks needed)

  // ── Derived ──

  const totalPages = Math.ceil(total / limit);
  const hasUserFilters = !!search || !!statusFilter || !!sportFilter || !!locationFilter || !!userFilter || !!specialFilter;
  const scopedLabel = config.scopeLabel ? `${config.scopeLabel.toLowerCase()} ` : "";

  const sportCodesInUse = useMemo(() => {
    if (!config.hasSportFilter) return [];
    const codes = new Set<string>();
    for (const item of items) {
      if (item.sportCode) codes.add(item.sportCode);
    }
    return Array.from(codes).sort();
  }, [items, config.hasSportFilter]);

  return (
    <>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-6 max-md:mb-4 max-md:flex-col max-md:items-start max-md:gap-3">
          <h1 className="text-[30px] tracking-[-0.03em] leading-none m-0 max-md:text-[22px]">{config.labelPlural}</h1>
        </div>
      )}

      {/* ════════ Filter bar + list ════════ */}
      <Card>
        {formOptionsError && (
          <div className="px-4 pt-4">
            <Alert variant="destructive">
              <AlertTitle>Filters did not load</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>Location and requester filters may be incomplete until the shared form data loads.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { void refetchFormOptions(); }}
                  className="h-10 shrink-0"
                >
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
        <BookingFilters
          config={config}
          search={search}
          onSearchChange={changeSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={changeStatus}
          specialFilter={specialFilter}
          onSpecialFilterChange={changeSpecialFilter}
          sportFilter={sportFilter}
          onSportFilterChange={changeSport}
          sportCodesInUse={sportCodesInUse}
          locationFilter={locationFilter}
          onLocationFilterChange={changeLocation}
          locations={locations}
          userFilter={userFilter}
          onUserFilterChange={changeRequester}
          users={users}
          onClearAll={clearAllFilters}
        />

        {/* ════════ Booking list ════════ */}
        {showInitialSkeleton ? (
          <SkeletonTable rows={6} cols={5} />
        ) : loadError ? (
          <EmptyState
            icon={loadError === "network" ? "wifi-off" : "clipboard"}
            title={loadError === "network" ? "You\u2019re offline" : `${config.labelPlural} did not load`}
            description={loadError === "network" ? `Could not reach the server. Retry before acting on this ${config.labelPlural.toLowerCase()} list.` : `Retry before acting on this ${config.labelPlural.toLowerCase()} list.`}
            actionLabel="Retry"
            onAction={reload}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={hasUserFilters
              ? `No ${config.labelPlural.toLowerCase()} match your filters`
              : `No ${scopedLabel}${config.labelPlural.toLowerCase()} yet`}
            description={hasUserFilters
              ? "Try a different search term or clear filters to see all results."
              : config.pastOnly
                ? `Completed and cancelled ${config.labelPlural.toLowerCase()} will appear here.`
                : `${config.label.charAt(0).toUpperCase() + config.label.slice(1)}s you create will appear here.`}
            actionLabel={hasUserFilters ? "Clear filters" : undefined}
            onAction={hasUserFilters ? clearAllFilters : undefined}
          />
        ) : (
          <>
            {viewMode === "cards" ? (
              /* ════════ Card grid ════════ */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                {sortedItems.map((item) => (
                  <BookingCard
                    key={item.id}
                    item={item}
                    overdueStatus={config.overdueStatus}
                    onClick={() => openBookingDetails(item.id)}
                    menuProps={{
                      currentUserId, currentUserRole, currentUserCapabilities, config, extendingId,
                      onViewDetails: openBookingDetails,
                      onExtend: handleExtendFromMenu,
                      items, reload, setItems,
                    }}
                  />
                ))}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="max-md:hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortHeader label="Name" sortKey="title" currentSort={sort} onSort={changeSort} />
                        <SortHeader label={config.startLabel} sortKey="startsAt" currentSort={sort} onSort={changeSort} />
                        <SortHeader label={config.endLabel} sortKey="endsAt" currentSort={sort} onSort={changeSort} />
                        <TableHead className="hidden md:table-cell">Duration</TableHead>
                        <TableHead className="hidden md:table-cell">{config.requesterLabel}</TableHead>
                        <TableHead className="hidden md:table-cell">Items</TableHead>
                        <TableHead className="w-11" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedItems.map((item) => (
                        <BookingTableRow
                          key={item.id}
                          item={item}
                          overdueStatus={config.overdueStatus}
                          onClick={() => openBookingDetails(item.id)}
                          menuProps={{
                            currentUserId, currentUserRole, currentUserCapabilities, config, extendingId,
                            onViewDetails: openBookingDetails,
                            onExtend: handleExtendFromMenu,
                            items, reload, setItems,
                          }}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card list */}
                <div className="hidden max-md:flex max-md:flex-col">
                  {sortedItems.map((item) => (
                    <BookingMobileCard
                      key={item.id}
                      item={item}
                      overdueStatus={config.overdueStatus}
                      onClick={() => openBookingDetails(item.id)}
                      menuProps={{
                        currentUserId, currentUserRole, currentUserCapabilities, config, extendingId,
                        onViewDetails: openBookingDetails,
                        onExtend: handleExtendFromMenu,
                        items, reload, setItems,
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm text-muted-foreground">
                <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious onClick={() => changePage(page - 1)} aria-disabled={page === 0} className={page === 0 ? "h-10 pointer-events-none opacity-50" : "h-10 cursor-pointer"} />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext onClick={() => changePage(page + 1)} aria-disabled={page >= totalPages - 1} className={page >= totalPages - 1 ? "h-10 pointer-events-none opacity-50" : "h-10 cursor-pointer"} />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ════════ Booking details sheet ════════ */}
      {selectedBookingId && (
        <Suspense>
          <BookingDetailsSheet
            bookingId={selectedBookingId}
            initialTab={pendingSheetTab}
            onClose={() => { setSelectedBookingId(null); setPendingSheetTab(null); }}
            onUpdated={reload}
          />
        </Suspense>
      )}

      {/* Remote creation is reservation-first. Checkout custody starts at kiosk pickup. */}
    </>
  );
}
