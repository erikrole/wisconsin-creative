"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResourceType } from "@/lib/client-enums";
import { ArrowLeftIcon, ArrowRightIcon, BadgeCheckIcon, LinkIcon, PencilIcon } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { MarkdownReader } from "@/components/resources/MarkdownReader";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { legacyGuideMarkdown, markdownHeadings, omitDuplicateLeadHeading } from "@/lib/guide-content";
import { inferResourceTypeFromCategory, RESOURCE_TYPE_LABELS } from "@/lib/guide-categories";
import { guideFreshness } from "@/lib/guide-freshness";
import type { GuideListItem } from "@/lib/guides";
import { buildSectionNav, type SectionNav } from "@/lib/resource-search";
import { cn } from "@/lib/utils";
import { resourceTypeHref } from "../../filters";

type Guide = {
  id: string;
  title: string;
  slug: string;
  type: ResourceType;
  category: string;
  markdown: string | null;
  published: boolean;
  content: unknown;
  author: { id: string; name: string };
  lastVerifiedAt: Date | string | null;
  lastVerifiedBy: { id: string; name: string } | null;
  updatedAt: Date | string;
};

type Props = {
  guide: Guide;
  canEdit: boolean;
  slug: string;
};

type TocItem = { id: string; level: number; text: string };

function TableOfContents({ items, activeId }: { items: TocItem[]; activeId: string | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ y: 0, height: 0, ready: false });

  const scrollToHeading = useCallback((id: string) => {
    const node = document.getElementById(id);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) {
      setIndicator((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    const button = list.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(activeId)}"]`);
    if (!button) return;
    setIndicator({
      y: button.offsetTop,
      height: button.offsetHeight,
      ready: true,
    });
    const panel = list.closest(".guide-toc");
    if (panel instanceof HTMLElement) {
      const panelRect = panel.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      if (buttonRect.top < panelRect.top) {
        panel.scrollTop -= panelRect.top - buttonRect.top;
      } else if (buttonRect.bottom > panelRect.bottom) {
        panel.scrollTop += buttonRect.bottom - panelRect.bottom;
      }
    }
  }, [activeId, items]);

  if (items.length === 0) return null;

  return (
    <nav aria-label="On this page" className="min-h-0">
      <p className="guide-side-label">On this page</p>
      <div ref={listRef} className="guide-toc-list">
        <span
          aria-hidden="true"
          className={cn("guide-toc-indicator", indicator.ready && "guide-toc-indicator-ready")}
          style={{
            transform: `translateY(${indicator.y}px)`,
            height: indicator.height,
          }}
        />
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-toc-id={item.id}
            onClick={() => scrollToHeading(item.id)}
            className={cn(
              "guide-toc-link outline-none transition-[color,scale] hover:text-foreground active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring",
              item.level === 3 && "guide-toc-link-h3",
              activeId === item.id && "guide-toc-link-active",
            )}
          >
            {item.text}
          </button>
        ))}
      </div>
    </nav>
  );
}

function SiblingNav({ nav }: { nav: SectionNav }) {
  // The rail keeps its column even when empty so the article never shifts left.
  if (nav.siblings.length === 0) return <div className="guide-rail hidden lg:block" aria-hidden="true" />;

  return (
    <nav aria-label="In this section" className="guide-rail hidden min-h-0 self-stretch lg:block">
      <div className="guide-section-nav">
        <p className="guide-side-label">
          {nav.typeLabel ? `In ${nav.typeLabel}` : "In this section"}
        </p>
        <div className="guide-section-nav-list">
          {nav.siblings.map((item) => (
            <Link
              key={item.id}
              href={`/resources/${item.slug}`}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "guide-section-link outline-none transition-[background-color,color,scale] hover:text-foreground active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring",
                item.current && "guide-section-link-active",
              )}
            >
              {item.title}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

function PrevNext({ nav }: { nav: SectionNav }) {
  if (!nav.prev && !nav.next) return null;

  return (
    <nav
      aria-label="Section pagination"
      className="grid gap-3 border-t border-border pt-7 sm:grid-cols-2"
    >
      {nav.prev ? (
        <Link
          href={`/resources/${nav.prev.slug}`}
          className="flex min-h-11 flex-col gap-1 rounded-xl p-3 outline-none transition-[background-color,scale] hover:bg-muted active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            Previous
          </span>
          <span className="line-clamp-1 text-[0.9375rem] font-bold text-foreground">{nav.prev.title}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" aria-hidden="true" />
      )}
      {nav.next ? (
        <Link
          href={`/resources/${nav.next.slug}`}
          className="flex min-h-11 flex-col items-end gap-1 rounded-xl p-3 text-right outline-none transition-[background-color,scale] hover:bg-muted active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Next
            <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="line-clamp-1 text-[0.9375rem] font-bold text-foreground">{nav.next.title}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" aria-hidden="true" />
      )}
    </nav>
  );
}

function GuideActions({
  guideId,
  slug,
  canEdit,
  stacked,
}: {
  guideId: string;
  slug: string;
  canEdit: boolean;
  stacked?: boolean;
}) {
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/resources/${slug}`);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const markVerified = async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      const res = await fetch(`/api/resources/${guideId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markVerified: true }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not mark this guide verified"));
        return;
      }
      toast.success("Marked as verified");
      router.refresh();
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className={cn("flex flex-wrap gap-2", stacked && "grid grid-cols-2")}>
      {canEdit && (
        <Button asChild variant="outline" size="sm" className="h-10 shrink-0">
          <Link href={`/resources/${slug}/edit`}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Link>
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" onClick={copyLink}>
        <LinkIcon data-icon="inline-start" />
        Copy link
      </Button>
      {canEdit && (
        <Button
          type="button"
          size="sm"
          className={cn("h-10 shrink-0", stacked && "col-span-2")}
          onClick={markVerified}
          loading={verifying}
          disabled={verifying}
        >
          <BadgeCheckIcon data-icon="inline-start" />
          Mark verified
        </Button>
      )}
    </div>
  );
}

export function GuideReader({ guide, canEdit, slug }: Props) {
  const markdown = useMemo(
    () => omitDuplicateLeadHeading(
      legacyGuideMarkdown(guide.markdown, guide.content),
      guide.title,
    ),
    [guide.content, guide.markdown, guide.title],
  );
  const headings = useMemo(() => markdownHeadings(markdown), [markdown]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  const { data: guideList } = useFetch<GuideListItem[]>({
    url: "/api/resources",
    transform: (json) => (json as { data: GuideListItem[] }).data ?? [],
  });
  const sectionNav = useMemo(
    () => buildSectionNav(guideList ?? [], guide.id),
    [guideList, guide.id],
  );

  useEffect(() => {
    if (headings.length === 0) return;

    let frame = 0;
    const updateActiveHeading = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let activeId = headings[0]?.id ?? null;
        for (const heading of headings) {
          const node = document.getElementById(heading.id);
          if (!node) continue;
          if (node.getBoundingClientRect().top <= 140) {
            activeId = heading.id;
          } else {
            break;
          }
        }
        setActiveHeadingId(activeId);
      });
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [guide.id, headings]);

  const hasToC = headings.length >= 2;
  const guideType = guide.type ?? inferResourceTypeFromCategory(guide.category);
  const typeLabel = RESOURCE_TYPE_LABELS[guideType];
  const freshness = guideFreshness(guide);
  const verifiedBy = freshness.verified && !freshness.stale ? guide.lastVerifiedBy?.name : null;

  return (
    <div className="guide-reader-shell mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/resources" className="rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          Resources
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={resourceTypeHref(guideType)} className="rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {typeLabel}
        </Link>
      </nav>

      <div className="guide-reader-grid">
        <SiblingNav nav={sectionNav} />

        <div className="flex min-w-0 flex-col gap-8">
          <header className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="resource-pill">{typeLabel}</span>
              {guide.category && guide.category !== typeLabel && (
                <span className="resource-pill resource-pill-draft">{guide.category}</span>
              )}
              {!guide.published && <span className="resource-pill resource-pill-draft">Draft</span>}
              <span className={cn("resource-freshness", freshness.stale && "resource-freshness-stale")}>
                {freshness.label}
                {verifiedBy ? ` by ${verifiedBy}` : ""}
              </span>
            </div>
            <h1 className="guide-reader-title">{guide.title}</h1>
            <div className="xl:hidden">
              <GuideActions guideId={guide.id} slug={slug} canEdit={canEdit} />
            </div>
          </header>

          <article className="guide-article min-w-0">
            <MarkdownReader markdown={markdown || "_No content yet._"} />
          </article>

          <PrevNext nav={sectionNav} />
        </div>

        <aside className="guide-toc-column hidden min-h-0 self-stretch xl:block">
          <div className="guide-toc">
            <GuideActions guideId={guide.id} slug={slug} canEdit={canEdit} stacked />
            {hasToC && <TableOfContents items={headings} activeId={activeHeadingId} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
