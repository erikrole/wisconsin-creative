"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Megaphone, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { AnnouncementMedia } from "@/components/announcements/AnnouncementMedia";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActiveAnnouncement, AnnouncementKindValue } from "@/lib/announcements";

const KIND_ICON: Record<AnnouncementKindValue, LucideIcon> = {
  FEATURE: Sparkles,
  UPDATE: RefreshCw,
  NOTICE: Megaphone,
};

type AnnouncementCardProps = {
  announcement: Pick<ActiveAnnouncement, "kind" | "kindLabel" | "title" | "blocks" | "ctaLabel" | "ctaUrl"> & {
    publishedAt?: string | null;
    remaining?: number;
    imageUrls?: string[];
    imageAlt?: string | null;
  };
  onCta?: () => void;
  onDismiss?: () => void;
  /** Render inert (the editor's side preview): looks live, takes no input. */
  preview?: boolean;
  /** The dialog already announces the title; hide the visible copy from assistive tech. */
  headingHidden?: boolean;
  className?: string;
};

/**
 * True while the scroll area has more below the fold, so the pinned buttons
 * can draw a hairline that says "keep scrolling" and drop it at the end.
 */
function useMoreBelow() {
  const ref = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);
  return { ref, moreBelow, onScroll: measure };
}

function formatPostedDate(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The announcement itself, shared by the live splash and the editor preview so
 * what an admin sees is exactly what people get.
 */
export function AnnouncementCard({
  announcement,
  onCta,
  onDismiss,
  preview = false,
  headingHidden = false,
  className,
}: AnnouncementCardProps) {
  const Icon = KIND_ICON[announcement.kind];
  const hasCta = Boolean(announcement.ctaLabel && announcement.ctaUrl);
  const remaining = announcement.remaining ?? 0;
  const images = announcement.imageUrls ?? [];
  const inert = preview ? { tabIndex: -1, "aria-hidden": true as const } : {};
  const { ref: scrollRef, onScroll, moreBelow } = useMoreBelow();

  return (
    <div
      className={cn("flex min-h-0 flex-col", preview && "pointer-events-none select-none", className)}
      aria-hidden={preview || undefined}
    >
      {/* Long messages scroll here while the buttons below stay put. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={-1}
        data-announcement-scroll=""
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
      >
        <div>
          <AnnouncementMedia images={images} alt={announcement.imageAlt ?? null} inert={preview} />
          <div className={cn("relative overflow-hidden px-6 pb-3 sm:px-7", images.length ? "pt-5" : "pt-7")}>
            {/* Without a banner, a quiet wash of Wisconsin red in the corner gives the splash a sense of occasion. */}
            <div
              aria-hidden="true"
              hidden={images.length > 0}
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_0%_0%,var(--wi-red-soft),transparent_62%)] dark:bg-[radial-gradient(120%_90%_at_0%_0%,color-mix(in_oklab,var(--wi-red)_14%,transparent),transparent_62%)]"
            />
            <div className="relative flex items-center gap-3">
              {images.length === 0 ? (
                <span
                  aria-hidden="true"
                  className="mr-0.5 flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--wi-red-soft)] text-[var(--wi-red)] dark:bg-[var(--wi-red)]/20 dark:text-[var(--red-text)]"
                >
                  <Icon className="size-[1.375rem]" strokeWidth={1.75} />
                </span>
              ) : null}
              <p className="m-0 flex min-w-0 items-center gap-2 text-xs">
                <span className="rounded-full bg-[var(--wi-red-soft)] px-2.5 py-1 font-semibold leading-none text-[var(--wi-red)] dark:bg-[var(--wi-red)]/20 dark:text-[var(--red-text)]">
                  {announcement.kindLabel}
                </span>
                <span className="text-muted-foreground">{formatPostedDate(announcement.publishedAt)}</span>
              </p>
              {remaining > 0 ? (
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{remaining} more</span>
              ) : null}
            </div>
            <h2
              aria-hidden={headingHidden || undefined}
              className="relative m-0 mt-4 text-balance text-[1.5rem] font-bold leading-[1.15] tracking-[-0.02em] text-foreground [overflow-wrap:anywhere] sm:text-[1.625rem]"
            >
              {announcement.title || "Your title"}
            </h2>
          </div>

          <div className="flex flex-col gap-3.5 px-6 pb-3 text-[0.9375rem] leading-[1.6] text-muted-foreground [overflow-wrap:anywhere] sm:px-7">
            {announcement.blocks.length === 0 ? (
              <p className="m-0">Your message appears here.</p>
            ) : (
              announcement.blocks.map((block, i) =>
                block.type === "paragraph" ? (
                  <p key={i} className="m-0 text-pretty">
                    {block.text}
                  </p>
                ) : (
                  <ul key={i} className="m-0 flex list-none flex-col gap-2.5 p-0">
                    {block.items.map((item, j) => (
                      <li key={j} className="flex gap-3 text-pretty leading-[1.5] text-foreground/90">
                        <span
                          aria-hidden="true"
                          className="mt-[0.125em] flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--wi-red-soft)] text-[var(--wi-red)] dark:bg-[var(--wi-red)]/20 dark:text-[var(--red-text)]"
                        >
                          <Check className="size-3" strokeWidth={2.75} />
                        </span>
                        <span className="min-w-0">{item}</span>
                      </li>
                    ))}
                  </ul>
                ),
              )
            )}
          </div>
        </div>
      </div>

      <div className="relative flex shrink-0 flex-col gap-1.5 px-6 pb-6 pt-4 sm:flex-row-reverse sm:justify-start sm:gap-2 sm:px-7 sm:pb-6">
        {/* When the message runs long, the text fades under the buttons instead of ending at a hard edge. */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-popover to-transparent transition-opacity duration-200 motion-reduce:transition-none",
            moreBelow ? "opacity-100" : "opacity-0",
          )}
        />
        <Button
          type="button"
          variant="brand"
          size="lg"
          onClick={hasCta ? onCta : onDismiss}
          className="h-12 min-w-0 rounded-xl text-[0.9375rem] font-semibold shadow-[0_1px_2px_rgb(0_0_0/0.14),inset_0_1px_0_rgb(255_255_255/0.14)] sm:h-10 sm:min-w-28 sm:rounded-[10px] sm:px-5 sm:text-sm"
          data-announcement-primary=""
          {...inert}
        >
          <span className="truncate">{hasCta ? announcement.ctaLabel : "Got it"}</span>
        </Button>
        {hasCta ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onDismiss}
            className="h-11 rounded-xl text-[0.9375rem] text-muted-foreground hover:text-foreground sm:h-10 sm:rounded-[10px] sm:text-sm"
            {...inert}
          >
            Close
          </Button>
        ) : null}
      </div>
    </div>
  );
}
