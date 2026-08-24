import { AlertCircleIcon, XIcon } from "lucide-react";

import { AssetImage } from "@/components/AssetImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  BulkSelection,
  BulkTurnaroundRiskInfo,
  PickerAsset,
  PickerBulkSku,
  TurnaroundRiskInfo,
} from "@/components/EquipmentPicker";
import type { UpcomingCommitmentInfo } from "@/components/equipment-picker/use-conflict-check";

type SelectedEquipmentShelfProps = {
  totalSelected: number;
  deferredConflictsLoading: boolean;
  resolvedSelectedAssets: PickerAsset[];
  unresolvedSelectedAssetIds: string[];
  selectedBulkItems: BulkSelection[];
  bulkById: Map<string, PickerBulkSku>;
  conflicts: Map<string, unknown>;
  upcomingCommitments: Map<string, UpcomingCommitmentInfo>;
  turnaroundRisks: Map<string, TurnaroundRiskInfo[]>;
  bulkTurnaroundRisks: Map<string, BulkTurnaroundRiskInfo[]>;
  onClearAll: () => void;
  onRemoveAsset: (id: string) => void;
  onRemoveBulk: (bulkSkuId: string) => void;
};

function riskTitle(risks: Array<{ message: string }> | undefined) {
  return risks?.map((risk) => risk.message).join(" · ") || "Turnaround risk";
}

export function SelectedEquipmentShelf({
  totalSelected,
  deferredConflictsLoading,
  resolvedSelectedAssets,
  unresolvedSelectedAssetIds,
  selectedBulkItems,
  bulkById,
  conflicts,
  upcomingCommitments,
  turnaroundRisks,
  bulkTurnaroundRisks,
  onClearAll,
  onRemoveAsset,
  onRemoveBulk,
}: SelectedEquipmentShelfProps) {
  if (totalSelected <= 0) return null;

  return (
    <div className="border-t border-border/40 bg-background">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">Selected</span>
        <div className="ml-auto flex items-center gap-2">
          {deferredConflictsLoading && (
            <span className="text-[10px] text-muted-foreground">
              Checking availability...
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-10 text-xs" onClick={onClearAll}>
            Clear all
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-3 pb-3">
        {resolvedSelectedAssets.map((asset) => {
          const hasConflict = conflicts.has(asset.id);
          const hasUpcoming = upcomingCommitments.has(asset.id) && !hasConflict;
          const hasTurnaround = turnaroundRisks.has(asset.id) && !hasConflict;
          const stateLabel = hasConflict
            ? "Conflict"
            : hasUpcoming
              ? "Next use"
              : hasTurnaround
                ? "Turnaround"
                : null;
          return (
            <div
              key={asset.id}
              className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/25 py-1 pl-1 pr-1 shadow-xs"
            >
              <AssetImage src={asset.imageUrl} alt={asset.assetTag} size={28} />
              <span className="brand-identity max-w-[11rem] truncate text-sm font-medium">{asset.assetTag}</span>
              {stateLabel && (
                <Badge
                  variant={hasUpcoming ? "blue" : "orange"}
                  size="sm"
                  className="hidden shrink-0 sm:inline-flex"
                >
                  {stateLabel}
                </Badge>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-9 rounded-full"
                onClick={() => onRemoveAsset(asset.id)}
                aria-label={`Remove ${asset.assetTag}`}
              >
                <XIcon />
              </Button>
            </div>
          );
        })}
        {unresolvedSelectedAssetIds.map((id) => (
          <div
            key={id}
            className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-[var(--orange)]/30 bg-[var(--orange)]/[0.06] py-1 pl-3 pr-1 shadow-xs"
          >
            <AlertCircleIcon className="size-4 shrink-0 text-[var(--orange-text)]" />
            <span className="max-w-[13rem] truncate text-sm font-medium">Unavailable selected item</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-9 rounded-full"
              onClick={() => onRemoveAsset(id)}
              aria-label="Remove unavailable selected item"
            >
              <XIcon />
            </Button>
          </div>
        ))}
        {selectedBulkItems.map((item) => {
          const sku = bulkById.get(item.bulkSkuId);
          if (!sku) return null;
          const risks = bulkTurnaroundRisks.get(item.bulkSkuId);
          const hasTurnaround = (risks?.length ?? 0) > 0;
          return (
            <div
              key={item.bulkSkuId}
              className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/25 py-1 pl-1 pr-1 shadow-xs"
            >
              <AssetImage src={sku.imageUrl} alt={sku.name} size={28} />
              <span className="brand-identity max-w-[11rem] truncate text-sm font-medium">{sku.name}</span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                x{item.quantity}
              </span>
              {hasTurnaround && (
                <Badge variant="orange" size="sm" className="hidden shrink-0 sm:inline-flex" title={riskTitle(risks)}>
                  Turnaround
                </Badge>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-9 rounded-full"
                onClick={() => onRemoveBulk(sku.id)}
                aria-label={`Remove ${sku.name}`}
              >
                <XIcon />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
