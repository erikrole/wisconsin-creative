export const DEFAULT_LOW_BATTERY_THRESHOLD = 10;

export type BatteryCameraLike = {
  brand?: string | null;
  model?: string | null;
  type?: string | null;
  categoryName?: string | null;
};

export type BatterySkuLike = {
  id: string;
  name: string;
  category?: string | null;
  categoryName?: string | null;
  availableQuantity?: number | null;
  currentQuantity?: number | null;
  minThreshold?: number | null;
};

export type BatteryCompatibilityRule = {
  id: string;
  label: string;
  cameraModelTerms: string[];
  batteryTerms: string[];
};

export type BatteryAvailabilityAlert = {
  ruleId: string;
  label: string;
  cameraModels: string[];
  batterySkuIds: string[];
  availableQuantity: number;
  threshold: number;
};

export type BatteryCompatibilitySummary = BatteryAvailabilityAlert & {
  cameraCount: number;
  batterySkuNames: string[];
  isLow: boolean;
};

export const BATTERY_COMPATIBILITY_RULES: BatteryCompatibilityRule[] = [
  {
    id: "sony-np-fz100",
    label: "Sony NP-FZ100 batteries",
    cameraModelTerms: [
      "fx3",
      "fx30",
      "a1",
      "a7",
      "a7s",
      "a7r",
      "a7iv",
      "a7 iii",
      "a7 iv",
      "ilme-fx3",
      "ilce-7m3",
      "ilce-7sm3",
      "ilce-1/b",
      "ilce-1m2",
      "ilce-9m3",
      "soa74ack",
    ],
    batteryTerms: ["sony battery", "np-fz100", "npfz100", "fz100"],
  },
  {
    id: "sony-bp-u",
    label: "Sony BP-U batteries",
    cameraModelTerms: ["fx6", "fx9", "ilme-fx6", "ilme-fx6v", "ilme-fx9"],
    batteryTerms: ["bp-u35", "bpu35", "bp-u70", "bpu70", "bp-u"],
  },
  {
    id: "canon-lp-e6",
    label: "Canon LP-E6 batteries",
    cameraModelTerms: ["r5", "r6", "r7", "c70", "c100", "c200"],
    batteryTerms: ["lp-e6", "lpe6", "canon battery"],
  },
  {
    id: "v-mount",
    label: "V-mount batteries",
    cameraModelTerms: ["ursa", "komodo", "venice", "c300", "c500", "fx6", "fx9"],
    batteryTerms: ["v-mount", "vmount", "v mount", "gold mount"],
  },
];

function haystack(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function isBatteryCamera(asset: BatteryCameraLike) {
  const text = haystack([asset.type, asset.categoryName, asset.brand, asset.model]);
  return /\b(cameras?|camcorder|cinema|mirrorless|dslr|bod(?:y|ies))\b/.test(text);
}

function quantityForSku(sku: BatterySkuLike) {
  return sku.availableQuantity ?? sku.currentQuantity ?? 0;
}

function thresholdForSkus(skus: BatterySkuLike[]) {
  return Math.max(
    DEFAULT_LOW_BATTERY_THRESHOLD,
    ...skus.map((sku) => sku.minThreshold ?? 0),
  );
}

export function getBatteryCompatibilitySummaries(args: {
  cameraAssets: BatteryCameraLike[];
  bulkSkus: BatterySkuLike[];
  rules?: BatteryCompatibilityRule[];
}): BatteryCompatibilitySummary[] {
  const rules = args.rules ?? BATTERY_COMPATIBILITY_RULES;
  const cameras = args.cameraAssets.filter(isBatteryCamera);
  if (cameras.length === 0) return [];

  return rules.flatMap((rule) => {
    const matchingCameras = cameras.filter((camera) => {
      const text = haystack([camera.brand, camera.model]);
      return rule.cameraModelTerms.some((term) => text.includes(term));
    });
    if (matchingCameras.length === 0) return [];

    const matchingSkus = args.bulkSkus.filter((sku) => {
      const text = haystack([sku.name, sku.category, sku.categoryName]);
      return rule.batteryTerms.some((term) => text.includes(term));
    });
    if (matchingSkus.length === 0) return [];

    const availableQuantity = matchingSkus.reduce((sum, sku) => sum + quantityForSku(sku), 0);
    const threshold = thresholdForSkus(matchingSkus);
    const cameraModels = [...new Set(matchingCameras.map((camera) => camera.model).filter((model): model is string => !!model))];

    return [{
      ruleId: rule.id,
      label: rule.label,
      cameraModels,
      cameraCount: matchingCameras.length,
      batterySkuIds: matchingSkus.map((sku) => sku.id),
      batterySkuNames: matchingSkus.map((sku) => sku.name),
      availableQuantity,
      threshold,
      isLow: availableQuantity < threshold,
    }];
  });
}
