"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOperationalPollingActivity } from "@/hooks/use-operational-polling-activity";

// Inventory mutation feedback is immediate locally; background freshness can
// use a slower cadence so a browsed Items tab does not keep Neon compute awake.
export const ITEM_CHANGE_SYNC_INTERVAL_MS = 60_000;
export const ITEM_CHANGE_SYNC_EVENT = "item-change-sync";

export type ItemChangeSyncEventDetail = {
  changedAssetIds: string[];
  changedBulkSkuIds: string[];
};

type ItemChangeResponse = {
  data?: {
    cursor?: string;
    changedAssetIds?: string[];
    changedBulkSkuIds?: string[];
  };
};

export function useItemChangeSync() {
  const queryClient = useQueryClient();
  const pollingState = useOperationalPollingActivity();
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    // Paused while hidden, idle, offline, or overnight. Becoming active polls immediately.
    if (pollingState !== "active") return;

    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    async function checkForChanges() {
      if (cancelled || inFlight) return;

      inFlight = true;
      try {
        const url = cursorRef.current
          ? `/api/items/changes?since=${encodeURIComponent(cursorRef.current)}`
          : "/api/items/changes";
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;

        const json = (await res.json()) as ItemChangeResponse;
        if (cancelled) return;
        const data = json.data;
        if (!data?.cursor) return;

        cursorRef.current = data.cursor;
        const changedAssetIds = data.changedAssetIds ?? [];
        const changedBulkSkuIds = data.changedBulkSkuIds ?? [];
        if (changedAssetIds.length === 0 && changedBulkSkuIds.length === 0) return;

        void queryClient.invalidateQueries({ queryKey: ["items"] });
        void queryClient.invalidateQueries({ queryKey: ["form-options"], refetchType: "none" });
        for (const assetId of changedAssetIds) {
          void queryClient.invalidateQueries({ queryKey: ["item", assetId] });
        }
        for (const bulkSkuId of changedBulkSkuIds) {
          void queryClient.invalidateQueries({ queryKey: ["bulkSku", bulkSkuId] });
        }

        window.dispatchEvent(
          new CustomEvent<ItemChangeSyncEventDetail>(ITEM_CHANGE_SYNC_EVENT, {
            detail: { changedAssetIds, changedBulkSkuIds },
          })
        );
      } catch {
        // The next interval will retry. Visible data should remain usable.
      } finally {
        inFlight = false;
      }
    }

    void checkForChanges();
    const interval = window.setInterval(checkForChanges, ITEM_CHANGE_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [pollingState, queryClient]);
}
