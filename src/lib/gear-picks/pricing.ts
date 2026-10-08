import { HttpError } from "@/lib/http";
import {
  findGearSku,
  formatUsd,
  GEAR_MAX_QUANTITY,
  GEAR_SIZE_MAX_LENGTH,
  isItemAllowedForFit,
  type GearPickFitKey,
  type GearSizeKind,
} from "./catalog";

export type GearPickLineInput = {
  sku: string;
  size?: string | null;
  quantity: number;
};

export type PricedGearPickLine = {
  sku: string;
  style: string;
  colorCode: string;
  size: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  sizeKind: GearSizeKind;
};

export type PricedGearPicks = {
  lines: PricedGearPickLine[];
  totalCents: number;
};

/** A cycle with no deadline stays open; otherwise it closes at the deadline instant. */
export function isGearPickCycleOpen(deadline: Date | null | undefined, now: Date = new Date()) {
  return !deadline || now.getTime() < deadline.getTime();
}

function normalizeSize(size: string | null | undefined) {
  const value = size?.trim().toUpperCase() ?? "";
  return value.length > 0 ? value : null;
}

/**
 * Validate a participant's pick lines against the catalog and price them from
 * the catalog alone. Throws a 400 HttpError with a product-language message on
 * the first problem so the client can show it next to the footer.
 */
export function priceGearPickLines(params: {
  fit: GearPickFitKey;
  allowanceCents: number;
  lines: GearPickLineInput[];
}): PricedGearPicks {
  const seen = new Set<string>();
  const priced: PricedGearPickLine[] = [];
  let totalCents = 0;

  for (const line of params.lines) {
    const entry = findGearSku(line.sku);
    if (!entry) {
      throw new HttpError(400, `Item ${line.sku} isn't in this year's catalog. Remove it and try again.`);
    }
    if (!isItemAllowedForFit(entry.item, params.fit)) {
      throw new HttpError(400, `${entry.item.name} isn't part of your catalog. Remove it and try again.`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > GEAR_MAX_QUANTITY) {
      throw new HttpError(400, `Choose between 1 and ${GEAR_MAX_QUANTITY} of ${entry.item.name}.`);
    }

    const size = normalizeSize(line.size);
    if (size && size.length > GEAR_SIZE_MAX_LENGTH) {
      throw new HttpError(400, `Sizes can be up to ${GEAR_SIZE_MAX_LENGTH} characters.`);
    }
    if (!size && entry.sizeKind === "APPAREL") {
      throw new HttpError(400, `Choose a size for ${entry.item.name} (${entry.color.label}).`);
    }

    const key = `${entry.sku}|${size ?? ""}`;
    if (seen.has(key)) {
      throw new HttpError(400, `${entry.item.name} (${entry.color.label}${size ? `, ${size}` : ""}) is listed twice. Combine the quantities instead.`);
    }
    seen.add(key);

    const lineTotalCents = entry.unitPriceCents * line.quantity;
    totalCents += lineTotalCents;
    priced.push({
      sku: entry.sku,
      style: entry.item.style,
      colorCode: entry.color.code,
      size,
      quantity: line.quantity,
      unitPriceCents: entry.unitPriceCents,
      lineTotalCents,
      sizeKind: entry.sizeKind,
    });
  }

  if (totalCents > params.allowanceCents) {
    throw new HttpError(
      400,
      `Your picks total ${formatUsd(totalCents)}, which is over your ${formatUsd(params.allowanceCents)} allowance. Remove something to continue.`,
    );
  }

  return { lines: priced, totalCents };
}
