"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { statusBadgeVariant } from "@/lib/status-colors";
import type { BadgeProps } from "@/components/ui/badge";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { useUrlState } from "@/hooks/use-url-state";
import { ArrowRightIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { OperationalPartialResultsAlert } from "@/components/OperationalFeedback";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import { useCurrentUser } from "@/hooks/use-current-user";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { getVisiblePageSearchResults, type PageSearchResult } from "@/lib/search-pages";
import { assetSearchTitle } from "@/lib/search-result-title";

type EntitySearchResult = {
  type: "item" | "checkout" | "reservation" | "user";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  status?: string;
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
  location?: { name?: string | null } | null;
  computedStatus?: string | null;
  status?: string | null;
};

type BookingSearchItem = {
  id: string;
  title?: string | null;
  requester?: { name?: string | null } | null;
  status?: string | null;
};

type UserSearchItem = {
  id: string;
  name?: string | null;
  role?: string | null;
  email?: string | null;
};

const SEARCH_RESULT_SOURCES = {
  items: "Items",
  checkouts: "Checkouts",
  reservations: "Reservations",
  users: "Users",
} as const;

function formatStatusLabel(status: string): string {
  switch (status) {
    case "PENDING_PICKUP": return "Pending pickup";
    case "OPEN": return "Checked Out";
    case "BOOKED": return "Reserved";
    case "DRAFT": return "Draft";
    case "COMPLETED": return "Completed";
    case "CANCELLED": return "Cancelled";
    default: return status.replace(/_/g, " ");
  }
}

export default function SearchPage() {
  const { data: user } = useCurrentUser();
  // Committed search value. DebouncedSearchInput owns the per-keystroke echo
  // and only commits settled text, so this state (and the URL) update once per
  // pause instead of once per character.
  const [query, setQuery] = useUrlState<string>(
    "q",
    (v) => v ?? "",
    (v) => (v.trim() ? v : null),
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<"network" | "server" | false>(false);
  const [partialFailures, setPartialFailures] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<SearchResult[]>([]);
  const resultsQueryRef = useRef("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resetSearchState = useCallback(() => {
    abortRef.current?.abort();
    resultsRef.current = [];
    resultsQueryRef.current = "";
    setResults([]);
    setLoading(false);
    setSearched(false);
    setSearchError(false);
    setPartialFailures([]);
  }, []);

  // NOTE (GAP-11): This page intentionally uses raw fetch() instead of useFetch.
  // The search fans out to 4 endpoints in parallel (assets, checkouts, reservations,
  // users) with a shared AbortController, then merges results into a unified list.
  // useFetch is single-URL and doesn't support coordinated multi-endpoint abort/merge.
  // Caching is also undesirable here — search results should always be fresh for the
  // current query string.
  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      resetSearchState();
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setSearched(true);
    setSearchError(false as const);
    setPartialFailures([]);

    const encoded = encodeURIComponent(trimmed);
    const canPreserveResults = resultsQueryRef.current === trimmed && resultsRef.current.length > 0;

    try {
      const [itemsRes, checkoutsRes, reservationsRes, usersRes] = await Promise.allSettled([
        fetch(`/api/assets?q=${encoded}&limit=10`, { signal: controller.signal }),
        fetch(`/api/checkouts?q=${encoded}&status_in=OPEN,PENDING_PICKUP&limit=10`, { signal: controller.signal }),
        fetch(`/api/reservations?q=${encoded}&status=BOOKED&limit=10`, { signal: controller.signal }),
        fetch(`/api/users?q=${encoded}&limit=10`, { signal: controller.signal }),
      ]);

      const merged: SearchResult[] = getVisiblePageSearchResults(
        user?.role,
        trimmed,
        12,
        user?.canViewUsageAnalytics === true,
      );
      const failures: string[] = [];

      if (itemsRes.status === "fulfilled" && handleAuthRedirect(itemsRes.value, "/search")) return;
      if (checkoutsRes.status === "fulfilled" && handleAuthRedirect(checkoutsRes.value, "/search")) return;
      if (reservationsRes.status === "fulfilled" && handleAuthRedirect(reservationsRes.value, "/search")) return;
      if (usersRes.status === "fulfilled" && handleAuthRedirect(usersRes.value, "/search")) return;

      if (itemsRes.status === "fulfilled" && itemsRes.value.ok) {
        const json = await parseJsonSafely<ApiSearchList<AssetSearchItem>>(itemsRes.value);
        const data = json?.data;
        if (!data) failures.push(SEARCH_RESULT_SOURCES.items);
        for (const item of (data ?? []).slice(0, 10)) {
          merged.push({
            type: "item",
            id: item.id,
            title: assetSearchTitle(item),
            subtitle: [item.type, item.location?.name].filter(Boolean).join(" · "),
            href: `/items/${item.id}`,
            status: item.computedStatus || item.status || undefined,
          });
        }
      } else {
        failures.push(SEARCH_RESULT_SOURCES.items);
      }

      if (checkoutsRes.status === "fulfilled" && checkoutsRes.value.ok) {
        const json = await parseJsonSafely<ApiSearchList<BookingSearchItem>>(checkoutsRes.value);
        const data = json?.data;
        if (!data) failures.push(SEARCH_RESULT_SOURCES.checkouts);
        for (const b of (data ?? []).slice(0, 10)) {
          merged.push({
            type: "checkout",
            id: b.id,
            title: b.title ?? "Untitled checkout",
            subtitle: b.requester?.name || "",
            href: `/checkouts/${b.id}`,
            status: b.status ?? undefined,
          });
        }
      } else {
        failures.push(SEARCH_RESULT_SOURCES.checkouts);
      }

      if (reservationsRes.status === "fulfilled" && reservationsRes.value.ok) {
        const json = await parseJsonSafely<ApiSearchList<BookingSearchItem>>(reservationsRes.value);
        const data = json?.data;
        if (!data) failures.push(SEARCH_RESULT_SOURCES.reservations);
        for (const b of (data ?? []).slice(0, 10)) {
          merged.push({
            type: "reservation",
            id: b.id,
            title: b.title ?? "Untitled reservation",
            subtitle: b.requester?.name || "",
            href: `/reservations/${b.id}`,
            status: b.status ?? undefined,
          });
        }
      } else {
        failures.push(SEARCH_RESULT_SOURCES.reservations);
      }

      if (usersRes.status === "fulfilled" && usersRes.value.ok) {
        const json = await parseJsonSafely<ApiSearchList<UserSearchItem>>(usersRes.value);
        const data = json?.data;
        if (!data) failures.push(SEARCH_RESULT_SOURCES.users);
        for (const u of (data ?? []).slice(0, 10)) {
          merged.push({
            type: "user",
            id: u.id,
            title: u.name ?? "Unnamed user",
            subtitle: [u.role, u.email].filter(Boolean).join(" · "),
            href: `/users/${u.id}`,
          });
        }
      } else {
        failures.push(SEARCH_RESULT_SOURCES.users);
      }

      if (canPreserveResults && failures.length > 0) {
        const failedResultTypes = new Set<SearchResult["type"]>();
        if (failures.includes(SEARCH_RESULT_SOURCES.items)) failedResultTypes.add("item");
        if (failures.includes(SEARCH_RESULT_SOURCES.checkouts)) failedResultTypes.add("checkout");
        if (failures.includes(SEARCH_RESULT_SOURCES.reservations)) failedResultTypes.add("reservation");
        if (failures.includes(SEARCH_RESULT_SOURCES.users)) failedResultTypes.add("user");

        for (const previous of resultsRef.current) {
          if (
            failedResultTypes.has(previous.type)
            && !merged.some((result) => result.type === previous.type && result.id === previous.id)
          ) {
            merged.push(previous);
          }
        }
      }

      if (!controller.signal.aborted) {
        if (failures.length === 4 && merged.length === 0) {
          if (canPreserveResults) {
            setPartialFailures(Object.values(SEARCH_RESULT_SOURCES));
          } else {
            resultsRef.current = [];
            resultsQueryRef.current = "";
            setResults([]);
            setSearchError("server");
          }
        } else {
          resultsRef.current = merged;
          resultsQueryRef.current = trimmed;
          setResults(merged);
          setPartialFailures(failures);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!controller.signal.aborted) {
        if (canPreserveResults) {
          setPartialFailures(Object.values(SEARCH_RESULT_SOURCES));
        } else {
          resultsRef.current = [];
          resultsQueryRef.current = "";
          setResults([]);
          setSearchError("network");
          setPartialFailures([]);
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [resetSearchState, user?.canViewUsageAnalytics, user?.role]);

  // Auto-search on committed query change (typing pause, Enter, clear, or
  // browser navigation rehydrating the q param).
  useEffect(() => {
    runSearch(query);
  }, [query, runSearch]);

  const grouped = {
    page: results.filter((r) => r.type === "page"),
    item: results.filter((r) => r.type === "item"),
    checkout: results.filter((r) => r.type === "checkout"),
    reservation: results.filter((r) => r.type === "reservation"),
    user: results.filter((r) => r.type === "user"),
  };

  const sectionLabels: Record<string, string> = {
    page: "Go to",
    item: "Items",
    checkout: "Checkouts",
    reservation: "Reservations",
    user: "Users",
  };

  const sectionViewAllHrefs: Record<string, string> = {
    item: `/items?q=${encodeURIComponent(query.trim())}`,
    checkout: `/bookings?tab=checkouts&q=${encodeURIComponent(query.trim())}`,
    reservation: `/bookings?tab=reservations&q=${encodeURIComponent(query.trim())}`,
    user: `/users?q=${encodeURIComponent(query.trim())}`,
  };

  return (
    <FadeUp>
    <div className="p-6">
      <PageHeader title="Search" />

      <div className="mb-6 flex max-w-xl items-center gap-3">
        <DebouncedSearchInput
          id="global-search-query"
          name="global-search-query"
          ref={inputRef}
          containerClassName="min-w-0 flex-1"
          placeholder="Search items, checkouts, reservations, users..."
          value={query}
          onValueChange={setQuery}
          aria-label="Search items, checkouts, reservations, users"
        />
        {loading && results.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner className="size-4" />
            Updating
          </span>
        )}
      </div>

      {loading && results.length === 0 && (
        <div className="flex flex-col gap-6" role="status" aria-label="Loading search results">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3.5 w-20 mb-2" />
              <Card>
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className={`flex items-center justify-between gap-3 py-3 px-4 ${j < 2 ? "border-b border-border" : ""}`}>
                    <div className="flex-1 flex flex-col gap-2">
                      <Skeleton className="h-4 w-[60%]" />
                      <Skeleton className="h-3 w-[35%]" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      {!loading && searchError && query.trim() && (
        <EmptyState
          icon={searchError === "network" ? "wifi-off" : "search"}
          title={searchError === "network" ? "Can\u2019t connect" : "Search did not load"}
          description={searchError === "network"
            ? "Check your connection and retry this search."
            : "Something went wrong on our end. Retry this search."}
          actionLabel="Retry"
          onAction={() => { void runSearch(query); }}
        />
      )}

      {!loading && !searchError && partialFailures.length > 0 && results.length > 0 && (
        <OperationalPartialResultsAlert
          className="mb-4"
          failureLabel="Unavailable result types"
          failures={partialFailures}
          noun="result type"
          recoveryCopy="Showing available matches. Refresh before treating this search as complete."
          title="Some result types did not load"
          actionLabel="Retry"
          onAction={() => { void runSearch(query); }}
        />
      )}

      {!loading && !searchError && searched && results.length === 0 && (
        <EmptyState icon="search" title="No results found" description={`Nothing matched "${query}". Try a tag, borrower, page name, setting, or report.`} />
      )}

      {results.length > 0 && (
        <div
          className={`flex flex-col gap-6 transition-opacity ${loading ? "opacity-60" : ""}`}
          aria-busy={loading}
        >
          {(["page", "item", "checkout", "reservation", "user"] as const).map((type) => {
            const items = grouped[type];
            if (items.length === 0) return null;
            return (
              <div key={type}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm text-muted-foreground uppercase m-0">
                    {sectionLabels[type]!} ({items.length}{items.length >= 10 ? "+" : ""})
                  </h2>
                  {type !== "page" && items.length >= 10 && (
                    <Link
                      href={sectionViewAllHrefs[type]!}
                      className="inline-flex min-h-10 items-center rounded-md px-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      View all {sectionLabels[type]!.toLowerCase()}
                    </Link>
                  )}
                </div>
                <Card>
                  {items.map((r, i) => (
                    <Link
                      key={r.id}
                      href={r.href}
                      className={`flex min-h-12 items-center justify-between gap-3 py-3 px-4 no-underline text-inherit cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${i < items.length - 1 ? "border-b border-border" : ""}`}
                    >
                      <div>
                        <div className="flex items-center gap-2 font-semibold">
                          {r.type === "page" && <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
                          <span>{r.title}</span>
                        </div>
                        {r.subtitle && <div className="text-sm text-muted-foreground">{r.subtitle}</div>}
                      </div>
                      {r.type !== "page" && r.status && (
                        <Badge variant={statusBadgeVariant(r.status) as BadgeProps["variant"]}>
                          {formatStatusLabel(r.status)}
                        </Badge>
                      )}
                    </Link>
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </FadeUp>
  );
}
