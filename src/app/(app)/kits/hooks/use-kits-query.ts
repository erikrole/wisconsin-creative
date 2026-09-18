"use client";

import { useEffect, useState } from "react";
import { useFetch } from "@/hooks/use-fetch";

export type KitRow = {
  id: string;
  name: string;
  description: string | null;
  sportCode: string | null;
  gamedayRole: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  location: { id: string; name: string };
  _count: { members: number; bulkMembers: number };
};

type KitsSummary = {
  total: number;
  active: number;
  archived: number;
  empty: number;
};

type KitsResponse = {
  data: KitRow[];
  total: number;
  limit: number;
  offset: number;
  summary: KitsSummary;
};

type QueryDeps = {
  search: string;
  locationId: string;
  includeArchived: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
};

export function useKitsQuery(deps: QueryDeps) {
  const [page, setPage] = useState(0);
  const limit = 25;

  useEffect(() => {
    setPage(0);
  }, [deps.search, deps.locationId, deps.includeArchived, deps.sortBy, deps.sortOrder]);

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(page * limit));
  if (deps.search) params.set("q", deps.search);
  if (deps.locationId) params.set("location_id", deps.locationId);
  if (deps.includeArchived) params.set("include_archived", "true");
  if (deps.sortBy) params.set("sort", deps.sortBy);
  if (deps.sortOrder) params.set("order", deps.sortOrder);

  const { data, loading, refreshing, error, reload } = useFetch<KitsResponse>({
    url: `/api/kits?${params}`,
    transform: (json) => json as unknown as KitsResponse,
    // Keep the previous rows visible while a changed search/filter refetches,
    // so the page never swaps to the full skeleton (and drops input focus)
    // after the initial load.
    keepPreviousData: true,
  });

  const kits = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const summary = data?.summary ?? { total, active: 0, archived: 0, empty: 0 };

  useEffect(() => {
    if (page > 0 && totalPages === 0) {
      setPage(0);
    } else if (page > 0 && page >= totalPages) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  return {
    kits,
    total,
    summary,
    page,
    setPage,
    limit,
    totalPages,
    loading,
    refreshing,
    loadError: !!error,
    reload,
  };
}
