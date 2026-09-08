/**
 * Equipment section definitions for guided checkout picker.
 *
 * 7 tabs with DB-category batching:
 *   Cameras  ← "Cameras" category
 *   Lenses   ← "Lenses" category
 *   Batteries ← "Batteries" category
 *   Audio    ← "Audio", "Microphones", "Recorders" categories
 *   Tripods  ← "Tripods", "Support" categories
 *   Lighting ← "Lighting", "Lights" categories
 *   Other    ← everything else (monitors, media storage, office, etc.)
 *
 * Classification priority:
 *   1. Asset's DB category name (via categoryId → Category.name)
 *   2. Fallback: keyword matching on asset `type` string
 */

export type EquipmentSectionKey =
  | "cameras"
  | "lenses"
  | "batteries"
  | "audio"
  | "tripods"
  | "lighting"
  | "other";

export type EquipmentSection = {
  key: EquipmentSectionKey;
  label: string;
  description: string;
};

export const EQUIPMENT_SECTIONS: EquipmentSection[] = [
  { key: "cameras", label: "Cameras", description: "Camera bodies and camcorders" },
  { key: "lenses", label: "Lenses", description: "Camera lenses" },
  { key: "batteries", label: "Batteries", description: "Batteries, chargers, and power" },
  { key: "audio", label: "Audio", description: "Microphones, recorders, and wireless" },
  { key: "tripods", label: "Tripods", description: "Tripods, monopods, and support" },
  { key: "lighting", label: "Lighting", description: "Lights and lighting equipment" },
  { key: "other", label: "Other", description: "Monitors, media storage, and accessories" },
];

/**
 * Category name → equipment section mapping.
 * Keys are lowercased category names.
 */
const CATEGORY_MAP: Record<string, EquipmentSectionKey> = {
  // Cameras tab
  cameras: "cameras",
  camera: "cameras",
  "camera bodies": "cameras",
  bodies: "cameras",
  // Lenses tab
  lenses: "lenses",
  lens: "lenses",
  // Batteries tab
  batteries: "batteries",
  battery: "batteries",
  // Audio tab
  audio: "audio",
  microphones: "audio",
  microphone: "audio",
  recorders: "audio",
  recorder: "audio",
  wireless: "audio",
  // Tripods tab
  tripods: "tripods",
  tripod: "tripods",
  support: "tripods",
  // Lighting tab
  lighting: "lighting",
  lights: "lighting",
  light: "lighting",
  // Other tab (monitors, media storage, office, etc.)
  monitors: "other",
  monitor: "other",
  "media storage": "other",
  "media cards": "other",
  storage: "other",
  office: "other",
};

/**
 * Normalized keyword sets for type-based fallback classification.
 */
const BUCKET_KEYWORDS: Record<EquipmentSectionKey, string[]> = {
  cameras: [
    "camera", "camcorder", "cinema camera", "dslr", "mirrorless",
    "video camera", "camera body",
  ],
  lenses: ["lens", "lenses"],
  batteries: [
    "battery", "batteries", "charger", "power supply", "power",
    "v-mount", "vmount", "gold mount",
  ],
  audio: [
    "microphone", "mic", "audio", "mixer", "headphone",
    "lavalier", "shotgun mic", "recorder", "transmitter", "receiver", "wireless",
  ],
  tripods: ["tripod", "monopod", "slider"],
  lighting: ["lighting", "light", "led panel", "fresnel", "strobe"],
  other: [], // catch-all — never matched by keywords
};

/**
 * Classify an asset into an equipment section.
 * Checks category name first, then falls back to keyword matching on type.
 */
export function classifyAssetType(type: string, categoryName?: string | null): EquipmentSectionKey {
  // 1. Try category name mapping
  if (categoryName) {
    const catKey = CATEGORY_MAP[categoryName.toLowerCase().trim()];
    if (catKey) return catKey;
  }

  // 2. Fallback to keyword matching on type
  const normalized = type.toLowerCase().trim();
  const orderedKeys: EquipmentSectionKey[] = ["cameras", "lenses", "batteries", "audio", "tripods", "lighting"];
  for (const key of orderedKeys) {
    for (const keyword of BUCKET_KEYWORDS[key]) {
      if (normalized.includes(keyword)) {
        return key;
      }
    }
  }

  return "other";
}

type BulkSkuLike = { id: string; category: string; categoryName?: string | null; [k: string]: unknown };

/**
 * Group bulk SKUs by equipment section.
 */
export function groupBulkBySection<T extends BulkSkuLike>(
  skus: T[]
): Record<EquipmentSectionKey, T[]> {
  const groups: Record<EquipmentSectionKey, T[]> = {
    cameras: [],
    lenses: [],
    batteries: [],
    audio: [],
    tripods: [],
    lighting: [],
    other: [],
  };

  for (const sku of skus) {
    const section = classifyAssetType(sku.category, sku.categoryName);
    groups[section].push(sku);
  }

  return groups;
}
