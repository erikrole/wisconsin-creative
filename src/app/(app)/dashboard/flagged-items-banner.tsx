"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangleIcon, ImageIcon, WrenchIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import type { FlaggedItem } from "../dashboard-types";

type Props = {
  items: FlaggedItem[];
  onChanged: () => void;
};

type FlagType = FlaggedItem["type"];

const TYPE_CONFIG = {
  DAMAGED: { label: "Damaged", variant: "orange" as const },
  LOST: { label: "Lost", variant: "red" as const },
  MAINTENANCE: { label: "Maintenance", variant: "orange" as const },
};

// Most severe first: a lost or damaged asset is shown ahead of one only in maintenance.
const SEVERITY: Record<FlagType, number> = {
  LOST: 0,
  DAMAGED: 1,
  MAINTENANCE: 2,
};

const ROW_CLASS =
  "flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2.5 text-left text-inherit no-underline transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50";

type FlaggedAsset = {
  assetId: string;
  assetTag: string;
  assetName: string | null;
  bookingTitle: string | null;
  imageUrl: string | null;
  types: FlagType[];
  // The most severe lost or damaged report, opened by the review dialog.
  report: FlaggedItem | null;
  // Damage report IDs behind this row; dismissing the row dismisses all of them.
  damageReportIds: string[];
};

// One row per asset: an asset flagged as both damaged and in maintenance shows once.
function groupByAsset(items: FlaggedItem[]): FlaggedAsset[] {
  const byAsset = new Map<string, FlaggedAsset>();
  for (const item of items) {
    const existing = byAsset.get(item.assetId);
    const damageReportIds = item.type === "DAMAGED" ? [item.id] : [];
    const report = item.type === "MAINTENANCE" ? null : item;
    if (existing) {
      if (!existing.types.includes(item.type)) existing.types.push(item.type);
      existing.imageUrl = existing.imageUrl ?? item.imageUrl ?? null;
      existing.bookingTitle = existing.bookingTitle ?? item.bookingTitle;
      existing.damageReportIds.push(...damageReportIds);
      if (report && (!existing.report || SEVERITY[report.type] < SEVERITY[existing.report.type])) {
        existing.report = report;
      }
    } else {
      byAsset.set(item.assetId, {
        assetId: item.assetId,
        assetTag: item.assetTag,
        assetName: item.assetName,
        bookingTitle: item.bookingTitle,
        imageUrl: item.imageUrl ?? null,
        types: [item.type],
        report,
        damageReportIds,
      });
    }
  }
  return [...byAsset.values()]
    .map((asset) => ({
      ...asset,
      types: [...asset.types].sort((a, b) => SEVERITY[a] - SEVERITY[b]),
    }))
    .sort(
      (a, b) =>
        Math.min(...a.types.map((t) => SEVERITY[t])) -
        Math.min(...b.types.map((t) => SEVERITY[t])),
    );
}

export function FlaggedItemsBanner({ items, onChanged }: Props) {
  const confirmDialog = useConfirm();
  const [reviewing, setReviewing] = useState<FlaggedItem | null>(null);
  const [dismissingAssetId, setDismissingAssetId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const onlyMaintenance = items.every((i) => i.type === "MAINTENANCE");
  const inventoryHref = onlyMaintenance ? "/items?status=MAINTENANCE" : "/items";
  const inventoryLabel = onlyMaintenance ? "View maintenance →" : "Open inventory →";

  const damaged = items.filter((i) => i.type === "DAMAGED").length;
  const lost = items.filter((i) => i.type === "LOST").length;
  const maintenance = items.filter((i) => i.type === "MAINTENANCE").length;

  const parts: string[] = [];
  if (damaged > 0) parts.push(`${damaged} damaged`);
  if (lost > 0) parts.push(`${lost} lost`);
  if (maintenance > 0) parts.push(`${maintenance} maintenance`);

  const assets = groupByAsset(items);
  const hiddenCount = assets.length - 5;

  async function dismissDamage(asset: FlaggedAsset) {
    if (dismissingAssetId) return;
    const ok = await confirmDialog({
      title: "Dismiss damage flag",
      message: `Hide the damage flag on ${asset.assetTag} from the dashboard? The report stays in the item's history.`,
      confirmLabel: "Dismiss",
    });
    if (!ok) return;

    setDismissingAssetId(asset.assetId);
    try {
      for (const reportId of asset.damageReportIds) {
        const res = await fetch(`/api/checkin-reports/${reportId}/dismiss`, {
          method: "POST",
        });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          toast.error(await parseErrorMessage(res, "Couldn't dismiss the damage flag"));
          return;
        }
      }
    } catch {
      toast.error("Couldn't dismiss the damage flag. Check your connection and try again.");
    } finally {
      // Refresh even on a partial failure so dismissed reports leave the list.
      setDismissingAssetId(null);
      onChanged();
    }
  }

  return (
    <div className="relative mb-4 overflow-hidden rounded-lg border border-[var(--orange)]/20 bg-[var(--orange)]/[0.04] dark:bg-[var(--orange)]/[0.08]">
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--orange)]"
        aria-hidden="true"
      />

      {/* Header */}
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--orange)]/15 px-4">
        <div className="flex items-center gap-2">
          <AlertTriangleIcon className="size-3.5 text-[var(--orange-text)] shrink-0" />
          <span
            className="text-[11px] uppercase tracking-[0.14em] text-[var(--orange-text)] font-semibold"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {parts.join(" · ")}
          </span>
        </div>
        <Link
          href={inventoryHref}
          className="flex min-h-10 items-center whitespace-nowrap rounded-sm text-[10.5px] text-muted-foreground/60 no-underline transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {inventoryLabel}
        </Link>
      </div>

      {/* Asset rows */}
      <div className="flex flex-col">
        {assets.slice(0, 5).map((asset) => {
          const report = asset.report;
          const content = (
            <>
              {report ? (
                <AlertTriangleIcon className="size-3.5 text-[var(--orange-text)]/70 shrink-0" />
              ) : (
                <WrenchIcon className="size-3.5 text-muted-foreground/50 shrink-0" />
              )}
              <span
                className="text-[13px] font-semibold truncate min-w-0"
                style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}
              >
                {asset.assetTag}
                {asset.assetName && (
                  <span className="font-normal text-muted-foreground ml-1.5">
                    {asset.assetName}
                  </span>
                )}
              </span>
              {asset.types.map((type) => (
                <Badge key={type} variant={TYPE_CONFIG[type].variant} size="sm" className="shrink-0">
                  {TYPE_CONFIG[type].label}
                </Badge>
              ))}
              {asset.imageUrl && (
                <Badge variant="secondary" size="sm" className="shrink-0 gap-1">
                  <ImageIcon className="size-3" />
                  Photo
                </Badge>
              )}
              {asset.bookingTitle && (
                <span
                  className="text-[10.5px] text-muted-foreground/50 truncate ml-auto hidden sm:inline"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {asset.bookingTitle}
                </span>
              )}
            </>
          );
          return (
            <div
              key={asset.assetId}
              className="flex min-h-10 items-center gap-2 border-b border-[var(--orange)]/10 last:border-b-0 hover:bg-[var(--orange)]/[0.07]"
            >
              {report ? (
                <button
                  type="button"
                  onClick={() => setReviewing(report)}
                  className={ROW_CLASS}
                  aria-label={`Review ${TYPE_CONFIG[report.type].label.toLowerCase()} report for ${asset.assetTag}`}
                >
                  {content}
                </button>
              ) : (
                <Link href={`/items/${asset.assetId}`} className={ROW_CLASS}>
                  {content}
                </Link>
              )}
              {asset.damageReportIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => void dismissDamage(asset)}
                  disabled={dismissingAssetId !== null}
                  aria-label={`Dismiss damage flag on ${asset.assetTag}`}
                  className="mr-2 flex size-10 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <Link
            href={inventoryHref}
            className="flex min-h-10 items-center px-4 py-2.5 text-[10.5px] text-muted-foreground/60 no-underline transition-colors hover:text-muted-foreground"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            +{hiddenCount} more
          </Link>
        )}
      </div>

      <FlaggedReportDialog item={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}

function FlaggedReportDialog({ item, onClose }: { item: FlaggedItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const inMaintenance = item?.assetStatus === "MAINTENANCE";

  async function toggleMaintenance() {
    if (!item || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${item.assetId}/maintenance`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Couldn't update maintenance"));
        return;
      }
      toast.success(inMaintenance ? "Maintenance cleared" : "Flagged for maintenance");
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    } catch {
      toast.error("Couldn't update maintenance");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>
                {item.type === "LOST" ? "Lost" : "Damage"} report: {item.assetTag}
              </DialogTitle>
              <DialogDescription>
                {[item.assetName, item.bookingTitle, item.reportedBy && `Reported by ${item.reportedBy}`]
                  .filter(Boolean)
                  .join(" · ")}
              </DialogDescription>
            </DialogHeader>
            {item.imageUrl ? (
              <a href={item.imageUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- report photos are arbitrary blob URLs */}
                <img
                  src={item.imageUrl}
                  alt={`Photo of reported ${item.type === "LOST" ? "loss" : "damage"} on ${item.assetTag}`}
                  className="max-h-80 w-full rounded-md border object-contain"
                />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No photo was attached to this report.</p>
            )}
            {item.description && <p className="whitespace-pre-wrap text-sm">{item.description}</p>}
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link href={`/items/${item.assetId}`}>Open item</Link>
              </Button>
              <Button onClick={toggleMaintenance} disabled={busy}>
                {inMaintenance ? "Clear maintenance" : "Needs maintenance"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
