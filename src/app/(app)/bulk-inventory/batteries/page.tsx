"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, Info, MoreHorizontal, Plus, RefreshCw, SlidersHorizontal, Tag, Wrench } from "lucide-react";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";

type UnitStatus = "AVAILABLE" | "CHECKED_OUT" | "LOST" | "RETIRED";

type BatteryUnit = {
  id: string;
  productId: string | null;
  unitNumber: number;
  status: UnitStatus;
  notes: string | null;
  labelPrintedAt: string | null;
  labelPrintedById: string | null;
  labelPrintBatchId: string | null;
  checkedOutAt: string | null;
  checkedOutDays: number | null;
  booking: {
    id: string;
    title: string;
    refNumber: string | null;
    endsAt: string;
    requesterName: string;
  } | null;
};

type BatteryProduct = {
  id: string;
  name: string;
  brand: string;
  model: string | null;
  assignedUnitCount: number;
};

type BatterySku = {
  id: string;
  name: string;
  category: string;
  trackByNumber: boolean;
  location: { id: string; name: string };
  minThreshold: number;
  threshold: number;
  binQrCodeValue: string;
  products: BatteryProduct[];
  counts: {
    total: number;
    available: number;
    checkedOut: number;
    lost: number;
    retired: number;
  };
  labelPrintedCount: number;
  labelNeededCount: number;
  isLow: boolean;
  units: BatteryUnit[];
};

type BatteryCockpitData = {
  totals: {
    total: number;
    available: number;
    checkedOut: number;
    lost: number;
    retired: number;
    lowSkus: number;
    agingCheckedOut: number;
  };
  skus: BatterySku[];
  compatibility: BatteryCompatibility[];
  integrity: {
    staleCheckedOutCount: number;
    staleCheckedOutUnits: BatteryIntegrityWarning[];
  };
};

type BatteryCompatibility = {
  ruleId: string;
  label: string;
  cameraModels: string[];
  cameraCount: number;
  batterySkuIds: string[];
  batterySkuNames: string[];
  availableQuantity: number;
  threshold: number;
  isLow: boolean;
};

type BatteryIntegrityWarning = {
  id: string;
  skuId: string;
  skuName: string;
  locationName: string;
  unitNumber: number;
};

type PendingAction = {
  skuId: string;
  skuName: string;
  unitNumber: number;
  fromStatus: Exclude<UnitStatus, "CHECKED_OUT">;
  status: Exclude<UnitStatus, "CHECKED_OUT">;
} | null;

type PendingAddUnits = {
  skuId: string;
  skuName: string;
  nextUnitNumber: number;
  currentAvailable: number;
  currentTotal: number;
  products: BatteryProduct[];
} | null;

type PendingQuantityAdjustment = {
  skuId: string;
  skuName: string;
  currentAvailable: number;
  currentTotal: number;
} | null;

type PendingLabelMark = {
  skuId: string;
  skuName: string;
  unitNumbers: number[];
} | null;

type PendingStaleRepair = {
  count: number;
  units: BatteryIntegrityWarning[];
} | null;

type UnitFilter = "ALL" | UnitStatus;

type CheckedOutRow = BatteryUnit & { skuId: string; skuName: string; locationName: string };

const STATUS_META: Record<UnitStatus, { label: string; className: string; dot: string }> = {
  AVAILABLE: {
    label: "Available",
    className: "bg-[var(--green-bg)] text-[var(--green-text)] hover:bg-[var(--green-bg)]",
    dot: "bg-[var(--green)]",
  },
  CHECKED_OUT: {
    label: "Checked out",
    className: "bg-[var(--blue-bg)] text-[var(--blue-text)] hover:bg-[var(--blue-bg)]",
    dot: "bg-[var(--blue)]",
  },
  LOST: {
    label: "Missing",
    className: "bg-[var(--red-bg)] text-[var(--red-text)] hover:bg-[var(--red-bg)]",
    dot: "bg-destructive",
  },
  RETIRED: {
    label: "Retired",
    className: "bg-muted text-muted-foreground hover:bg-muted",
    dot: "bg-muted-foreground",
  },
};

function metricLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function formatLabelDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function summarizeUnitNumbers(numbers: number[], max = 8) {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length <= max) return sorted.map((n) => `#${n}`).join(", ");
  return `${sorted.slice(0, max).map((n) => `#${n}`).join(", ")} +${sorted.length - max} more`;
}

function defaultStatusReason(status: Exclude<UnitStatus, "CHECKED_OUT">) {
  if (status === "AVAILABLE") return "Recovered during battery count";
  if (status === "LOST") return "Missing after shelf audit";
  return "Removed from service";
}

function statusImpact(action: NonNullable<PendingAction>) {
  if (action.fromStatus === "AVAILABLE" && action.status !== "AVAILABLE") return "Available count will decrease by 1.";
  if (action.fromStatus !== "AVAILABLE" && action.status === "AVAILABLE") return "Available count will increase by 1.";
  return "Available count will not change.";
}

function clampUnitCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(500, Math.trunc(value)));
}

function normalizeQuantityDelta(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1_000_000, Math.min(1_000_000, Math.trunc(value)));
}

function productOptionLabel(product: BatteryProduct) {
  const metadata = [product.brand, product.model].filter(Boolean).join(" ");
  if (!metadata || product.name.toLocaleLowerCase().includes(metadata.toLocaleLowerCase())) {
    return product.name;
  }
  return `${product.name} (${metadata})`;
}

export default function BatteryCockpitPage() {
  const [data, setData] = useState<BatteryCockpitData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusReason, setStatusReason] = useState("");
  const [pendingAddUnits, setPendingAddUnits] = useState<PendingAddUnits>(null);
  const [addUnitCount, setAddUnitCount] = useState(1);
  const [addUnitReason, setAddUnitReason] = useState("Battery stock received");
  const [addProductId, setAddProductId] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const addBusyRef = useRef(false);
  const [pendingQuantityAdjustment, setPendingQuantityAdjustment] = useState<PendingQuantityAdjustment>(null);
  const [quantityDelta, setQuantityDelta] = useState(1);
  const [quantityReason, setQuantityReason] = useState("Battery count correction");
  const [quantityBusy, setQuantityBusy] = useState(false);
  const quantityBusyRef = useRef(false);
  const [pendingLabelMark, setPendingLabelMark] = useState<PendingLabelMark>(null);
  const [labelBusy, setLabelBusy] = useState(false);
  const labelBusyRef = useRef(false);
  const [exportingSkuId, setExportingSkuId] = useState<string | null>(null);
  const [pendingStaleRepair, setPendingStaleRepair] = useState<PendingStaleRepair>(null);
  const [repairReason, setRepairReason] = useState("Repair stale checked-out battery flags with no active allocation");
  const [repairBusy, setRepairBusy] = useState(false);
  const repairBusyRef = useRef(false);

  async function load({ refresh = false } = {}) {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch("/api/bulk-skus/batteries");
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        const message = await parseErrorMessage(res, "Failed to load batteries");
        if (!refresh) setError(message);
        else toast.error(message);
        return;
      }
      const json = await parseJsonSafely<{ data?: BatteryCockpitData }>(res);
      if (!json?.data) {
        const message = "Battery data response was incomplete. Refresh and try again.";
        if (!refresh) setError(message);
        else toast.error(message);
        return;
      }
      setData(json.data);
      setError(null);
    } catch (err) {
      if (refresh) toast.error("Network error — battery data may be stale.");
      else setError(err instanceof TypeError ? "Network error. Try again." : "Failed to load batteries.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const checkedOutUnits = useMemo(() => {
    return (data?.skus ?? [])
      .flatMap((sku) =>
        sku.units
          .filter((unit) => unit.status === "CHECKED_OUT")
          .map((unit) => ({ ...unit, skuId: sku.id, skuName: sku.name, locationName: sku.location.name })),
      )
      .sort((a, b) => (b.checkedOutDays ?? -1) - (a.checkedOutDays ?? -1));
  }, [data]);
  const unitSkus = useMemo(() => (data?.skus ?? []).filter((sku) => sku.trackByNumber), [data]);
  const quantitySkus = useMemo(() => (data?.skus ?? []).filter((sku) => !sku.trackByNumber), [data]);
  const staleCheckedOutUnitIds = useMemo(
    () => new Set((data?.integrity.staleCheckedOutUnits ?? []).map((unit) => unit.id)),
    [data],
  );

  function openStatusAction(action: NonNullable<PendingAction>) {
    setPendingAction(action);
    setStatusReason(defaultStatusReason(action.status));
  }

  function openAddUnits(sku: BatterySku) {
    const maxUnitNumber = sku.units.reduce((max, unit) => Math.max(max, unit.unitNumber), 0);
    const suggestedCount = clampUnitCount(Math.max(1, sku.threshold - sku.counts.available));
    setPendingAddUnits({
      skuId: sku.id,
      skuName: sku.name,
      nextUnitNumber: maxUnitNumber + 1,
      currentAvailable: sku.counts.available,
      currentTotal: sku.counts.total,
      products: sku.products,
    });
    setAddUnitCount(suggestedCount);
    setAddUnitReason(sku.isLow ? "Low-stock replenishment" : "Battery stock received");
    setAddProductId("");
  }

  function openQuantityAdjustment(sku: BatterySku) {
    const suggestedDelta = normalizeQuantityDelta(sku.isLow ? Math.max(1, sku.threshold - sku.counts.available) : 1);
    setPendingQuantityAdjustment({
      skuId: sku.id,
      skuName: sku.name,
      currentAvailable: sku.counts.available,
      currentTotal: sku.counts.total,
    });
    setQuantityDelta(suggestedDelta);
    setQuantityReason(sku.isLow ? "Low-stock replenishment" : "Battery count correction");
  }

  async function applyStatusChange(action: NonNullable<PendingAction>, reason: string) {
    if (busyRef.current) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      toast.error("Add a reason before changing unit status.");
      return;
    }
    busyRef.current = true;
    const key = `${action.skuId}-${action.unitNumber}`;
    setBusyKey(key);

    try {
      const res = await fetch(`/api/bulk-skus/${action.skuId}/units/${action.unitNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action.status, reason: cleanReason }),
      });
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to update unit"));
        return;
      }

      toast.success(`#${action.unitNumber} marked ${STATUS_META[action.status].label.toLowerCase()}`);
      setData((prev) => updateUnitStatus(prev, action));
    } catch {
      toast.error("Network error — unit was not updated.");
    } finally {
      busyRef.current = false;
      setBusyKey(null);
      setPendingAction(null);
      setStatusReason("");
    }
  }

  async function submitAddUnits(action: NonNullable<PendingAddUnits>) {
    if (addBusyRef.current) return;
    const count = clampUnitCount(addUnitCount);
    const reason = addUnitReason.trim();
    if (reason.length < 3) {
      toast.error("Add a reason before adding units.");
      return;
    }

    addBusyRef.current = true;
    setAddBusy(true);

    try {
      const res = await fetch(`/api/bulk-skus/${action.skuId}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, reason, productId: addProductId || null }),
      });
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to add units"));
        return;
      }
      const json = await parseJsonSafely<{ data?: { startNumber: number; endNumber: number; productName: string | null } }>(res);
      const range = json?.data ? `#${json.data.startNumber}-#${json.data.endNumber}` : `${count} units`;
      const productSuffix = json?.data?.productName ? ` as ${json.data.productName}` : "";
      toast.success(`Added ${range}${productSuffix}`);
      setPendingAddUnits(null);
      void load({ refresh: true });
    } catch {
      toast.error("Network error. Units were not added.");
    } finally {
      addBusyRef.current = false;
      setAddBusy(false);
    }
  }

  async function submitQuantityAdjustment(action: NonNullable<PendingQuantityAdjustment>) {
    if (quantityBusyRef.current) return;
    const delta = normalizeQuantityDelta(quantityDelta);
    const reason = quantityReason.trim();
    const next = action.currentAvailable + delta;
    if (delta === 0) {
      toast.error("Enter a non-zero adjustment.");
      return;
    }
    if (next < 0) {
      toast.error("Adjustment would drop available stock below zero.");
      return;
    }
    if (reason.length < 3) {
      toast.error("Add a reason before adjusting quantity.");
      return;
    }

    quantityBusyRef.current = true;
    setQuantityBusy(true);

    try {
      const res = await fetch(`/api/bulk-skus/${action.skuId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityDelta: delta, reason }),
      });
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to adjust stock"));
        return;
      }
      toast.success(`Adjusted ${action.skuName} by ${delta > 0 ? `+${delta}` : delta}`);
      setPendingQuantityAdjustment(null);
      void load({ refresh: true });
    } catch {
      toast.error("Network error. Stock was not adjusted.");
    } finally {
      quantityBusyRef.current = false;
      setQuantityBusy(false);
    }
  }

  async function exportBrotherLabels(sku: BatterySku) {
    if (exportingSkuId) return;
    const unprinted = sku.units
      .filter((unit) => unit.labelPrintedAt === null && unit.status !== "RETIRED")
      .map((unit) => unit.unitNumber)
      .sort((a, b) => a - b);

    if (unprinted.length === 0) {
      toast.info(`${sku.name} has no unprinted labels. Use the unit menu to reprint.`);
      return;
    }

    setExportingSkuId(sku.id);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}/units/labels?scope=unprinted`);
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to build label CSV"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `brother-labels-${sku.id}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success(`Exported ${metricLabel(unprinted.length, "label")} for ${sku.name}`);
      setPendingLabelMark({ skuId: sku.id, skuName: sku.name, unitNumbers: unprinted });
    } catch {
      toast.error("Network error — label CSV was not downloaded.");
    } finally {
      setExportingSkuId(null);
    }
  }

  async function confirmLabelsPrinted(action: NonNullable<PendingLabelMark>) {
    if (labelBusyRef.current) return;
    labelBusyRef.current = true;
    setLabelBusy(true);
    try {
      const res = await fetch(`/api/bulk-skus/${action.skuId}/units/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitNumbers: action.unitNumbers, printed: true }),
      });
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to mark labels printed"));
        return;
      }
      const json = await parseJsonSafely<{ data?: { updated: number; alreadyPrinted: number } }>(res);
      const updated = json?.data?.updated ?? action.unitNumbers.length;
      toast.success(`Marked ${metricLabel(updated, "label")} printed for ${action.skuName}`);
      setPendingLabelMark(null);
      void load({ refresh: true });
    } catch {
      toast.error("Network error — labels were not marked printed.");
    } finally {
      labelBusyRef.current = false;
      setLabelBusy(false);
    }
  }

  async function submitStaleRepair(action: NonNullable<PendingStaleRepair>) {
    if (repairBusyRef.current) return;
    const reason = repairReason.trim();
    if (reason.length < 3) {
      toast.error("Add a reason before repairing stale flags.");
      return;
    }

    repairBusyRef.current = true;
    setRepairBusy(true);
    try {
      const res = await fetch("/api/bulk-skus/batteries/repair-stale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, dryRun: false }),
      });
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to repair stale battery flags"));
        return;
      }
      const json = await parseJsonSafely<{ data?: { repairedCount: number } }>(res);
      const repaired = json?.data?.repairedCount ?? action.count;
      toast.success(`Repaired ${metricLabel(repaired, "stale battery flag")}`);
      setPendingStaleRepair(null);
      void load({ refresh: true });
    } catch {
      toast.error("Network error. Stale battery flags were not repaired.");
    } finally {
      repairBusyRef.current = false;
      setRepairBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Battery Ops unavailable"
        description={error}
        actionLabel="Retry"
        onAction={() => void load()}
      />
    );
  }

  const totals = data?.totals;
  const ownedTotal = totals ? Math.max(0, totals.total - totals.retired) : 0;
  const attentionCount = data
    ? data.compatibility.length +
      (totals && totals.lost > 0 ? 1 : 0) +
      (data.integrity.staleCheckedOutCount > 0 ? 1 : 0) +
      (totals && totals.agingCheckedOut > 0 ? 1 : 0)
    : 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Battery Ops" description="What is on the shelf, what is out, and what needs a look.">
        <Button className="h-10" variant="outline" onClick={() => void load({ refresh: true })} disabled={refreshing}>
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </PageHeader>

      {totals && (
        <section aria-label="Battery summary" className="-mt-2 rounded-2xl border border-border bg-card p-5 sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-muted-foreground">Ready to check out</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-6xl font-black leading-none tracking-tight tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
                  {totals.available}
                </span>
                <span className="text-base text-muted-foreground">of {ownedTotal} batteries</span>
              </div>
              <StockBar
                className="mt-6"
                available={totals.available}
                checkedOut={totals.checkedOut}
                missing={totals.lost}
                owned={ownedTotal}
              />
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <LegendItem dot={STATUS_META.AVAILABLE.dot} label="Available" value={totals.available} />
                <LegendItem dot={STATUS_META.CHECKED_OUT.dot} label="Checked out" value={totals.checkedOut} />
                <LegendItem dot={STATUS_META.LOST.dot} label="Missing" value={totals.lost} />
                {totals.retired > 0 && <LegendItem dot={STATUS_META.RETIRED.dot} label="Retired" value={totals.retired} />}
              </dl>
            </div>
            <div className="flex gap-8 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <SummaryStat label="Running low" value={totals.lowSkus} warn={totals.lowSkus > 0} />
              <SummaryStat label="Out 7+ days" value={totals.agingCheckedOut} warn={totals.agingCheckedOut > 0} />
            </div>
          </div>
        </section>
      )}

      {data && attentionCount > 0 && (
        <section aria-labelledby="battery-attention" className="flex flex-col gap-3">
          <h2 id="battery-attention" className="text-lg">Needs attention</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {data.compatibility.map((item) => (
              <CompatibilityRow key={item.ruleId} item={item} />
            ))}
            {totals && totals.lost > 0 && (
              <AttentionRow
                tone="red"
                title={`${metricLabel(totals.lost, "battery", "batteries")} marked missing`}
                detail="Open the loss report to see who last had them."
                action={(
                  <Button variant="outline" className="h-10" asChild>
                    <Link href="/reports/bulk-losses">Review</Link>
                  </Button>
                )}
              />
            )}
            {data.integrity.staleCheckedOutCount > 0 && (
              <IntegrityWarningRow
                warnings={data.integrity.staleCheckedOutUnits}
                repairBusy={repairBusy}
                onRepair={() => {
                  setPendingStaleRepair({
                    count: data.integrity.staleCheckedOutCount,
                    units: data.integrity.staleCheckedOutUnits,
                  });
                  setRepairReason("Repair stale checked-out battery flags with no active allocation");
                }}
              />
            )}
            {totals && totals.agingCheckedOut > 0 && (
              <AttentionRow
                tone="orange"
                title={`${metricLabel(totals.agingCheckedOut, "battery", "batteries")} out a week or more`}
                detail="Worth a nudge to whoever has them."
                action={(
                  <Button variant="outline" className="h-10" asChild>
                    <a href="#battery-checked-out">See who</a>
                  </Button>
                )}
              />
            )}
          </ul>
        </section>
      )}

      {data && data.skus.length === 0 ? (
        <EmptyState
          icon="box"
          title="No battery families found"
          description="Active battery families appear here when they are tracked as units or quantity."
          actionLabel="Back to Items"
          actionHref="/items"
        />
      ) : (
        <>
          <section aria-labelledby="battery-families" className="flex flex-col gap-3">
            <h2 id="battery-families" className="text-lg">Families</h2>
            <div className="flex flex-col gap-4">
              {unitSkus.map((sku) => (
                <BatteryFamilyWorkspace
                  key={sku.id}
                  sku={sku}
                  staleCheckedOutUnitIds={staleCheckedOutUnitIds}
                  busyKey={busyKey}
                  exporting={exportingSkuId === sku.id}
                  onAddUnits={() => openAddUnits(sku)}
                  onExportLabels={() => void exportBrotherLabels(sku)}
                  onPendingAction={openStatusAction}
                />
              ))}
            </div>
          </section>

          {quantitySkus.length > 0 && (
            <section aria-labelledby="battery-counted" className="flex flex-col gap-3">
              <div>
                <h2 id="battery-counted" className="text-lg">Counted by quantity</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">No numbers on these, so the live count comes from audited stock movements.</p>
              </div>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {quantitySkus.map((sku) => (
                  <li key={sku.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/bulk-inventory/${sku.id}`} className="font-bold text-foreground no-underline hover:underline">
                          {sku.name}
                        </Link>
                        {sku.isLow && <LowPill />}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        <span className="font-semibold tabular-nums text-foreground">{sku.counts.available}</span> available
                        {" / "}low below {sku.threshold} / {sku.location.name}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" className="h-10" onClick={() => openQuantityAdjustment(sku)}>
                        <SlidersHorizontal className="size-3.5" />
                        Adjust live count
                      </Button>
                      <Button variant="ghost" className="h-10" asChild>
                        <Link href={`/bulk-inventory/${sku.id}?tab=info`}>Edit</Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <CheckedOutSection units={checkedOutUnits} />
        </>
      )}

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setStatusReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark unit {pendingAction ? `#${pendingAction.unitNumber}` : ""} {pendingAction ? STATUS_META[pendingAction.status].label.toLowerCase() : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This updates stock availability and writes an audit entry for {pendingAction?.skuName}. Checked-out units still need to be returned through check-in before their status can change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingAction && (
            <div className="flex flex-col gap-3">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                {statusImpact(pendingAction)}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="battery-status-reason">Reason</Label>
                <Textarea
                  id="battery-status-reason"
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  maxLength={500}
                  placeholder="Shelf audit, damaged contacts, recovered from bag..."
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingAction || statusReason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault();
                if (pendingAction) void applyStatusChange(pendingAction, statusReason);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingAddUnits}
        onOpenChange={(open) => {
          if (!open) setPendingAddUnits(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add battery units</AlertDialogTitle>
            <AlertDialogDescription>
              Add numbered units to {pendingAddUnits?.skuName}. New units start available and are scanned by exact unit at pickup and return.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingAddUnits && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="battery-add-count">Units to add</Label>
                  <Input
                    id="battery-add-count"
                    type="number"
                    min={1}
                    max={500}
                    value={addUnitCount}
                    onChange={(event) => setAddUnitCount(clampUnitCount(Number(event.target.value)))}
                  />
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="text-xs text-muted-foreground">Count impact</div>
                  <div className="font-medium tabular-nums">
                    {pendingAddUnits.currentAvailable} to {pendingAddUnits.currentAvailable + clampUnitCount(addUnitCount)} available
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {pendingAddUnits.currentTotal} to {pendingAddUnits.currentTotal + clampUnitCount(addUnitCount)} total / units #{pendingAddUnits.nextUnitNumber}-#{pendingAddUnits.nextUnitNumber + clampUnitCount(addUnitCount) - 1}
                  </div>
                </div>
              </div>
              {pendingAddUnits.products.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="battery-add-product">Product metadata</Label>
                  <NativeSelect
                    id="battery-add-product"
                    name="batteryAddProduct"
                    className="h-10"
                    value={addProductId}
                    onChange={(event) => setAddProductId(event.target.value)}
                    disabled={addBusy}
                  >
                    <option value="">Unassigned product</option>
                    {pendingAddUnits.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {productOptionLabel(product)}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">
                    Applies the selected product to every new unit. You can reassign individual units later.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="battery-add-reason">Reason</Label>
                <Textarea
                  id="battery-add-reason"
                  value={addUnitReason}
                  onChange={(event) => setAddUnitReason(event.target.value)}
                  maxLength={500}
                  placeholder="Low-stock replenishment, new purchase, count correction..."
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={addBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingAddUnits || addBusy || addUnitReason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault();
                if (pendingAddUnits) void submitAddUnits(pendingAddUnits);
              }}
            >
              {addBusy ? "Adding..." : "Add units"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingQuantityAdjustment}
        onOpenChange={(open) => {
          if (!open) setPendingQuantityAdjustment(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adjust battery quantity</AlertDialogTitle>
            <AlertDialogDescription>
              Adjust available stock for {pendingQuantityAdjustment?.skuName}. This writes a stock movement and audit entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingQuantityAdjustment && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="battery-quantity-delta">Quantity change</Label>
                  <Input
                    id="battery-quantity-delta"
                    type="number"
                    step={1}
                    value={quantityDelta}
                    onChange={(event) => setQuantityDelta(normalizeQuantityDelta(Number(event.target.value)))}
                  />
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="text-xs text-muted-foreground">Count impact</div>
                  <div className="font-medium tabular-nums">
                    {pendingQuantityAdjustment.currentAvailable} to {pendingQuantityAdjustment.currentAvailable + normalizeQuantityDelta(quantityDelta)} available
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {pendingQuantityAdjustment.currentTotal} to {pendingQuantityAdjustment.currentTotal + normalizeQuantityDelta(quantityDelta)} total
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="battery-quantity-reason">Reason</Label>
                <Textarea
                  id="battery-quantity-reason"
                  value={quantityReason}
                  onChange={(event) => setQuantityReason(event.target.value)}
                  maxLength={500}
                  placeholder="Shelf count, replenishment, damaged stock..."
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={quantityBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !pendingQuantityAdjustment ||
                quantityBusy ||
                quantityReason.trim().length < 3 ||
                normalizeQuantityDelta(quantityDelta) === 0 ||
                (pendingQuantityAdjustment.currentAvailable + normalizeQuantityDelta(quantityDelta)) < 0
              }
              onClick={(event) => {
                event.preventDefault();
                if (pendingQuantityAdjustment) void submitQuantityAdjustment(pendingQuantityAdjustment);
              }}
            >
              {quantityBusy ? "Adjusting..." : "Adjust stock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingLabelMark}
        onOpenChange={(open) => {
          if (!open && !labelBusy) setPendingLabelMark(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark {pendingLabelMark ? metricLabel(pendingLabelMark.unitNumbers.length, "label") : "labels"} printed?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingLabelMark
                ? `Confirm the Brother labels for ${pendingLabelMark.skuName} were printed and applied. Units ${summarizeUnitNumbers(pendingLabelMark.unitNumbers)}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={labelBusy}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingLabelMark || labelBusy}
              onClick={(event) => {
                event.preventDefault();
                if (pendingLabelMark) void confirmLabelsPrinted(pendingLabelMark);
              }}
            >
              {labelBusy ? "Marking..." : "Mark printed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingStaleRepair}
        onOpenChange={(open) => {
          if (!open && !repairBusy) setPendingStaleRepair(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Repair stale battery flags?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStaleRepair
                ? `This will set ${metricLabel(pendingStaleRepair.count, "orphaned checked-out unit")} back to Available because there is no active checkout allocation.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingStaleRepair && (
            <div className="flex flex-col gap-3">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                Units {summarizeUnitNumbers(pendingStaleRepair.units.map((unit) => unit.unitNumber), 12)}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="battery-stale-repair-reason">Reason</Label>
                <Textarea
                  id="battery-stale-repair-reason"
                  value={repairReason}
                  onChange={(event) => setRepairReason(event.target.value)}
                  maxLength={500}
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={repairBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingStaleRepair || repairBusy || repairReason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault();
                if (pendingStaleRepair) void submitStaleRepair(pendingStaleRepair);
              }}
            >
              {repairBusy ? "Repairing..." : "Repair flags"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StockBar({
  available,
  checkedOut,
  missing,
  owned,
  lowLine,
  className,
}: {
  available: number;
  checkedOut: number;
  missing: number;
  owned: number;
  /** Where "low" starts, in units. Drawn as a tick on the bar. */
  lowLine?: number;
  className?: string;
}) {
  const pct = (value: number) => (owned > 0 ? Math.min(100, (value / owned) * 100) : 0);
  const lowPct = lowLine !== undefined && owned > 0 ? Math.min(100, (lowLine / owned) * 100) : null;
  return (
    <div className={cn("relative", className)}>
      <div
        role="img"
        aria-label={`${available} available, ${checkedOut} checked out, ${missing} missing of ${owned}`}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {available > 0 && <span className="rounded-full bg-[var(--green)]" style={{ width: `${pct(available)}%` }} />}
        {checkedOut > 0 && <span className="rounded-full bg-[var(--blue)]" style={{ width: `${pct(checkedOut)}%` }} />}
        {missing > 0 && <span className="rounded-full bg-[var(--red)]" style={{ width: `${pct(missing)}%` }} />}
      </div>
      {lowPct !== null && (
        <span
          aria-hidden
          title={`Low below ${lowLine}`}
          className="absolute -top-1 h-[18px] w-px bg-foreground/50"
          style={{ left: `${lowPct}%` }}
        />
      )}
    </div>
  );
}

function LegendItem({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-2 rounded-full", dot)} />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function SummaryStat({ label, value, warn }: { label: string; value: number; warn: boolean }) {
  return (
    <div>
      <div className={cn("text-3xl font-black leading-none tabular-nums", warn && "text-[var(--orange-text)]")} style={{ fontFamily: "var(--font-heading)" }}>
        {value}
      </div>
      <div className="mt-1.5 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function LowPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--orange-bg)] px-2 py-0.5 text-xs font-bold text-[var(--orange-text)]">
      <span className="size-1.5 rounded-full bg-[var(--orange)]" />
      Running low
    </span>
  );
}

function AttentionRow({
  tone,
  title,
  detail,
  action,
}: {
  tone: "orange" | "red";
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-2 size-2 shrink-0 rounded-full", tone === "red" ? "bg-[var(--red)]" : "bg-[var(--orange)]")} />
        <div className="min-w-0">
          <div className="font-bold">{title}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
      {action && <div className="shrink-0 pl-5 sm:pl-0">{action}</div>}
    </li>
  );
}

function BatteryFamilyWorkspace({
  sku,
  staleCheckedOutUnitIds,
  busyKey,
  exporting,
  onAddUnits,
  onExportLabels,
  onPendingAction,
}: {
  sku: BatterySku;
  staleCheckedOutUnitIds: Set<string>;
  busyKey: string | null;
  exporting: boolean;
  onAddUnits: () => void;
  onExportLabels: () => void;
  onPendingAction: (action: NonNullable<PendingAction>) => void;
}) {
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [unitFilter, setUnitFilter] = useState<UnitFilter>("ALL");
  const owned = Math.max(0, sku.counts.total - sku.counts.retired);
  const filteredUnits = unitFilter === "ALL"
    ? sku.units
    : sku.units.filter((unit) => unit.status === unitFilter);
  const productSummary = sku.products.length === 0
    ? null
    : sku.products.map((product) => `${product.name} ${product.assignedUnitCount}`).join(" / ");
  const unitFilters: Array<{ value: UnitFilter; label: string; count: number }> = [
    { value: "ALL", label: "All", count: sku.counts.total },
    { value: "AVAILABLE", label: "Available", count: sku.counts.available },
    { value: "CHECKED_OUT", label: "Out", count: sku.counts.checkedOut },
    { value: "LOST", label: "Missing", count: sku.counts.lost },
    { value: "RETIRED", label: "Retired", count: sku.counts.retired },
  ];
  const quietCounts = [
    sku.counts.checkedOut > 0 ? `${sku.counts.checkedOut} out` : null,
    sku.counts.lost > 0 ? `${sku.counts.lost} missing` : null,
    sku.counts.retired > 0 ? `${sku.counts.retired} retired` : null,
  ].filter(Boolean);

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="min-w-0 truncate text-lg">
                <Link href={`/bulk-inventory/${sku.id}`} className="text-foreground no-underline hover:underline">{sku.name}</Link>
              </h3>
              {sku.isLow && <LowPill />}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{sku.location.name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button className="h-10" onClick={onAddUnits}>
              <Plus className="size-3.5" />
              Add units
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-9" aria-label={`More actions for ${sku.name}`}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={exporting} onClick={onExportLabels}>
                  <Download className="size-3.5" />
                  {exporting ? "Exporting..." : "Export labels"}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/bulk-inventory/${sku.id}?tab=info`}>
                    <Info className="size-3.5" />
                    Edit metadata
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-5 flex items-baseline gap-2.5">
          <span className="text-4xl font-black leading-none tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
            {sku.counts.available}
          </span>
          <span className="text-sm text-muted-foreground">available of {owned}</span>
          {quietCounts.length > 0 && (
            <span className="ml-auto text-sm text-muted-foreground">{quietCounts.join(" / ")}</span>
          )}
        </div>
        <StockBar
          className="mt-4"
          available={sku.counts.available}
          checkedOut={sku.counts.checkedOut}
          missing={sku.counts.lost}
          owned={owned}
          lowLine={sku.threshold}
        />
        <p className="mt-2 text-xs text-muted-foreground">Low below {sku.threshold}</p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="min-w-0 text-sm text-muted-foreground">
            {sku.labelNeededCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <Tag className="size-3.5 text-muted-foreground" />
                {sku.labelNeededCount} need labels
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Tag className="size-3.5" />
                All labeled
              </span>
            )}
            <span className="mx-2 text-border">|</span>
            <span className="font-mono text-xs">{sku.binQrCodeValue}</span>
            {productSummary && <span className="hidden sm:inline"><span className="mx-2 text-border">|</span>{productSummary}</span>}
          </p>
          <Button
            variant="ghost"
            className="h-10 shrink-0 text-muted-foreground"
            aria-expanded={unitsOpen}
            aria-controls={`battery-units-${sku.id}`}
            onClick={() => setUnitsOpen((open) => !open)}
          >
            {unitsOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {unitsOpen ? "Hide units" : `Show ${sku.counts.total} units`}
          </Button>
        </div>
      </div>

      {unitsOpen && (
        <div id={`battery-units-${sku.id}`} className="border-t border-border bg-muted/30 p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={`Filter ${sku.name} units`}>
            {unitFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={unitFilter === filter.value}
                onClick={() => setUnitFilter(filter.value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors",
                  unitFilter === filter.value
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
                )}
              >
                {filter.label}
                <span className="tabular-nums opacity-70">{filter.count}</span>
              </button>
            ))}
          </div>
          {filteredUnits.length === 0 ? (
            <EmptyState
              inline
              icon="box"
              title={`No ${unitFilters.find((filter) => filter.value === unitFilter)?.label.toLowerCase()} units`}
              description="Choose another status to review this battery family."
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-2">
              {filteredUnits.map((unit) => (
                <UnitMenu
                  key={unit.id}
                  sku={sku}
                  unit={unit}
                  dataWarning={staleCheckedOutUnitIds.has(unit.id)}
                  busy={busyKey === `${sku.id}-${unit.unitNumber}`}
                  onPendingAction={onPendingAction}
                />
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Availability follows unit status. Add units for new physical batteries; tap a unit to mark it missing, retired, or recovered.
          </p>
        </div>
      )}
    </article>
  );
}

function CheckedOutSection({ units }: { units: CheckedOutRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? units : units.slice(0, 8);

  return (
    <section id="battery-checked-out" aria-labelledby="battery-out-title" className="flex scroll-mt-24 flex-col gap-3">
      <h2 id="battery-out-title" className="text-lg">Checked out</h2>
      {units.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <EmptyState
            inline
            icon="check"
            title="Every battery is on the shelf"
            description="Checked-out batteries show up here with who has them and when they are due."
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {visible.map((unit) => {
              const aging = (unit.checkedOutDays ?? 0) >= 7;
              const holder = unit.booking?.requesterName ?? "Unknown";
              return (
                <li key={unit.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <UserAvatar name={holder} size="default" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{holder}</div>
                    <p className="truncate text-sm text-muted-foreground">
                      <Link href={`/bulk-inventory/${unit.skuId}`} className="text-foreground no-underline hover:underline">
                        {unit.skuName} #{unit.unitNumber}
                      </Link>
                      {unit.booking && (
                        <>
                          {" / "}
                          <Link href={`/bookings?highlight=${unit.booking.id}`} className="text-foreground no-underline hover:underline">
                            {unit.booking.refNumber ?? unit.booking.title}
                          </Link>
                          {` / due ${formatDue(unit.booking.endsAt)}`}
                        </>
                      )}
                    </p>
                  </div>
                  <div className={cn("shrink-0 text-sm font-bold tabular-nums", aging ? "text-[var(--orange-text)]" : "text-muted-foreground")}>
                    {unit.checkedOutDays === null ? "n/a" : `${unit.checkedOutDays}d`}
                  </div>
                </li>
              );
            })}
          </ul>
          {units.length > 8 && (
            <Button variant="ghost" className="self-start text-muted-foreground" onClick={() => setShowAll((open) => !open)}>
              {showAll ? "Show fewer" : `Show all ${units.length}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function CompatibilityRow({ item }: { item: BatteryCompatibility }) {
  const shortage = Math.max(0, item.threshold - item.availableQuantity);
  const models = item.cameraModels.length > 0 ? item.cameraModels.join(", ") : "Matched camera inventory";
  return (
    <AttentionRow
      tone="orange"
      title={`${item.label} are ${shortage} short`}
      detail={`${item.availableQuantity} available, low below ${item.threshold}. Covers ${models} (${metricLabel(item.cameraCount, "camera")}).`}
    />
  );
}

function IntegrityWarningRow({
  warnings,
  repairBusy,
  onRepair,
}: {
  warnings: BatteryIntegrityWarning[];
  repairBusy: boolean;
  onRepair: () => void;
}) {
  const names = warnings.slice(0, 4).map((warning) => `${warning.skuName} #${warning.unitNumber}`).join(", ");
  const more = warnings.length > 4 ? ` and ${warnings.length - 4} more` : "";
  return (
    <AttentionRow
      tone="orange"
      title={`${metricLabel(warnings.length, "battery", "batteries")} with a stale checked-out flag`}
      detail={`${names}${more}. They have no active checkout, so they are counted as available.`}
      action={(
        <Button className="h-10" variant="outline" onClick={onRepair} disabled={repairBusy}>
          <Wrench className="size-3.5" />
          {repairBusy ? "Repairing..." : "Repair flags"}
        </Button>
      )}
    />
  );
}

function UnitMenu({
  sku,
  unit,
  busy,
  dataWarning,
  onPendingAction,
}: {
  sku: BatterySku;
  unit: BatteryUnit;
  busy: boolean;
  dataWarning: boolean;
  onPendingAction: (action: NonNullable<PendingAction>) => void;
}) {
  const meta = STATUS_META[unit.status];
  const product = sku.products.find((candidate) => candidate.id === unit.productId) ?? null;
  const needsLabel = unit.labelPrintedAt === null && unit.status !== "RETIRED";
  const labelTitle = unit.labelPrintedAt
    ? `Label printed ${formatLabelDate(unit.labelPrintedAt)}`
    : needsLabel
      ? "Needs label"
      : undefined;
  const content = (
    <div
      title={labelTitle}
      className={cn(
        "relative flex min-h-12 flex-col items-start justify-center rounded-md px-2.5 py-2 text-left transition-[background-color,scale] active:scale-[0.96]",
        meta.className,
        unit.status === "CHECKED_OUT" || dataWarning ? "cursor-default opacity-80" : "cursor-pointer",
      )}
    >
      {needsLabel && (
        <span
          aria-label="Needs label"
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--orange)]"
        />
      )}
      {unit.labelPrintedAt && (
        <Tag aria-label="Label printed" className="absolute right-1.5 top-1.5 size-2.5 opacity-70" />
      )}
      <span className="font-mono text-sm font-semibold tabular-nums">#{unit.unitNumber}</span>
      <span className="text-[10px] leading-tight">{busy ? "Updating..." : meta.label}</span>
      {product && (
        <span className="max-w-full truncate text-[10px] leading-tight opacity-75">{product.brand}</span>
      )}
    </div>
  );

  if (unit.status === "CHECKED_OUT" || dataWarning) {
    return content;
  }
  const editableStatus = unit.status;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={busy} className="text-left disabled:pointer-events-none disabled:opacity-60">
          {content}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          disabled={unit.status === "AVAILABLE"}
          onClick={() => onPendingAction({ skuId: sku.id, skuName: sku.name, unitNumber: unit.unitNumber, fromStatus: editableStatus, status: "AVAILABLE" })}
        >
          Release to available
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={unit.status === "LOST"}
          className="text-destructive focus:text-destructive"
          onClick={() => onPendingAction({ skuId: sku.id, skuName: sku.name, unitNumber: unit.unitNumber, fromStatus: editableStatus, status: "LOST" })}
        >
          Mark missing
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={unit.status === "RETIRED"}
          onClick={() => onPendingAction({ skuId: sku.id, skuName: sku.name, unitNumber: unit.unitNumber, fromStatus: editableStatus, status: "RETIRED" })}
        >
          Retire unit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function updateUnitStatus(data: BatteryCockpitData | null, action: NonNullable<PendingAction>): BatteryCockpitData | null {
  if (!data) return data;

  let availableDelta = 0;
  const skus = data.skus.map((sku) => {
    if (sku.id !== action.skuId) return sku;
    const units = sku.units.map((unit) => {
      if (unit.unitNumber !== action.unitNumber) return unit;
      if (unit.status === "AVAILABLE" && action.status !== "AVAILABLE") availableDelta -= 1;
      if (unit.status !== "AVAILABLE" && action.status === "AVAILABLE") availableDelta += 1;
      return { ...unit, status: action.status, checkedOutAt: null, checkedOutDays: null, booking: null };
    });
    const counts = {
      total: units.length,
      available: units.filter((unit) => unit.status === "AVAILABLE").length,
      checkedOut: units.filter((unit) => unit.status === "CHECKED_OUT").length,
      lost: units.filter((unit) => unit.status === "LOST").length,
      retired: units.filter((unit) => unit.status === "RETIRED").length,
    };
    return { ...sku, units, counts, isLow: counts.available < sku.threshold };
  });

  const totals = skus.reduce(
    (acc, sku) => {
      acc.total += sku.counts.total;
      acc.available += sku.counts.available;
      acc.checkedOut += sku.counts.checkedOut;
      acc.lost += sku.counts.lost;
      acc.retired += sku.counts.retired;
      if (sku.isLow) acc.lowSkus += 1;
      acc.agingCheckedOut += sku.units.filter(
        (unit) => unit.status === "CHECKED_OUT" && (unit.checkedOutDays ?? 0) >= 7,
      ).length;
      return acc;
    },
    { total: 0, available: 0, checkedOut: 0, lost: 0, retired: 0, lowSkus: 0, agingCheckedOut: 0 },
  );

  const compatibility = availableDelta === 0
    ? data.compatibility
    : data.compatibility.map((item) =>
        item.batterySkuIds.includes(action.skuId)
          ? {
              ...item,
              availableQuantity: item.availableQuantity + availableDelta,
              isLow: item.availableQuantity + availableDelta < item.threshold,
            }
          : item,
      ).filter((item) => item.isLow);

  return { totals, skus, compatibility, integrity: data.integrity };
}
