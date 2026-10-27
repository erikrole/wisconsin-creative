"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import type { EquipmentSectionKey } from "@/lib/equipment-sections";
import type { PickerAsset } from "@/components/EquipmentPicker";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

type UsePickerSearchParams = {
  activeSection: EquipmentSectionKey;
  equipSearch: string;
  onlyAvailable: boolean;
};

export function usePickerSearch({
  activeSection,
  equipSearch,
  onlyAvailable,
}: UsePickerSearchParams) {
  const [sectionResults, setSectionResults] = useState<PickerAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [sectionCounts, setSectionCounts] = useState<Record<string, number> | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const initialFetchDoneRef = useRef(false);

  const fetchSectionResults = useCallback(async (section: EquipmentSectionKey, q: string, available: boolean) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchLoading(true);
    setSearchError(false);
    try {
      const params = new URLSearchParams();
      params.set("section", section);
      if (q) params.set("q", q);
      params.set("only_available", String(available));
      params.set("limit", "50");
      const res = await fetch(`/api/assets/picker-search?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{
          data?: { assets?: PickerAsset[]; total?: number; sectionCounts?: Record<string, number> | null };
        }>(res);
        const data = json?.data;
        if (!data?.assets) {
          toast.error("Equipment response was incomplete. Refresh and try again.");
          setSearchError(true);
          setSectionResults([]);
          setTotal(0);
          return;
        }
        setSectionResults(data.assets);
        setTotal(data.total ?? data.assets.length);
        setSectionCounts(data.sectionCounts ?? null);
      } else {
        toast.error(await parseErrorMessage(res, "Failed to load equipment"));
        setSearchError(true);
        setSectionResults([]);
        setTotal(0);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Failed to load equipment — check your connection and try again.");
      setSearchError(true);
      setSectionResults([]);
      setTotal(0);
    } finally {
      if (!controller.signal.aborted) setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetchSectionResults(activeSection, equipSearch, onlyAvailable);
    }, initialFetchDoneRef.current ? 300 : 0);
    initialFetchDoneRef.current = true;
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [activeSection, equipSearch, onlyAvailable, fetchSectionResults]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  const retry = useCallback(() => {
    fetchSectionResults(activeSection, equipSearch, onlyAvailable);
  }, [activeSection, equipSearch, fetchSectionResults, onlyAvailable]);

  return { sectionResults, total, sectionCounts, searchLoading, searchError, retry };
}
