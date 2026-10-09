import catalogJson from "./catalog-2027-28.json";

/**
 * Typed access to the UA staff gear catalog. The JSON file is the single
 * source of truth for items, colors, and team prices; the server prices every
 * pick from here and never trusts a client-sent price. Safe to import from
 * client components (no server-only dependencies).
 */

export type GearPickFitKey = "MEN" | "WOMEN";
export type GearItemFit = GearPickFitKey | "UNISEX";

export type GearCatalogColor = {
  code: string;
  label: string;
  swatch: string;
  image: string;
  imageNote: string | null;
};

export type GearCatalogItem = {
  style: string;
  /** Verified item options; absent apparel options retain the free-text contract. */
  sizes?: string[];
  shoeSizeSystem?: "US_MENS" | "US_WOMENS" | "CATALOG";
  name: string;
  fit: GearItemFit;
  category: string;
  collection: string;
  collectionLabel: string | null;
  price: number;
  priceNote: string | null;
  colors: GearCatalogColor[];
};

export type GearKitEntry = {
  kind: "STANDARD_ISSUE" | "CORE_KIT";
  style: string;
  code: string;
  name: string;
  image: string;
};

export type GearCatalog = {
  cycle: string;
  title: string;
  allowances: Record<GearPickFitKey, number>;
  categories: string[];
  collections: { key: string; label: string }[];
  kits: Record<GearPickFitKey, GearKitEntry[]>;
  items: GearCatalogItem[];
};

/** How a line's size is chosen: apparel needs a size, footwear takes a shoe size, headwear can be fitted or one size. */
export type GearSizeKind = "APPAREL" | "FOOTWEAR" | "HEADWEAR";

export type GearCatalogSku = {
  sku: string;
  item: GearCatalogItem;
  color: GearCatalogColor;
  unitPriceCents: number;
  sizeKind: GearSizeKind;
};

export const GEAR_PICK_CYCLE_ID = "2027-28";

export const GEAR_CATALOG = catalogJson as GearCatalog;

export function gearSku(style: string, colorCode: string) {
  return `${style}-${colorCode}`;
}

export function dollarsToCents(dollars: number) {
  return Math.round(dollars * 100);
}

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function sizeKindForCategory(category: string): GearSizeKind {
  if (category === "Footwear") return "FOOTWEAR";
  if (category === "Headwear") return "HEADWEAR";
  return "APPAREL";
}

/** MEN shops MEN + UNISEX items; WOMEN shops WOMEN + UNISEX items. */
export function isItemAllowedForFit(item: Pick<GearCatalogItem, "fit">, fit: GearPickFitKey) {
  return item.fit === "UNISEX" || item.fit === fit;
}

export function itemsForFit(fit: GearPickFitKey, catalog: GearCatalog = GEAR_CATALOG) {
  return catalog.items.filter((item) => isItemAllowedForFit(item, fit));
}

export function defaultAllowanceCents(fit: GearPickFitKey, catalog: GearCatalog = GEAR_CATALOG) {
  return dollarsToCents(catalog.allowances[fit]);
}

function buildSkuIndex(catalog: GearCatalog) {
  const index = new Map<string, GearCatalogSku>();
  for (const item of catalog.items) {
    const unitPriceCents = dollarsToCents(item.price);
    const sizeKind = sizeKindForCategory(item.category);
    for (const color of item.colors) {
      const sku = gearSku(item.style, color.code);
      index.set(sku, { sku, item, color, unitPriceCents, sizeKind });
    }
  }
  return index;
}

const SKU_INDEX = buildSkuIndex(GEAR_CATALOG);

export function findGearSku(sku: string): GearCatalogSku | null {
  return SKU_INDEX.get(sku) ?? null;
}

/** Apparel sizes offered in the picker. Free text up to 12 characters is accepted server-side. */
export const GEAR_APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;

export const GEAR_ONE_SIZE = "OSFA";
export const GEAR_SIZE_MAX_LENGTH = 12;
export const GEAR_MAX_QUANTITY = 5;

/** Profile top sizes use "2XL"; the UA picker lists "XXL". */
export function normalizeApparelSize(size: string | null | undefined) {
  const value = size?.trim().toUpperCase();
  if (!value) return null;
  if (value === "2XL") return "XXL";
  return value;
}

/** Fitted headwear overrides the category's one-size default. */
export function isOneSizeItem(item: GearCatalogItem) {
  return item.category === "Headwear" && !item.sizes;
}

export function gearSizeLabel(item: GearCatalogItem) {
  if (item.shoeSizeSystem === "US_MENS") return "US men's shoe size";
  if (item.shoeSizeSystem === "US_WOMENS") return "US women's shoe size";
  if (item.category === "Footwear") return "Catalog shoe size";
  if (item.style === "6021743") return "Waist size (inches)";
  return "Size";
}

/** The same size gate runs before saving in the browser and at the pricing boundary. */
export function gearSizeProblem(item: GearCatalogItem, size: string | null | undefined): string | null {
  const value = size?.trim().toUpperCase();
  if (isOneSizeItem(item)) return value && value !== GEAR_ONE_SIZE ? "Choose one size" : null;
  if (!value) return "Choose a size";
  if (item.sizes && !item.sizes.includes(value)) return "Choose an available size";
  return null;
}
