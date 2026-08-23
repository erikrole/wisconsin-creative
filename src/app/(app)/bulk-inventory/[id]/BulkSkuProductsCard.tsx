"use client";

import { useRef, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { BulkSkuDetail, BulkSkuProduct } from "./types";

type ProductDraft = {
  name: string;
  brand: string;
  model: string;
};

const EMPTY_DRAFT: ProductDraft = { name: "", brand: "", model: "" };

export function BulkSkuProductsCard({
  sku,
  canEdit,
  onRefresh,
}: {
  sku: BulkSkuDetail;
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  function beginCreate() {
    setEditingId("new");
    setDraft(EMPTY_DRAFT);
  }

  function beginEdit(product: BulkSkuProduct) {
    setEditingId(product.id);
    setDraft({ name: product.name, brand: product.brand, model: product.model ?? "" });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function saveProduct() {
    if (!draft.name.trim() || !draft.brand.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const creating = editingId === "new";
    const endpoint = creating
      ? `/api/bulk-skus/${sku.id}/products`
      : `/api/bulk-skus/${sku.id}/products/${editingId}`;

    try {
      const res = await fetch(endpoint, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          brand: draft.brand,
          model: draft.model.trim() || null,
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, creating ? "Failed to add product" : "Failed to update product"));
        return;
      }
      const json = await parseJsonSafely<{ data?: BulkSkuProduct }>(res);
      if (!json?.data) {
        toast.error("Product saved, but the response was incomplete. Refresh and try again.");
        return;
      }
      toast.success(creating ? `${json.data.name} added` : `${json.data.name} updated`);
      cancelEdit();
      onRefresh();
    } catch (error) {
      toast.error(error instanceof TypeError ? "You’re offline. Check your connection." : "Failed to save product");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function toggleProduct(product: BulkSkuProduct) {
    if (savingRef.current) return;
    if (product.active) {
      const approved = await confirm({
        title: `Archive ${product.name}?`,
        message: `${product._count.units} assigned unit${product._count.units === 1 ? "" : "s"} will keep this product identity. Archived products cannot be assigned to more units until restored.`,
        confirmLabel: "Archive product",
        variant: "danger",
      });
      if (!approved) return;
    }
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !product.active }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to update product"));
        return;
      }
      toast.success(product.active ? `${product.name} archived` : `${product.name} restored`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof TypeError ? "You’re offline. Check your connection." : "Failed to update product");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Card className="border-border/40 shadow-none">
      <CardHeader className="flex-col gap-3 border-b border-border/40 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Products in this family</CardTitle>
          <CardDescription className="mt-1 max-w-2xl">
            Watson, GVM, and future compatible products stay under one bookable family and one numbered QR sequence.
          </CardDescription>
        </div>
        {canEdit && editingId === null && (
          <Button type="button" variant="outline" className="h-10 shrink-0" onClick={beginCreate}>
            <Plus className="size-4" aria-hidden="true" />
            Add product
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {editingId === "new" && (
          <ProductForm draft={draft} saving={saving} onChange={setDraft} onSave={saveProduct} onCancel={cancelEdit} />
        )}

        {sku.products.length === 0 && editingId !== "new" ? (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm font-medium">No products defined</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a product before assigning brand and model identity to numbered units.</p>
            {canEdit && (
              <Button type="button" variant="outline" className="mt-4 h-10" onClick={beginCreate}>
                <Plus className="size-4" aria-hidden="true" />
                Add first product
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/40 overflow-hidden rounded-md border border-border/50">
            {sku.products.map((product) => (
              <div key={product.id} className="px-3 py-3">
                {editingId === product.id ? (
                  <ProductForm draft={draft} saving={saving} onChange={setDraft} onSave={saveProduct} onCancel={cancelEdit} />
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{product.name}</p>
                        <Badge variant={product.active ? "gray" : "outline"} size="sm">
                          {product.active ? `${product._count.units} units` : "Archived"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {[product.brand, product.model].filter(Boolean).join(" · ")}
                        {!product.active && product._count.units > 0 ? ` · ${product._count.units} assigned units retain this identity` : ""}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <Button className="h-10" type="button" variant="ghost" onClick={() => beginEdit(product)} disabled={saving}>
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Edit
                        </Button>
                        <Button className="h-10" type="button" variant="ghost" onClick={() => toggleProduct(product)} disabled={saving}>
                          {product.active ? <Archive className="size-3.5" aria-hidden="true" /> : <ArchiveRestore className="size-3.5" aria-hidden="true" />}
                          {product.active ? "Archive" : "Restore"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProductForm({
  draft,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ProductDraft;
  saving: boolean;
  onChange: (draft: ProductDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md bg-muted/25 p-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm font-medium">
        Product name
        <Input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Watson NP-F550" disabled={saving} autoFocus />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Brand
        <Input value={draft.brand} onChange={(event) => onChange({ ...draft, brand: event.target.value })} placeholder="Watson" disabled={saving} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Model <span className="font-normal text-muted-foreground">optional</span>
        <Input value={draft.model} onChange={(event) => onChange({ ...draft, model: event.target.value })} placeholder="B-4203" disabled={saving} />
      </label>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="button" onClick={onSave} disabled={saving || !draft.name.trim() || !draft.brand.trim()}>
          {saving ? "Saving…" : "Save product"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}
