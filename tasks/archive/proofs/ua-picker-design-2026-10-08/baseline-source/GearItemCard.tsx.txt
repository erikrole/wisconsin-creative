"use client";

import Image from "next/image";
import { AlertTriangleIcon, MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  dollarsToCents,
  formatUsd,
  gearSku,
  GEAR_MAX_QUANTITY,
  sizeKindForCategory,
  type GearCatalogItem,
} from "@/lib/gear-picks/catalog";
import { cn } from "@/lib/utils";
import { sizeOptionsFor, type DraftLine } from "./gear-pick-state";

export function gearItemAnchorId(style: string) {
  return `gear-item-${style}`;
}

export function GearSwatches({
  item,
  selectedCode,
  onSelect,
  onPhoto = false,
  className,
}: {
  item: GearCatalogItem;
  selectedCode: string;
  onSelect: (code: string) => void;
  /** Sits on the white product photo, so it uses light styling in either theme (dark swatches stay readable). */
  onPhoto?: boolean;
  className?: string;
}) {
  if (item.colors.length < 2) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5",
        onPhoto && "gap-1 rounded-full bg-white/90 p-1 shadow-[0_1px_3px_rgba(0,0,0,0.18)] backdrop-blur-sm",
        className,
      )}
      role="group"
      aria-label={`${item.name} colors`}
    >
      {item.colors.map((color) => {
        const selected = color.code === selectedCode;
        return (
          <button
            key={color.code}
            type="button"
            aria-pressed={selected}
            aria-label={`${color.label} (${color.code})`}
            title={color.label}
            onClick={() => onSelect(color.code)}
            className={cn(
              "relative size-7 rounded-full border shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-shadow focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              onPhoto ? "size-6 border-black/15" : "border-border",
              selected &&
                (onPhoto
                  ? "ring-2 ring-neutral-900 ring-offset-2 ring-offset-white"
                  : "ring-2 ring-foreground ring-offset-2 ring-offset-background"),
            )}
            style={{ backgroundColor: color.swatch }}
          />
        );
      })}
    </div>
  );
}

export function GearItemCard({
  item,
  selectedCode,
  lines,
  readOnly,
  onSelectColor,
  onPreview,
  onAddLine,
  onChangeLine,
  onRemoveLine,
}: {
  item: GearCatalogItem;
  selectedCode: string;
  /** Every draft line for this style, across colors. */
  lines: DraftLine[];
  readOnly: boolean;
  onSelectColor: (code: string) => void;
  onPreview: () => void;
  onAddLine: (sku: string) => void;
  onChangeLine: (id: string, patch: Partial<Pick<DraftLine, "size" | "quantity">>) => void;
  onRemoveLine: (id: string) => void;
}) {
  const color = item.colors.find((entry) => entry.code === selectedCode) ?? item.colors[0]!;
  const sku = gearSku(item.style, color.code);
  const sizeKind = sizeKindForCategory(item.category);
  const colorLines = lines.filter((line) => line.sku === sku);
  const otherColors = item.colors
    .filter((entry) => entry.code !== color.code)
    .map((entry) => {
      const quantity = lines
        .filter((line) => line.sku === gearSku(item.style, entry.code))
        .reduce((sum, line) => sum + line.quantity, 0);
      return quantity > 0 ? `${entry.label} ×${quantity}` : null;
    })
    .filter(Boolean);
  const picked = lines.length > 0;

  return (
    <article
      id={gearItemAnchorId(item.style)}
      className={cn(
        "flex scroll-mt-20 flex-col overflow-hidden rounded-lg border bg-card transition-colors",
        picked ? "border-[var(--wi-red)]/50" : "border-border",
      )}
      aria-label={item.name}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onPreview}
          className="group relative aspect-square w-full bg-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
          aria-label={`Preview ${item.name} in ${color.label} larger`}
        >
          <Image
            src={color.image}
            alt={`${item.name} in ${color.label}`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
            className="object-contain p-3 transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transition-none"
          />
          {color.imageNote && (
            <Badge variant="gray" size="sm" className="absolute left-2 top-2">
              {color.imageNote}
            </Badge>
          )}
          {item.collectionLabel && (
            <Badge size="sm" className="absolute right-2 top-2 bg-neutral-900 text-white">
              {item.collectionLabel.replace(/ collection$/i, "")}
            </Badge>
          )}
        </button>
        <GearSwatches
          item={item}
          selectedCode={color.code}
          onSelect={onSelectColor}
          onPhoto
          className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 border-t border-border p-3">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold leading-snug text-foreground">{item.name}</h3>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatUsd(dollarsToCents(item.price))}</span>
          </div>
          {item.priceNote && (
            <p className="mt-0.5 flex items-start gap-1 text-[11.5px] leading-4 text-[var(--orange-text)]">
              <AlertTriangleIcon className="mt-px size-3 shrink-0" aria-hidden="true" />
              {item.priceNote}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{color.label}</p>
        </div>

        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          {colorLines.map((line) => (
            // Wraps the stepper under the size on narrow cards so sizes like "XXL" never truncate.
            <div key={line.id} className="flex flex-wrap items-center gap-1.5">
              {sizeKind === "HEADWEAR" ? (
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">One size</span>
              ) : (
                <NativeSelect
                  aria-label={`Size for ${item.name} in ${color.label}`}
                  className="h-9 min-w-[5.5rem] flex-1 basis-[5.5rem] px-2 text-sm"
                  value={line.size ?? ""}
                  disabled={readOnly}
                  onChange={(event) => onChangeLine(line.id, { size: event.target.value || null })}
                >
                  <option value="">{sizeKind === "FOOTWEAR" ? "Shoe size" : "Size"}</option>
                  {sizeOptionsFor(sizeKind, line.size).map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <div className="ml-auto flex shrink-0 items-center rounded-md border border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-r-none"
                  disabled={readOnly}
                  aria-label={line.quantity === 1 ? `Remove ${item.name} ${line.size ?? ""}` : `Fewer ${item.name}`}
                  onClick={() =>
                    line.quantity <= 1 ? onRemoveLine(line.id) : onChangeLine(line.id, { quantity: line.quantity - 1 })
                  }
                >
                  {line.quantity <= 1 ? <Trash2Icon className="size-3.5" /> : <MinusIcon className="size-3.5" />}
                </Button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                  {line.quantity}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-l-none"
                  disabled={readOnly || line.quantity >= GEAR_MAX_QUANTITY}
                  aria-label={`More ${item.name}`}
                  onClick={() => onChangeLine(line.id, { quantity: line.quantity + 1 })}
                >
                  <PlusIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}

          {!readOnly && (colorLines.length === 0 || sizeKind !== "HEADWEAR") && (
            <Button
              type="button"
              variant={colorLines.length > 0 ? "ghost" : "outline"}
              size="sm"
              className="min-h-10 w-full"
              onClick={() => onAddLine(sku)}
            >
              <PlusIcon data-icon="inline-start" />
              {colorLines.length > 0 ? "Add another size" : "Add"}
            </Button>
          )}

          {otherColors.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground">Also in your list: {otherColors.join(", ")}</p>
          )}
        </div>
      </div>
    </article>
  );
}
