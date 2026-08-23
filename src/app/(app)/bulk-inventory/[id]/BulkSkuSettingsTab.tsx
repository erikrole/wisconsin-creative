"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import type { BulkSkuDetail } from "./types";

export default function BulkSkuSettingsTab({
  sku,
  onRefresh,
}: {
  sku: BulkSkuDetail;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busyRef = useRef(false);

  async function toggleActive() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !sku.active }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) { toast.error(await parseErrorMessage(res, "Failed to update")); return; }
      toast.success(sku.active ? "Item archived" : "Item unarchived");
      onRefresh();
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to update status");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Cannot delete this item"));
        setConfirmDelete(false);
        return;
      }
      toast.success(`${sku.name} deleted`);
      router.push("/items");
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to delete item");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3.5 max-w-xl flex flex-col gap-4">
      {/* Archive toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="bulk-sku-active" className="text-sm font-medium">Active</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Archived items are hidden from booking flows but retain history.
              </p>
            </div>
            <Switch id="bulk-sku-active" checked={sku.active} onCheckedChange={toggleActive} disabled={busy} />
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          {!confirmDelete ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete item</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permanently removes this item. Cannot be undone. Blocked if booking history exists.
                </p>
              </div>
              <Button className="h-10"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-destructive">
                Delete &ldquo;{sku.name}&rdquo;? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button className="h-10" variant="destructive" onClick={handleDelete} disabled={busy}>
                  {busy ? "Deleting…" : "Yes, delete permanently"}
                </Button>
                <Button className="h-10" variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
