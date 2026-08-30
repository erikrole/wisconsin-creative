import type { SerializedIntakeTemplate } from "./types";
import {
  getNextSequentialAssetTag,
  summarizeRepeatTags,
  type RepeatTagAsset,
} from "./repeat-tags";

export type SerializedTemplateSource = {
  id: string;
  assetTag: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  linkUrl?: string | null;
  imageUrl?: string | null;
  location?: { id?: string | null } | null;
  category?: { id?: string | null } | null;
  department?: { id?: string | null } | null;
  parentAsset?: { id?: string | null } | null;
  availableForReservation?: boolean | null;
  availableForCheckout?: boolean | null;
  availableForCustody?: boolean | null;
};

function text(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function buildSerializedIntakeTemplate(
  source: SerializedTemplateSource,
  relatedAssets: RepeatTagAsset[],
): SerializedIntakeTemplate {
  const repeatSummary = summarizeRepeatTags(source.assetTag, relatedAssets);
  const brand = text(source.brand);
  const model = text(source.model);
  const name = text(source.name);

  return {
    key: `source:${source.id}:${repeatSummary?.nextTag ?? source.assetTag}`,
    sourceAssetId: source.id,
    sourceLabel: source.assetTag,
    productLabel: name || [brand, model].filter(Boolean).join(" ") || source.assetTag,
    assetTag: repeatSummary?.nextTag ?? getNextSequentialAssetTag(source.assetTag),
    name,
    brand,
    model,
    categoryId: text(source.category?.id),
    locationId: text(source.location?.id),
    departmentId: text(source.department?.id),
    linkUrl: text(source.linkUrl),
    availableForReservation: source.availableForReservation ?? true,
    availableForCheckout: source.availableForCheckout ?? true,
    availableForCustody: source.availableForCustody ?? true,
  };
}
