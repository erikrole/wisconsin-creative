"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";

type LostUnitsTarget = { skuName: string; bulkSkuId: string; units: number[] };

/** Settle lost numbered units from the dashboard: it turned up, or the loss is confirmed. */
export function LostUnitsDialog({ target, onClose }: { target: LostUnitsTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busyUnit, setBusyUnit] = useState<number | null>(null);
  const [settled, setSettled] = useState<number[]>([]);
  const remaining = target ? target.units.filter((n) => !settled.includes(n)) : [];

  async function settle(unitNumber: number, status: "AVAILABLE" | "RETIRED") {
    if (!target || busyUnit !== null) return;
    setBusyUnit(unitNumber);
    const label = `${target.skuName} #${unitNumber}`;
    try {
      const res = await fetch(`/api/bulk-skus/${target.bulkSkuId}/units/${unitNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: status === "AVAILABLE" ? `${label} found` : `${label} loss confirmed` }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Couldn't update this unit"));
        return;
      }
      toast.success(status === "AVAILABLE" ? `${label} is back in stock` : `${label} written off`);
      const left = remaining.filter((n) => n !== unitNumber);
      setSettled((prev) => [...prev, unitNumber]);
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (left.length === 0) handleClose();
    } catch {
      toast.error("Couldn't update this unit");
    } finally {
      setBusyUnit(null);
    }
  }

  function handleClose() {
    setSettled([]);
    onClose();
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        {target && (
          <>
            <DialogHeader className="flex-col items-start gap-1">
              <DialogTitle>{target.skuName}: marked lost</DialogTitle>
              <DialogDescription>
                Found it puts the unit back in stock. Write off confirms the loss and retires it.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
            <ul className="flex flex-col divide-y">
              {remaining.map((n) => (
                <li key={n} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm font-bold">#{n}</span>
                  <span className="flex gap-2">
                    <Button variant="outline" className="h-10" disabled={busyUnit !== null} onClick={() => settle(n, "AVAILABLE")}>Found it</Button>
                    <Button variant="ghost" className="h-10" disabled={busyUnit !== null} onClick={() => settle(n, "RETIRED")}>Write off</Button>
                  </span>
                </li>
              ))}
            </ul>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link href="/reports/bulk-losses">Missing units report</Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
