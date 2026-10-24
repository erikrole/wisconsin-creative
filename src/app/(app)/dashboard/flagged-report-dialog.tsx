"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import type { FlaggedItem } from "../dashboard-types";

export function FlaggedReportDialog({ item, onClose }: { item: FlaggedItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const inMaintenance = item?.assetStatus === "MAINTENANCE";

  async function toggleMaintenance() {
    if (!item || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${item.assetId}/maintenance`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Couldn't update maintenance"));
        return;
      }
      toast.success(inMaintenance ? "Maintenance cleared" : "Flagged for maintenance");
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    } catch {
      toast.error("Couldn't update maintenance");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>
                {item.type === "LOST" ? "Lost" : "Damage"} report: {item.assetTag}
              </DialogTitle>
              <DialogDescription>
                {[item.assetName, item.bookingTitle, item.reportedBy && `Reported by ${item.reportedBy}`]
                  .filter(Boolean)
                  .join(" · ")}
              </DialogDescription>
            </DialogHeader>
            {item.imageUrl ? (
              <a href={item.imageUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- report photos are arbitrary blob URLs */}
                <img
                  src={item.imageUrl}
                  alt={`Photo of reported ${item.type === "LOST" ? "loss" : "damage"} on ${item.assetTag}`}
                  className="max-h-80 w-full rounded-md border object-contain"
                />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No photo was attached to this report.</p>
            )}
            {item.description && <p className="whitespace-pre-wrap text-sm">{item.description}</p>}
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link href={`/items/${item.assetId}`}>Open item</Link>
              </Button>
              <Button onClick={toggleMaintenance} disabled={busy}>
                {inMaintenance ? "Clear maintenance" : "Needs maintenance"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
