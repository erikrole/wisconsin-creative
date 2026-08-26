"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { usePickerSearch } from "@/components/equipment-picker/use-picker-search";
import { canSelectSerializedAssetForWindow } from "@/components/equipment-picker/serialized-selection";
import { SelectedEquipmentShelf } from "@/components/equipment-picker/SelectedEquipmentShelf";
import {
  getBulkAvailableQuantity,
  reconcileSelectedBulkQuantities,
} from "@/components/equipment-picker/bulk-quantity-recovery";
import {
  useConflictCheck,
  type BulkTurnaroundRiskInfo,
  type ConflictInfo,
  type TurnaroundRiskInfo,
  type UpcomingCommitmentInfo,
} from "@/components/equipment-picker/use-conflict-check";
import {
  EQUIPMENT_SECTIONS,
  classifyAssetType,
  groupBulkBySection,
  type EquipmentSectionKey,
} from "@/lib/equipment-sections";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { handleAuthRedirect, isAbortError, parseJsonSafely } from "@/lib/errors";
import { getBatteryCompatibilitySummaries } from "@/lib/battery-compatibility";
import { compareItemAssetTags } from "@/lib/item-asset-tag-sort";
import { AssetImage } from "@/components/AssetImage";
import {
  availabilityConflictMessage,
  availabilityRiskBadgeLabel,
  availabilityRiskMessage,
  availabilityRiskTitle,
  upcomingCommitmentLabel,
  upcomingCommitmentTitle,
} from "@/lib/availability-copy";

/* ───── Types ───── */

export type PickerAsset = {
  id: string;
  assetTag: string;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  type: string;
  computedStatus: string;
  qrCodeValue?: string | null;
  primaryScanCode?: string | null;
  categoryName?: string | null;
  imageUrl?: string | null;
  location: { id: string; name: string } | null;
  currentHolder?: { bookingId: string; bookingTitle: string; holderName: string; endsAt?: string | null } | null;
};

export type PickerBulkSku = {
  id: string;
  name: string;
  unit: string;
  category: string;
  currentQuantity: number;
  availableQuantity?: number;
  minThreshold?: number | null;
  trackByNumber?: boolean;
  binQrCodeValue?: string | null;
  categoryName?: string | null;
  imageUrl?: string | null;
};

export type BulkSelection = {
  bulkSkuId: string;
  quantity: number;
};

export type EquipmentPickerSelectionState = {
  totalSelected: number;
  resolvedAssetCount: number;
  bulkQuantity: number;
  unresolvedAssetCount: number;
  conflictCount: number;
  upcomingCommitmentCount: number;
  turnaroundRiskCount: number;
  bulkTurnaroundRiskCount: number;
  checkingAvailability: boolean;
  availabilityError: string | null;
};

export type EquipmentPickerProps = {
  bulkSkus: PickerBulkSku[];
  selectedAssetIds: string[];
  setSelectedAssetIds: Dispatch<SetStateAction<string[]>>;
  selectedBulkItems: BulkSelection[];
  setSelectedBulkItems: Dispatch<SetStateAction<BulkSelection[]>>;
  /** Booking window start (ISO string) — used for availability conflict check */
  startsAt?: string;
  /** Booking window end (ISO string) — used for availability conflict check */
  endsAt?: string;
  /** Location filter for availability check */
  locationId?: string;
  /** Booking to exclude when editing equipment on an existing booking */
  excludeBookingId?: string;
  /** Booking kind so preflight availability applies the same per-kind
   * availableForCheckout/availableForReservation gating as the save */
  bookingKind?: "RESERVATION" | "CHECKOUT";
  /** Pre-selected assets to seed the display cache (search mode) */
  initialSelectedAssets?: PickerAsset[];
  /** Called when selection changes with resolved asset objects */
  onSelectedAssetsChange?: (assets: PickerAsset[]) => void;
  /** Called when selection state changes with counts used by parent flow chrome */
  onSelectionStateChange?: (state: EquipmentPickerSelectionState) => void;
  /** Controlled active section (for parent tab-advance logic) */
  activeSection?: EquipmentSectionKey;
  /** Called when active section changes */
  onActiveSectionChange?: (section: EquipmentSectionKey) => void;
};

export { type BulkTurnaroundRiskInfo, type ConflictInfo, type TurnaroundRiskInfo, type UpcomingCommitmentInfo };

function primaryRisk<T extends { severity: "warning" | "critical" }>(risks: T[] | undefined) {
  if (!risks || risks.length === 0) return undefined;
  return risks.find((risk) => risk.severity === "critical") ?? risks[0];
}

function riskLabel(risks: Array<{ message: string; severity: "warning" | "critical" }> | undefined) {
  const risk = primaryRisk(risks);
  if (!risk) return null;
  const message = availabilityRiskMessage(risk);
  return risks && risks.length > 1 ? `${message} +${risks.length - 1}` : message;
}

function riskTitle(risks: Array<{ message: string; severity: "warning" | "critical" }> | undefined) {
  return availabilityRiskTitle(risks);
}

function statusText(status: string) {
  return status.replace(/_/g, " ").toLowerCase();
}

function getBulkAvailable(sku: PickerBulkSku) {
  return getBulkAvailableQuantity(sku);
}

function bulkQuantityHint(sku: PickerBulkSku) {
  return sku.trackByNumber
    ? "units scan at pickup"
    : "count only";
}

function PickerLoadingRows() {
  return (
    <div aria-label="Loading equipment" aria-busy="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index}>
          {index > 0 && <ItemSeparator />}
          <div className="flex min-h-[56px] items-center gap-3 px-3">
            <Skeleton className="size-5 rounded-sm" />
            <Skeleton className="size-10 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44 max-w-[70%]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───── Component ───── */

export default function EquipmentPicker({
  bulkSkus,
  selectedAssetIds,
  setSelectedAssetIds,
  selectedBulkItems,
  setSelectedBulkItems,
  startsAt,
  endsAt,
  locationId,
  excludeBookingId,
  bookingKind,
  initialSelectedAssets,
  onSelectedAssetsChange,
  onSelectionStateChange,
  activeSection: controlledSection,
  onActiveSectionChange,
}: EquipmentPickerProps) {
  const [internalSection, setInternalSection] = useState<EquipmentSectionKey>(EQUIPMENT_SECTIONS[0]!.key);
  const activeSection = controlledSection ?? internalSection;
  const setActiveSection = useCallback((sec: EquipmentSectionKey) => {
    setInternalSection(sec);
    onActiveSectionChange?.(sec);
  }, [onActiveSectionChange]);
  const activeSectionMeta = EQUIPMENT_SECTIONS.find((s) => s.key === activeSection) ?? EQUIPMENT_SECTIONS[0]!;
  const [sectionSearchBySection, setSectionSearchBySection] = useState<Record<EquipmentSectionKey, string>>({
    cameras: "",
    lenses: "",
    batteries: "",
    audio: "",
    tripods: "",
    lighting: "",
    other: "",
  });
  const sectionSearch = sectionSearchBySection[activeSection] ?? "";
  const setSectionSearch = (value: string) => {
    setSectionSearchBySection((prev) => ({ ...prev, [activeSection]: value }));
  };
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [bulkCountRecovery, setBulkCountRecovery] = useState<string | null>(null);

  // Asset cache so we can display selected items even after switching sections
  const [selectedAssetsCache] = useState<Map<string, PickerAsset>>(() => {
    const m = new Map<string, PickerAsset>();
    if (initialSelectedAssets) for (const a of initialSelectedAssets) m.set(a.id, a);
    return m;
  });

  const rememberAsset = useCallback((asset: PickerAsset) => {
    const existing = selectedAssetsCache.get(asset.id);
    if (
      existing?.assetTag === asset.assetTag &&
      existing?.computedStatus === asset.computedStatus &&
      existing?.imageUrl === asset.imageUrl
    ) {
      return;
    }
    selectedAssetsCache.set(asset.id, asset);
    setCacheVersion((version) => version + 1);
  }, [selectedAssetsCache]);

  // ── Data hooks ──
  const { sectionResults, total, searchLoading, searchError, retry: retrySearch } = usePickerSearch({
    activeSection,
    equipSearch: sectionSearch,
    onlyAvailable,
  });

  const bulkById = useMemo(() => new Map(bulkSkus.map((s) => [s.id, s])), [bulkSkus]);
  const bulkBySection = useMemo(() => groupBulkBySection(bulkSkus), [bulkSkus]);

  useEffect(() => {
    const recovery = reconcileSelectedBulkQuantities(selectedBulkItems, bulkSkus);
    if (!recovery.changed) return;
    setSelectedBulkItems(recovery.items);
    setBulkCountRecovery(recovery.messages.join(" "));
  }, [bulkSkus, selectedBulkItems, setSelectedBulkItems]);

  // ── Section data ──
  const sectionBulk = useMemo(() => {
    const q = sectionSearch.toLowerCase();
    return (bulkBySection[activeSection] || [])
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
      .sort((a, b) => compareItemAssetTags(a.name, b.name));
  }, [bulkBySection, activeSection, sectionSearch]);

  const conflictPreviewAssetIds = useMemo(() => {
    return Array.from(new Set([...sectionResults.map((asset) => asset.id), ...selectedAssetIds]));
  }, [sectionResults, selectedAssetIds]);

  const bulkPreviewItems = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of selectedBulkItems) quantities.set(item.bulkSkuId, item.quantity);
    for (const sku of sectionBulk) {
      if (!quantities.has(sku.id)) quantities.set(sku.id, 1);
    }
    return Array.from(quantities, ([bulkSkuId, quantity]) => ({ bulkSkuId, quantity }));
  }, [sectionBulk, selectedBulkItems]);

  const {
    conflicts,
    upcomingCommitments,
    turnaroundRisks,
    bulkTurnaroundRisks,
    checking: conflictsLoading,
    availabilityError: conflictsError,
    retry: retryAvailability,
  } = useConflictCheck({
    startsAt,
    endsAt,
    locationId,
    assetIds: conflictPreviewAssetIds,
    bulkItems: bulkPreviewItems,
    excludeBookingId,
    bookingKind,
  });

  useEffect(() => {
    for (const asset of sectionResults) rememberAsset(asset);
  }, [sectionResults, rememberAsset]);

  // Hydrate deep-linked or draft-selected IDs that are outside the currently loaded section.
  useEffect(() => {
    const missingIds = selectedAssetIds.filter((id) => !selectedAssetsCache.has(id));
    if (missingIds.length === 0) return;
    const controller = new AbortController();
    async function hydrateSelectedAssets() {
      try {
        const params = new URLSearchParams();
        params.set("ids", missingIds.join(","));
        params.set("limit", String(missingIds.length));
        const res = await fetch(`/api/assets/picker-search?${params}`, { signal: controller.signal });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) return;
        const json = await parseJsonSafely<{ data?: { assets?: PickerAsset[] } }>(res);
        const assets = json?.data?.assets ?? [];
        for (const asset of assets) rememberAsset(asset);
      } catch (err) {
        if (isAbortError(err)) return;
      }
    }
    hydrateSelectedAssets();
    return () => controller.abort();
  }, [rememberAsset, selectedAssetIds, selectedAssetsCache]);

  // Delay showing the "Checking availability..." indicator to avoid flicker on fast checks.
  const [deferredConflictsLoading, setDeferredConflictsLoading] = useState(false);
  useEffect(() => {
    if (conflictsLoading) {
      const t = setTimeout(() => setDeferredConflictsLoading(true), 200);
      return () => clearTimeout(t);
    }
    setDeferredConflictsLoading(false);
  }, [conflictsLoading]);

  // ── Indexed lookups ──
  const assetById = useMemo(() => {
    void cacheVersion;
    const m = new Map<string, PickerAsset>();
    for (const a of sectionResults) m.set(a.id, a);
    selectedAssetsCache.forEach((a, id) => { if (!m.has(id)) m.set(id, a); });
    return m;
  }, [sectionResults, selectedAssetsCache, cacheVersion]);

  const selectedIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);

  // ── Selected count per section (for section-level actions) ──
  const selectedBySection = useMemo(() => {
    void cacheVersion;
    const c: Record<EquipmentSectionKey, number> = { cameras: 0, lenses: 0, batteries: 0, audio: 0, tripods: 0, lighting: 0, other: 0 };
    for (const id of selectedAssetIds) {
      const a = selectedAssetsCache.get(id) ?? assetById.get(id);
      if (a) c[classifyAssetType(a.type, a.categoryName)]++;
    }
    for (const item of selectedBulkItems) {
      const sku = bulkById.get(item.bulkSkuId);
      if (sku) c[classifyAssetType(sku.category, sku.categoryName)]++;
    }
    return c;
  }, [selectedAssetIds, selectedBulkItems, assetById, bulkById, selectedAssetsCache, cacheVersion]);

  // ── Resolved selected items for shelf display ──
  const resolvedSelectedAssets = useMemo(() => {
    void cacheVersion;
    return selectedAssetIds
      .map((id) => selectedAssetsCache.get(id) ?? assetById.get(id))
      .filter((a): a is PickerAsset => !!a);
  }, [selectedAssetIds, assetById, selectedAssetsCache, cacheVersion]);

  const unresolvedSelectedAssetIds = useMemo(() => {
    void cacheVersion;
    return selectedAssetIds.filter((id) => !assetById.has(id) && !selectedAssetsCache.has(id));
  }, [assetById, selectedAssetIds, selectedAssetsCache, cacheVersion]);

  // ── Notify parent of resolved asset details ──
  useEffect(() => {
    if (!onSelectedAssetsChange) return;
    onSelectedAssetsChange(resolvedSelectedAssets);
  }, [resolvedSelectedAssets, onSelectedAssetsChange]);

  const batteryGuidance = useMemo(
    () => getBatteryCompatibilitySummaries({
      cameraAssets: resolvedSelectedAssets,
      bulkSkus,
    }),
    [bulkSkus, resolvedSelectedAssets],
  );
  const visibleBatteryGuidance = useMemo(
    () => activeSection === "batteries"
      ? batteryGuidance
      : batteryGuidance.filter((item) => item.isLow),
    [activeSection, batteryGuidance],
  );

  // ── Helpers ──

  function toggleAsset(id: string, asset?: PickerAsset) {
    if (asset) rememberAsset(asset);
    setSelectedAssetIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (conflicts.has(id)) return prev;
      return [...prev, id];
    });
  }

  const setBulkQty = useCallback((bulkSkuId: string, qty: number) => {
    setBulkCountRecovery(null);
    const sku = bulkById.get(bulkSkuId);
    const maxQty = sku ? getBulkAvailable(sku) : Number.POSITIVE_INFINITY;
    const nextQty = Math.min(Math.max(0, qty), maxQty);

    if (nextQty <= 0) {
      setSelectedBulkItems((prev) => prev.filter((i) => i.bulkSkuId !== bulkSkuId));
    } else {
      setSelectedBulkItems((prev) => {
        const existing = prev.find((i) => i.bulkSkuId === bulkSkuId);
        if (existing) return prev.map((i) => i.bulkSkuId === bulkSkuId ? { ...i, quantity: nextQty } : i);
        return [...prev, { bulkSkuId, quantity: nextQty }];
      });
    }
  }, [bulkById, setSelectedBulkItems]);

  function clearCurrentSection() {
    const assetIdsInSection = new Set(
      selectedAssetIds.filter((id) => {
        const asset = selectedAssetsCache.get(id) ?? assetById.get(id);
        return asset && classifyAssetType(asset.type, asset.categoryName) === activeSection;
      }),
    );
    const bulkIdsInSection = new Set(
      (bulkBySection[activeSection] || []).map((sku) => sku.id),
    );
    setSelectedAssetIds((prev) => prev.filter((id) => !assetIdsInSection.has(id)));
    setSelectedBulkItems((prev) => prev.filter((item) => !bulkIdsInSection.has(item.bulkSkuId)));
  }

  function clearAllSelections() {
    setSelectedAssetIds([]);
    setSelectedBulkItems([]);
  }

  const bulkQuantity = selectedBulkItems.reduce((s, i) => s + i.quantity, 0);
  const selectedConflictCount = resolvedSelectedAssets.filter((asset) => conflicts.has(asset.id)).length;
  const selectedUpcomingCommitmentCount = resolvedSelectedAssets.filter((asset) =>
    !conflicts.has(asset.id) && upcomingCommitments.has(asset.id)
  ).length;
  const selectedTurnaroundRiskCount = resolvedSelectedAssets.filter((asset) =>
    !conflicts.has(asset.id) && (turnaroundRisks.get(asset.id)?.length ?? 0) > 0
  ).length;
  const selectedBulkTurnaroundRiskCount = selectedBulkItems.filter((item) =>
    (bulkTurnaroundRisks.get(item.bulkSkuId)?.length ?? 0) > 0
  ).length;
  const totalSelected = selectedAssetIds.length + bulkQuantity;
  const currentSectionSelected = selectedBySection[activeSection] || 0;
  const visibleCount = sectionResults.length + sectionBulk.length;
  const matchingCount = total + sectionBulk.length;
  const visibleLabel = searchLoading
    ? `Loading ${activeSectionMeta.label.toLowerCase()}`
    : sectionSearch
      ? `${matchingCount} matching ${activeSectionMeta.label.toLowerCase()}`
      : `${visibleCount} visible`;
  const emptyDescription = sectionSearch
    ? "Clear search or switch sections."
    : onlyAvailable
      ? "Show unavailable gear or switch sections."
      : "Try another equipment section.";

  useEffect(() => {
    if (!onSelectionStateChange) return;
    onSelectionStateChange({
      totalSelected,
      resolvedAssetCount: resolvedSelectedAssets.length,
      bulkQuantity,
      unresolvedAssetCount: unresolvedSelectedAssetIds.length,
      conflictCount: selectedConflictCount,
      upcomingCommitmentCount: selectedUpcomingCommitmentCount,
      turnaroundRiskCount: selectedTurnaroundRiskCount,
      bulkTurnaroundRiskCount: selectedBulkTurnaroundRiskCount,
      checkingAvailability: conflictsLoading,
      availabilityError: conflictsError,
    });
  }, [
    bulkQuantity,
    conflictsError,
    conflictsLoading,
    onSelectionStateChange,
    resolvedSelectedAssets.length,
    selectedBulkTurnaroundRiskCount,
    selectedConflictCount,
    selectedTurnaroundRiskCount,
    selectedUpcomingCommitmentCount,
    totalSelected,
    unresolvedSelectedAssetIds.length,
  ]);

  // ── Render ──

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/90 shadow-xs">
      {/* ── Section tabs ── */}
      <Tabs value={activeSection} onValueChange={(value) => { setActiveSection(value as EquipmentSectionKey); }}>
        <TabsList className="gap-2 overflow-x-auto border-b-0 bg-transparent px-3 py-3">
          {EQUIPMENT_SECTIONS.map((sec) => (
            <TabsTrigger
              key={sec.key}
              value={sec.key}
              className="mb-0 min-h-10 shrink-0 rounded-full border-b-0 px-3 py-1.5 text-sm hover:bg-muted/50 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm data-[state=active]:hover:bg-foreground/90"
            >
              {sec.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ── Search + action bar ── */}
      <div className="flex flex-col gap-2 border-b border-border/40 bg-muted/10 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`equipment-picker-search-${activeSection}`}
              name={`equipment-picker-search-${activeSection}`}
              placeholder={`Search ${activeSectionMeta.label.toLowerCase()}`}
              value={sectionSearch}
              onChange={(e) => setSectionSearch(e.target.value)}
              className="h-10 pl-8 pr-8"
            />
            {sectionSearch && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSectionSearch("")}
                className="absolute right-0 top-1/2 size-10 -translate-y-1/2"
                aria-label="Clear equipment search"
              >
                <XIcon />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground shadow-xs">
              <Checkbox
                checked={onlyAvailable}
                onCheckedChange={(checked) => setOnlyAvailable(checked === true)}
                aria-label="Show available equipment only"
              />
              Available only
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{visibleLabel}</span>
          {currentSectionSelected > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearCurrentSection}
              className="h-10 text-xs"
            >
              Clear section
            </Button>
          )}
        </div>
      </div>

      {visibleBatteryGuidance.length > 0 && (
        <div className="flex flex-col gap-2 border-b border-border/60 bg-background px-3 py-2">
          {visibleBatteryGuidance.map((item) => (
            <Alert
              key={item.ruleId}
              className={cn(
                "rounded-md py-2.5",
                item.isLow
                  ? "border-[var(--orange)]/30 bg-[var(--orange)]/[0.06]"
                  : "border-[var(--blue)]/20 bg-[var(--blue)]/[0.05]",
              )}
            >
              <AlertTitle className="text-sm">
                {item.isLow ? `Low ${item.label}` : `Recommended ${item.label}`}
              </AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground">
                {item.availableQuantity} available
                {item.isLow ? `, threshold ${item.threshold}` : ""}
                {item.cameraModels.length > 0 ? ` for ${item.cameraModels.join(", ")}` : ""}.
                {" "}Add the quantity needed now; exact battery units are scanned at pickup.
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {bulkCountRecovery && (
        <div className="border-b border-border/60 bg-background px-3 py-2">
          <Alert className="rounded-md py-2.5">
            <AlertCircleIcon />
            <AlertTitle className="text-sm">Inventory counts refreshed</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              {bulkCountRecovery} Review the current quantities before continuing.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {conflictsError && (
        <div className="border-b border-border/60 bg-background px-3 py-2">
          <Alert className="rounded-md border-[var(--orange)]/30 bg-[var(--orange)]/[0.06] py-2.5">
            <AlertCircleIcon />
            <AlertTitle className="text-sm">Availability check unavailable</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{conflictsError}</span>
              <Button type="button" variant="outline" size="sm" className="h-10" onClick={retryAvailability}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* ── Item list ── */}
      <div className="max-h-[28rem] overflow-y-auto bg-background">
        {searchLoading ? (
          <PickerLoadingRows />
        ) : searchError ? (
          <Empty className="min-h-64 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><AlertCircleIcon /></EmptyMedia>
              <EmptyTitle>Equipment did not load</EmptyTitle>
              <EmptyDescription>Check the connection and try again.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button className="h-10" type="button" variant="outline" onClick={retrySearch}>
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        ) : sectionResults.length === 0 && sectionBulk.length === 0 ? (
          <Empty className="min-h-64 border-0">
            <EmptyHeader>
              <EmptyTitle>
                {sectionSearch ? "No matching equipment" : onlyAvailable ? "Nothing available right now" : "No items in this section"}
              </EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
            {(sectionSearch || onlyAvailable) && (
              <EmptyContent className="flex-row flex-wrap justify-center">
                {sectionSearch && (
                  <Button className="h-10" type="button" variant="outline" onClick={() => setSectionSearch("")}>
                    Clear search
                  </Button>
                )}
                {onlyAvailable && (
                  <Button className="h-10" type="button" variant="ghost" onClick={() => setOnlyAvailable(false)}>
                    Show unavailable
                  </Button>
                )}
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <ItemGroup aria-label={`${activeSectionMeta.label} equipment`}>
            {sectionResults.map((asset, index) => {
              const isSelected = selectedIdSet.has(asset.id);
              const conflict = conflicts.get(asset.id);
              const upcoming = upcomingCommitments.get(asset.id);
              const risks = turnaroundRisks.get(asset.id);
              const risk = primaryRisk(risks);
              const riskText = riskLabel(risks);
              const canSelect = canSelectSerializedAssetForWindow(asset, { startsAt, conflict });
              const isUnavailable = !canSelect && !isSelected;
              const holder = asset.currentHolder;

              return (
                <div key={asset.id}>
                  {index > 0 && <ItemSeparator />}
                  <Item
                    size="sm"
                    className={cn(
                      "min-h-[56px] rounded-none px-3",
                      isSelected && "bg-foreground/[0.04]",
                      isUnavailable && "opacity-60",
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={isUnavailable}
                      onCheckedChange={() => toggleAsset(asset.id, asset)}
                      aria-label={`${isSelected ? "Remove" : "Add"} ${asset.assetTag}`}
                    />
                    <ItemMedia variant="default">
                      <AssetImage src={asset.imageUrl} alt={asset.assetTag} size={40} />
                    </ItemMedia>
                    <ItemContent>
                      <button
                        type="button"
                        disabled={isUnavailable}
                        onClick={() => toggleAsset(asset.id, asset)}
                        className={cn(
                          "min-w-0 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                          isUnavailable ? "cursor-default" : "cursor-pointer",
                        )}
                      >
                        <ItemTitle className="w-full max-w-full">
                          <span className="truncate">{asset.assetTag}</span>
                        </ItemTitle>
                        <ItemDescription className="truncate text-xs">
                          {[asset.brand, asset.model].filter(Boolean).join(" ") || asset.name}
                        </ItemDescription>
                        {holder && (
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground/80">
                            Held by {holder.holderName}
                            {holder.endsAt && ` · Returns ${new Date(holder.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                          </p>
                        )}
                        {conflict && (
                          <p className="mt-0.5 truncate text-[10px] text-[var(--red-text)]" title={availabilityConflictMessage(conflict, { currentStartsAt: startsAt, currentEndsAt: endsAt })}>
                            {availabilityConflictMessage(conflict, { currentStartsAt: startsAt, currentEndsAt: endsAt })}
                          </p>
                        )}
                        {upcoming && !conflict && !isUnavailable && (
                          <p className="mt-0.5 truncate text-[10px] text-[var(--blue-text)]">
                            {upcomingCommitmentLabel(upcoming, endsAt)}
                            {upcoming.bookingTitle ? ` · ${upcoming.bookingTitle}` : ""}
                          </p>
                        )}
                        {riskText && !conflict && !isUnavailable && (
                          <p className={cn(
                            "mt-0.5 truncate text-[10px]",
                            risk?.severity === "critical"
                              ? "text-[var(--red-text)]"
                              : "text-[var(--orange-text)]",
                          )}>
                            {riskText}
                          </p>
                        )}
                      </button>
                    </ItemContent>
                    <ItemActions className="ml-auto">
                      {isUnavailable && !holder && (
                        <Badge variant="secondary" size="sm" className="shrink-0">
                          {statusText(asset.computedStatus)}
                        </Badge>
                      )}
                      {conflict && (
                        <Badge
                          variant="red"
                          size="sm"
                          className="shrink-0"
                          title={availabilityConflictMessage(conflict, { currentStartsAt: startsAt, currentEndsAt: endsAt })}
                        >
                          Conflict
                        </Badge>
                      )}
                      {!conflict && upcoming && (
                        <Badge
                          variant="blue"
                          size="sm"
                          className="shrink-0"
                          title={upcomingCommitmentTitle(upcoming)}
                        >
                          Needed next
                        </Badge>
                      )}
                      {!conflict && risk && (
                        <Badge
                          variant={risk.severity === "critical" ? "red" : "orange"}
                          size="sm"
                          className="shrink-0"
                          title={riskTitle(risks)}
                        >
                          {availabilityRiskBadgeLabel(risk)}
                        </Badge>
                      )}
                      {isSelected && !conflict ? (
                        <CheckCircle2Icon className="size-5 shrink-0 text-foreground/70" />
                      ) : null}
                    </ItemActions>
                  </Item>
                </div>
              );
            })}

            {sectionBulk.map((sku, index) => {
              const current = selectedBulkItems.find((i) => i.bulkSkuId === sku.id)?.quantity ?? 0;
              const available = getBulkAvailable(sku);
              const noneAvailable = available === 0;
              const hasSeparator = sectionResults.length > 0 || index > 0;
              const risks = bulkTurnaroundRisks.get(sku.id);
              const risk = primaryRisk(risks);
              const riskText = riskLabel(risks);

              return (
                <div key={sku.id}>
                  {hasSeparator && <ItemSeparator />}
                  <Item
                    size="sm"
                    role="group"
                    aria-label={`${sku.name}, ${current} requested`}
                    className={cn(
                      "min-h-[56px] rounded-none px-3",
                      current > 0 && "bg-foreground/[0.04]",
                      noneAvailable && current === 0 && "opacity-60",
                    )}
                  >
                    <ItemMedia variant="default">
                      <AssetImage src={sku.imageUrl} alt={sku.name} size={40} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="truncate">{sku.name}</ItemTitle>
                      <ItemDescription className={cn("text-xs", noneAvailable && "text-destructive")}>
                        {noneAvailable
                          ? "None available"
                          : `${available} available · ${bulkQuantityHint(sku)}`}
                      </ItemDescription>
                      {riskText && (
                        <p className={cn(
                          "mt-0.5 truncate text-[10px]",
                          risk?.severity === "critical"
                            ? "text-[var(--red-text)]"
                            : "text-[var(--orange-text)]",
                        )}>
                          {riskText}
                        </p>
                      )}
                    </ItemContent>
                    <ItemActions className="ml-auto">
                      {risks && risks.length > 0 && (
                        <Badge
                          variant={risk?.severity === "critical" ? "red" : "orange"}
                          size="sm"
                          className="shrink-0"
                          title={riskTitle(risks)}
                        >
                          {risk ? availabilityRiskBadgeLabel(risk) : "Notice"}
                        </Badge>
                      )}
                      <div className="flex h-10 items-center rounded-full border border-border/60 bg-background/70">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          onClick={() => setBulkQty(sku.id, current - 1)}
                          disabled={current === 0}
                          aria-label={`Remove one ${sku.name}`}
                        >
                          <MinusIcon />
                        </Button>
                        <span className="min-w-8 text-center text-sm font-medium tabular-nums">{current}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          onClick={() => setBulkQty(sku.id, current + 1)}
                          disabled={current >= available}
                          aria-label={`Add one ${sku.name}`}
                        >
                          <PlusIcon />
                        </Button>
                      </div>
                    </ItemActions>
                  </Item>
                </div>
              );
            })}
          </ItemGroup>
        )}
      </div>

      <SelectedEquipmentShelf
        totalSelected={totalSelected}
        deferredConflictsLoading={deferredConflictsLoading}
        resolvedSelectedAssets={resolvedSelectedAssets}
        unresolvedSelectedAssetIds={unresolvedSelectedAssetIds}
        selectedBulkItems={selectedBulkItems}
        bulkById={bulkById}
        conflicts={conflicts}
        upcomingCommitments={upcomingCommitments}
        turnaroundRisks={turnaroundRisks}
        bulkTurnaroundRisks={bulkTurnaroundRisks}
        currentStartsAt={startsAt}
        currentEndsAt={endsAt}
        onClearAll={clearAllSelections}
        onRemoveAsset={(id) => toggleAsset(id)}
        onRemoveBulk={(id) => setBulkQty(id, 0)}
      />
    </div>
  );
}
