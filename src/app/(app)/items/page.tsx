"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RowSelectionState, VisibilityState } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Asset, getColumns } from "./columns";
import { DataTable, type Density } from "./data-table";
import { NewItemSheet } from "./new-item-sheet";
import { GapWizardDialog } from "./gap-wizard-dialog";
import { normalizeItemsSorting, useUrlFilters } from "./hooks/use-url-filters";
import { useItemsQuery, type BulkItem } from "./hooks/use-items-query";
import {
  getBulkActionReferenceAvailability,
  getItemsControlRecoveryMode,
  useFilterOptions,
} from "./hooks/use-filter-options";
import { useBulkActions } from "./hooks/use-bulk-actions";
import { BulkActionBar } from "./components/bulk-action-bar";
import { ItemsToolbar } from "./components/items-toolbar";
import { ItemsPagination } from "./components/items-pagination";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useItemChangeSync } from "@/hooks/use-item-change-sync";
import {
  AlertTriangle,
  Archive,
  Download,
  Package,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  Rows3,
  Rows4,
  Timer,
  Wrench,
} from "lucide-react";
import { FadeUp } from "@/components/ui/motion";
import { OperationalMetricCard, OperationalPartialResultsAlert } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { buildBulkRowId, getItemHref, parseBulkRowId } from "./lib/item-href";
import { compareItemAssetTags } from "@/lib/item-asset-tag-sort";

export default function ItemsPage() {
  const router = useRouter();
  const filters = useUrlFilters();
  const options = useFilterOptions();
  useItemChangeSync();

  const query = useItemsQuery({
    search: filters.search,
    itemType: filters.itemType,
    statusKey: filters.statusKey,
    locationKey: filters.locationKey,
    categoryKey: filters.categoryKey,
    brandKey: filters.brandKey,
    departmentKey: filters.departmentKey,
    showAccessories: filters.showAccessories,
    favoritesOnly: filters.favoritesOnly,
    sorting: filters.sorting,
    sortKey: filters.sortKey,
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createSourceId, setCreateSourceId] = useState<string | null>(null);
  const [showGapWizard, setShowGapWizard] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [density, setDensity] = useState<Density>("comfortable");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  function openBlankCreate() {
    setCreateSourceId(null);
    setShowCreate(true);
  }

  useEffect(() => {
    let nextColumnVisibility: VisibilityState = {};
    let nextDensity: Density = "comfortable";
    try {
      const savedColumns = localStorage.getItem("items-column-visibility");
      nextColumnVisibility = savedColumns ? JSON.parse(savedColumns) : {};
      const savedDensity = localStorage.getItem("items-density");
      nextDensity = savedDensity === "compact" ? "compact" : "comfortable";
    } catch {
      nextColumnVisibility = {};
      nextDensity = "comfortable";
    }
    setColumnVisibility(nextColumnVisibility);
    setDensity(nextDensity);
    setPreferencesLoaded(true);
  }, []);

  // Persist column visibility + density to localStorage
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem("items-column-visibility", JSON.stringify(columnVisibility));
    } catch { /* ignore */ }
  }, [columnVisibility, preferencesLoaded]);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try { localStorage.setItem("items-density", density); } catch { /* ignore */ }
  }, [density, preferencesLoaded]);
  const [retireTarget, setRetireTarget] = useState<Asset | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const busyRef = useRef(false);
  // Per-asset lock so rapid star clicks don't fire racing toggles that desync
  // the optimistic UI from server state.
  const favoriteInFlight = useRef<Set<string>>(new Set());

  // Clear selection when page/filters change
  useEffect(() => {
    setRowSelection({});
  }, [
    query.page,
    filters.search,
    filters.statusKey,
    filters.locationKey,
    filters.categoryKey,
    filters.brandKey,
    filters.departmentKey,
    filters.showAccessories,
    filters.favoritesOnly,
    filters.itemType,
    filters.sortKey,
  ]);

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const selectedCount = selectedIds.length;

  useKeyboardShortcuts({
    searchInputRef,
    onClearSearch: () => filters.setSearch(""),
    onClearSelection: () => setRowSelection({}),
    onPreviousPage: () => query.setPage(Math.max(0, query.page - 1)),
    onNextPage: () => query.setPage(Math.min(query.totalPages - 1, query.page + 1)),
    hasSelection: selectedCount > 0,
    canGoBack: query.page > 0,
    canGoForward: query.page < query.totalPages - 1,
  });

  const bulk = useBulkActions(
    () => selectedIds,
    // Refetch the active view and mark sibling filter caches stale so a bulk
    // star/unstar (or any bulk mutation) doesn't leave stale rows behind when
    // the user switches filters.
    () => { setRowSelection({}); query.invalidate(true); }
  );

  const [selectingAll, setSelectingAll] = useState(false);
  const handleSelectAllMatching = useCallback(async () => {
    setSelectingAll(true);
    try {
      const params = new URLSearchParams();
      params.set("ids_only", "true");
      if (filters.search) params.set("q", filters.search);
      filters.statusKey.split(",").filter(Boolean).forEach((v) => params.append("status", v));
      filters.locationKey.split(",").filter(Boolean).forEach((v) => params.append("location_id", v));
      filters.categoryKey.split(",").filter(Boolean).forEach((v) => params.append("category_id", v));
      filters.brandKey.split(",").filter(Boolean).forEach((v) => params.append("brand", v));
      filters.departmentKey.split(",").filter(Boolean).forEach((v) => params.append("department_id", v));
      if (filters.showAccessories) params.set("show_accessories", "true");
      if (filters.favoritesOnly) params.set("favorites_only", "true");
      if (filters.itemType !== "all") params.set("item_type", filters.itemType);
      const res = await fetch(`/api/assets?${params}`);
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error("Failed to expand selection");
        return;
      }
      const json = await parseJsonSafely<{ ids?: unknown; truncated?: boolean }>(res);
      if (!json || !Array.isArray(json.ids)) {
        toast.error("Could not read the selection response");
        return;
      }
      const ids = json.ids.filter((id): id is string => typeof id === "string");
      const next: RowSelectionState = {};
      for (const id of ids) next[id] = true;
      setRowSelection(next);
      if (json.truncated) {
        toast.warning(`Selection capped at 5,000 items (use bulk actions in batches).`);
      } else {
        toast.success(`Selected ${ids.length} items`);
      }
    } catch {
      toast.error("Network error — could not expand selection");
    } finally {
      setSelectingAll(false);
    }
  }, [filters]);

  // Merge item-family rows into the main table as Asset-shaped rows.
  const mergedData = useMemo(() => {
    const familyItems = query.bulkItems.filter((item) => {
      if (filters.itemType === "unit-tracked") return item.trackByNumber;
      if (filters.itemType === "quantity-tracked") return !item.trackByNumber;
      return filters.itemType !== "serialized";
    });

    const bulkAssets: Asset[] = filters.itemType !== "serialized"
      ? familyItems.map((b: BulkItem) => ({
          id: buildBulkRowId(b.id),
          assetTag: b.name,
          name: b.trackByNumber ? "Unit-tracked item family" : "Quantity-tracked item family",
          type: b.category,
          brand: "",
          model: "",
          serialNumber: "",
          status: "AVAILABLE",
          computedStatus: `${b.availableQuantity}/${b.onHandQuantity} available`,
          createdAt: "",
          location: { id: b.locationId, name: b.locationName },
          category: b.categoryId ? { id: b.categoryId, name: b.category } : null,
          department: b.departmentId && b.departmentName ? { id: b.departmentId, name: b.departmentName } : null,
          imageUrl: b.imageUrl,
          activeBooking: null,
          isFavorited: !!b.isFavorited,
          isItemFamily: true,
          itemFamilyTrackByNumber: b.trackByNumber,
        }))
      : [];

    const serializedItems = filters.itemType === "all" || filters.itemType === "serialized" ? query.items : [];

    // Most popular uses the server-provided mixed row order. Asset-tag sort
    // interleaves serialized and family rows by tag. Empty sort snaps to Most popular.
    const sortingById = normalizeItemsSorting(filters.sorting)[0]!.id;
    if (sortingById === "popular" && query.itemOrder.length > 0) {
      const rowById = new Map([...serializedItems, ...bulkAssets].map((item) => [item.id, item]));
      return query.itemOrder.flatMap((id) => {
        const row = rowById.get(id);
        return row ? [row] : [];
      });
    }

    if (sortingById === "assetTag") {
      return [...serializedItems, ...bulkAssets].sort((a, b) => compareItemAssetTags(a.assetTag, b.assetTag));
    }

    bulkAssets.sort((a, b) => compareItemAssetTags(a.assetTag, b.assetTag));
    return [...serializedItems, ...bulkAssets];
  }, [query.items, query.bulkItems, query.itemOrder, filters.itemType, filters.sorting]);

  const visibleRowCount = mergedData.length;
  const pageLoading = !preferencesLoaded || query.loading;
  const failedReferenceGroups = new Set(options.partialFailures);
  const canCreateItem = !failedReferenceGroups.has("locations") && !failedReferenceGroups.has("categories");
  const canFillGaps = !failedReferenceGroups.has("categories") && !failedReferenceGroups.has("departments");
  const canOfferCreateItem = options.canEdit && canCreateItem;
  const recoveryMode = getItemsControlRecoveryMode(
    options.initialError,
    options.refreshError,
    options.partialFailures,
  );
  const unavailableReferenceGroups = options.partialFailures.map((failure) => ({
    locations: "Locations",
    departments: "Departments",
    categories: "Categories",
    brands: "Brands",
    kits: "Kits",
  }[failure] ?? failure));
  const bulkActionReferenceAvailability = getBulkActionReferenceAvailability(options.partialFailures);

  // Optimistic favorite toggle
  const handleToggleFavorite = useCallback(async (asset: Asset) => {
    const bulkSkuId = parseBulkRowId(asset.id);
    const isFamily = !!bulkSkuId;
    const endpoint = isFamily ? `/api/bulk-skus/${bulkSkuId}/favorite` : `/api/assets/${asset.id}/favorite`;
    // Ignore re-clicks while a toggle for this asset is still resolving.
    if (favoriteInFlight.current.has(asset.id)) return;
    favoriteInFlight.current.add(asset.id);
    const prev = asset.isFavorited;
    if (isFamily) {
      query.setBulkItems((items) =>
        items.map((b) => b.id === bulkSkuId ? { ...b, isFavorited: !prev } : b)
      );
    } else {
      query.setItems((items) =>
        items.map((a) => a.id === asset.id ? { ...a, isFavorited: !prev } : a)
      );
    }
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error();
      // Reconcile to the server's authoritative state: the endpoint toggles
      // based on its own row, which may differ from our optimistic guess.
      const json = await parseJsonSafely<{ favorited?: unknown }>(res);
      if (typeof json?.favorited === "boolean") {
        const favorited = json.favorited;
        if (isFamily) {
          query.setBulkItems((items) =>
            items.map((b) => b.id === bulkSkuId ? { ...b, isFavorited: favorited } : b)
          );
        } else {
          query.setItems((items) =>
            items.map((a) => a.id === asset.id ? { ...a, isFavorited: favorited } : a)
          );
        }
      } else {
        toast.error("Favorite updated, but the response could not be confirmed. Refreshing items.");
        query.invalidate(true);
      }
      // Mark other cached filter views (e.g. favorites-only) stale so toggling
      // a filter doesn't resurrect a fav state this toggle just changed.
      query.invalidate(false);
    } catch {
      if (isFamily) {
        query.setBulkItems((items) =>
          items.map((b) => b.id === bulkSkuId ? { ...b, isFavorited: prev } : b)
        );
      } else {
        query.setItems((items) =>
          items.map((a) => a.id === asset.id ? { ...a, isFavorited: prev } : a)
        );
      }
      toast.error("Failed to update favorite");
    } finally {
      favoriteInFlight.current.delete(asset.id);
    }
  }, [query]);

  // CSV export
  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("format", "csv");
      if (filters.search) params.set("q", filters.search);
      filters.statusKey.split(",").filter(Boolean).forEach((v) => params.append("status", v));
      filters.locationKey.split(",").filter(Boolean).forEach((v) => params.append("location_id", v));
      filters.categoryKey.split(",").filter(Boolean).forEach((v) => params.append("category_id", v));
      filters.brandKey.split(",").filter(Boolean).forEach((v) => params.append("brand", v));
      filters.departmentKey.split(",").filter(Boolean).forEach((v) => params.append("department_id", v));
      if (filters.itemType !== "all") params.set("item_type", filters.itemType);
      if (filters.showAccessories) params.set("show_accessories", "true");
      if (filters.favoritesOnly) params.set("favorites_only", "true");

      const res = await fetch(`/api/assets/export?${params}`);
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error();
      const truncated = res.headers.get("X-Truncated") === "true";
      const totalCount = res.headers.get("X-Total-Count");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `items-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (truncated) {
        toast.warning(`Export limited to 5,000 items (${totalCount} total). Narrow your filters for a complete export.`);
      } else {
        toast.success("Export downloaded");
      }
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, [filters]);

  const reloadItems = query.reload;
  const handleRowAction = useCallback(async (action: string, asset: Asset) => {
    if (busyRef.current) return;
    const bulkSkuId = parseBulkRowId(asset.id);
    if (bulkSkuId) {
      switch (action) {
        case "open":
          router.push(getItemHref(asset.id));
          return;
        case "manage-family":
          router.push(`/bulk-inventory/${bulkSkuId}`);
          return;
        case "print-label":
          if (!asset.itemFamilyTrackByNumber) return;
          busyRef.current = true;
          setActionBusy(true);
          try {
            const res = await fetch(`/api/bulk-skus/${bulkSkuId}/units/labels?scope=unprinted`);
            if (handleAuthRedirect(res)) return;
            if (!res.ok) {
              toast.error(await parseErrorMessage(res, "Failed to export unit labels"));
              return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `unit-labels-${asset.assetTag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || bulkSkuId}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            toast.success(`Unit labels exported for ${asset.assetTag}`);
          } catch {
            toast.error("Network error — could not export unit labels");
          } finally {
            busyRef.current = false;
            setActionBusy(false);
          }
          return;
        default:
          toast.info("Open the item family for status and admin operations");
          return;
      }
    }
    switch (action) {
      case "open":
        router.push(getItemHref(asset.id));
        break;
      case "print-label":
        router.push(`/labels?items=${asset.id}`);
        break;
      case "add-another":
        setCreateSourceId(asset.id);
        setShowCreate(true);
        break;
      case "maintenance":
        busyRef.current = true;
        setActionBusy(true);
        try {
          const res = await fetch(`/api/assets/${asset.id}/maintenance`, { method: "POST" });
          if (handleAuthRedirect(res)) return;
          if (res.ok) {
            toast.success(`Updated ${asset.assetTag} maintenance status`);
            reloadItems();
          } else {
            toast.error(await parseErrorMessage(res, "Failed to update maintenance status"));
          }
        } catch {
          toast.error("Network error — could not update item");
        } finally {
          busyRef.current = false;
          setActionBusy(false);
        }
        break;
      case "retire":
        setRetireTarget(asset);
        break;
    }
  }, [reloadItems, router]);

  async function confirmRetireTarget() {
    if (!retireTarget || busyRef.current) return;
    busyRef.current = true;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/assets/${retireTarget.id}/retire`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success(`Retired ${retireTarget.assetTag}`);
        query.reload();
      } else {
        toast.error(await parseErrorMessage(res, "Failed to retire item"));
      }
    } catch {
      toast.error("Network error — could not retire item");
    } finally {
      setRetireTarget(null);
      busyRef.current = false;
      setActionBusy(false);
    }
  }

  const columns = useMemo(
    () => getColumns({ canEdit: options.canEdit, density, onRowAction: handleRowAction, onToggleFavorite: handleToggleFavorite }),
    [options.canEdit, density, handleRowAction, handleToggleFavorite]
  );

  // Helper to set filter and reset page
  const withPageReset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    query.setPage(0);
  };

  const toggleStatusFilter = (status: string) => {
    const next = new Set(filters.statusFilter);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    filters.setStatusFilter(next);
    query.setPage(0);
  };

  const statusSummary = query.statusBreakdown ? [
    {
      id: "available",
      status: "AVAILABLE",
      label: "Available",
      value: query.statusBreakdown.available,
      helper: "Ready to reserve or check out",
      icon: PackageCheck,
      tone: "green" as const,
    },
    {
      id: "checked-out",
      status: "CHECKED_OUT",
      label: "Checked out",
      value: query.statusBreakdown.checkedOut,
      helper: "Currently in active custody",
      icon: PackageOpen,
      tone: "blue" as const,
      railTone: "info" as const,
    },
    {
      id: "pending-pickup",
      status: "PENDING_PICKUP",
      label: "Pending pickup",
      value: query.statusBreakdown.pendingPickup,
      helper: "Committed and waiting for handoff",
      icon: Timer,
      tone: "orange" as const,
      railTone: "warning" as const,
    },
    {
      id: "reserved",
      status: "RESERVED",
      label: "Reserved",
      value: query.statusBreakdown.reserved,
      helper: "Committed to upcoming reservations",
      icon: Package,
      tone: "purple" as const,
      railTone: "neutral" as const,
    },
    {
      id: "maintenance",
      status: "MAINTENANCE",
      label: "Maintenance",
      value: query.statusBreakdown.maintenance,
      helper: "Unavailable until maintenance is cleared",
      icon: Wrench,
      tone: "orange" as const,
      railTone: "warning" as const,
    },
    {
      id: "retired",
      status: "RETIRED",
      label: "Retired",
      value: query.statusBreakdown.retired,
      helper: "Inactive inventory kept for history",
      icon: Archive,
      tone: "muted" as const,
    },
  ] : [];
  const railItems: OperationalStatusRailItem[] = statusSummary
    .filter((item) => item.railTone && item.value > 0)
    .map((item) => ({
      id: item.id,
      label: item.label,
      value: item.value,
      detail: item.helper,
      icon: item.icon,
      tone: item.railTone!,
      onSelect: () => toggleStatusFilter(item.status),
    }));
  const hasOperationalCommitments = railItems.length > 0;

  return (
    <FadeUp>
      <div className="mx-auto w-full max-w-screen-2xl">
      {/* Single-item retire confirmation */}
      <AlertDialog open={!!retireTarget} onOpenChange={(open) => { if (!open) setRetireTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {retireTarget?.assetTag}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently mark &ldquo;{retireTarget?.assetTag}&rdquo; as retired. Retired items are hidden from active inventory and cannot be checked out or reserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmRetireTarget}
              disabled={actionBusy}
            >
              {actionBusy ? "Retiring…" : "Retire"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageHeader title="Items">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden size-10 sm:flex"
            onClick={() => setDensity((d) => (d === "compact" ? "comfortable" : "compact"))}
            aria-label={density === "compact" ? "Switch to comfortable density" : "Switch to compact density"}
            title={density === "compact" ? "Comfortable density" : "Compact density"}
          >
            {density === "compact" ? <Rows3 className="size-4" aria-hidden="true" /> : <Rows4 className="size-4" aria-hidden="true" />}
          </Button>
          {options.canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
                className="hidden h-10 min-w-[86px] sm:flex"
                aria-label={exporting ? "Exporting items" : "Export items to CSV"}
              >
                <Download className="size-3.5" aria-hidden="true" />
                {exporting ? "Exporting…" : "Export"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="hidden h-10 min-w-[86px] sm:flex"
                onClick={() => setShowGapWizard(true)}
                disabled={!canFillGaps}
              >
                Fill gaps
              </Button>
              <Button variant="outline" size="sm" className="h-10 min-w-[76px]" asChild><Link href="/import">Import</Link></Button>
              <Button size="sm" className="h-10 min-w-[92px]" onClick={openBlankCreate} disabled={!canCreateItem}>Add item</Button>
            </>
          )}
        </div>
      </PageHeader>

      {recoveryMode === "initial" && (
        <Alert className="mb-4 border-destructive/40">
          <AlertTriangle className="size-4" />
          <AlertTitle>Item controls did not load</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>You can still browse inventory, but filters and staff actions stay unavailable until role and reference data are confirmed.</span>
            <Button variant="outline" size="sm" className="h-10" onClick={options.retry} disabled={options.refreshing}>
              <RefreshCw className={options.refreshing ? "animate-spin" : ""} aria-hidden="true" />
              Retry controls
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {recoveryMode === "refresh" && (
        <Alert className="mb-4 border-[var(--orange)]/40 bg-[var(--orange-bg)]">
          <AlertTriangle className="size-4 text-[var(--orange-text)]" />
          <AlertTitle>Item controls may be out of date</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>The last loaded filters and permissions remain available while refresh is retried.</span>
            <Button variant="outline" size="sm" className="h-10" onClick={options.retry} disabled={options.refreshing}>
              <RefreshCw className={options.refreshing ? "animate-spin" : ""} aria-hidden="true" />
              Retry refresh
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {recoveryMode === "partial" && (
        <div className="mb-4 flex flex-col gap-2">
          <OperationalPartialResultsAlert
            failures={unavailableReferenceGroups}
            failureLabel="Unavailable item controls"
            noun="reference group"
            recoveryCopy={options.refreshError
              ? "The latest refresh also failed. Healthy filters remain available while recovery is retried."
              : "Healthy filters remain available; retry before relying on the unavailable controls."}
            title={options.refreshError ? "Some item controls may be out of date" : "Some item controls did not load"}
          />
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="h-10" onClick={options.retry} disabled={options.refreshing}>
              <RefreshCw className={options.refreshing ? "animate-spin" : ""} aria-hidden="true" />
              Retry controls
            </Button>
          </div>
        </div>
      )}

      {/* Inventory status rail */}
      {query.statusBreakdown && !pageLoading && (
        <OperationalStatusRail
          className="mb-4"
          orientation={{
            label: "Active inventory",
            value: `${query.total} ${query.total === 1 ? "item" : "items"}`,
            icon: Package,
          }}
          items={railItems}
          allClearLabel={!hasOperationalCommitments ? "No active item statuses need attention" : undefined}
          details={(
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {statusSummary.map((item) => (
                <OperationalMetricCard
                  key={item.id}
                  label={item.label}
                  value={item.value}
                  helper={item.helper}
                  tone={item.tone}
                  onClick={() => toggleStatusFilter(item.status)}
                  ariaPressed={filters.statusFilter.has(item.status)}
                />
              ))}
            </div>
          )}
        />
      )}

      <NewItemSheet
        open={showCreate}
        onOpenChange={(nextOpen) => {
          setShowCreate(nextOpen);
          if (!nextOpen) setCreateSourceId(null);
        }}
        locations={options.locations}
        departments={options.departments}
        categories={options.categories}
        onCreated={query.reload}
        sourceAssetId={createSourceId}
      />

      <GapWizardDialog
        open={showGapWizard}
        onOpenChange={setShowGapWizard}
        categories={options.categories}
        departments={options.departments}
        onAssigned={query.reload}
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
        {/* Toolbar stays mounted across loading/empty/error states so the
            search input never loses focus while results update. */}
        <div className="flex items-stretch">
          {selectedCount > 0 ? (
            <BulkActionBar
              count={selectedCount}
              locations={options.locations}
              categoryOptions={options.categoryOptions}
              kits={options.kits}
              referenceAvailability={bulkActionReferenceAvailability}
              busy={bulk.busy || selectingAll}
              error={bulk.error}
              userRole={options.userRole}
              onAction={bulk.execute}
              onClear={() => setRowSelection({})}
              onSelectAllMatching={handleSelectAllMatching}
              selectAllMatchingTotal={query.total}
            />
          ) : (
            <ItemsToolbar
              searchInputRef={searchInputRef}
              search={filters.search}
              onSearchChange={withPageReset(filters.setSearch)}
              statusFilter={filters.statusFilter}
              onStatusFilterChange={withPageReset(filters.setStatusFilter)}
              locationFilter={filters.locationFilter}
              onLocationFilterChange={withPageReset(filters.setLocationFilter)}
              categoryFilter={filters.categoryFilter}
              onCategoryFilterChange={withPageReset(filters.setCategoryFilter)}
              brandFilter={filters.brandFilter}
              onBrandFilterChange={withPageReset(filters.setBrandFilter)}
              departmentFilter={filters.departmentFilter}
              onDepartmentFilterChange={withPageReset(filters.setDepartmentFilter)}
              showAccessories={filters.showAccessories}
              onShowAccessoriesChange={(v) => { filters.setShowAccessories(v); query.setPage(0); }}
              favoritesOnly={filters.favoritesOnly}
              onFavoritesOnlyChange={(v) => { filters.setFavoritesOnly(v); query.setPage(0); }}
              itemType={filters.itemType}
              onItemTypeChange={(v) => { filters.setItemType(v); query.setPage(0); }}
              sorting={filters.sorting}
              onSortingChange={(v) => { filters.setSorting(normalizeItemsSorting(v)); query.setPage(0); }}
              hasActiveFilters={filters.hasActiveFilters}
              onClearAllFilters={() => { filters.clearAllFilters(); query.setPage(0); }}
              locations={options.locations}
              departments={options.departments}
              categoryOptions={options.categoryOptions}
              brands={options.brands}
            />
          )}
        </div>
        {pageLoading ? (
          <>
          {/* Desktop skeleton table */}
          <div className="rounded-md border hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow striped={false} className="bg-muted/50">
                  <TableHead className="border-t w-[40px]"><Skeleton className="size-4" /></TableHead>
                  <TableHead className="border-t w-[40px]"><Skeleton className="size-4" /></TableHead>
                  <TableHead className="border-t w-[280px]"><Skeleton className="h-4 w-12" /></TableHead>
                  <TableHead className="border-t w-[160px]"><Skeleton className="h-4 w-14" /></TableHead>
                  <TableHead className="border-t w-[120px]"><Skeleton className="h-4 w-16" /></TableHead>
                  <TableHead className="border-t w-[120px]"><Skeleton className="h-4 w-20" /></TableHead>
                  <TableHead className="border-t w-[130px]"><Skeleton className="h-4 w-16" /></TableHead>
                  <TableHead className="border-t w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }, (_, r) => (
                  <TableRow key={r}>
                    <TableCell><Skeleton className="size-4" /></TableCell>
                    <TableCell><Skeleton className="size-4" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className={density === "compact" ? "size-8 rounded-md shrink-0" : "size-9 rounded-md shrink-0"} />
                        <div className="flex flex-col gap-1.5 flex-1">
                          <Skeleton className="h-4" style={{ width: `${55 + (r % 3) * 15}%` }} />
                          <Skeleton className="h-3" style={{ width: `${35 + (r % 4) * 10}%` }} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4" style={{ width: `${50 + (r % 3) * 18}%` }} /></TableCell>
                    <TableCell><Skeleton className="h-4" style={{ width: `${40 + (r % 4) * 15}%` }} /></TableCell>
                    <TableCell><Skeleton className="h-4" style={{ width: `${45 + (r % 3) * 20}%` }} /></TableCell>
                    <TableCell><Skeleton className="size-4" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile skeleton cards */}
          <div className="rounded-md border sm:hidden">
            {Array.from({ length: 5 }, (_, r) => (
              <div key={r} className="flex items-start gap-3 px-3 py-3 border-b last:border-b-0">
                <Skeleton className="size-10 rounded-md shrink-0" />
                <div className="flex-1 flex flex-col gap-2">
                  <Skeleton className="h-4" style={{ width: `${50 + (r % 3) * 15}%` }} />
                  <Skeleton className="h-3" style={{ width: `${35 + (r % 4) * 10}%` }} />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          </>
        ) : query.loadError ? (
          <EmptyState icon="box" title="Failed to load items" description="Something went wrong loading your inventory." actionLabel="Retry" onAction={query.reload} />
        ) : visibleRowCount === 0 && !filters.hasActiveFilters && !filters.search ? (
          <EmptyState
            icon="box"
            title="No items in inventory yet"
            description={canOfferCreateItem ? "Create your first item to get started." : "No items have been added yet."}
            actionLabel={canOfferCreateItem ? "Add item" : undefined}
            onAction={canOfferCreateItem ? openBlankCreate : undefined}
          />
        ) : visibleRowCount === 0 ? (
          <EmptyState
            icon="search"
            title={filters.showAccessories ? "No hidden attachments match" : "No items match your filters"}
            description={
              filters.showAccessories
                ? "Attachments are child items hidden from the normal list. Clear this filter to return to parent items and item families."
                : "Try adjusting your search or filters."
            }
            actionLabel="Clear filters"
            onAction={() => filters.clearAllFilters()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={mergedData}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={filters.sorting}
            onSortingChange={(next) => { filters.setSorting(normalizeItemsSorting(next)); query.setPage(0); }}
            refreshing={query.refreshing}
            density={density}
            canEdit={options.canEdit}
            actionBusy={actionBusy}
            onRowAction={handleRowAction}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
        </div>

        {/* Pagination footer */}
        {!pageLoading && !query.loadError && visibleRowCount > 0 && (
          <ItemsPagination
            total={query.total}
            page={query.page}
            totalPages={query.totalPages}
            limit={query.limit}
            offset={query.page * query.limit}
            selectedCount={selectedCount}
            onPageChange={query.setPage}
            onLimitChange={(v) => { query.setLimit(v); query.setPage(0); }}
          />
        )}
      </div>
      </div>
    </FadeUp>
  );
}
