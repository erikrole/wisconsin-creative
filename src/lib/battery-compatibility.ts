import { unique } from "@/lib/utils";
import { batteryLowThreshold } from "@/lib/bulk-batteries";

type BatteryCameraLike = {
  brand?: string | null;
  model?: string | null;
  type?: string | null;
  categoryName?: string | null;
};

type BatterySkuLike = {
  id: string;
  name: string;
  category?: string | null;
  categoryName?: string | null;
  availableQuantity?: number | null;
  /** Units owned (not retired); sets the relative low-stock line. */
  ownedQuantity?: number | null;
  currentQuantity?: number | null;
  minThreshold?: number | null;
};

type BatteryCompatibilityRule = {
  id: string;
  label: string;
  cameraModelTerms: string[];
  batteryTerms: string[];
};

type BatteryAvailabilityAlert = {
  ruleId: string;
  label: string;
  cameraModels: string[];
  batterySkuIds: string[];
  availableQuantity: number;
  threshold: number;
};

type BatteryCompatibilitySummary = BatteryAvailabilityAlert & {
  cameraCount: number;
  batterySkuNames: string[];
  isLow: boolean;
};

const BATTERY_COMPATIBILITY_RULES: BatteryCompatibilityRule[] = [
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

/**
 * True when `term` appears in `text` as its own model token: not glued to a
 * preceding letter or digit, and not followed by a digit. A plain `includes`
 * let "r5" claim a Canon R50 and "a1" claim an A10, which attributed the wrong
 * battery family to a camera. A trailing letter is fine ("a7" in "a7iv").
 */
function hasModelTerm(text: string, term: string) {
  let from = text.indexOf(term);
  while (from !== -1) {
    const before = from === 0 ? "" : (text[from - 1] ?? "");
    const after = text[from + term.length] ?? "";
    if (!/[a-z0-9]/.test(before) && !/[0-9]/.test(after)) return true;
    from = text.indexOf(term, from + 1);
  }
  return false;
}

function haystack(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/** Whole words `isBatteryCamera` accepts. Longer forms are first so `camera` does not hide `cameras`. */
const BATTERY_CAMERA_WORDS = ["cameras", "camcorder", "camera", "mirrorless", "cinema", "bodies", "dslr", "body"] as const;

const BATTERY_CAMERA_PATTERN = new RegExp(`\\b(?:${BATTERY_CAMERA_WORDS.join("|")})\\b`);

function isBatteryCamera(asset: BatteryCameraLike) {
  const text = haystack([asset.type, asset.categoryName, asset.brand, asset.model]);
  return BATTERY_CAMERA_PATTERN.test(text);
}

/**
 * `contains` needles for Battery Ops. Each accepted word includes one of
 * these, so a name that passes `isBatteryCamera` is still loaded. `bodies`
 * does not contain `body`, and the check still drops substring false positives.
 */
export const BATTERY_CAMERA_SEARCH_TERMS = ["cameras", "camcorder", "camera", "mirrorless", "cinema", "bodies", "dslr", "body"] as const;

function quantityForSku(sku: BatterySkuLike) {
  return sku.availableQuantity ?? sku.currentQuantity ?? 0;
}

function thresholdForSkus(skus: BatterySkuLike[]) {
  const owned = skus.reduce((sum, sku) => sum + (sku.ownedQuantity ?? quantityForSku(sku)), 0);
  return batteryLowThreshold(Math.max(0, ...skus.map((sku) => sku.minThreshold ?? 0)), owned);
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
      return rule.cameraModelTerms.some((term) => hasModelTerm(text, term));
    });
    if (matchingCameras.length === 0) return [];

    const matchingSkus = args.bulkSkus.filter((sku) => {
      const text = haystack([sku.name, sku.category, sku.categoryName]);
      return rule.batteryTerms.some((term) => text.includes(term));
    });
    if (matchingSkus.length === 0) return [];

    const availableQuantity = matchingSkus.reduce((sum, sku) => sum + quantityForSku(sku), 0);
    const threshold = thresholdForSkus(matchingSkus);
    const cameraModels = unique(matchingCameras.map((camera) => camera.model).filter((model): model is string => !!model));

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
