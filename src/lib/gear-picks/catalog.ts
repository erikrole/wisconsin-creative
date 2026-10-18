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

/** Brand colors lead every item: Red, then White, then Black. Other colors keep catalog order after them. */
const LEAD_COLOR_ORDER = ["Red", "White", "Black"];

export function sortGearColors(colors: GearCatalogColor[]) {
  const rank = (color: GearCatalogColor) => {
    const index = LEAD_COLOR_ORDER.indexOf(color.label);
    return index === -1 ? LEAD_COLOR_ORDER.length : index;
  };
  return [...colors].sort((a, b) => rank(a) - rank(b));
}

const rawCatalog = catalogJson as GearCatalog;

export const GEAR_CATALOG: GearCatalog = {
  ...rawCatalog,
  items: rawCatalog.items.map((item) => ({ ...item, colors: sortGearColors(item.colors) })),
};

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

/** The department-covered kit entry (standard issue or core kit) for a catalog style, if the fit's kit includes it. */
export function kitEntryForStyle(fit: GearPickFitKey, style: string, catalog: GearCatalog = GEAR_CATALOG) {
  return catalog.kits[fit].find((entry) => entry.style === style) ?? null;
}

/** Apparel sizes offered in the picker. Free text up to 12 characters is accepted server-side. */
export const GEAR_APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;

/** Profile fields that can prefill a size. Shoe systems never convert across scales. */
export type GearPickSizeProfile = {
  topSize: string | null;
  topSizeFit: "UNISEX" | "WOMENS" | "MENS" | null;
  shoeSize: string | null;
  shoeSizeSystem: "US_WOMENS" | "US_MENS" | null;
};

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

/**
 * A matching profile size, or null when the person still has to choose.
 * Tops match fit. Pants, base layers, and fitted hats do not prefill.
 * Shoes match the US system and an offered size, with no conversion.
 * Catalog shoe sizes (Icon Lo) never prefill.
 */
export function defaultGearPickSize(item: GearCatalogItem, profile: GearPickSizeProfile): string | null {
  if (isOneSizeItem(item)) return GEAR_ONE_SIZE;
  if (item.category === "Headwear" || item.category === "Pants & shorts" || item.category === "Base layer") return null;
  if (item.category === "Footwear") {
    if (!item.shoeSizeSystem || item.shoeSizeSystem === "CATALOG" || item.shoeSizeSystem !== profile.shoeSizeSystem) return null;
    const size = profile.shoeSize?.trim() || null;
    return gearSizeProblem(item, size) ? null : size;
  }
  const expectedFit = item.fit === "MEN" ? "MENS" : item.fit === "WOMEN" ? "WOMENS" : "UNISEX";
  if (profile.topSizeFit !== expectedFit) return null;
  const size = normalizeApparelSize(profile.topSize);
  return gearSizeProblem(item, size) ? null : size;
}

/** Sizes the picker offers. Exact lists are enforced; apparel without a list still accepts other text up to 12 characters. */
export function gearPickSizeChoices(item: GearCatalogItem): { sizes: string[]; exact: boolean } {
  if (isOneSizeItem(item)) return { sizes: [GEAR_ONE_SIZE], exact: true };
  if (item.sizes && item.sizes.length > 0) return { sizes: item.sizes, exact: true };
  return { sizes: [...GEAR_APPAREL_SIZES], exact: false };
}

export type GearPickPhoneKit = {
  kind: "STANDARD_ISSUE" | "CORE_KIT";
  colorCode: string;
};

export type GearPickPhoneColor = {
  code: string;
  label: string;
  swatch: string;
  image: string;
};

export type GearPickPhoneItem = {
  style: string;
  name: string;
  fit: GearItemFit;
  category: string;
  priceCents: number;
  sizeLabel: string;
  sizes: string[];
  sizesAreExact: boolean;
  oneSize: boolean;
  defaultSize: string | null;
  kit: GearPickPhoneKit | null;
  colors: GearPickPhoneColor[];
};

/** The fit-filtered catalog a phone can shop. Prices are cents from the same JSON the server prices with. */
export type GearPickPhoneCatalog = {
  maxQuantity: number;
  categories: string[];
  items: GearPickPhoneItem[];
};

export function gearPickPhoneCatalog(fit: GearPickFitKey, profile: GearPickSizeProfile): GearPickPhoneCatalog {
  const items = itemsForFit(fit).map((item): GearPickPhoneItem => {
    const choices = gearPickSizeChoices(item);
    const kit = kitEntryForStyle(fit, item.style);
    return {
      style: item.style,
      name: item.name,
      fit: item.fit,
      category: item.category,
      priceCents: dollarsToCents(item.price),
      sizeLabel: gearSizeLabel(item),
      sizes: choices.sizes,
      sizesAreExact: choices.exact,
      oneSize: isOneSizeItem(item),
      defaultSize: defaultGearPickSize(item, profile),
      kit: kit ? { kind: kit.kind, colorCode: kit.code } : null,
      colors: item.colors.map((color) => ({
        code: color.code,
        label: color.label,
        swatch: color.swatch,
        image: color.image,
      })),
    };
  });
  return {
    maxQuantity: GEAR_MAX_QUANTITY,
    categories: GEAR_CATALOG.categories.filter((category) => items.some((item) => item.category === category)),
    items,
  };
}

/** The same size gate runs before saving in the browser and at the pricing boundary. */
export function gearSizeProblem(item: GearCatalogItem, size: string | null | undefined): string | null {
  const value = size?.trim().toUpperCase();
  if (isOneSizeItem(item)) return value && value !== GEAR_ONE_SIZE ? "Choose one size" : null;
  if (!value) return "Choose a size";
  if (item.sizes && !item.sizes.includes(value)) return "Choose an available size";
  return null;
}

/** Parse a typed dollar amount ("5,500", "$5500.5") into whole cents, or null when it isn't a plain amount. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
