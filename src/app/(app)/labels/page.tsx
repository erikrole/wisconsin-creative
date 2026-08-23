"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ExternalLink, PackageSearch, Printer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { useFetch } from "@/hooks/use-fetch";
import { FadeUp } from "@/components/ui/motion";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";

function LabelQRCode({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    setLoaded(false);
    import("qrcode").then((QRCode) => {
      if (!canvasRef.current) return;
      QRCode.toCanvas(
        canvasRef.current,
        value,
        { width: 80, margin: 1 },
        () => {
          setLoaded(true);
        },
      );
    });
  }, [value]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 80, height: 80, opacity: loaded ? 1 : 0.3 }}
    />
  );
}

type Asset = {
  id: string;
  assetTag: string;
  name?: string | null;
  type?: string | null;
  brand: string;
  model: string;
  qrCodeValue: string;
  primaryScanCode?: string;
  serialNumber: string;
  location: { name: string };
};

type BulkItemFamily = {
  id: string;
  kind: "bulk";
  name: string;
  category: string;
  trackByNumber: boolean;
  onHandQuantity: number;
  availableQuantity: number;
  binQrCodeValue: string;
  locationName: string;
};

type LabelItem = {
  id: string;
  title: string;
  description: string;
  qrCodeValue: string;
  primaryScanCode?: string;
  locationName: string;
  href: string;
  ariaLabel: string;
  selectAriaLabel: string;
};

function assetSubtitle(asset: Asset) {
  const seen = new Set([asset.assetTag.trim().toLowerCase()]);
  return [asset.name, `${asset.brand} ${asset.model}`.trim()]
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

function mapAssetToLabelItem(asset: Asset): LabelItem {
  const description = assetSubtitle(asset) || "Serialized item";
  return {
    id: asset.id,
    title: asset.assetTag,
    description,
    qrCodeValue: asset.qrCodeValue,
    primaryScanCode: asset.primaryScanCode,
    locationName: asset.location.name,
    href: `/items/${asset.id}`,
    ariaLabel: `Open serialized item ${asset.assetTag}`,
    selectAriaLabel: `Select serialized item ${asset.assetTag}`,
  };
}

function mapFamilyToLabelItem(family: BulkItemFamily): LabelItem {
  const tracking = family.trackByNumber ? "Unit-tracked item family" : "Quantity-tracked item family";
  const trackingLabel = tracking.toLowerCase();
  const availability = `${family.availableQuantity}/${family.onHandQuantity} available`;
  return {
    id: `bulk-${family.id}`,
    title: family.name,
    description: [tracking, availability, family.category].filter(Boolean).join(" · "),
    qrCodeValue: family.binQrCodeValue,
    primaryScanCode: family.binQrCodeValue,
    locationName: family.locationName,
    href: `/items/bulk-${family.id}`,
    ariaLabel: `Open ${trackingLabel} ${family.name} at ${family.locationName}`,
    selectAriaLabel: `Select ${trackingLabel} ${family.name} at ${family.locationName}`,
  };
}

function LabelMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "green" | "muted";
}) {
  const toneClass =
    tone === "green"
      ? "bg-[var(--green-bg)]/70"
      : tone === "muted"
        ? "bg-muted/50"
        : "bg-background";

  return (
    <div className={cn("rounded-sm px-3 py-2 shadow-xs", toneClass)}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold leading-none tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function labelCount(count: number) {
  return `${count} ${count === 1 ? "label" : "labels"}`;
}

export default function LabelsPage() {
  const searchParams = useSearchParams();
  const preselectedItems = searchParams.get("items");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [didPreselect, setDidPreselect] = useState(false);


  // Build fetch URL from search state
  const fetchUrl = (() => {
    const params = new URLSearchParams({ limit: "200" });
    if (search) params.set("q", search);
    return `/api/assets?${params}`;
  })();

  const { data: labelItems, loading, error, reload } = useFetch<LabelItem[]>({
    url: fetchUrl,
    // Keep the previous list visible while a changed search refetches instead
    // of flashing skeletons on every committed keystroke.
    keepPreviousData: true,
    transform: (json) => {
      const assets = ((json.data as Asset[] | undefined) ?? []).map(mapAssetToLabelItem);
      const families = ((json.bulkItems as BulkItemFamily[] | undefined) ?? []).map(mapFamilyToLabelItem);
      return [...assets, ...families].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
      );
    },
  });

  // Auto-select items from URL param on first load
  useEffect(() => {
    if (!didPreselect && preselectedItems && labelItems && labelItems.length > 0) {
      const ids = new Set(preselectedItems.split(","));
      const matching = new Set(
        labelItems.filter((item) => ids.has(item.id)).map((item) => item.id),
      );
      if (matching.size > 0) setSelectedIds(matching);
      setDidPreselect(true);
    }
  }, [didPreselect, preselectedItems, labelItems]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (labelItems) setSelectedIds(new Set(labelItems.map((item) => item.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const selectedItems = (labelItems ?? []).filter((item) => selectedIds.has(item.id));
  const matchingCount = labelItems?.length ?? 0;
  const hasSearch = search.trim().length > 0;
  const allVisibleSelected =
    matchingCount > 0 && labelItems?.every((item) => selectedIds.has(item.id));

  return (
    <FadeUp>
      <PageHeader
        title="Print Labels"
        description="Build a focused queue of item, family, and QR labels before sending them to browser print."
        className="no-print"
      >
        <Button className="h-10" variant="outline" asChild>
          <Link href="/items" className="h-10">
            <PackageSearch className="mr-1.5 size-4" />
            Items
          </Link>
        </Button>
        <Button
          onClick={() => window.print()}
          disabled={selectedItems.length === 0}
          size="sm"
          className="h-10"
        >
          <Printer className="mr-1.5 size-4" />
          {selectedItems.length > 0
            ? `Print ${labelCount(selectedItems.length)}`
            : "Print labels"}
        </Button>
      </PageHeader>

      <div className="no-print mb-4 grid gap-2 rounded-md border border-border/60 bg-muted/20 p-2 sm:grid-cols-3">
        <LabelMetric label="Matching items" value={matchingCount} />
        <LabelMetric label="Selected" value={selectedItems.length} tone="green" />
        <LabelMetric
          label="Ready to print"
          value={selectedItems.filter((item) => item.qrCodeValue).length}
          tone="muted"
        />
      </div>

      <Card className="no-print mb-4 overflow-hidden" elevation="flat">
        <CardHeader className="gap-3 border-b border-border/70">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <DebouncedSearchInput
              id="labels-search"
              name="labels-search"
              containerClassName="min-w-0 flex-1"
              placeholder="Search by item, model, serial, QR, category, location..."
              value={search}
              onValueChange={setSearch}
              aria-label="Search labels"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="tabular-nums">
                {selectedItems.length} selected
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-10"
                onClick={selectAll}
                disabled={matchingCount === 0 || allVisibleSelected}
              >
                Select visible
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                onClick={selectNone}
                disabled={selectedItems.length === 0}
              >
                Clear queue
              </Button>
            </div>
          </div>
        </CardHeader>

        {loading ? (
          <CardContent className="p-0">
            <div className="flex flex-col gap-1 p-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-md px-2 py-3">
                  <Skeleton className="size-5 rounded" />
                  <Skeleton className="size-9 rounded-sm" />
                  <div className="flex-1 flex flex-col gap-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-72 max-w-full" />
                  </div>
                  <Skeleton className="h-7 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </CardContent>
        ) : error ? (
          <EmptyState
            icon={error === "network" ? "wifi-off" : "box"}
            title={error === "network" ? "Labels are offline" : "Labels could not load"}
            description={
              error === "network"
                ? "Check your connection and retry the print queue."
                : "The label queue could not read item data. Retry before assuming there are no labels."
            }
            actionLabel="Retry"
            onAction={reload}
            compact
          />
        ) : matchingCount === 0 ? (
          <EmptyState
            icon={hasSearch ? "search" : "box"}
            title={hasSearch ? "No matching labels" : "No labels available"}
            description={
              hasSearch
                ? "Clear the search or try another item name, label code, QR, category, or location."
                : "Add items or item families before printing labels."
            }
            actionLabel={hasSearch ? "Clear search" : undefined}
            onAction={hasSearch ? () => setSearch("") : undefined}
            compact
          />
        ) : (
          <ItemGroup className="max-h-[380px] overflow-y-auto p-2">
            {(labelItems ?? []).map((item) => (
              <Item
                key={item.id}
                size="sm"
                className={cn(
                  "border border-transparent transition-colors",
                  selectedIds.has(item.id)
                    ? "border-[var(--green)]/30 bg-[var(--green-bg)]"
                    : "hover:bg-muted/50",
                )}
              >
                <Checkbox
                  checked={selectedIds.has(item.id)}
                  onCheckedChange={() => toggleSelect(item.id)}
                  aria-label={item.selectAriaLabel}
                />
                <ItemMedia variant="icon" className="bg-background">
                  {selectedIds.has(item.id) ? (
                    <CheckCircle2 className="size-4 text-[var(--green-text)]" />
                  ) : (
                    <Printer className="size-4 text-muted-foreground" />
                  )}
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0 justify-between">
                    <span className="truncate">{item.title}</span>
                    <Badge variant="outline" className="hidden tabular-nums sm:inline-flex">
                      {item.locationName}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="truncate">
                    {item.description || "No secondary identity"}
                    {item.primaryScanCode && (
                      <span className="ml-2 font-mono text-[11px]">
                        · {item.primaryScanCode}
                      </span>
                    )}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    asChild
                  >
                    <Link href={item.href} aria-label={item.ariaLabel}>
                      <ExternalLink className="size-4" />
                    </Link>
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </Card>

      {selectedItems.length > 0 && (
        <div className="label-print-grid">
          {selectedItems.map((item) => (
            <div key={item.id} className="label-print-card">
              <div className="shrink-0">
                <LabelQRCode value={item.qrCodeValue} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm mb-0.5">{item.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {item.description}
                </div>
                {item.primaryScanCode && (
                  <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{item.primaryScanCode}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </FadeUp>
  );
}
