"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ResourceType } from "@prisma/client";
import { ArrowLeftIcon, ArrowRightIcon, PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownReader } from "@/components/resources/MarkdownReader";
import { useFetch } from "@/hooks/use-fetch";
import { legacyGuideMarkdown, markdownHeadings, omitDuplicateLeadHeading } from "@/lib/guide-content";
import { inferResourceTypeFromCategory, RESOURCE_TYPE_LABELS } from "@/lib/guide-categories";
import type { GuideListItem } from "@/lib/guides";
import { buildSectionNav, type SectionNav } from "@/lib/resource-search";
import { cn } from "@/lib/utils";

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
    <nav aria-label="On this page" className="guide-toc-column hidden min-h-0 self-stretch xl:block">
      <div className="guide-toc">
        <p className="guide-toc-label">On this page</p>
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
      </div>
    </nav>
  );
}

function SiblingNav({ nav }: { nav: SectionNav }) {
  if (nav.siblings.length === 0) return null;

  return (
    <nav aria-label="In this section" className="hidden shrink-0 self-stretch 2xl:block 2xl:w-[220px]">
      <div className="guide-section-nav">
        <p className="guide-section-nav-label">
          {nav.typeLabel ?? "In this section"}
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
      className="mt-2 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
    >
      {nav.prev ? (
        <Link
          href={`/resources/${nav.prev.slug}`}
          className="flex min-h-11 flex-col gap-1 rounded-lg border p-4 outline-none transition-[background-color,border-color,scale] hover:border-foreground/30 hover:bg-muted/40 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            Previous
          </span>
          <span className="line-clamp-1 text-sm font-medium text-foreground">{nav.prev.title}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" aria-hidden="true" />
      )}
      {nav.next ? (
        <Link
          href={`/resources/${nav.next.slug}`}
          className="flex min-h-11 flex-col items-end gap-1 rounded-lg border p-4 text-right outline-none transition-[background-color,border-color,scale] hover:border-foreground/30 hover:bg-muted/40 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Next
            <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="line-clamp-1 text-sm font-medium text-foreground">{nav.next.title}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" aria-hidden="true" />
      )}
    </nav>
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

  return (
    <div className="guide-reader-shell mx-auto flex w-full max-w-[1440px] justify-center gap-10 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <SiblingNav nav={sectionNav} />

      <div className="flex w-full min-w-0 max-w-[1120px] flex-col gap-8">
      <div>
        <Link
          href="/resources"
          className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground outline-none transition-[color,scale] hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-3.5" />
          All guides
        </Link>
      </div>

      <div className="guide-reader-header flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 max-w-4xl flex-col gap-3">
          <h1 className="guide-reader-title">{guide.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{typeLabel}</Badge>
            {guide.category && guide.category !== typeLabel && (
              <Badge variant="outline">{guide.category}</Badge>
            )}
            {!guide.published && (
              <Badge variant="outline" className="text-[10px]">Draft</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Updated{" "}
              {new Date(guide.updatedAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        {canEdit && (
          <Button asChild variant="outline" size="sm" className="h-10 shrink-0">
            <Link href={`/resources/${slug}/edit`}>
              <PencilIcon data-icon="inline-start" />
              Edit
            </Link>
          </Button>
        )}
      </div>

      <div className={cn("guide-reader-grid", hasToC && "xl:grid xl:grid-cols-[minmax(0,860px)_220px] xl:gap-12")}>
        <article className="guide-article min-w-0">
          <MarkdownReader markdown={markdown || "_No content yet._"} />
        </article>

        {hasToC && (
          <TableOfContents items={headings} activeId={activeHeadingId} />
        )}
      </div>

      <PrevNext nav={sectionNav} />
      </div>
    </div>
  );
}
