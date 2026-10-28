"use client";

import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Download, PlusIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { BulkUnitGrid } from "@/components/BulkUnitGrid";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { BulkSkuProductsCard } from "./BulkSkuProductsCard";
import type { BulkSkuDetail } from "./types";

export default function BulkSkuUnitsTab({
  sku,
  canEdit,
  onRefresh,
  onUnitsAdded,
}: {
  sku: BulkSkuDetail;
  canEdit: boolean;
  onRefresh: () => void;
  onUnitsAdded?: (count: number) => void;
}) {
  const [addingUnits, setAddingUnits] = useState(false);
  const [addCount, setAddCount] = useState(10);
  const [addProductId, setAddProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const addBusyRef = useRef(false);
  const statusBusyRef = useRef(new Set<string>());
  const productBusyRef = useRef(new Set<number>());

  const units = sku.units ?? [];
  const available = units.filter((u) => u.status === "AVAILABLE").length;
  const checkedOut = units.filter((u) => u.status === "CHECKED_OUT").length;
  const lost = units.filter((u) => u.status === "LOST").length;
  const retired = units.filter((u) => u.status === "RETIRED").length;
  const activeUnits = units.filter((u) => u.status !== "RETIRED");
  const printedLabels = activeUnits.filter((u) => !!u.labelPrintedAt).length;
  const activeProducts = sku.products.filter((product) => product.active);
  const selectedAddProductId = activeProducts.some((product) => product.id === addProductId) ? addProductId : "";

  async function handleExportLabels() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}/units/labels?scope=unprinted`);
      if (handleAuthRedirect(res)) return;
      if (!res.ok) { toast.error(await parseErrorMessage(res, "Failed to build label CSV")); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `brother-labels-${sku.id}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Label CSV downloaded. Mark printed from Battery Ops.");
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to export labels. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleStatusChange(unitNumber: number, newStatus: "AVAILABLE" | "LOST" | "RETIRED") {
    const key = `${unitNumber}:${newStatus}`;
    if (statusBusyRef.current.has(key)) return;
    statusBusyRef.current.add(key);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}/units/${unitNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) { toast.error(await parseErrorMessage(res, "Failed to update unit")); return; }
      onRefresh();
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to update unit. Try again.");
    } finally {
      statusBusyRef.current.delete(key);
    }
  }

  async function handleProductChange(unitNumber: number, productId: string | null) {
    if (productBusyRef.current.has(unitNumber)) return;
    productBusyRef.current.add(unitNumber);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}/units/${unitNumber}/product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) { toast.error(await parseErrorMessage(res, "Failed to assign product")); return; }
      toast.success(productId ? `Product assigned to unit #${unitNumber}` : `Product cleared from unit #${unitNumber}`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to assign product. Try again.");
    } finally {
      productBusyRef.current.delete(unitNumber);
    }
  }

  async function handleAddUnits() {
    if (addCount <= 0) return;
    if (addBusyRef.current) return;
    addBusyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: addCount, productId: selectedAddProductId || null }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) { toast.error(await parseErrorMessage(res, "Failed to add units")); return; }
      toast.success(`Added ${addCount} units`);
      setAddingUnits(false);
      onUnitsAdded?.(addCount);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to add units. Try again.");
    } finally {
      addBusyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3.5 flex flex-col gap-4">
      <BulkSkuProductsCard sku={sku} canEdit={canEdit} onRefresh={onRefresh} />
      <Card className="border-border/40 shadow-none">
        <CardHeader className="flex-col gap-4 border-b border-border/40 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <CardTitle className="text-base tabular-nums">
                {activeUnits.length} active units
              </CardTitle>
              {retired > 0 ? (
                <span className="text-xs text-muted-foreground tabular-nums">{units.length} numbered records</span>
              ) : null}
            </div>
            <CardDescription className="mt-1 text-pretty">
              Right-click or press and hold an available unit to change its status.
            </CardDescription>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {available > 0 && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-[var(--green)]" />{available} available</span>}
              {checkedOut > 0 && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-[var(--blue)]" />{checkedOut} out</span>}
              {lost > 0 && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-destructive" />{lost} missing</span>}
              {retired > 0 && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-muted-foreground" />{retired} retired records</span>}
              {sku.trackByNumber && units.length > 0 && (
                <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-muted-foreground/60" />{printedLabels}/{activeUnits.length} active labels</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
          {sku.trackByNumber && units.length > 0 && (
            <Button variant="outline" className="h-10 active:scale-[0.96] transition-transform" onClick={handleExportLabels} disabled={exporting}>
              <Download className="size-4" />
              {exporting ? "Exporting…" : "Brother CSV"}
            </Button>
          )}
          {canEdit && (
            addingUnits ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {activeProducts.length > 0 && (
                  <NativeSelect
                    aria-label="Product for new units"
                    value={selectedAddProductId}
                    onChange={(event) => setAddProductId(event.target.value)}
                    className="h-10 w-48"
                    disabled={busy}
                  >
                    <option value="">Unassigned product</option>
                    {activeProducts.map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </NativeSelect>
                )}
                <Input
                  id="bulk-sku-add-units-count"
                  name="addUnitsCount"
                  type="number" min={1} max={500} value={addCount}
                  onChange={(e) => setAddCount(Number(e.target.value))}
                  className="w-20"
                  disabled={busy}
                />
                <Button className="h-10" onClick={handleAddUnits} disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
                <Button className="h-10" variant="outline" onClick={() => setAddingUnits(false)} disabled={busy}>Cancel</Button>
              </div>
            ) : (
              <Button variant="outline" className="h-10 active:scale-[0.96] transition-transform" onClick={() => setAddingUnits(true)}>
                <PlusIcon className="size-4" />
                Add units
              </Button>
            )
          )}
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {units.length === 0 ? (
            <EmptyState
              inline
              icon="box"
              title="No units yet"
              description="Add units to track this item family individually."
              actionLabel={canEdit ? "Add units" : undefined}
              onAction={canEdit ? () => setAddingUnits(true) : undefined}
            />
          ) : (
            <>
              <BulkUnitGrid
                units={units}
                products={sku.products}
                onStatusChange={handleStatusChange}
                onProductChange={handleProductChange}
                disabled={!canEdit}
              />
              {canEdit && checkedOut > 0 ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Checked-out units are locked here and return through kiosk check-in.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
