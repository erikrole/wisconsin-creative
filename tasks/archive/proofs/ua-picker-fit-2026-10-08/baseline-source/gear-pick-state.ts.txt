import {
  findGearSku,
  GEAR_APPAREL_SIZES,
  GEAR_ONE_SIZE,
  GEAR_SHOE_SIZES,
  normalizeApparelSize,
  type GearCatalogItem,
  type GearSizeKind,
} from "@/lib/gear-picks/catalog";
import type { GearPicksMeResponse } from "@/lib/gear-picks/types";

/** One editable pick line in the browser. `id` is stable across size edits. */
export type DraftLine = {
  id: string;
  sku: string;
  size: string | null;
  quantity: number;
};

let nextId = 0;
export function draftLineId() {
  nextId += 1;
  return `line-${nextId}`;
}

export function draftLinesFromServer(data: GearPicksMeResponse | null | undefined): DraftLine[] {
  return (data?.submission?.lines ?? []).map((line) => ({
    id: draftLineId(),
    sku: line.sku,
    size: line.size,
    quantity: line.quantity,
  }));
}

/** Total in cents, priced from the catalog (the server re-prices on save). */
export function draftTotalCents(lines: DraftLine[]) {
  return lines.reduce((sum, line) => sum + (findGearSku(line.sku)?.unitPriceCents ?? 0) * line.quantity, 0);
}

export function defaultSizeFor(sizeKind: GearSizeKind, profile: GearPicksMeResponse["profile"]): string | null {
  if (sizeKind === "HEADWEAR") return GEAR_ONE_SIZE;
  if (sizeKind === "FOOTWEAR") return profile.shoeSize?.trim() || null;
  return normalizeApparelSize(profile.topSize);
}

/** Size options for a line, keeping a non-standard current value selectable. */
export function sizeOptionsFor(sizeKind: GearSizeKind, current: string | null): string[] {
  const base: string[] =
    sizeKind === "HEADWEAR"
      ? [GEAR_ONE_SIZE]
      : sizeKind === "FOOTWEAR"
        ? GEAR_SHOE_SIZES
        : [...GEAR_APPAREL_SIZES];
  if (current && !base.includes(current)) return [current, ...base];
  return base;
}

/** Problems the server would reject, surfaced before saving. */
export function draftLineProblems(lines: DraftLine[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const entry = findGearSku(line.sku);
    if (!entry) {
      problems.push(`${line.sku} is no longer in the catalog. Remove it to continue.`);
      continue;
    }
    if (entry.sizeKind === "APPAREL" && !line.size) {
      problems.push(`Choose a size for ${entry.item.name} (${entry.color.label}).`);
    }
    const key = `${line.sku}|${line.size ?? ""}`;
    if (seen.has(key)) {
      problems.push(`${entry.item.name} (${entry.color.label}${line.size ? `, ${line.size}` : ""}) is listed twice. Combine the quantities.`);
    }
    seen.add(key);
  }
  return problems;
}

export function itemSearchText(item: GearCatalogItem) {
  return [
    item.name,
    item.style,
    item.category,
    item.collectionLabel ?? "",
    item.collection,
    ...item.colors.flatMap((color) => [color.label, color.code, `${item.style}-${color.code}`]),
  ]
    .join(" ")
    .toLowerCase();
}

export function categoryAnchorId(category: string) {
  return `gear-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}
