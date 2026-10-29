"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { PickerAsset } from "@/components/EquipmentPicker";
import type { BookingDetail } from "@/components/booking-details/types";

/** Admin-only: add one available numbered item to an active checkout. */
export function AddToCheckoutDialog({
  open,
  bookingId,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  bookingId: string;
  onOpenChange: (open: boolean) => void;
  onAdded: (booking: BookingDetail) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerAsset[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ only_available: "true", limit: "20" });
        if (query.trim()) params.set("q", query.trim());
        const res = await fetch(`/api/assets/picker-search?${params}`, { signal: controller.signal });
        if (handleAuthRedirect(res) || !res.ok) return;
        const json = await parseJsonSafely<{ data?: { assets?: PickerAsset[] } }>(res);
        setResults(json?.data?.assets ?? []);
      } catch {
        // Aborted or offline: keep the last results.
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  async function add(asset: PickerAsset) {
    if (addingId) return;
    setAddingId(asset.id);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not add this item"));
        return;
      }
      const json = await parseJsonSafely<{ data?: BookingDetail }>(res);
      if (json?.data) onAdded(json.data);
      toast.success(`${asset.name || asset.assetTag} added`);
      onOpenChange(false);
      setQuery("");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to this checkout</DialogTitle>
          <DialogDescription>Available items only. The item goes out now and is due back with the checkout.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or tag"
            aria-label="Search items"
            autoFocus
          />
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {results.map((asset) => (
              <li key={asset.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/60">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{asset.name || asset.assetTag}</p>
                  <p className="truncate text-xs text-muted-foreground">{asset.assetTag}</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="h-10" disabled={!!addingId} onClick={() => add(asset)}>
                  {addingId === asset.id ? "Adding..." : "Add"}
                </Button>
              </li>
            ))}
            {results.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">No available items found</li>}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
