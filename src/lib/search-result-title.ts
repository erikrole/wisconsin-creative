type SearchAssetIdentity = {
  assetTag?: string | null;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  type?: string | null;
};

export function assetSearchTitle(item: SearchAssetIdentity): string {
  const productName = [item.brand, item.model].filter(Boolean).join(" · ");
  return item.assetTag || item.name || productName || item.type || "Untitled item";
}
