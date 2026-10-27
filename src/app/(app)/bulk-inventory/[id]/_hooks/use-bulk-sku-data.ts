"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import {
  handleAuthRedirect,
  isAbortError,
  classifyError,
  parseJsonSafely,
  type FetchErrorKind,
} from "@/lib/errors";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ITEM_CHANGE_SYNC_EVENT, type ItemChangeSyncEventDetail } from "@/hooks/use-item-change-sync";
import type { BulkSkuDetail } from "../types";

export type UseBulkSkuDataReturn = {
  sku: BulkSkuDetail | null;
  setSku: React.Dispatch<React.SetStateAction<BulkSkuDetail | null>>;
  fetchError: FetchErrorKind | "not-found" | false;
  refreshing: boolean;
  currentUserRole: string;
  canEdit: boolean;
  loadSku: () => void;
};

export default function useBulkSkuData(id: string): UseBulkSkuDataReturn {
  const [sku, setSku] = useState<BulkSkuDetail | null>(null);
  const [fetchError, setFetchError] = useState<FetchErrorKind | "not-found" | false>(false);
  const [refreshing, setRefreshing] = useState(false);
  const { data: currentUser } = useCurrentUser();
  const currentUserRole = currentUser?.role ?? "";
  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedOnce = useRef(false);
  const { setBreadcrumbLabel } = useBreadcrumbLabel();

  const loadSku = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const isRefresh = hasLoadedOnce.current;
    if (isRefresh) setRefreshing(true);

    fetch(`/api/bulk-skus/${id}`, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return null;
        if (handleAuthRedirect(res, `/items/bulk-${id}`)) return null;
        if (res.status === 404) {
          if (!isRefresh) setFetchError("not-found");
          return null;
        }
        if (!res.ok) throw new Error("server");
        return parseJsonSafely<{ data?: BulkSkuDetail }>(res);
      })
      .then((json) => {
        if (!json || controller.signal.aborted) return;
        if (json?.data) {
          setSku(json.data);
          setBreadcrumbLabel(json.data.name);
          setFetchError(false);
          hasLoadedOnce.current = true;
          return;
        }
        throw new Error("incomplete");
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        if (isRefresh) {
          toast.error("Failed to refresh — data may be stale.");
        } else {
          setFetchError(classifyError(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
  }, [id, setBreadcrumbLabel]);

  useEffect(() => {
    loadSku();
    return () => { abortRef.current?.abort(); };
  }, [loadSku]);

  useEffect(() => {
    function onItemChange(event: Event) {
      const detail = (event as CustomEvent<ItemChangeSyncEventDetail>).detail;
      if (detail?.changedBulkSkuIds.includes(id)) loadSku();
    }

    window.addEventListener(ITEM_CHANGE_SYNC_EVENT, onItemChange);
    return () => window.removeEventListener(ITEM_CHANGE_SYNC_EVENT, onItemChange);
  }, [id, loadSku]);

  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "STAFF";

  return { sku, setSku, fetchError, refreshing, currentUserRole, canEdit, loadSku };
}
