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

  return (
    <div
      className={cn("flex flex-col", preview && "pointer-events-none select-none", className)}
      aria-hidden={preview || undefined}
    >
      <AnnouncementMedia images={images} alt={announcement.imageAlt ?? null} inert={preview} />
      <div className={cn("relative overflow-hidden px-6 pb-5 sm:px-7", images.length ? "pt-5" : "pt-6 sm:pt-7")}>
        {/* Without a banner, a quiet wash of Wisconsin red in the corner gives the splash a sense of occasion. */}
        <div
          aria-hidden="true"
          hidden={images.length > 0}
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_0%_0%,var(--wi-red-soft),transparent_62%)] dark:bg-[radial-gradient(120%_90%_at_0%_0%,color-mix(in_oklab,var(--wi-red)_16%,transparent),transparent_62%)]"
        />
        <div className="relative flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-background text-[var(--wi-red)] shadow-sm ring-1 ring-[var(--wi-red)]/15"
          >
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
          <p className="m-0 flex min-w-0 items-baseline gap-2 text-xs">
            <span className="font-semibold uppercase tracking-[0.08em] text-[var(--wi-red)]">{announcement.kindLabel}</span>
            <span aria-hidden="true" className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{formatPostedDate(announcement.publishedAt)}</span>
          </p>
          {remaining > 0 ? (
            <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              {remaining} more
            </span>
          ) : null}
        </div>
        <h2
          aria-hidden={headingHidden || undefined}
          className="relative m-0 mt-5 text-balance text-[1.625rem] font-semibold leading-[1.15] tracking-[-0.015em] text-foreground"
        >
          {announcement.title || "Your title"}
        </h2>
      </div>

      <div className="flex flex-col gap-3 px-6 text-[0.9375rem] leading-relaxed text-muted-foreground sm:px-7">
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
                  <li key={j} className="flex gap-3 text-pretty text-foreground/85">
                    <span
                      aria-hidden="true"
                      className="mt-[0.2em] flex size-[1.125rem] shrink-0 items-center justify-center rounded-full bg-[var(--wi-red-soft)] text-[var(--wi-red)] dark:bg-[var(--wi-red)]/15"
                    >
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ),
          )
        )}
      </div>

      <div className="flex flex-col gap-2 px-6 pb-6 pt-6 sm:flex-row-reverse sm:justify-start sm:px-7 sm:pb-7">
        <Button
          type="button"
          variant="brand"
          size="lg"
          onClick={hasCta ? onCta : onDismiss}
          className="sm:h-10 sm:min-w-28"
          data-announcement-primary=""
          {...inert}
        >
          {hasCta ? announcement.ctaLabel : "Got it"}
        </Button>
        {hasCta ? (
          <Button type="button" variant="ghost" size="lg" onClick={onDismiss} className="text-muted-foreground sm:h-10" {...inert}>
            Close
          </Button>
        ) : null}
      </div>
    </div>
  );
}
