"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Boxes, Check, Hash, Layers, Plus, Tag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useLabelCatalog } from "./use-label-catalog";
import { LabelGenerators, useLabelCart } from "./LabelCart";
import { PrintSheet, useSheetUnits } from "./PrintSheet";
import { familyEntry, printableCount, serializedEntry, sheetRows, type CartEntry } from "./label-sheet";

type Asset = {
  id: string;
  assetTag: string;
  name?: string | null;
  brand: string;
  model: string;
  qrCodeValue: string;
  primaryScanCode?: string;
  location: { name: string };
  category?: { name: string } | null;
};

type BulkItemFamily = {
  id: string;
  name: string;
  category: string;
  trackByNumber: boolean;
  onHandQuantity: number;
  availableQuantity: number;
  binQrCodeValue: string;
  locationName: string;
};

type Filter = "all" | "serialized" | "families";

type PickerItem = {
  id: string;
  kind: "serialized" | "numbered" | "counted";
  title: string;
  subtitle: string;
  badge: string;
  href: string;
  ariaLabel: string;
  entry: () => CartEntry;
};

function assetSubtitle(asset: Asset) {
  const seen = new Set([asset.assetTag.trim().toLowerCase()]);
  return [asset.name, `${asset.brand} ${asset.model}`.trim(), asset.location.name]
    .map((part) => part?.trim())
    .filter((part): part is string => {
      if (!part) return false;
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" · ");
}

function assetItem(asset: Asset): PickerItem {
  const name = asset.name?.trim() || `${asset.brand} ${asset.model}`.trim();
  return {
    id: asset.id,
    kind: "serialized",
    title: asset.assetTag,
    subtitle: assetSubtitle(asset) || "Serialized item",
    badge: asset.category?.name ?? "Serialized",
    href: `/items/${asset.id}`,
    ariaLabel: `serialized item ${asset.assetTag}`,
    entry: () =>
      serializedEntry({
        id: asset.id,
        title: asset.assetTag,
        name,
        category: asset.category?.name,
        qrCodeValue: asset.qrCodeValue,
        primaryScanCode: asset.primaryScanCode,
      }),
  };
}

function familyItem(family: BulkItemFamily): PickerItem {
  const numbered = family.trackByNumber;
  return {
    id: `bulk-${family.id}`,
    kind: numbered ? "numbered" : "counted",
    title: family.name,
    subtitle: [family.category, family.locationName].filter(Boolean).join(" · "),
    badge: numbered
      ? `${family.onHandQuantity.toLocaleString()} numbered units`
      : `${family.onHandQuantity.toLocaleString()} on hand`,
    href: `/items/bulk-${family.id}`,
    ariaLabel: `${numbered ? "numbered" : "quantity"} family ${family.name} at ${family.locationName}`,
    entry: () => familyEntry(family),
  };
}

const KIND_ICON = { serialized: Tag, numbered: Hash, counted: Boxes } as const;

function PickerRow({ item, added, onToggle }: { item: PickerItem; added: boolean; onToggle: () => void }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors",
        added ? "bg-[var(--accent-soft)]" : "hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          added ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-surface)] text-muted-foreground",
        )}
      >
        {added ? <Check className="size-4" /> : <Icon className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <Link href={item.href} className="block truncate text-sm font-bold text-foreground underline-offset-2 hover:underline" aria-label={`Open ${item.ariaLabel}`}>
          {item.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
      </div>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{item.badge}</span>
      <Button
        variant={added ? "ghost" : "outline"}
        size="sm"
        className={cn("h-9 w-[84px] shrink-0", added && "text-[var(--accent)]")}
        onClick={onToggle}
        aria-pressed={added}
        aria-label={added ? `Remove ${item.ariaLabel} from the print sheet` : `Add ${item.ariaLabel} to the print sheet`}
      >
        {added ? (
          <>
            <Check className="size-4" />
            Added
          </>
        ) : (
          <>
            <Plus className="size-4" />
            Add
          </>
        )}
      </Button>
    </li>
  );
}

export default function LabelsHelper() {
  const searchParams = useSearchParams();
  const preselectedItems = searchParams.get("items");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { cart, hydrated, has, add, remove, update, clear } = useLabelCart();
  const [didPreselect, setDidPreselect] = useState(false);

  const { data: items, loading, error, reload } = useLabelCatalog(search, {
    // Keep the previous list visible while a changed search refetches.
    keepPreviousData: true,
    transform: (catalog) =>
      [
        ...(catalog.assets as Asset[]).map(assetItem),
        ...(catalog.families as BulkItemFamily[]).map(familyItem),
      ].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })),
  });

  // Items and item pages link here with ?items=<id,...> to start a sheet.
  useEffect(() => {
    if (!didPreselect && hydrated && preselectedItems && items && items.length > 0) {
      const ids = new Set(preselectedItems.split(","));
      add(items.filter((item) => ids.has(item.id)).map((item) => item.entry()));
      setDidPreselect(true);
    }
  }, [didPreselect, hydrated, preselectedItems, items, add]);

  const counts = useMemo(() => {
    const list = items ?? [];
    const serialized = list.filter((item) => item.kind === "serialized").length;
    return { all: list.length, serialized, families: list.length - serialized };
  }, [items]);
  const visible = (items ?? []).filter((item) =>
    filter === "all" ? true : filter === "serialized" ? item.kind === "serialized" : item.kind !== "serialized",
  );
  const notAdded = visible.filter((item) => !has(item.id));
  const hasSearch = search.trim().length > 0;

  const { unitsBySku } = useSheetUnits(cart);
  const total = printableCount(sheetRows(cart, unitsBySku));

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader
        title="Print labels"
        description="Pick gear, choose how many of each, and download a CSV ready for the Brother label printer."
        className="no-print"
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Gear" className="no-print overflow-hidden rounded-[var(--radius)] border border-border bg-card">
            <div className="flex flex-col gap-3 border-b border-border/70 p-3 sm:flex-row sm:items-center">
              <DebouncedSearchInput
                id="labels-search"
                name="labels-search"
                containerClassName="min-w-0 flex-1"
                placeholder="Search tag, model, serial, QR or location"
                value={search}
                onValueChange={setSearch}
                aria-label="Search gear to label"
              />
              <ToggleGroup
                type="single"
                value={filter}
                onValueChange={(value) => value && setFilter(value as Filter)}
                aria-label="Show"
                className="shrink-0 [&>button]:gap-1.5 [&>button]:text-sm"
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="serialized">
                  <Tag className="size-3.5" />
                  Serialized
                </ToggleGroupItem>
                <ToggleGroupItem value="families">
                  <Layers className="size-3.5" />
                  Families
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex min-h-10 items-center justify-between gap-2 border-b border-border/60 px-4 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {loading ? "Loading gear…" : `${visible.length.toLocaleString()} of ${counts[filter].toLocaleString()} shown`}
              </span>
              {notAdded.length > 0 && notAdded.length <= 200 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 px-2 text-xs text-[var(--accent)]"
                  onClick={() => add(notAdded.map((item) => item.entry()))}
                >
                  Add all {notAdded.length.toLocaleString()}
                </Button>
              )}
            </div>

            {loading ? (
              <ul className="flex flex-col">
                {Array.from({ length: 6 }, (_, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <Skeleton className="size-9 rounded-lg" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-64 max-w-full" />
                    </div>
                    <Skeleton className="h-9 w-[84px] rounded-md" />
                  </li>
                ))}
              </ul>
            ) : error ? (
              <EmptyState
                icon={error === "network" ? "wifi-off" : "box"}
                title={error === "network" ? "You're offline" : "Gear could not load"}
                description={
                  error === "network"
                    ? "Check your connection and try again."
                    : "The list could not read item data. Try again before assuming there is nothing to label."
                }
                actionLabel="Try again"
                onAction={reload}
                compact
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={hasSearch ? "search" : "box"}
                title={hasSearch ? "No matches" : "Nothing to label here"}
                description={
                  hasSearch
                    ? "Try another tag, model, serial, QR or location."
                    : "Switch the filter, or add items and families first."
                }
                actionLabel={hasSearch ? "Clear search" : undefined}
                onAction={hasSearch ? () => setSearch("") : undefined}
                compact
              />
            ) : (
              <ul className="max-h-[min(640px,calc(100vh-280px))] divide-y divide-border/50 overflow-y-auto">
                {visible.map((item) => (
                  <PickerRow
                    key={item.id}
                    item={item}
                    added={has(item.id)}
                    onToggle={() => (has(item.id) ? remove(item.id) : add([item.entry()]))}
                  />
                ))}
              </ul>
            )}
          </section>

          <LabelGenerators onAdd={add} />
        </div>

        <PrintSheet
          cart={cart}
          onUpdate={update}
          onRemove={remove}
          onClear={clear}
          className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
        />
      </div>

      {cart.length > 0 && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <Button asChild className="h-11 w-full justify-between">
            <a href="#print-sheet">
              <span>Review print sheet</span>
              <span className="tabular-nums opacity-80">
                {total.toLocaleString()} {total === 1 ? "label" : "labels"}
              </span>
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
