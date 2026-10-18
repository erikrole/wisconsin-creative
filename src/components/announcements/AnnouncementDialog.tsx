"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";

type AnnouncementDialogProps = {
  announcement: Parameters<typeof AnnouncementCard>[0]["announcement"];
  onCta?: () => void;
  /** Called for Close, Got it, Escape, and a click outside. */
  onDismiss: () => void;
};

/**
 * The splash frame: a centered card on desktop, a bottom sheet on phones.
 * Focus lands on the panel, not a button, so nothing looks pre-selected and a
 * stray Enter can't fire the call to action.
 */
export function AnnouncementDialog({ announcement, onCta, onDismiss }: AnnouncementDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onDismiss())}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className="max-w-[440px] gap-0 outline-none sm:rounded-[20px] max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[88dvh] max-sm:translate-y-0 max-sm:rounded-t-[24px] max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)] max-sm:data-[state=open]:slide-in-from-bottom-8 max-sm:data-[state=open]:zoom-in-100"
      >
        <DialogTitle className="sr-only">{announcement.title}</DialogTitle>
        <DialogDescription className="sr-only">{announcement.kindLabel} announcement</DialogDescription>
        <div aria-hidden="true" className="absolute left-1/2 top-2 z-10 h-1 w-9 -translate-x-1/2 rounded-full bg-foreground/20 mix-blend-luminosity sm:hidden" />
        <AnnouncementCard headingHidden announcement={announcement} onCta={onCta} onDismiss={onDismiss} />
      </DialogContent>
    </Dialog>
  );
}
