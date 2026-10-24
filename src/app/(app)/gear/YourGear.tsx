"use client";

import Image from "next/image";
import Link from "next/link";
import { CheckIcon, ChevronRightIcon, GridIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUsd, findGearSku, gearSizeProblem, type GearCatalogItem } from "@/lib/gear-picks/catalog";
import { SIZE_NEEDED } from "@/lib/gear-picks/order";
import { formatDateShort } from "@/lib/format";
import type { GearMyKitDto, GearMyKitPieceDto } from "@/lib/gear-picks/types";
import { cn } from "@/lib/utils";
import type { DraftLine } from "./gear-pick-state";
import { useMyGearKit } from "./MyKit";
import type { GearPreview } from "./GearPreviewDialog";

const CARD = "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const DIVIDER = "border-[#F0F1F3] dark:border-white/10";
const TONE = {
  green: "bg-[#E6F6EB] text-[#18794E]",
  amber: "bg-[#FFF3D6] text-[#9A6700]",
  red: "bg-[#FFE9E9] text-[#C2282F]",
  gray: "bg-[#F0F1F3] text-[#60646C] dark:bg-white/10 dark:text-muted-foreground",
} as const;
type Tone = keyof typeof TONE;

function pieceStatus(piece: GearMyKitPieceDto, kit: GearMyKitDto): { label: string; tone: Tone } {
  if (piece.handed) return { label: piece.handedOutAt ? `In hand · ${formatDateShort(piece.handedOutAt)}` : "In hand", tone: "green" };
  if (piece.size === SIZE_NEEDED) return { label: "Add your size", tone: "red" };
  if (kit.order.placedAt) return { label: kit.order.expectedAt ? `On order · due ${formatDateShort(kit.order.expectedAt)}` : "On order", tone: "amber" };
  return { label: "Planned", tone: "gray" };
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn("inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-bold", TONE[tone])}>
      {tone === "green" && <CheckIcon className="size-3.5" aria-hidden="true" />}
      {label}
    </span>
  );
}

function Photo({ src, label, onOpen }: { src: string; label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}. Preview larger`}
      className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-[#F0F1F3] bg-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-white/10"
    >
      <Image src={src} alt="" fill sizes="56px" className="object-contain p-1" />
    </button>
  );
}

function GroupHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b px-5 pb-2 pt-4", DIVIDER)}>
      <h3 className="text-sm font-extrabold tracking-[-0.01em]">{title}</h3>
      <span className="text-xs text-[#8B8D98]">{detail}</span>
    </div>
  );
}

/**
 * Everything the person can expect to receive, above the catalog: their picks
 * first, then the department-covered kit, each with a photo and a status.
 */
export function YourGear({
  lines,
  readOnly,
  onPreview,
  onEditPicks,
  onBrowse,
}: {
  lines: DraftLine[];
  readOnly: boolean;
  onPreview: (preview: GearPreview) => void;
  onEditPicks: () => void;
  onBrowse: () => void;
}) {
  const { data: kit } = useMyGearKit();
  const kitPieces = kit?.pieces.filter((piece) => piece.source !== "PICK") ?? [];
  const pickPieces = new Map((kit?.pieces ?? []).filter((piece) => piece.source === "PICK").map((piece) => [`${piece.sku}|${piece.size}`, piece]));
  const picks = lines.map((line) => ({ line, entry: findGearSku(line.sku) })).filter((row) => row.entry);
  const pickTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  const needsSize = kit?.pieces.some((piece) => piece.size === SIZE_NEEDED) ?? false;

  return (
    <section aria-labelledby="gear-your-gear" className={cn(CARD, "mb-6")}>
      <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4", DIVIDER)}>
        <div>
          <h2 id="gear-your-gear" className="text-lg font-extrabold tracking-[-0.02em]">Your gear</h2>
          <p className="text-sm text-[#60646C] dark:text-muted-foreground">
            {pickTotal > 0 ? `${pickTotal} ${pickTotal === 1 ? "pick" : "picks"}` : "No picks yet"}
            {kitPieces.length > 0 ? ` · ${kitPieces.length} in your kit` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" className="min-h-10" onClick={onBrowse}>
          <GridIcon data-icon="inline-start" />
          Catalog
        </Button>
      </div>

      {needsSize && (
        <p className={cn("border-b bg-[#FFF8F8] px-5 py-2.5 text-sm text-[#C2282F] dark:bg-white/5", DIVIDER)} role="status">
          We need your size before your kit can be ordered. <Link href="/profile?tab=gear" className="font-bold underline underline-offset-2">Add it on your profile</Link>.
        </p>
      )}

      <GroupHeading title="Your picks" detail={picks.length > 0 ? formatUsd(lines.reduce((sum, line) => sum + (findGearSku(line.sku)?.unitPriceCents ?? 0) * line.quantity, 0)) : ""} />
      {picks.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-[#60646C] dark:text-muted-foreground">
            {readOnly ? "Nothing was saved for this cycle." : "Choose what you'd like from this year's catalog."}
          </p>
          {!readOnly && <Button type="button" className="min-h-10" onClick={onBrowse}>Browse the catalog</Button>}
        </div>
      ) : (
        <ul>
          {picks.map(({ line, entry }) => {
            const item = entry!.item;
            const piece = pickPieces.get(`${line.sku}|${line.size ?? ""}`);
            const sizeMissing = Boolean(gearSizeProblem(item, line.size));
            const status = piece && kit ? pieceStatus(piece, kit) : null;
            return (
              <li key={line.id} className={cn("flex items-center gap-3 border-b px-5 py-3 text-sm last:border-b-0", DIVIDER)}>
                <Photo
                  src={entry!.color.image}
                  label={item.name}
                  onOpen={() => onPreview({ kind: "item", item: item as GearCatalogItem, colorCode: entry!.color.code })}
                />
                <button type="button" onClick={onEditPicks} className="min-w-0 flex-1 text-left focus-visible:outline-none">
                  <span className="block truncate font-bold">{item.name}</span>
                  <span className={cn("block truncate text-xs", sizeMissing ? "text-[#C2282F]" : "text-[#8B8D98]")}>
                    {entry!.color.label} · {sizeMissing ? "Size needed" : line.size ? `Size ${line.size}` : "One size"}
                    {line.quantity > 1 ? ` · ×${line.quantity}` : ""}
                  </span>
                </button>
                {status && <StatusPill {...status} />}
                <span className="shrink-0 font-mono text-sm tabular-nums text-[#60646C] dark:text-muted-foreground">{formatUsd(entry!.unitPriceCents * line.quantity)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {picks.length > 0 && !readOnly && (
        <button type="button" onClick={onEditPicks} className={cn("flex min-h-11 w-full items-center justify-between border-t px-5 text-sm font-bold text-[#60646C] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:text-muted-foreground", DIVIDER)}>
          Edit your picks
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </button>
      )}

      {kitPieces.length > 0 && kit && (
        <>
          <div className={cn("border-t", DIVIDER)} />
          <GroupHeading title="In your kit" detail="Covered by the department" />
          <ul>
            {kitPieces.map((piece) => {
              const entry = findGearSku(piece.sku);
              const status = pieceStatus(piece, kit);
              return (
                <li key={`${piece.source}|${piece.sku}|${piece.size}`} className={cn("flex items-center gap-3 border-b px-5 py-3 text-sm last:border-b-0", DIVIDER)}>
                  {entry ? (
                    <Photo
                      src={entry.color.image}
                      label={piece.itemName}
                      onOpen={() => onPreview({ kind: "kit", name: piece.itemName, label: piece.source === "CORE_KIT" ? "Core kit" : "Standard issue", sku: piece.sku, image: entry.color.image })}
                    />
                  ) : (
                    <span className="size-14 shrink-0 rounded-lg bg-[#F0F1F3] dark:bg-white/10" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{piece.itemName}</span>
                    <span className="block truncate text-xs text-[#8B8D98]">
                      {piece.colorLabel ? `${piece.colorLabel} · ` : ""}
                      {piece.size === SIZE_NEEDED ? "No size yet" : `Size ${piece.size}`}
                      {piece.quantity > 1 ? ` · ×${piece.quantity}` : ""}
                    </span>
                  </span>
                  <StatusPill {...status} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
