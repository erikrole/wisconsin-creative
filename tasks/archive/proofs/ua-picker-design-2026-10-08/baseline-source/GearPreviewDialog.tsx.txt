"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dollarsToCents, formatUsd, gearSku, type GearCatalogItem } from "@/lib/gear-picks/catalog";
import { GearSwatches } from "./GearItemCard";

export type GearPreview =
  | { kind: "item"; item: GearCatalogItem; colorCode: string }
  | { kind: "kit"; name: string; label: string; sku: string; image: string };

export function GearPreviewDialog({
  preview,
  onOpenChange,
  onSelectColor,
}: {
  preview: GearPreview | null;
  onOpenChange: (open: boolean) => void;
  onSelectColor: (style: string, code: string) => void;
}) {
  const color =
    preview?.kind === "item"
      ? preview.item.colors.find((entry) => entry.code === preview.colorCode) ?? preview.item.colors[0]!
      : null;
  const image = preview?.kind === "item" ? color!.image : preview?.image;
  const name = preview?.kind === "item" ? preview.item.name : preview?.name;
  const badge = color?.imageNote ?? null;

  return (
    <Dialog open={Boolean(preview)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 sm:max-w-lg">
        {preview && image && name && (
          <>
            <div className="relative aspect-square w-full overflow-hidden bg-white sm:rounded-t-lg">
              <Image src={image} alt={color ? `${name} in ${color.label}` : name} fill sizes="512px" className="object-contain p-6" />
              {badge && (
                <Badge variant="gray" size="sm" className="absolute left-3 top-3">
                  {badge}
                </Badge>
              )}
            </div>
            <DialogHeader className="flex-col items-stretch gap-1 border-b-0 border-t pb-3 pr-6">
              <div className="flex items-start justify-between gap-3">
                <DialogTitle>{name}</DialogTitle>
                <span className="shrink-0 font-semibold tabular-nums">
                  {preview.kind === "item" ? formatUsd(dollarsToCents(preview.item.price)) : preview.label}
                </span>
              </div>
              <DialogDescription>
                {preview.kind === "item" && color
                  ? `${color.label} · ${gearSku(preview.item.style, color.code)}`
                  : preview.kind === "kit"
                    ? preview.sku
                    : null}
              </DialogDescription>
            </DialogHeader>
            {preview.kind === "item" && color && (
              <div className="px-6 pb-6">
                <GearSwatches
                  item={preview.item}
                  selectedCode={color.code}
                  onSelect={(code) => onSelectColor(preview.item.style, code)}
                />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
