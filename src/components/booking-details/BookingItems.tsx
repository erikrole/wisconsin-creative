"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { AssetImage } from "@/components/AssetImage";
import { CheckCircle2, Search } from "lucide-react";
import type { BookingDetail, SerializedItem, BulkItem } from "./types";

type Props = {
  booking: BookingDetail;
  equipSearch: string;
  onEquipSearchChange: (v: string) => void;
  filteredSerializedItems: SerializedItem[];
  filteredBulkItems: BulkItem[];
  canEditEquipment: boolean;
  canCheckin: boolean;
  checkinLoading: boolean;
  onEnterEquipEditMode: () => void;
  onCheckinItem?: (assetId: string) => void;
};

export default function BookingItems({
  booking,
  equipSearch,
  onEquipSearchChange,
  filteredSerializedItems,
  filteredBulkItems,
  canEditEquipment,
  canCheckin,
  checkinLoading,
  onEnterEquipEditMode,
  onCheckinItem,
}: Props) {
  const totalItems = (booking.serializedItems?.length ?? 0) + (booking.bulkItems?.length ?? 0);
  const showSearch = totalItems >= 4;
  const allEmpty = filteredSerializedItems.length === 0 && filteredBulkItems.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar + edit button */}
      <div className="flex items-center gap-2">
        {showSearch && (
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
	            <Input
	              id="booking-equipment-search"
	              name="bookingEquipmentSearch"
	              placeholder="Search equipment..."
	              aria-label="Search equipment"
	              value={equipSearch}
              onChange={(e) => onEquipSearchChange(e.target.value)}
              className="h-8 pl-8"
            />
          </div>
        )}
        {!showSearch && <div className="flex-1" />}
        {canEditEquipment && (
          <Button className="h-10" variant="outline" onClick={onEnterEquipEditMode}>
            Edit
          </Button>
        )}
      </div>

      {/* Unified item list */}
      {!allEmpty && (
        <Card elevation="flat" className="rounded-lg border-border/50 shadow-xs">
          <CardContent className="p-0 divide-y divide-border/40">
            {filteredSerializedItems.map((item) => {
              const isReturned = item.allocationStatus === "returned";
              const isPickedUp = booking.kind === "RESERVATION" && item.allocationStatus === "picked_up";
              const isInactive = isReturned || isPickedUp;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${isInactive ? "opacity-50" : ""}`}
                >
                  <AssetImage src={item.asset.imageUrl} alt={item.asset.assetTag} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/items/${item.asset.id}`}
                      className="text-sm font-semibold text-foreground no-underline hover:text-[var(--wi-red)] transition-colors truncate block"
                      style={{ fontFamily: "var(--font-heading)", fontWeight: 700 }}
                    >
                      {item.asset.assetTag}
                    </Link>
                    <div className="text-xs text-muted-foreground truncate">
                      {item.asset.name?.trim() || `${item.asset.brand} ${item.asset.model}`.trim()}
                    </div>
                  </div>
                  {canCheckin && onCheckinItem && !isPickedUp && (
                    <div className="shrink-0">
                      {isReturned ? (
                        <CheckCircle2 className="size-4 text-[var(--green-text)]" />
                      ) : (
                        <Button className="h-10"
                          variant="outline"
                          disabled={checkinLoading}
                          onClick={(e) => { e.stopPropagation(); onCheckinItem(item.asset.id); }}
                        >
                          Mark returned
                        </Button>
                      )}
                    </div>
                  )}
                  {isPickedUp && (
                    <Badge variant="blue" size="sm">
                      Picked up
                    </Badge>
                  )}
                  {!canCheckin && isReturned && (
                    <CheckCircle2 className="size-4 text-[var(--green-text)] shrink-0" />
                  )}
                </div>
              );
            })}

            {filteredBulkItems.map((item) => {
              const scannedOut = item.checkedOutQuantity;
              const scannedIn = item.checkedInQuantity;
              const isReservation = booking.kind === "RESERVATION";
              const pickedUpQty = isReservation
                ? Math.min(scannedOut, item.plannedQuantity)
                : 0;
              const remainingQty = isReservation
                ? Math.max(0, item.plannedQuantity - pickedUpQty)
                : 0;
              const isCompleted = booking.status === "COMPLETED";
              const isOpen = booking.status === "OPEN";
              const allOut = scannedOut >= item.plannedQuantity;
              const allIn = scannedIn >= scannedOut && scannedOut > 0;

              const assignedUnits = item.unitAllocations
                ?.map((a) => a.bulkSkuUnit.unitNumber)
                .sort((a, b) => a - b) ?? [];
              const showAssignedUnits = item.bulkSku.trackByNumber && assignedUnits.length > 0;

              return (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <AssetImage src={item.bulkSku.imageUrl} alt={item.bulkSku.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{item.bulkSku.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{item.bulkSku.category}</span>
                      {isReservation && pickedUpQty > 0 && (
                        <span className="text-[var(--blue-text)]">
                          · {remainingQty > 0 ? `${pickedUpQty} picked up · ${remainingQty} remaining` : "Picked up"}
                        </span>
                      )}
                      {showAssignedUnits && assignedUnits.map((unitNumber) => (
                        <Badge key={unitNumber} variant="outline" size="sm" className="font-mono tabular-nums">
                          #{unitNumber}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" size="sm">
                      {item.plannedQuantity} {item.bulkSku.unit}
                    </Badge>
                    {isOpen && booking.kind === "CHECKOUT" && scannedOut > 0 && (
                      <Badge variant={allOut ? "green" : "orange"} size="sm">
                        {scannedOut}/{item.plannedQuantity} out
                      </Badge>
                    )}
                    {isReservation && pickedUpQty > 0 && (
                      <Badge variant="blue" size="sm">
                        {pickedUpQty}/{item.plannedQuantity} picked up
                      </Badge>
                    )}
                    {isCompleted && scannedOut > 0 && (
                      <Badge variant={allIn ? "green" : "orange"} size="sm">
                        {scannedIn}/{scannedOut} in
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {allEmpty && (
        <Empty className="py-10 border-0">
          <EmptyDescription>
            {equipSearch ? "No items match your search" : "No equipment in this booking"}
          </EmptyDescription>
        </Empty>
      )}
    </div>
  );
}
