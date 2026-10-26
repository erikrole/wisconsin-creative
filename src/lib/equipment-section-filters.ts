/**
 * Prisma WHERE clause builders for equipment section filtering.
 *
 * Mirrors `classifyAssetType` in equipment-sections.ts as database filters, so
 * every asset lands in exactly the section the picker counts it under: a known
 * category decides first, and only an asset without one falls back to the first
 * section whose type keyword matches.
 */
import { Prisma } from "@prisma/client";
import {
  BUCKET_KEYWORDS,
  CATEGORY_MAP,
  KEYWORD_SECTION_ORDER,
  type EquipmentSectionKey,
} from "@/lib/equipment-sections";

const MAPPED_CATEGORY_NAMES = Object.keys(CATEGORY_MAP);

function categoryNamesFor(section: EquipmentSectionKey): string[] {
  return MAPPED_CATEGORY_NAMES.filter((name) => CATEGORY_MAP[name] === section);
}

/** No category, or one the category map does not know, so the type decides. */
const UNMAPPED_CATEGORY: Prisma.AssetWhereInput = {
  OR: [
    { categoryId: null },
    { category: { name: { notIn: MAPPED_CATEGORY_NAMES, mode: "insensitive" } } },
  ],
};

function typeMatches(section: EquipmentSectionKey): Prisma.AssetWhereInput {
  return { OR: BUCKET_KEYWORDS[section].map((keyword) => ({ type: { contains: keyword, mode: "insensitive" } })) };
}

/** Build a Prisma WHERE clause that matches assets belonging to a section. */
export function sectionWhere(section: EquipmentSectionKey): Prisma.AssetWhereInput {
  if (section === "other") {
    // The catch-all: assets that no keyword section claims.
    return { NOT: { OR: KEYWORD_SECTION_ORDER.map(sectionMatchClause) } };
  }
  return sectionMatchClause(section);
}

function sectionMatchClause(section: Exclude<EquipmentSectionKey, "other">): Prisma.AssetWhereInput {
  const earlierSections = KEYWORD_SECTION_ORDER.slice(0, KEYWORD_SECTION_ORDER.indexOf(section));
  return {
    OR: [
      { category: { name: { in: categoryNamesFor(section), mode: "insensitive" } } },
      {
        AND: [
          UNMAPPED_CATEGORY,
          typeMatches(section),
          ...earlierSections.map((earlier) => ({ NOT: typeMatches(earlier) })),
        ],
      },
    ],
  };
}

/** All section keys for iteration. */
export const ALL_SECTION_KEYS: EquipmentSectionKey[] = [
  "cameras", "lenses", "batteries", "audio", "tripods", "lighting", "other",
];
