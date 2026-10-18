import { Megaphone, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActiveAnnouncement, AnnouncementKindValue } from "@/lib/announcements";

const KIND_ICON: Record<AnnouncementKindValue, LucideIcon> = {
  FEATURE: Sparkles,
  UPDATE: RefreshCw,
  NOTICE: Megaphone,
};

type AnnouncementCardProps = {
  announcement: Pick<ActiveAnnouncement, "kind" | "kindLabel" | "title" | "blocks" | "ctaLabel" | "ctaUrl">;
  onCta?: () => void;
  onDismiss?: () => void;
  /** Render inert (the admin preview). */
  preview?: boolean;
  /** The dialog already announces the title; hide the visible copy from assistive tech. */
  headingHidden?: boolean;
  className?: string;
};

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

  return (
    <div className={cn("flex flex-col gap-5 p-6 sm:p-7", className)}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--wi-red-soft)] text-[var(--wi-red)] dark:bg-[var(--wi-red)]/15"
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--wi-red)]">
          {announcement.kindLabel}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 aria-hidden={headingHidden || undefined} className="m-0 text-balance text-[1.625rem] font-semibold leading-tight tracking-tight text-foreground">
          {announcement.title || "Your title"}
        </h2>
        <div className="flex flex-col gap-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
          {announcement.blocks.length === 0 ? (
            <p className="m-0">Your message appears here.</p>
          ) : (
            announcement.blocks.map((block, i) =>
              block.type === "paragraph" ? (
                <p key={i} className="m-0 text-pretty">
                  {block.text}
                </p>
              ) : (
                <ul key={i} className="m-0 flex list-none flex-col gap-2 p-0">
                  {block.items.map((item, j) => (
                    <li key={j} className="flex gap-3 text-pretty">
                      <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-[var(--wi-red)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ),
            )
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {hasCta ? (
          <Button type="button" variant="ghost" onClick={onDismiss} disabled={preview} className="text-muted-foreground">
            Not now
          </Button>
        ) : null}
        <Button type="button" variant="brand" onClick={hasCta ? onCta : onDismiss} disabled={preview} className="sm:min-w-28">
          {hasCta ? announcement.ctaLabel : "Got it"}
        </Button>
      </div>
    </div>
  );
}
