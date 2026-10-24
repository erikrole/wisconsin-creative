export const UNKNOWN_ITEM_METADATA = "Unknown";

export type SerializedSubmitInput = {
  assetTag: string;
  itemName: string;
  brand: string;
  model: string;
  serialNumber: string;
  qrCodeValue: string;
  locationId: string;
  categoryId: string;
  departmentId: string;
  purchaseDate: string;
  purchasePrice: string;
  warrantyDate: string;
  residualValue: string;
  linkUrl: string;
  uwAssetTag: string;
  fiscalYear: string;
  userNotes: string;
  availableForReservation: boolean;
  availableForCheckout: boolean;
  availableForCustody: boolean;
  isAccessory: boolean;
  parentAssetId?: string;
  parentAsset?: {
    assetTag?: string | null;
    name?: string | null;
    brand?: string | null;
    model?: string | null;
  };
};

function trimmed(value: string) {
  return value.trim();
}

const GENERATED_ATTACHMENT_TAG_MAX_LENGTH = 120;
const USD_PRICE_PATTERN = /^\$?\s*(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?|\.\d{1,2})\s*$/;

function cleanTagPart(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9 .#_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQrSuffix(qrCodeValue: string): string {
  const compact = qrCodeValue.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  return compact ? compact.slice(-8) : "UNLABELED";
}

function buildAttachmentInternalAssetTag(input: SerializedSubmitInput): string {
  const parentLabel = cleanTagPart(input.parentAsset?.assetTag) || "PARENT";
  const attachmentLabel =
    cleanTagPart(input.itemName) ||
    cleanTagPart(input.model) ||
    cleanTagPart(input.brand) ||
    "Attachment";
  const suffix = buildQrSuffix(input.qrCodeValue);
  const generated = `ATT ${parentLabel} ${attachmentLabel} ${suffix}`;

  return generated.slice(0, GENERATED_ATTACHMENT_TAG_MAX_LENGTH).trim();
}

function resolveAssetTag(input: SerializedSubmitInput): string {
  const explicitTag = trimmed(input.assetTag);
  if (explicitTag) return explicitTag;
  if (input.isAccessory) return buildAttachmentInternalAssetTag(input);
  return explicitTag;
}

export function parseUsdPriceInput(value: string): number | undefined {
  const input = trimmed(value);
  if (!input) return undefined;
  if (!USD_PRICE_PATTERN.test(input)) return undefined;

  const parsed = Number(input.replace(/^\$\s*/, "").replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function isValidUsdPriceInput(value: string): boolean {
  return !trimmed(value) || parseUsdPriceInput(value) !== undefined;
}

export function buildSerializedItemSubmitBody(input: SerializedSubmitInput): Record<string, unknown> {
  const metadata: Record<string, string> = {};
  if (input.fiscalYear) metadata.fiscalYearPurchased = input.fiscalYear;
  if (trimmed(input.userNotes)) metadata.userNotes = trimmed(input.userNotes);
  const purchasePrice = parseUsdPriceInput(input.purchasePrice);

  return {
    assetTag: resolveAssetTag(input),
    type: "equipment",
    brand: trimmed(input.brand) || UNKNOWN_ITEM_METADATA,
    model: trimmed(input.model) || UNKNOWN_ITEM_METADATA,
    qrCodeValue: trimmed(input.qrCodeValue),
    locationId: input.locationId,
    availableForReservation: input.isAccessory ? false : input.availableForReservation,
    availableForCheckout: input.isAccessory ? false : input.availableForCheckout,
    availableForCustody: input.isAccessory ? false : input.availableForCustody,
    ...(input.isAccessory && input.parentAssetId ? { parentAssetId: input.parentAssetId } : {}),
    ...(trimmed(input.serialNumber) ? { serialNumber: trimmed(input.serialNumber) } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    ...(trimmed(input.itemName) ? { name: trimmed(input.itemName) } : {}),
    ...(input.purchaseDate ? { purchaseDate: input.purchaseDate } : {}),
    ...(purchasePrice !== undefined ? { purchasePrice } : {}),
    ...(input.warrantyDate ? { warrantyDate: input.warrantyDate } : {}),
    ...(input.residualValue ? { residualValue: parseFloat(input.residualValue) } : {}),
    ...(trimmed(input.linkUrl) ? { linkUrl: trimmed(input.linkUrl) } : {}),
    ...(trimmed(input.uwAssetTag) ? { uwAssetTag: trimmed(input.uwAssetTag) } : {}),
    ...(Object.keys(metadata).length ? { notes: JSON.stringify(metadata) } : {}),
  };
}
