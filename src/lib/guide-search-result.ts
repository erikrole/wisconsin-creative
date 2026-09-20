import { ResourceType } from "@prisma/client";
import { RESOURCE_TYPE_LABELS } from "@/lib/guide-categories";

export type GuideSearchHit = {
  id: string;
  title?: string | null;
  slug?: string | null;
  type?: string | null;
  summary?: string | null;
  published?: boolean | null;
  searchText?: string | null;
};

type GuideSearchResult = {
  type: "guide";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  status?: "DRAFT";
  searchText: string;
};

export function guideSearchTypeLabel(type?: string | null): string | null {
  if (!type) return null;
  if (Object.prototype.hasOwnProperty.call(RESOURCE_TYPE_LABELS, type)) {
    return RESOURCE_TYPE_LABELS[type as ResourceType];
  }
  return type;
}

export function mapGuideSearchResult(guide: GuideSearchHit): GuideSearchResult | null {
  const slug = guide.slug?.trim();
  if (!slug) return null;

  const typeLabel = guideSearchTypeLabel(guide.type);
  const summary = guide.summary?.trim() || null;

  return {
    type: "guide",
    id: guide.id,
    title: guide.title?.trim() || "Untitled guide",
    subtitle: [typeLabel, summary].filter(Boolean).join(" · "),
    href: `/resources/${slug}`,
    status: guide.published === false ? "DRAFT" : undefined,
    searchText: guide.searchText ?? "",
  };
}
