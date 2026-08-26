"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AssetImage } from "@/components/AssetImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertCircle, Check, ImageIcon, MoreHorizontal, Search } from "lucide-react";
import { StaggerList, StaggerItem } from "@/components/ui/motion";
import { toast } from "sonner";
import type { BookingDetail, SerializedItem, BulkItem } from "@/components/booking-details/types";
import { handleAuthRedirect, isAbortError, parseJsonSafely } from "@/lib/errors";
import {
  availabilityConflictMessage,
  availabilityRiskBadgeLabel,
  availabilityRiskMessage,
  availabilityRiskTitle,
  upcomingCommitmentLabel,
  upcomingCommitmentTitle,
} from "@/lib/availability-copy";

type ConflictInfo = {
  assetId: string;
  conflictingBookingId?: string;
  conflictingBookingTitle?: string;
  startsAt: string;
  endsAt: string;
};

type UpcomingCommitmentInfo = {
  assetId: string;
  bookingId: string;
  bookingTitle?: string;
  startsAt: string;
  endsAt: string;
  status: string;
  nextLocationId?: string | null;
  nextLocationName?: string | null;
};

type TurnaroundRiskInfo = {
  assetId: string;
  code: "SHORT_TURNAROUND" | "LOCATION_TRANSFER" | "RECENT_CHECKIN_REPORT";
  severity: "warning" | "critical";
  message: string;
  bookingId?: string;
  bookingTitle?: string;
  startsAt?: string;
  gapMinutes?: number;
  nextLocationName?: string | null;
  reportType?: "DAMAGED" | "LOST";
  reportCreatedAt?: string;
};

type BulkTurnaroundRiskInfo = {
  bulkSkuId: string;
  code: "BULK_SHORT_TURNAROUND";
  severity: "warning" | "critical";
  message: string;
  bookingId: string;
  bookingTitle?: string;
  startsAt: string;
  gapMinutes: number;
  plannedQuantity: number;
};

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

export default function BookingEquipmentTab({
  booking,
}: {
  booking: BookingDetail;
}) {
  const [search, setSearch] = useState("");
  const isCheckout = booking.kind === "CHECKOUT";

  const itemCount = booking.serializedItems.length + booking.bulkItems.length;

  // Checkin progress for checkouts
  const returnedSerialized = booking.serializedItems.filter(
    (i) => i.allocationStatus === "returned",
  ).length;
  // checkedOutQuantity is a non-nullable Int defaulting to 0 — it stays 0 until
  // pickup, so fall back to plannedQuantity until something is actually checked out.
  const totalBulkOut = booking.bulkItems.reduce(
    (sum, i) => sum + (i.checkedOutQuantity > 0 ? i.checkedOutQuantity : i.plannedQuantity),
    0,
  );
  const totalBulkIn = booking.bulkItems.reduce(
    (sum, i) => sum + (i.checkedInQuantity ?? 0),
    0,
  );
  const totalOut = booking.serializedItems.length + totalBulkOut;
  const totalReturned = returnedSerialized + totalBulkIn;
  const showProgress = isCheckout && totalReturned > 0 && totalOut > 0;

  // ── Conflict checking for active bookings ──
  const isActive = ["BOOKED", "DRAFT", "PENDING_PICKUP", "OPEN"].includes(booking.status);
  const [conflicts, setConflicts] = useState<Map<string, ConflictInfo>>(new Map());
  const [upcomingCommitments, setUpcomingCommitments] = useState<Map<string, UpcomingCommitmentInfo>>(new Map());
  const [turnaroundRisks, setTurnaroundRisks] = useState<Map<string, TurnaroundRiskInfo[]>>(new Map());
  const [bulkTurnaroundRisks, setBulkTurnaroundRisks] = useState<Map<string, BulkTurnaroundRiskInfo[]>>(new Map());
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchConflicts = useCallback(async () => {
    if (!isActive || (booking.serializedItems.length === 0 && booking.bulkItems.length === 0)) {
      setConflicts(new Map());
      setUpcomingCommitments(new Map());
      setTurnaroundRisks(new Map());
      setBulkTurnaroundRisks(new Map());
      setAvailabilityError(null);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAvailabilityError(null);

    try {
      const res = await fetch("/api/availability/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          locationId: booking.location.id,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          serializedAssetIds: booking.serializedItems.map((i) => i.asset.id),
          bulkItems: booking.bulkItems.map((item) => ({
            bulkSkuId: item.bulkSku.id,
            quantity: item.plannedQuantity,
          })),
          excludeBookingId: booking.id,
          kind: booking.kind === "CHECKOUT" ? "CHECKOUT" : "RESERVATION",
        }),
      });
      if (controller.signal.aborted) return;
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        setAvailabilityError("Availability could not be refreshed. Showing the last known result.");
        return;
      }
      const json = await parseJsonSafely<{
        conflicts?: Array<{ assetId: string; conflictingBookingTitle?: string; startsAt: string; endsAt: string }>;
        upcomingCommitments?: UpcomingCommitmentInfo[];
        turnaroundRisks?: TurnaroundRiskInfo[];
        bulkTurnaroundRisks?: BulkTurnaroundRiskInfo[];
      }>(res);
      // The availability route returns its result at the top level.
      const data = json;
      if (!data) {
        setAvailabilityError("Availability could not be refreshed. Showing the last known result.");
        return;
      }
      const conflictMap = new Map<string, ConflictInfo>();
      if (data.conflicts) {
        for (const c of data.conflicts) {
          conflictMap.set(c.assetId, {
            assetId: c.assetId,
            conflictingBookingTitle: c.conflictingBookingTitle,
            startsAt: c.startsAt,
            endsAt: c.endsAt,
          });
        }
      }
      const upcomingMap = new Map<string, UpcomingCommitmentInfo>();
      for (const c of data.upcomingCommitments ?? []) {
        upcomingMap.set(c.assetId, c);
      }
      const riskMap = new Map<string, TurnaroundRiskInfo[]>();
      for (const risk of data.turnaroundRisks ?? []) {
        riskMap.set(risk.assetId, [...(riskMap.get(risk.assetId) ?? []), risk]);
      }
      const bulkRiskMap = new Map<string, BulkTurnaroundRiskInfo[]>();
      for (const risk of data.bulkTurnaroundRisks ?? []) {
        bulkRiskMap.set(risk.bulkSkuId, [...(bulkRiskMap.get(risk.bulkSkuId) ?? []), risk]);
      }
      setConflicts(conflictMap);
      setUpcomingCommitments(upcomingMap);
      setTurnaroundRisks(riskMap);
      setBulkTurnaroundRisks(bulkRiskMap);
      setAvailabilityError(null);
    } catch (err) {
      if (isAbortError(err)) return;
      setAvailabilityError("Availability could not be refreshed. Showing the last known result.");
      toast.error("Failed to check equipment availability — try refreshing.");
    }
  }, [isActive, booking.id, booking.kind, booking.location.id, booking.startsAt, booking.endsAt, booking.serializedItems, booking.bulkItems]);

  useEffect(() => {
    fetchConflicts();
    return () => { abortRef.current?.abort(); };
  }, [fetchConflicts]);

  const filteredSerialized = useMemo(() => {
    if (!search) return booking.serializedItems;
    const q = search.toLowerCase();
    return booking.serializedItems.filter(
      (item) =>
        item.asset.assetTag.toLowerCase().includes(q) ||
        item.asset.brand?.toLowerCase().includes(q) ||
        item.asset.model?.toLowerCase().includes(q) ||
        item.asset.serialNumber?.toLowerCase().includes(q),
    );
  }, [booking.serializedItems, search]);

  const filteredBulk = useMemo(() => {
    if (!search) return booking.bulkItems;
    const q = search.toLowerCase();
    return booking.bulkItems.filter((item) =>
      item.bulkSku.name.toLowerCase().includes(q),
    );
  }, [booking.bulkItems, search]);

  return (
    <Card elevation="flat" className="rounded-xl border-border/50 shadow-xs">
      {/* Header */}
      <CardHeader className="pb-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base tracking-tight">Equipment</CardTitle>
              <Badge variant="secondary" size="sm" className="tabular-nums">
                {itemCount} item{itemCount !== 1 ? "s" : ""}
              </Badge>
            </div>
            {showProgress && (
              <div className="flex items-center gap-2 mt-1">
                <Progress
                  value={Math.round((totalReturned / totalOut) * 100)}
                  className="h-1.5 bg-muted [&>[data-slot=progress-indicator]]:bg-[var(--green)]"
                />
                <span className="text-xs text-muted-foreground shrink-0">
                  {totalReturned}/{totalOut} returned
                </span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      {availabilityError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-[var(--orange)]/30 bg-[var(--orange)]/[0.06] px-3 py-2.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--orange-text)]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Availability check unavailable</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{availabilityError}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" onClick={() => void fetchConflicts()}>
            Retry
          </Button>
        </div>
      )}

      {/* Search */}
      {itemCount > 3 && (
        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
	            <Input
	              id="booking-detail-equipment-search"
	              name="bookingDetailEquipmentSearch"
	              placeholder="Search equipment..."
	              aria-label="Search equipment"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8"
            />
          </div>
        </div>
      )}

      {/* Item list */}
      <div className="p-2 pt-3">
        {filteredSerialized.length === 0 && filteredBulk.length === 0 ? (
          <Empty className="py-8 border-0">
            <EmptyDescription>
              {search ? "No items match your search." : "No items in this booking."}
            </EmptyDescription>
          </Empty>
        ) : (
          <StaggerList className="flex flex-col gap-0.5">
            {filteredSerialized.map((item) => (
              <StaggerItem key={item.id}>
                <SerializedRow
                  item={item}
                  isCheckout={isCheckout}
                  conflict={conflicts.get(item.asset.id)}
                  upcoming={upcomingCommitments.get(item.asset.id)}
                  risks={turnaroundRisks.get(item.asset.id)}
                  currentStartsAt={booking.startsAt}
                  currentEndsAt={booking.endsAt}
                />
              </StaggerItem>
            ))}
            {filteredBulk.map((item) => (
              <StaggerItem key={item.id}>
                <BulkRow
                  item={item}
                  isCheckout={isCheckout}
                  risks={bulkTurnaroundRisks.get(item.bulkSku.id)}
                />
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </div>
    </Card>
  );
}

/* ── Thumbnail helper ── */

function ItemThumbnail({ src, alt }: { src?: string | null; alt: string }) {
  return <AssetImage src={src} alt={alt} size={40} />;
}

/* ── Serialized item row ── */

function SerializedRow({
  item,
  isCheckout,
  conflict,
  upcoming,
  risks,
  currentStartsAt,
  currentEndsAt,
}: {
  item: SerializedItem;
  isCheckout: boolean;
  conflict?: ConflictInfo;
  upcoming?: UpcomingCommitmentInfo;
  risks?: TurnaroundRiskInfo[];
  currentStartsAt: string;
  currentEndsAt: string;
}) {
  const returned = item.allocationStatus === "returned";
  const risk = primaryRisk(risks);
  const riskText = riskLabel(risks);

  return (
    <div className={`group/row flex items-center gap-3 px-3 py-2.5 rounded-md ${returned ? "opacity-60" : "hover:bg-muted/50"}`}>
      {/* Returned indicator */}
      {isCheckout && returned && (
        <div className="shrink-0">
          <div className="size-5 rounded-full bg-[var(--green-text)] text-white flex items-center justify-center">
            <Check className="size-3" />
          </div>
        </div>
      )}

      {/* Thumbnail */}
      <ItemThumbnail src={item.asset.imageUrl} alt={item.asset.assetTag} />

      {/* Info */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/items/${item.asset.id}`}
          className="font-medium text-sm hover:underline truncate block"
        >
          {item.asset.assetTag}
        </Link>
        <div className="text-xs text-muted-foreground truncate">
          {item.asset.brand} {item.asset.model}
          {item.asset.serialNumber && (
            <span className="ml-1.5 font-mono">{item.asset.serialNumber}</span>
          )}
        </div>
        {upcoming && !conflict && !returned && (
          <div className="truncate text-[11px] text-[var(--blue-text)]">
            {upcomingCommitmentLabel(upcoming, currentEndsAt)}
            {upcoming.bookingTitle ? ` · ${upcoming.bookingTitle}` : ""}
          </div>
        )}
        {riskText && !conflict && !returned && (
          <div className={`truncate text-[11px] ${risk?.severity === "critical" ? "text-[var(--red-text)]" : "text-[var(--orange-text)]"}`}>
            {riskText}
          </div>
        )}
        {conflict && !returned && (
          <div className="truncate text-[11px] text-[var(--red-text)]" title={availabilityConflictMessage(conflict, { currentStartsAt, currentEndsAt })}>
            {availabilityConflictMessage(conflict, { currentStartsAt, currentEndsAt })}
          </div>
        )}
      </div>

      {/* Status + row actions */}
      <div className="shrink-0 flex items-center gap-1.5">
        {conflict && !returned && (
          <Badge
            variant="red"
            size="sm"
            title={availabilityConflictMessage(conflict, { currentStartsAt, currentEndsAt })}
          >
            Conflict
          </Badge>
        )}
        {upcoming && !conflict && !returned && (
          <Badge
            variant="blue"
            size="sm"
            title={
              upcomingCommitmentTitle(upcoming)
            }
          >
            Needed next
          </Badge>
        )}
        {risk && !conflict && !returned && (
          <Badge
            variant={risk.severity === "critical" ? "red" : "orange"}
            size="sm"
            title={riskTitle(risks)}
          >
            {availabilityRiskBadgeLabel(risk)}
          </Badge>
        )}
        {returned && (
          <span className="text-xs font-medium text-[var(--green-text)]">
            Returned
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="size-7 flex items-center justify-center rounded-md hover:bg-muted/80 text-muted-foreground sm:opacity-0 sm:group-hover/row:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity">
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Item actions</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/items/${item.asset.id}`}>View item</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ── Bulk item row ── */

function BulkRow({
  item,
  isCheckout,
  risks,
}: {
  item: BulkItem;
  isCheckout: boolean;
  risks?: BulkTurnaroundRiskInfo[];
}) {
  // checkedOutQuantity is 0 (not null) until pickup — show planned quantity until
  // then, and only mark "Returned" once something was actually checked out.
  const outQty = item.checkedOutQuantity > 0 ? item.checkedOutQuantity : item.plannedQuantity;
  const inQty = item.checkedInQuantity ?? 0;
  const allReturned = isCheckout && item.checkedOutQuantity > 0 && inQty >= outQty;
  const riskText = riskLabel(risks);
  const risk = primaryRisk(risks);

  // Unit-tracked bulk SKUs (e.g. numbered batteries) carry specific unit numbers.
  const assignedUnits =
    item.unitAllocations
      ?.map((a) => a.bulkSkuUnit.unitNumber)
      .sort((a, b) => a - b) ?? [];
  const showUnits = item.bulkSku.trackByNumber && assignedUnits.length > 0;

  return (
    <div className={`group/row flex items-center gap-3 px-3 py-2.5 rounded-md ${allReturned ? "opacity-60" : "hover:bg-muted/50"}`}>
      {/* Returned indicator */}
      {isCheckout && allReturned && (
        <div className="shrink-0">
          <div className="size-5 rounded-full bg-[var(--green-text)] text-white flex items-center justify-center">
            <Check className="size-3" />
          </div>
        </div>
      )}

      {/* Thumbnail */}
      {item.bulkSku.imageUrl ? (
        <ItemThumbnail src={item.bulkSku.imageUrl} alt={item.bulkSku.name} />
      ) : (
        <div className="size-10 rounded-md bg-muted flex items-center justify-center shrink-0">
          <ImageIcon className="size-4 text-muted-foreground/50" />
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-sm truncate block">
          {item.bulkSku?.name ?? "Unknown"}
        </span>
        <div className="text-xs text-muted-foreground">
          {isCheckout && inQty > 0
            ? `${inQty} / ${outQty} returned`
            : `Qty: ${isCheckout ? outQty : item.plannedQuantity}`}{" "}
          <span className="text-muted-foreground/60">{item.bulkSku.unit}</span>
        </div>
        {showUnits && (
          <div className="mt-1 flex flex-wrap gap-1">
            {assignedUnits.map((n) => (
              <span
                key={n}
                className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
              >
                #{n}
              </span>
            ))}
          </div>
        )}
        {riskText && !allReturned && (
          <div className="truncate text-[11px] text-[var(--orange-text)]">
            {riskText}
          </div>
        )}
      </div>

      {/* Status */}
      <div className="shrink-0 flex items-center gap-2">
        {risks && risks.length > 0 && !allReturned && (
          <Badge variant={risk?.severity === "critical" ? "red" : "orange"} size="sm" title={riskTitle(risks)}>
            {risk ? availabilityRiskBadgeLabel(risk) : "Notice"}
          </Badge>
        )}
        {allReturned && (
          <span className="text-xs font-medium text-[var(--green-text)]">
            Returned
          </span>
        )}
      </div>
    </div>
  );
}
