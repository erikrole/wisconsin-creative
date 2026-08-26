"use client";

import type { Dispatch, SetStateAction } from "react";
import EquipmentPicker from "@/components/EquipmentPicker";
import type { BulkSelection, EquipmentPickerSelectionState } from "@/components/EquipmentPicker";
import type { EquipmentSectionKey } from "@/lib/equipment-sections";
import type { AvailableAsset, BulkSkuOption } from "@/components/booking-list/types";
import type { FormState } from "@/components/create-booking/types";
import { Badge } from "@/components/ui/badge";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { buildAvailabilityReview, getTurnaroundWarningTotal } from "./flow-summary";

type Props = {
  form: FormState;
  bulkSkus: BulkSkuOption[];
  selectedAssetIds: string[];
  setSelectedAssetIds: Dispatch<SetStateAction<string[]>>;
  selectedBulkItems: BulkSelection[];
  setSelectedBulkItems: Dispatch<SetStateAction<BulkSelection[]>>;
  onSelectedAssetsChange: (assets: AvailableAsset[]) => void;
  onSelectionStateChange: (state: EquipmentPickerSelectionState) => void;
  selectionState: EquipmentPickerSelectionState;
  itemCount: number;
  activeSection: EquipmentSectionKey;
  onActiveSectionChange: (section: EquipmentSectionKey) => void;
};

export function WizardStep2({
  form,
  bulkSkus,
  selectedAssetIds,
  setSelectedAssetIds,
  selectedBulkItems,
  setSelectedBulkItems,
  onSelectedAssetsChange,
  onSelectionStateChange,
  selectionState,
  itemCount,
  activeSection,
  onActiveSectionChange,
}: Props) {
  const availabilityReview = buildAvailabilityReview(selectionState);
  const turnaroundCount = getTurnaroundWarningTotal(selectionState);
  const hasWarnings = availabilityReview !== null;
  const hasUnavailable = selectionState.unresolvedAssetCount > 0;
  const hasConflicts = selectionState.conflictCount > 0;
  const showSelectionStatus = hasWarnings || hasUnavailable || selectionState.checkingAvailability || !!selectionState.availabilityError;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Equipment</h2>
        {itemCount > 0 && (
          <Badge variant="secondary" size="sm" className="tabular-nums">
            {itemCount} selected
          </Badge>
        )}
      </div>

      {showSelectionStatus && (
        <div className="rounded-md border border-border/60 bg-background px-3 py-2.5 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            {availabilityReview && !hasConflicts && (
              <Badge variant="orange" size="sm" className="gap-1.5 tabular-nums">
                <AlertCircleIcon data-icon="inline-start" />
                {availabilityReview.total} warning{availabilityReview.total !== 1 ? "s" : ""}
              </Badge>
            )}
            {hasConflicts && (
              <Badge variant="red" size="sm" className="gap-1.5 tabular-nums">
                <AlertCircleIcon data-icon="inline-start" />
                {selectionState.conflictCount} conflict{selectionState.conflictCount !== 1 ? "s" : ""}
              </Badge>
            )}
            {selectionState.upcomingCommitmentCount > 0 && (
              <Badge variant="blue" size="sm" className="gap-1.5 tabular-nums">
                {selectionState.upcomingCommitmentCount} needed next
              </Badge>
            )}
            {turnaroundCount > 0 && (
              <Badge variant="orange" size="sm" className="gap-1.5 tabular-nums">
                {turnaroundCount} turnaround
              </Badge>
            )}
            {hasUnavailable && (
              <Badge variant="orange" size="sm" className="gap-1.5 tabular-nums">
                <AlertCircleIcon data-icon="inline-start" />
                {selectionState.unresolvedAssetCount} unavailable
              </Badge>
            )}
            {selectionState.checkingAvailability && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                Rechecking availability
              </span>
            )}
          </div>
            {(hasWarnings || hasUnavailable || selectionState.availabilityError) && (
            <p className="mt-2 text-xs text-muted-foreground">
              {hasConflicts
                ? "Remove conflicted items or change the booking dates before review."
                : hasUnavailable
                ? "Remove unavailable items or pick replacements before review."
                : selectionState.availabilityError
                ? selectionState.availabilityError
                : "Review timing before submitting."}
            </p>
          )}
        </div>
      )}

      <EquipmentPicker
        bulkSkus={bulkSkus}
        selectedAssetIds={selectedAssetIds}
        setSelectedAssetIds={setSelectedAssetIds}
        selectedBulkItems={selectedBulkItems}
        setSelectedBulkItems={setSelectedBulkItems}
        startsAt={form.startsAt}
        endsAt={form.endsAt}
        locationId={form.locationId}
        bookingKind="RESERVATION"
        onSelectedAssetsChange={onSelectedAssetsChange}
        onSelectionStateChange={onSelectionStateChange}
        activeSection={activeSection}
        onActiveSectionChange={onActiveSectionChange}
      />
    </div>
  );
}
