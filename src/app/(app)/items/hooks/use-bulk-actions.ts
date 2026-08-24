"use client";

import { useState } from "react";
import { toast } from "sonner";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { isBulkRowId } from "../lib/item-href";

const ACTION_LABELS: Record<string, string> = {
  move_location: "Moved",
  change_category: "Updated category for",
  retire: "Retired",
  unretire: "Restored",
  maintenance: "Updated maintenance status for",
  delete: "Deleted",
  add_to_kit: "Added to kit:",
  favorite: "Starred",
  unfavorite: "Unstarred",
};

const UNDOABLE_ACTIONS: Record<string, string> = {
  retire: "unretire",
};

export function useBulkActions(getSelectedIds: () => string[], onComplete: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function execute(action: string, payload?: Record<string, string | null>) {
    const ids = getSelectedIds();
    const assetIds = ids.filter((id) => !isBulkRowId(id));
    setBusy(true);
    setError("");
    try {
      if (assetIds.length === 0) {
        toast.error(
          ids.some((id) => isBulkRowId(id))
            ? "Bulk actions apply to standard items. Item families were skipped."
            : "No serialized items selected",
        );
        setBusy(false);
        return;
      }

      // Favorites actions use a separate endpoint and only work on serialized items.
      if (action === "favorite" || action === "unfavorite") {
        const res = await fetch("/api/assets/favorites/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetIds, action: action === "favorite" ? "add" : "remove" }),
        });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          const msg = await parseErrorMessage(res, "Failed to update favorites");
          setError(msg);
          toast.error(msg);
          setBusy(false);
          return;
        }
        const label = ACTION_LABELS[action];
        toast.success(`${label} ${assetIds.length} item${assetIds.length === 1 ? "" : "s"}`);
        setBusy(false);
        onComplete();
        return;
      }

      const res = await fetch("/api/assets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: assetIds, action, ...payload }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Bulk action failed");
        setError(msg);
        toast.error(msg);
        setBusy(false);
        return;
      }
      const label = ACTION_LABELS[action] ?? "Updated";
      const message = `${label} ${assetIds.length} item${assetIds.length === 1 ? "" : "s"}`;
      const undoAction = UNDOABLE_ACTIONS[action];
      if (undoAction) {
        const undoIds = [...assetIds];
        toast.success(message, {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                const res = await fetch("/api/assets/bulk", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ids: undoIds, action: undoAction }),
                });
                if (handleAuthRedirect(res)) return;
                if (!res.ok) {
                  toast.error(await parseErrorMessage(res, "Undo failed"));
                  return;
                }
                toast.success(`Restored ${undoIds.length} item${undoIds.length === 1 ? "" : "s"}`);
                onComplete();
              } catch {
                toast.error("Network error — undo failed");
              }
            },
          },
        });
      } else {
        toast.success(message);
      }
      setBusy(false);
      onComplete();
    } catch {
      setError("Network error");
      toast.error("Network error — bulk action failed");
      setBusy(false);
    }
  }

  return { execute, busy, error };
}
