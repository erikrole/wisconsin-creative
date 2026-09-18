export type ReuseSerializedAsset = {
  id: string;
  assetTag: string;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  type: string;
  computedStatus: string;
  imageUrl: string | null;
  qrCodeValue?: string | null;
  categoryName?: string | null;
  location: { id: string; name: string } | null;
};

export type ReuseSerializedItem = {
  assetId: string;
  asset: ReuseSerializedAsset;
};

export type ReuseBulkItem = {
  bulkSkuId: string;
  plannedQuantity: number;
  bulkSku: { id: string; name: string };
};

type MergeEquipmentSource = {
  serializedItems: Array<{
    assetId: string;
    asset: ReuseSerializedAsset;
  }>;
  bulkItems: Array<{
    bulkSkuId: string;
    plannedQuantity: number;
    bulkSku: { id: string; name: string };
  }>;
};

export function mergeReuseEquipment(
  source: MergeEquipmentSource,
  linkedCheckouts: MergeEquipmentSource[] = [],
) {
  const serializedByAssetId = new Map<string, ReuseSerializedItem>();
  const bulkBySkuId = new Map<string, ReuseBulkItem>();

  const add = (plan: MergeEquipmentSource) => {
    for (const item of plan.serializedItems) {
      if (!item.assetId || serializedByAssetId.has(item.assetId)) continue;
      serializedByAssetId.set(item.assetId, {
        assetId: item.assetId,
        asset: item.asset,
      });
    }
    for (const item of plan.bulkItems) {
      if (!item.bulkSkuId || item.plannedQuantity <= 0) continue;
      const existing = bulkBySkuId.get(item.bulkSkuId);
      if (existing) {
        existing.plannedQuantity += item.plannedQuantity;
        continue;
      }
      bulkBySkuId.set(item.bulkSkuId, {
        bulkSkuId: item.bulkSkuId,
        plannedQuantity: item.plannedQuantity,
        bulkSku: item.bulkSku,
      });
    }
  };

  add(source);
  for (const checkout of linkedCheckouts) add(checkout);

  return {
    serializedItems: [...serializedByAssetId.values()],
    bulkItems: [...bulkBySkuId.values()],
  };
}

export function isEventDerivedTitle(
  title: string,
  events: Array<{ summary: string; sportCode: string | null; opponent: string | null; isHome: boolean | null }>,
  generatedTitle: string | null,
) {
  const normalized = title.trim();
  if (!normalized || events.length === 0) return false;
  const primary = events[0]!;
  return normalized === primary.summary.trim() || (generatedTitle != null && normalized === generatedTitle.trim());
}
