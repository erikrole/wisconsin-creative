import { ResourceAssetKind } from "@prisma/client";

export const RESOURCE_ASSET_KIND_LABELS: Record<ResourceAssetKind, string> = {
  [ResourceAssetKind.LOGO]: "Logo",
  [ResourceAssetKind.FONT]: "Font",
  [ResourceAssetKind.GRAPHIC_ELEMENT]: "Graphic element",
  [ResourceAssetKind.TEMPLATE]: "Template",
  [ResourceAssetKind.COLOR_REFERENCE]: "Color and reference",
  [ResourceAssetKind.PHOTO]: "Photography",
  [ResourceAssetKind.VIDEO]: "Video",
  [ResourceAssetKind.DOCUMENT]: "Document",
  [ResourceAssetKind.OTHER]: "Other",
};

export const RESOURCE_ASSET_KIND_OPTIONS = Object.values(ResourceAssetKind).map((value) => ({
  value,
  label: RESOURCE_ASSET_KIND_LABELS[value],
}));

