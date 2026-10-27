"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { classifyError, handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { collectLabelCatalog, type LabelCatalogPage } from "./label-catalog";

async function readLabelCatalogPage(path: string, signal?: AbortSignal): Promise<LabelCatalogPage<unknown, unknown>> {
  const res = await fetch(path, { signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error("server");
  const json = await parseJsonSafely<LabelCatalogPage<unknown, unknown>>(res);
  if (!json) throw new Error("server");
  return json;
}

export function useLabelCatalog<T>(
  search: string,
  options: {
    keepPreviousData?: boolean;
    transform: (catalog: { assets: unknown[]; families: unknown[] }) => T;
  },
) {
  const { transform } = options;
  const keepPreviousData = options.keepPreviousData ?? false;

  const {
    data,
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["label-catalog", search],
    queryFn: ({ signal }) => collectLabelCatalog(search, (path) => readLabelCatalogPage(path, signal)),
    select: (catalog) => transform(catalog),
    placeholderData: keepPreviousData ? (previousData) => previousData : undefined,
    refetchOnWindowFocus: true,
  });

  const prevFetchingRef = useRef(false);
  useEffect(() => {
    if (prevFetchingRef.current && !isFetching && queryError && data !== undefined) {
      toast.error("Failed to refresh. Your data may be stale.");
    }
    prevFetchingRef.current = isFetching;
  }, [isFetching, queryError, data]);

  return {
    data: data ?? null,
    loading: isLoading,
    error: queryError ? classifyError(queryError) : false as const,
    reload: () => { refetch(); },
  };
}
