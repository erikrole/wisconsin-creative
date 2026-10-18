"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { cn } from "@/lib/utils";

type AnnouncementDialogProps = {
  announcement: Parameters<typeof AnnouncementCard>[0]["announcement"];
  onCta?: () => void;
  /** Called for Close, Got it, Escape, and a click outside. */
  onDismiss: () => void;
};

/**
 * The splash frame: a centered card on desktop, a bottom sheet on phones.
 * Focus lands on the scrolling message, not a button, so nothing looks
 * pre-selected, a stray Enter can't fire the call to action, and the arrow keys
 * scroll a long message while its buttons stay pinned below.
 */
export function AnnouncementDialog({ announcement, onCta, onDismiss }: AnnouncementDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onDismiss())}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const panel = event.currentTarget as HTMLElement | null;
          (panel?.querySelector<HTMLElement>("[data-announcement-scroll]") ?? panel)?.focus();
        }}
        className="flex max-w-[460px] flex-col gap-0 overflow-hidden border-black/[0.06] bg-popover shadow-[0_24px_64px_-16px_rgb(0_0_0/0.32),0_2px_6px_rgb(0_0_0/0.06)] outline-none dark:border-white/10 sm:rounded-[22px] max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[88dvh] max-sm:translate-y-0 max-sm:rounded-t-[28px] max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)] max-sm:data-[state=open]:slide-in-from-bottom-8 max-sm:data-[state=open]:zoom-in-100"
      >
        <DialogTitle className="sr-only">{announcement.title}</DialogTitle>
        <DialogDescription className="sr-only">{announcement.kindLabel} announcement</DialogDescription>
        <div
          aria-hidden="true"
          className={cn(
            "absolute left-1/2 top-2 z-10 h-1 w-9 -translate-x-1/2 rounded-full sm:hidden",
            announcement.imageUrls?.length ? "bg-white/80 shadow-sm" : "bg-foreground/15",
          )}
        />
        <AnnouncementCard
          headingHidden
          className="flex-1"
          announcement={announcement}
          onCta={onCta}
          onDismiss={onDismiss}
        />
      </DialogContent>
    </Dialog>
  );
}
