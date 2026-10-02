"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildBrotherLabelCsv, splitAssetTag } from "@/lib/brother-label-csv";

/** One label in the print cart, editable in the review step before export. */
export type CartEntry = {
  id: string;
  title: string;
  description: string;
  name: string;
  qrCodeValue: string;
  primaryScanCode?: string;
  tag: string;
  number: string;
  copies: number;
};

const STORAGE_KEY = "labels.cart.v1";

function readStoredCart(): CartEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartEntry[]) : [];
  } catch {
    return [];
  }
}

export function newCartEntry(item: Omit<CartEntry, "tag" | "number" | "copies">): CartEntry {
  return { ...item, ...splitAssetTag(item.title), copies: 1 };
}

/** Cart persisted per browser so it survives searches, navigation and reloads. */
export function useLabelCart() {
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCart(readStoredCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Storage blocked: the cart still works for this visit.
    }
  }, [cart, hydrated]);

  const has = useCallback((id: string) => cart.some((entry) => entry.id === id), [cart]);
  const add = useCallback(
    (entries: CartEntry[]) =>
      setCart((prev) => {
        const ids = new Set(prev.map((entry) => entry.id));
        return [...prev, ...entries.filter((entry) => !ids.has(entry.id))];
      }),
    [],
  );
  const remove = useCallback(
    (id: string) => setCart((prev) => prev.filter((entry) => entry.id !== id)),
    [],
  );
  const update = useCallback(
    (id: string, patch: Partial<CartEntry>) =>
      setCart((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))),
    [],
  );
  const clear = useCallback(() => setCart([]), []);

  return { cart, hydrated, has, add, remove, update, clear };
}

export function labelTotal(cart: CartEntry[]) {
  return cart.reduce((sum, entry) => sum + Math.max(1, entry.copies), 0);
}

export function downloadBrotherCsv(cart: CartEntry[]) {
  const csv = buildBrotherLabelCsv(
    cart
      .filter((entry) => entry.qrCodeValue)
      .map((entry) => ({
        assetTag: entry.title,
        qrCodeValue: entry.qrCodeValue,
        name: entry.name,
        tag: entry.tag,
        number: entry.number,
        copies: entry.copies,
      })),
  );
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `brother-labels-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function LabelCartReview({
  cart,
  onUpdate,
  onRemove,
  onClear,
}: {
  cart: CartEntry[];
  onUpdate: (id: string, patch: Partial<CartEntry>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (cart.length === 0) return null;
  const total = labelTotal(cart);

  return (
    <Card className="no-print mb-4 overflow-hidden" elevation="flat">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border/70">
        <div>
          <div className="font-semibold">Review print cart</div>
          <div className="text-xs text-muted-foreground">
            Adjust the tag and number lines before exporting. In P-touch Editor, drop the CSV on
            the database bar, then Print → All records.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-10" onClick={onClear}>
            Clear cart
          </Button>
          <Button size="sm" className="h-10" onClick={() => downloadBrotherCsv(cart)}>
            <Download className="mr-1.5 size-4" />
            Brother CSV ({total} {total === 1 ? "label" : "labels"})
          </Button>
        </div>
      </CardHeader>
      <CardContent className="max-h-[420px] overflow-y-auto p-0">
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_4rem_2.5rem] gap-2 border-b border-border/60 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5rem_6rem_4rem_2.5rem]">
          <span className="hidden sm:block">Item</span>
          <span>Tag line</span>
          <span>Number</span>
          <span className="hidden sm:block">QR</span>
          <span>Copies</span>
          <span />
        </div>
        {cart.map((entry) => (
          <div
            key={entry.id}
            className="grid grid-cols-[minmax(0,1fr)_5rem_4rem_2.5rem] items-center gap-2 border-b border-border/40 px-3 py-2 last:border-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5rem_6rem_4rem_2.5rem]"
          >
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-sm font-medium">{entry.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{entry.name}</div>
            </div>
            <Input
              value={entry.tag}
              onChange={(e) => onUpdate(entry.id, { tag: e.target.value })}
              aria-label={`Tag line for ${entry.title}`}
            />
            <Input
              value={entry.number}
              onChange={(e) => onUpdate(entry.id, { number: e.target.value })}
              aria-label={`Number for ${entry.title}`}
            />
            <span
              className={
                entry.qrCodeValue
                  ? "hidden truncate font-mono text-[11px] sm:block"
                  : "hidden text-[11px] text-destructive sm:block"
              }
            >
              {entry.qrCodeValue || "No QR"}
            </span>
            <Input
              type="number"
              min={1}
              value={entry.copies}
              onChange={(e) =>
                onUpdate(entry.id, { copies: Math.max(1, Number(e.target.value) || 1) })
              }
              aria-label={`Copies of ${entry.title}`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              onClick={() => onRemove(entry.id)}
              aria-label={`Remove ${entry.title} from print cart`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
