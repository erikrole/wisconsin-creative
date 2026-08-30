"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation";
import { toast } from "sonner";

import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import type { AssetDetail } from "../types";

type UseItemActionsParams = {
  asset: AssetDetail | null;
  setAsset: React.Dispatch<React.SetStateAction<AssetDetail | null>>;
  loadAsset: () => void;
};

export type UseItemActionsReturn = {
  actionBusy: boolean;
  handleAction: (action: string) => Promise<void>;
  handleToggleFavorite: () => Promise<void>;
  saveHeaderField: (field: string, value: string) => Promise<void>;
};

export default function useItemActions({
  asset,
  setAsset,
  loadAsset,
}: UseItemActionsParams): UseItemActionsReturn {
  const router = useRouter();
  const confirmDialog = useConfirm();
  const invalidateItemCatalog = useInvalidateItemCatalog();
  const [actionBusy, setActionBusy] = useState(false);
  const busyRef = useRef(false);
  const favoriteBusyRef = useRef(false);

  const handleToggleFavorite = useCallback(async () => {
    if (!asset || favoriteBusyRef.current) return;
    favoriteBusyRef.current = true;
    const prev = asset.isFavorited;
    setAsset((a) => a ? { ...a, isFavorited: !prev } : a);
    try {
      const res = await fetch(`/api/assets/${asset.id}/favorite`, { method: "POST" });
      if (handleAuthRedirect(res)) {
        setAsset((a) => a ? { ...a, isFavorited: prev } : a);
        return;
      }
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to update favorite");
        throw new Error(msg);
      }
      invalidateItemCatalog();
    } catch (error) {
      setAsset((a) => a ? { ...a, isFavorited: prev } : a);
      toast.error(error instanceof Error ? error.message : "Failed to update favorite");
    } finally {
      favoriteBusyRef.current = false;
    }
  }, [asset, invalidateItemCatalog, setAsset]);

  async function saveHeaderField(field: string, value: string) {
    if (!asset) return;
    const body: Record<string, unknown> = { [field]: value || null };
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Save failed");
      throw new Error(msg);
    }
    setAsset((prev) => prev ? { ...prev, [field]: value } : prev);
    invalidateItemCatalog();
  }

  async function handleAction(action: string) {
    if (!asset || busyRef.current) return;
    busyRef.current = true;
    setActionBusy(true);
    try {
      if (action === "print-label") {
        router.push(`/labels?items=${asset.id}`);
        return;
      } else if (action === "retire") {
        const ok = await confirmDialog({
          title: "Retire item",
          message: "Retire this item? It will no longer be available for bookings.",
          confirmLabel: "Retire",
          variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/assets/${asset.id}/retire`, { method: "POST" });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          const msg = await parseErrorMessage(res, "Retire failed");
          toast.error(msg);
          return;
        }
        invalidateItemCatalog();
        loadAsset();
      } else if (action === "maintenance") {
        const res = await fetch(`/api/assets/${asset.id}/maintenance`, { method: "POST" });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          const msg = await parseErrorMessage(res, "Action failed");
          toast.error(msg);
          return;
        }
        invalidateItemCatalog();
        loadAsset();
      } else if (action === "delete") {
        const ok = await confirmDialog({
          title: "Delete item",
          message: "Permanently delete this item? This cannot be undone.",
          confirmLabel: "Delete",
          variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
        if (handleAuthRedirect(res)) return;
        if (res.ok) {
          invalidateItemCatalog();
          router.push("/items");
        } else {
          const msg = await parseErrorMessage(res, "Delete failed");
          toast.error(msg);
        }
      }
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      busyRef.current = false;
      setActionBusy(false);
    }
  }

  return {
    actionBusy,
    handleAction,
    handleToggleFavorite,
    saveHeaderField,
  };
}
