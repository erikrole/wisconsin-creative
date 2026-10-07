/**
 * Canonical support-gear item families (D-022).
 *
 * Fungible cased/support gear books as family quantity; exact units and
 * branded products bind under the family, never as separate picker rows.
 * Creative vs Football is the accepted pool split (same shape as Sony Battery
 * / Football Sony Battery). Kits remain gameday job templates, not inventory.
 */

import type { EquipmentSectionKey } from "@/lib/equipment-sections";

export type SupportGearPool = "creative" | "football";

export type CanonicalSupportFamily = {
  name: string;
  pool: SupportGearPool;
  section: Extract<EquipmentSectionKey, "tripods" | "lighting">;
  /** Held product decisions that may later split this family further. */
  pendingSplit?: string;
};

export const CANONICAL_SUPPORT_GEAR_FAMILIES: readonly CanonicalSupportFamily[] = [
  { name: "Tripod", pool: "creative", section: "tripods" },
  { name: "Football Tripod", pool: "football", section: "tripods" },
  {
    name: "Light Kit",
    pool: "creative",
    section: "lighting",
    pendingSplit: "2-point vs 3-point pool boundary",
  },
  {
    name: "Football Light Kit",
    pool: "football",
    section: "lighting",
    pendingSplit: "2-point vs 3-point pool boundary",
  },
] as const;

const CANONICAL_NAMES = new Set(
  CANONICAL_SUPPORT_GEAR_FAMILIES.map((family) => family.name.toLowerCase()),
);

/** Category names that usually mean fungible support / lighting pool gear. */
const SUPPORT_POOL_CATEGORIES = new Set([
  "tripods",
  "tripod",
  "support",
  "monopods",
  "monopod",
  "lighting",
  "lights",
  "light",
]);

const SUPPORT_POOL_KEYWORDS = [
  "tripod",
  "monopod",
  "light kit",
  "lighting kit",
  "led panel kit",
  "2-point",
  "3-point",
  "two point",
  "three point",
] as const;

export function isCanonicalSupportFamilyName(name: string | null | undefined): boolean {
  return !!name && CANONICAL_NAMES.has(name.trim().toLowerCase());
}

export function findCanonicalSupportFamily(name: string | null | undefined): CanonicalSupportFamily | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  return CANONICAL_SUPPORT_GEAR_FAMILIES.find((family) => family.name.toLowerCase() === normalized) ?? null;
}

function haystack(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Serialized assets that likely belong in a unit-tracked support family instead
 * of remaining one-row-per-model in the picker. Accessories (parented rows) and
 * retired gear are excluded. Heuristic only — staff still decides migration.
 */
export function isSerializedSupportPoolCandidate(asset: {
  status?: string | null;
  parentAssetId?: string | null;
  categoryName?: string | null;
  type?: string | null;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  assetTag?: string | null;
}): boolean {
  if (asset.parentAssetId) return false;
  if ((asset.status ?? "").toUpperCase() === "RETIRED") return false;

  const category = (asset.categoryName ?? "").trim().toLowerCase();
  if (category && SUPPORT_POOL_CATEGORIES.has(category)) return true;

  const text = haystack([asset.type, asset.name, asset.brand, asset.model, asset.assetTag]);
  return SUPPORT_POOL_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * Numbered units should carry a product when the family already defines one or
 * more active products. Unassigned units block model-aware maintenance without
 * helping reservation (which stays family-quantity).
 */
export function shouldAssignUnitProduct(args: {
  trackByNumber: boolean;
  activeProductCount: number;
  productId: string | null | undefined;
  unitStatus?: string | null;
}): boolean {
  if (!args.trackByNumber) return false;
  if (args.activeProductCount <= 0) return false;
  if (args.productId) return false;
  if ((args.unitStatus ?? "").toUpperCase() === "RETIRED") return false;
  return true;
}
