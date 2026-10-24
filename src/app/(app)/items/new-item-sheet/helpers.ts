"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-url-state";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { generateAssetQrCode } from "@/lib/asset-qr-code";
import type { ParentSearchResult } from "./types";

export function generateQrCode(): string {
  return generateAssetQrCode();
}

function getFiscalYearOptions(): string[] {
  const now = new Date();
  const calYear = now.getFullYear();
  const currentFY = now.getMonth() >= 6 ? calYear + 1 : calYear;
  const options: string[] = [];
  for (let y = currentFY + 2; y >= currentFY - 5; y -= 1) {
    options.push(String(y));
  }
  return options;
}

export const FISCAL_YEARS = getFiscalYearOptions();

type ParentSearchRow = {
  id?: unknown;
  assetTag?: unknown;
  name?: unknown;
  brand?: unknown;
  model?: unknown;
};

type ParentSearchResponse = {
  data?: ParentSearchRow[];
};

type ValidParentSearchRow = ParentSearchRow & {
  id: string;
  assetTag: string;
};

const NO_PARENTS: ParentSearchResult[] = [];

async function searchParents(query: string, signal: AbortSignal): Promise<ParentSearchResult[]> {
  const res = await fetch(`/api/assets?q=${encodeURIComponent(query)}&limit=5`, { signal });
  if (handleAuthRedirect(res)) return NO_PARENTS;
  const json = await parseJsonSafely<ParentSearchResponse>(res);
  if (!res.ok) throw new Error("Parent search failed");
  return (json?.data || [])
    .filter((a): a is ValidParentSearchRow => (
      typeof a.id === "string" && typeof a.assetTag === "string"
    ))
    .map((a) => ({
      id: a.id,
      assetTag: a.assetTag,
      name: typeof a.name === "string" ? a.name : null,
      brand: typeof a.brand === "string" ? a.brand : "",
      model: typeof a.model === "string" ? a.model : "",
    }));
}

export function useParentSearch() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const searchable = query.length >= 2 && debouncedQuery.length >= 2;
  const search = useQuery({
    queryKey: ["items", "parent-search", debouncedQuery],
    queryFn: ({ signal }) => searchParents(debouncedQuery, signal),
    enabled: searchable,
    // Keep the last matches on screen while the next search runs.
    placeholderData: keepPreviousData,
    retry: false,
  });

  return {
    query,
    setQuery,
    results: searchable ? search.data ?? NO_PARENTS : NO_PARENTS,
    searching: searchable && search.isFetching,
    clear: () => setQuery(""),
  };
}
