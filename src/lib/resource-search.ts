import { inferResourceTypeFromCategory, RESOURCE_TYPE_LABELS } from "@/lib/guide-categories";
import type { GuideListItem } from "@/lib/guides";

// How much guide body text to feed the fuzzy matcher. Enough to match a phrase
// buried in a guide without making every keystroke score huge strings.
export const BODY_MATCH_CHARS = 800;

type ResourceSearchEntry = {
  guide: GuideListItem;
  typeLabel: string;
  /** Space-joined haystack handed to cmdk for fuzzy matching. */
  value: string;
};

/**
 * Build the client-side search index for the Resources command palette. Matching
 * spans title, category, typed focus label, author, and a bounded body excerpt so
 * a search finds guides by content, not just title.
 */
export function buildResourceSearchIndex(guides: GuideListItem[]): ResourceSearchEntry[] {
  return guides.map((guide) => {
    const type = guide.type ?? inferResourceTypeFromCategory(guide.category);
    const typeLabel = RESOURCE_TYPE_LABELS[type];
    const body = (guide.searchText ?? "").slice(0, BODY_MATCH_CHARS);
    return {
      guide,
      typeLabel,
      value: [guide.title, guide.category, typeLabel, guide.author.name, body]
        .filter(Boolean)
        .join(" "),
    };
  });
}

/** Most-recently-updated entries first, capped to `count`. */
export function selectRecentEntries(
  entries: ResourceSearchEntry[],
  count: number,
): ResourceSearchEntry[] {
  return [...entries]
    .sort(
      (a, b) =>
        new Date(b.guide.updatedAt).getTime() - new Date(a.guide.updatedAt).getTime(),
    )
    .slice(0, count);
}

/**
 * Split a (already display-ordered) guide list into the admin-featured lead and
 * the remaining library. Featured guides sort by `featuredRank` (unranked last),
 * then most-recent. When nothing is featured, the whole list stays in `library`
 * so the landing renders exactly as before.
 */
export function splitFeaturedGuides(guides: GuideListItem[]): {
  featured: GuideListItem[];
  library: GuideListItem[];
} {
  const featured = guides
    .filter((guide) => guide.featured)
    .sort((a, b) => {
      const rankA = a.featuredRank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.featuredRank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const library = featured.length > 0 ? guides.filter((guide) => !guide.featured) : guides;
  return { featured, library };
}

export type SectionNavLink = { slug: string; title: string };

type SectionNavItem = SectionNavLink & { id: string; current: boolean };

export type SectionNav = {
  /** Typed-focus label shared by the section, or null when there is no section. */
  typeLabel: string | null;
  /** Guides in the same typed focus, title-sorted, current one flagged. */
  siblings: SectionNavItem[];
  prev: SectionNavLink | null;
  next: SectionNavLink | null;
};

function resolveType(guide: GuideListItem) {
  return guide.type ?? inferResourceTypeFromCategory(guide.category);
}

/**
 * Build the docs-style "in this section" navigation for a guide: the title-sorted
 * list of guides sharing its typed focus, plus prev/next links within that order.
 * Reuses the role-filtered list the API already returns, so students never see a
 * link they cannot open.
 */
export function buildSectionNav(guides: GuideListItem[], currentId: string): SectionNav {
  const empty: SectionNav = { typeLabel: null, siblings: [], prev: null, next: null };

  const current = guides.find((g) => g.id === currentId);
  if (!current) return empty;

  const currentType = resolveType(current);
  const group = guides
    .filter((g) => resolveType(g) === currentType)
    .sort((a, b) => a.title.localeCompare(b.title));

  // A section of one (just this guide) offers no useful navigation.
  if (group.length < 2) return empty;

  const index = group.findIndex((g) => g.id === currentId);
  const prevGuide = index > 0 ? group[index - 1] : undefined;
  const nextGuide = index < group.length - 1 ? group[index + 1] : undefined;

  return {
    typeLabel: RESOURCE_TYPE_LABELS[currentType],
    siblings: group.map((g) => ({
      id: g.id,
      slug: g.slug,
      title: g.title,
      current: g.id === currentId,
    })),
    prev: prevGuide ? { slug: prevGuide.slug, title: prevGuide.title } : null,
    next: nextGuide ? { slug: nextGuide.slug, title: nextGuide.title } : null,
  };
}
