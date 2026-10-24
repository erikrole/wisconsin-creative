"use client";

import { useEffect, useRef, useState } from "react";
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

export function useParentSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ParentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/assets?q=${encodeURIComponent(query)}&limit=5`);
        if (handleAuthRedirect(res)) return;
        const json = await parseJsonSafely<ParentSearchResponse>(res);
        if (res.ok) {
          setResults(
            (json?.data || [])
              .filter((a): a is ValidParentSearchRow => (
                typeof a.id === "string" && typeof a.assetTag === "string"
              ))
              .map((a) => ({
                id: a.id,
                assetTag: a.assetTag,
                name: typeof a.name === "string" ? a.name : null,
                brand: typeof a.brand === "string" ? a.brand : "",
                model: typeof a.model === "string" ? a.model : "",
              }))
          );
        }
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return {
    query,
    setQuery,
    results,
    searching,
    clear: () => {
      setQuery("");
      setResults([]);
    },
  };
}
