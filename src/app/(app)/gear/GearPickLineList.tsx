"use client";

import Image from "next/image";
import { AlertTriangleIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findGearSku, formatUsd } from "@/lib/gear-picks/catalog";
import { cn } from "@/lib/utils";

export type GearPickListLine = {
  id: string;
  sku: string;
  size: string | null;
  quantity: number;
  /** Saved price snapshot; the catalog price is used when absent (unsaved drafts). */
  unitPriceCents?: number;
};

/**
 * Photo rows for a pick list: name, color, size, quantity, and line price.
 * Rows jump to the catalog card when `onJump` is set and show a remove button
 * when `onRemoveLine` is set; without either the list is read-only.
 */
export function GearPickLineList({
  lines,
  onJump,
  onRemoveLine,
  className,
}: {
  lines: GearPickListLine[];
  onJump?: (style: string) => void;
  onRemoveLine?: (id: string) => void;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {lines.map((line) => {
        const entry = findGearSku(line.sku);
        if (!entry) {
          return (
            <li key={line.id} className="flex items-center gap-3 px-6 py-3 text-sm">
              <span className="min-w-0 flex-1 text-[var(--orange-text)]">{line.sku} is no longer in the catalog.</span>
              {onRemoveLine && <RemoveButton label={line.sku} onClick={() => onRemoveLine(line.id)} />}
            </li>
          );
        }
        const unitPriceCents = line.unitPriceCents ?? entry.unitPriceCents;
        const needsSize = entry.sizeKind === "APPAREL" && !line.size;
        const content = (
          <>
            <span className="relative size-16 shrink-0 overflow-hidden rounded-md bg-white">
              <Image src={entry.color.image} alt="" fill sizes="64px" className="object-contain p-1" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug text-foreground">{entry.item.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{entry.color.label}</span>
              <span
                className={cn(
                  "mt-0.5 flex items-center gap-1 text-xs",
                  needsSize ? "font-medium text-[var(--orange-text)]" : "text-muted-foreground",
                )}
              >
                {needsSize && <AlertTriangleIcon className="size-3 shrink-0" aria-hidden="true" />}
                {entry.sizeKind === "HEADWEAR" ? "One size" : needsSize ? "Choose a size" : `Size ${line.size}`}
                {` · Qty ${line.quantity}`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums">{formatUsd(unitPriceCents * line.quantity)}</span>
              {line.quantity > 1 && (
                <span className="block text-[11px] tabular-nums text-muted-foreground">
                  {formatUsd(unitPriceCents)} each
                </span>
              )}
            </span>
          </>
        );
        return (
          <li key={line.id} className="flex items-center gap-3 px-6 py-3">
            {onJump ? (
              <button
                type="button"
                onClick={() => onJump(entry.item.style)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={`${entry.item.name}, ${entry.color.label}. Show it in the catalog.`}
              >
                {content}
              </button>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
            )}
            {onRemoveLine && (
              <RemoveButton label={`${entry.item.name} ${line.size ?? ""}`} onClick={() => onRemoveLine(line.id)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-10 shrink-0"
      aria-label={`Remove ${label.trim()}`}
      onClick={onClick}
    >
      <Trash2Icon className="size-4" />
    </Button>
  );
}
