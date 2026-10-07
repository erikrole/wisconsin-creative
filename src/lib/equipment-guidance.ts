import type { EquipmentSectionKey } from "./equipment-sections";

export type GuidanceContext = {
  selectedSectionKeys: EquipmentSectionKey[];
  activeSection: EquipmentSectionKey;
};

export type GuidanceRule = {
  id: string;
  section: EquipmentSectionKey | null;
  message: string;
  level: "info" | "warning" | "requirement";
  condition: (ctx: GuidanceContext) => boolean;
};

export const EQUIPMENT_GUIDANCE_RULES: GuidanceRule[] = [
  // ── Core pairing rules ──────────────────────────────────
  {
    id: "body-needs-batteries",
    section: "batteries",
    message:
      "Camera body selected — add Sony Battery, Monitor Battery, Gold Mount, or FX6 Battery quantity. Exact units bind at pickup.",
    level: "warning",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("cameras") &&
      !ctx.selectedSectionKeys.includes("batteries"),
  },
  {
    id: "lens-needs-body",
    section: "lenses",
    message: "You\u2019ve added lenses but no camera body. Add a body in the Cameras tab.",
    level: "warning",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("lenses") &&
      !ctx.selectedSectionKeys.includes("cameras"),
  },
  {
    id: "audio-with-video",
    section: "audio",
    message: "Don\u2019t forget audio gear \u2014 recorder, microphone, or wireless kit.",
    level: "info",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("cameras") &&
      !ctx.selectedSectionKeys.includes("audio"),
  },

  // ── Support gear (family pools, not model rows) ─────────
  {
    id: "cameras-need-support",
    section: "tripods",
    message:
      "Add Tripod or Football Tripod quantity for sideline and press-box coverage. Models stay under the family and bind at pickup.",
    level: "info",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("cameras") &&
      !ctx.selectedSectionKeys.includes("tripods"),
  },
  {
    id: "cameras-need-lighting",
    section: "lighting",
    message:
      "Need lights? Reserve Light Kit or Football Light Kit — cased sets, not brand rows. Exact cases bind at pickup.",
    level: "info",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("cameras") &&
      !ctx.selectedSectionKeys.includes("lighting"),
  },
  {
    id: "monitors-need-power",
    section: "batteries",
    message: "Field monitors drain batteries fast \u2014 pack Monitor Battery or Gold Mount extras.",
    level: "warning",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("other") &&
      !ctx.selectedSectionKeys.includes("batteries"),
  },

  // ── Media & storage ─────────────────────────────────────
  {
    id: "cameras-need-media",
    section: "other",
    message: "SD cards and hard drives are in the Other tab \u2014 pack enough for the shoot.",
    level: "info",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("cameras") &&
      !ctx.selectedSectionKeys.includes("other"),
  },

  // ── Transport ───────────────────────────────────────────
  {
    id: "large-kit-needs-bags",
    section: "other",
    message: "Large checkout \u2014 make sure you have backpacks or cases for transport.",
    level: "info",
    condition: (ctx) => {
      const selected = ctx.selectedSectionKeys;
      return selected.length >= 3 && !selected.includes("other");
    },
  },

  // ── Completeness warnings ──────────────────────────────
  {
    id: "batteries-alone",
    section: "cameras",
    message: "You have batteries but no camera \u2014 add a body if this is a shoot checkout.",
    level: "info",
    condition: (ctx) =>
      ctx.selectedSectionKeys.includes("batteries") &&
      !ctx.selectedSectionKeys.includes("cameras") &&
      !ctx.selectedSectionKeys.includes("lenses"),
  },
  {
    id: "accessories-without-cameras",
    section: "cameras",
    message: "You have support gear (audio, tripods, or light kits) but no camera body.",
    level: "info",
    condition: (ctx) =>
      (ctx.selectedSectionKeys.includes("audio")
        || ctx.selectedSectionKeys.includes("tripods")
        || ctx.selectedSectionKeys.includes("lighting")) &&
      !ctx.selectedSectionKeys.includes("cameras") &&
      !ctx.selectedSectionKeys.includes("lenses"),
  },

  // ── Return reminder ─────────────────────────────────────
  {
    id: "multi-section-return-reminder",
    section: null,
    message: "Multi-category checkout \u2014 double-check everything is packed before returning.",
    level: "info",
    condition: (ctx) => ctx.selectedSectionKeys.length >= 4,
  },
];

/** Hard blockers for review advance (none today; reserved for future requirements). */
export function getUnsatisfiedRequirements(selectedSectionKeys: EquipmentSectionKey[]): GuidanceRule[] {
  const ctx: GuidanceContext = { selectedSectionKeys, activeSection: "cameras" };
  return EQUIPMENT_GUIDANCE_RULES.filter(
    (rule) => rule.level === "requirement" && rule.condition(ctx),
  );
}

/**
 * Section-scoped advisory hints for the equipment picker. Shows rules that
 * target the active tab (or global null-section rules) when their condition
 * is already true from the current selection.
 */
export function getSectionGuidance(ctx: GuidanceContext): GuidanceRule[] {
  return EQUIPMENT_GUIDANCE_RULES.filter((rule) => {
    if (!rule.condition(ctx)) return false;
    if (rule.level === "requirement") return false;
    if (rule.section === null) return ctx.selectedSectionKeys.length >= 4;
    return rule.section === ctx.activeSection;
  });
}
