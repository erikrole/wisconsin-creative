"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BatteryCharging, CircleAlert, Download, ExternalLink, PackageOpen, Plus, RefreshCw, SlidersHorizontal, Tag, TriangleAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";

type UnitStatus = "AVAILABLE" | "CHECKED_OUT" | "LOST" | "RETIRED";

type BatteryUnit = {
  id: string;
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

type BatterySku = {
  id: string;
  name: string;
  category: string;
  trackByNumber: boolean;
  location: { id: string; name: string };
  minThreshold: number;
  threshold: number;
  binQrCodeValue: string;
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
    });
    setAddUnitCount(suggestedCount);
    setAddUnitReason(sku.isLow ? "Low-stock replenishment" : "Battery stock received");
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
        body: JSON.stringify({ count, reason }),
      });
      if (handleAuthRedirect(res, "/bulk-inventory/batteries")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to add units"));
        return;
      }
      const json = await parseJsonSafely<{ data?: { startNumber: number; endNumber: number } }>(res);
      const range = json?.data ? `#${json.data.startNumber}-#${json.data.endNumber}` : `${count} units`;
      toast.success(`Added ${range}`);
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
  const railItems: OperationalStatusRailItem[] = totals ? [
    ...(totals.lost > 0 ? [{
      id: "missing",
      label: "Missing",
      value: totals.lost,
      detail: "Battery units marked missing.",
      icon: TriangleAlert,
      tone: "critical" as const,
      href: "/reports/bulk-losses",
    }] : []),
    ...(totals.lowSkus > 0 ? [{
      id: "low-families",
      label: "Low families",
      value: totals.lowSkus,
      detail: "Battery families below their stock threshold.",
      icon: CircleAlert,
      tone: "warning" as const,
    }] : []),
    ...((data?.integrity.staleCheckedOutCount ?? 0) > 0 ? [{
      id: "stale-flags",
      label: "Stale flags",
      value: data!.integrity.staleCheckedOutCount,
      detail: "Stored checked-out flags without active allocations.",
      icon: Wrench,
      tone: "warning" as const,
    }] : []),
    ...(totals.checkedOut > 0 ? [{
      id: "checked-out",
      label: "Checked out",
      value: totals.checkedOut,
      detail: "Battery units currently in active custody.",
      icon: PackageOpen,
      tone: "info" as const,
    }] : []),
  ] : [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Battery Ops">
        <Button className="h-10" variant="outline" onClick={() => void load({ refresh: true })} disabled={refreshing}>
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </PageHeader>

      {totals && (
        <OperationalStatusRail
          orientation={{
            label: "Tracked batteries",
            value: `${totals.total}`,
            icon: BatteryCharging,
          }}
          items={railItems}
          allClearLabel={railItems.length === 0 ? "Battery inventory is ready" : undefined}
          details={(
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <OperationalMetricCard label="Available" value={totals.available} tone="green" />
              <OperationalMetricCard label="Checked out" value={totals.checkedOut} tone="blue" />
              <OperationalMetricCard label="Missing" value={totals.lost} tone="red" />
              <OperationalMetricCard label="Retired" value={totals.retired} tone="muted" />
              <OperationalMetricCard label="Low families" value={totals.lowSkus} tone={totals.lowSkus ? "red" : "muted"} />
            </div>
          )}
        />
      )}

      {data && data.compatibility.length > 0 && (
        <Card className="border-[var(--orange)]/25 bg-[var(--orange-bg)]/40 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CircleAlert className="size-4 text-[var(--orange-text)]" />
                Compatible battery lows
              </CardTitle>
              <Badge variant="orange">{metricLabel(data.compatibility.length, "family", "families")}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-2">
              {data.compatibility.map((item) => (
                <CompatibilityRow key={item.ruleId} item={item} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.integrity.staleCheckedOutCount > 0 && (
        <IntegrityWarningCard
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
          <Card className="border-border/40 shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Checked-out units</CardTitle>
                {totals && totals.agingCheckedOut > 0 && (
                  <Badge variant="orange" className="gap-1">
                    <CircleAlert className="size-3" />
                    {metricLabel(totals.agingCheckedOut, "unit")} out 7d+
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {checkedOutUnits.length === 0 ? (
                <EmptyState
                  inline
                  icon="check"
                  title="No battery units checked out"
                  description="Checked-out battery units appear here with holder, booking, due date, and age."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead>Battery</TableHead>
                        <TableHead>Holder</TableHead>
                        <TableHead>Booking</TableHead>
                        <TableHead className="text-right">Age</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {checkedOutUnits.map((unit) => (
                        <TableRow key={unit.id}>
                          <TableCell className="font-mono tabular-nums">#{unit.unitNumber}</TableCell>
                          <TableCell>
                            <Link href={`/bulk-inventory/${unit.skuId}`} className="font-medium hover:underline">
                              {unit.skuName}
                            </Link>
                            <div className="text-xs text-muted-foreground">{unit.locationName}</div>
                          </TableCell>
                          <TableCell>{unit.booking?.requesterName ?? "Unknown"}</TableCell>
                          <TableCell>
                            {unit.booking ? (
                              <Link href={`/bookings?highlight=${unit.booking.id}`} className="inline-flex items-center gap-1 text-sm font-medium hover:underline">
                                {unit.booking.refNumber ?? unit.booking.title}
                                <ExternalLink className="size-3" />
                              </Link>
                            ) : (
                              <span className="text-sm text-muted-foreground">No booking context</span>
                            )}
                            {unit.booking && (
                              <div className="text-xs text-muted-foreground">Due {formatDue(unit.booking.endsAt)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {unit.checkedOutDays === null ? "n/a" : `${unit.checkedOutDays}d`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {unitSkus.map((sku) => (
              <Card key={sku.id} className="min-w-0 border-border/40 shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                        <BatteryCharging className="size-4 text-muted-foreground" />
                        <Link href={`/bulk-inventory/${sku.id}`} className="min-w-0 truncate hover:underline">
                          {sku.name}
                        </Link>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">{sku.location.name} / {sku.category}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {sku.isLow && <Badge variant="orange">Low stock</Badge>}
                      {sku.labelNeededCount > 0 && (
                        <Badge variant="secondary" className="gap-1">
                          <Tag className="size-3" />
                          {sku.labelNeededCount} need labels
                        </Badge>
                      )}
                      <Button className="h-10"
                        variant="outline"
                        disabled={exportingSkuId === sku.id}
                        onClick={() => void exportBrotherLabels(sku)}
                      >
                        <Download className="size-3.5" />
                        {exportingSkuId === sku.id ? "Exporting..." : "Brother CSV"}
                      </Button>
                      <Button className="h-10" variant="outline" onClick={() => openAddUnits(sku)}>
                        <Plus className="size-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Tag className="size-3.5" />
                    <span className="tabular-nums">
                      {sku.labelPrintedCount} of {sku.counts.total} labels printed
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <Count label="Avail" value={sku.counts.available} dot={STATUS_META.AVAILABLE.dot} />
                    <Count label="Out" value={sku.counts.checkedOut} dot={STATUS_META.CHECKED_OUT.dot} />
                    <Count label="Missing" value={sku.counts.lost} dot={STATUS_META.LOST.dot} />
                    <Count label="Retired" value={sku.counts.retired} dot={STATUS_META.RETIRED.dot} />
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(74px,1fr))] gap-2">
                    {sku.units.map((unit) => (
                      <UnitMenu
                        key={unit.id}
                        sku={sku}
                        unit={unit}
                        dataWarning={staleCheckedOutUnitIds.has(unit.id)}
                        busy={busyKey === `${sku.id}-${unit.unitNumber}`}
                        onPendingAction={openStatusAction}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {quantitySkus.length > 0 && (
            <Card className="border-border/40 shadow-none">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-base">Quantity-tracked batteries</CardTitle>
                  <Badge variant="secondary">{metricLabel(quantitySkus.length, "family", "families")}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {quantitySkus.map((sku) => (
                    <div key={sku.id} className="rounded-md border border-border/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/bulk-inventory/${sku.id}`} className="font-medium hover:underline">
                            {sku.name}
                          </Link>
                          <div className="mt-1 text-xs text-muted-foreground">{sku.location.name} / {sku.category}</div>
                        </div>
                        {sku.isLow && <Badge variant="orange" className="shrink-0">Low stock</Badge>}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Count label="Avail" value={sku.counts.available} dot={STATUS_META.AVAILABLE.dot} />
                        <Count label="Minimum" value={sku.threshold} dot="bg-[var(--orange)]" />
                      </div>
                      <Button variant="outline" className="h-10 mt-3 w-full" onClick={() => openQuantityAdjustment(sku)}>
                        <SlidersHorizontal className="size-3.5" />
                        Adjust
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
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

function Count({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", dot)} />
        {label}
      </div>
      <div className="mt-1 font-mono text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CompatibilityRow({ item }: { item: BatteryCompatibility }) {
  const shortage = Math.max(0, item.threshold - item.availableQuantity);
  const models = item.cameraModels.length > 0 ? item.cameraModels.join(", ") : "Matched camera inventory";
  const batteries = item.batterySkuNames.join(", ");

  return (
    <div className="rounded-md border border-[var(--orange)]/25 bg-background/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{item.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {models} / {metricLabel(item.cameraCount, "camera")} matched
          </div>
        </div>
        <Badge variant="orange" className="shrink-0">{shortage} short</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md bg-muted px-2 py-1 tabular-nums">
          {item.availableQuantity} available / {item.threshold} threshold
        </span>
        {batteries && <span className="rounded-md bg-muted px-2 py-1">{batteries}</span>}
      </div>
    </div>
  );
}

function IntegrityWarningCard({
  warnings,
  repairBusy,
  onRepair,
}: {
  warnings: BatteryIntegrityWarning[];
  repairBusy: boolean;
  onRepair: () => void;
}) {
  const visibleWarnings = warnings.slice(0, 8);
  const remaining = Math.max(0, warnings.length - visibleWarnings.length);

  return (
    <Card className="border-[var(--orange)]/25 bg-[var(--orange-bg)]/40 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CircleAlert className="size-4 text-[var(--orange-text)]" />
            Inventory data warnings
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="orange">{metricLabel(warnings.length, "unit")}</Badge>
            <Button className="h-10" variant="outline" onClick={onRepair} disabled={repairBusy}>
              <Wrench className="size-3.5" />
              {repairBusy ? "Repairing..." : "Repair flags"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          These units still have a stored checked-out flag but no active checkout allocation, so Battery Ops is counting them as available.
        </p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {visibleWarnings.map((warning) => (
            <Link
              key={warning.id}
              href={`/bulk-inventory/${warning.skuId}`}
              className="rounded-md border border-[var(--orange)]/25 bg-background/80 px-3 py-2 text-sm no-underline transition-colors hover:bg-background"
            >
              <div className="font-medium">{warning.skuName} #{warning.unitNumber}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{warning.locationName}</div>
            </Link>
          ))}
        </div>
        {remaining > 0 && (
          <div className="text-xs text-muted-foreground">
            {metricLabel(remaining, "more unit")} needs review.
          </div>
        )}
      </CardContent>
    </Card>
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
